import os from "os";
import build from "pino-abstract-transport";
import { OpenobserveTransport } from "@openobserve/pino-openobserve";
import pino from "pino";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";

dayjs.extend(utc);

const MACHINE_NAME = os.hostname();
const CWD = process.cwd();
const CLOSE_FLUSH_MS = 250;

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
 * Sends logs to OpenObserve with @openobserve/pino-openobserve, which owns the
 * ingest URL, Basic auth and batching.
 * Options:
 * - url: string (required) Server base URL, e.g. https://observe.stream4tech.app
 * - organization, streamName: string (required) Target organization and stream
 * - auth: object (required) { username, password } for Basic auth
 * - batchSize: number (optional) Records per request; defaults to 1 (send immediately)
 * - timeThreshold: number (optional) Max ms a partial batch waits; defaults to 5 minutes
 * - app, environment, appVersion: string (optional) Static tags stamped onto every record
 * - customLevels: object (optional) Level name -> numeric value, for severity naming
 */
const createWriteStream = (options = {}) => {
  const { app = "", environment = "", appVersion = "", customLevels, batchSize = 1, ...openObserveOptions } = options;
  if (!options.url || !options.organization || !options.streamName) {
    throw new Error('[pino-openobserve] httpConfig needs "url", "organization", "streamName" and "auth" { username, password }');
  }
  const context = { app, environment, appVersion, severities: severityByLevel(customLevels) };
  const stream = new OpenobserveTransport({ batchSize, silentSuccess: true, ...openObserveOptions });

  return build(
    async (source) => {
      for await (const log of source) {
        stream.write(`${JSON.stringify(toRecord(log, context))}\n`);
      }
    },
    {
      // Let an in-flight batch finish, then drop the timer the package keeps
      // rescheduling, which would otherwise hold this worker open
      close: async () => {
        stream.end();
        await new Promise((resolve) => setTimeout(resolve, CLOSE_FLUSH_MS));
        clearTimeout(stream.timer);
      },
    }
  );
};

export default createWriteStream;
export { createWriteStream, toRecord, severityByLevel };
