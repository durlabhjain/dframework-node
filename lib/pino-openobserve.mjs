import os from "os";
import build from "pino-abstract-transport";
import pino from "pino";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";

dayjs.extend(utc);

const MACHINE_NAME = os.hostname();
const CWD = process.cwd();
const SHUTDOWN_TIMEOUT_MS = 5_000;

// Numeric pino level -> severity name, including app levels such as { slow: 35 }
const severityByLevel = (customLevels = {}) => Object.fromEntries(
  Object.entries({ ...pino.levels.values, ...customLevels })
    .map(([name, value]) => [value, name.charAt(0).toUpperCase() + name.slice(1)])
);

// Drops empty values so OpenObserve doesn't index null/blank noise
const compact = (record) => Object.fromEntries(Object.entries(record).filter(([, value]) => {
  if (value === undefined || value === null || value === "") return false;
  return typeof value === "object" ? Object.keys(value).length > 0 : true;
}));

// Shapes a pino log line into the record OpenObserve dashboards query
const toRecord = (log, { app, environment, appVersion, severities }) => {
  const { level, time, hostname, Username, msg, message, err, query, req = {} } = log;

  return compact({
    level,
    severity: severities[level] ?? "Error",
    application_name: app,
    environment,
    app_version: appVersion,
    message: message || msg || err?.message || "",
    stack_trace: err ? `${err.stack || err.message || ""}${query ? `\r\nquery: ${query}` : ""}` : "",
    machine_name: hostname || MACHINE_NAME,
    system_path: CWD,
    utc_date: dayjs.utc(time).format("YYYY-MM-DD hh:mm:ss A"),
    user: Username,
    remote_host: req.remoteAddress,
    raw_url: req.url,
    absolute_url: req.url,
    url_referrer: req.referrer,
    query_string: req.query,
    form: req.params,
    body: req.body == null ? undefined : JSON.stringify(req.body),
    browser: req.userAgent,
  });
};

/**
 * Sends bounded, best-effort NDJSON batches to OpenObserve. File logging remains
 * independent of remote delivery failures or queue overflow.
 * Options:
 * - url: string (required) Server base URL, e.g. https://observe.stream4tech.app
 * - organization, streamName: string (required) Target organization and stream
 * - auth: object (required) { username, password } for Basic auth
 * - batchSize: number (optional) Records per request; defaults to 1 (send immediately)
 * - timeThreshold: number (optional) Max ms a partial batch waits; defaults to 5 minutes
 * - timeoutMs: number (optional) Request deadline; defaults to 10 seconds
 * - maxQueueSize: number (optional) Maximum waiting records; defaults to 1000
 * - app, environment, appVersion: string (optional) Static tags stamped onto every record
 * - customLevels: object (optional) Level name -> numeric value, for severity naming
 */
const createWriteStream = (options = {}) => {
  const {
    url, organization, streamName, auth, headers,
    app = "", environment = "", appVersion = "", customLevels,
    batchSize = 1, timeThreshold = 300_000, timeoutMs = 10_000, maxQueueSize = 1_000,
    silentSuccess = true, silentError = false,
  } = options;
  if (![url, organization, streamName, auth?.username, auth?.password].every(value => typeof value === "string" && value.trim())) {
    throw new Error('[pino-openobserve] httpConfig needs "url", "organization", "streamName" and "auth" { username, password }');
  }
  for (const [name, value] of Object.entries({ batchSize, timeThreshold, timeoutMs, maxQueueSize })) {
    if (!Number.isSafeInteger(value) || value < 1 || value > 2_147_483_647) {
      throw new Error(`[pino-openobserve] "${name}" must be a positive integer no greater than 2147483647`);
    }
  }
  if (maxQueueSize < batchSize) throw new Error('[pino-openobserve] "maxQueueSize" must be at least "batchSize"');
  const endpoint = new URL(`${url.replace(/\/+$/, "")}/api/${encodeURIComponent(organization)}/${encodeURIComponent(streamName)}/_multi`);
  if (!["http:", "https:"].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new Error('[pino-openobserve] "url" must be an HTTP(S) base URL without credentials, query or fragment');
  }
  const context = { app, environment, appVersion, severities: severityByLevel(customLevels) };
  const pending = [];
  const shutdown = new AbortController();
  let inFlight;
  let timer;
  let closing = false;
  let dropped = 0;

  const reportDropped = () => {
    if (dropped && !silentError) console.error(`[pino-openobserve] Dropped ${dropped} log(s): queue limit or shutdown deadline reached`);
    dropped = 0;
  };
  const schedule = () => {
    clearTimeout(timer);
    if (!pending.length || shutdown.signal.aborted) return;
    const delay = timeThreshold - (performance.now() - pending[0].queuedAt);
    if (closing || pending.length >= batchSize || delay <= 0) void flush();
    else timer = setTimeout(flush, delay);
  };
  const flush = () => {
    if (inFlight || !pending.length) return inFlight;
    clearTimeout(timer);
    inFlight = (async () => {
      do {
        const batch = pending.splice(0, batchSize);
        try {
          const response = await fetch(endpoint, {
            method: "POST",
            headers: {
              ...headers,
              Authorization: `Basic ${Buffer.from(`${auth.username}:${auth.password}`).toString("base64")}`,
              "Content-Type": "application/json",
            },
            body: batch.map(record => record.line).join("\n") + "\n",
            signal: AbortSignal.any([shutdown.signal, AbortSignal.timeout(timeoutMs)]),
          });
          await response.arrayBuffer();
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          if (!silentSuccess) console.log(`[pino-openobserve] Sent ${batch.length} log(s)`);
        } catch (error) {
          if (!silentError) console.error(`[pino-openobserve] Failed to send ${batch.length} log(s): ${error.message}`);
        }
      } while (pending.length && !shutdown.signal.aborted && (closing || pending.length >= batchSize || performance.now() - pending[0].queuedAt >= timeThreshold));
    })().finally(() => {
      inFlight = undefined;
      reportDropped();
      schedule();
    });
    return inFlight;
  };

  return build(
    (source) => {
      // Pino's multi-target worker ignores backpressure; cap this queue explicitly.
      source.on("data", (log) => {
        if (pending.length >= maxQueueSize) {
          dropped++;
          return;
        }
        try {
          pending.push({ line: JSON.stringify(toRecord(log, context)), queuedAt: performance.now() });
          schedule();
        } catch (error) {
          if (!silentError) console.error(`[pino-openobserve] Failed to format log: ${error.message}`);
        }
      });
    },
    {
      close: async () => {
        closing = true;
        clearTimeout(timer);
        const deadline = setTimeout(() => {
          dropped += pending.length;
          pending.length = 0;
          shutdown.abort(new Error("Shutdown deadline exceeded"));
        }, SHUTDOWN_TIMEOUT_MS);
        try {
          await flush();
          reportDropped();
        } finally {
          clearTimeout(deadline);
          clearTimeout(timer);
        }
      },
    }
  );
};

export default createWriteStream;
export { createWriteStream, toRecord, severityByLevel };
