import build from "pino-abstract-transport";
import os from "os";
import http2 from "node:http2";

// Constants computed once
const MACHINE_NAME = os.hostname();
const CWD = process.cwd();
const H2_SESSION_CLOSE_TIMEOUT_MS = 300;

const PROVIDERS = {
  EXCEPTION_HANDLER: "exceptionHandler",
  OPENOBSERVE: "openobserve",
};

// Convert nested objects into URLSearchParams-friendly strings
const convertToURLSearchParams = (obj) => {
  const params = new URLSearchParams();
  Object.entries(obj || {}).forEach(([key, value]) => {
    typeof value === "object" && value !== null
      ? params.append(key, JSON.stringify(value))
      : params.append(key, value ?? "");
  });
  return params.toString();
};

// Pulls the fields every provider needs out of a parsed pino log line
const extractCommonFields = (log) => {
  const { req = {}, ...others } = log;
  const { Username = "", time = new Date().toISOString(), hostname, pid, level, ...rest } = others;
  return { req, Username, time, hostname, pid, level, rest };
};

// Legacy provider: posts form-urlencoded params to an ExceptionHandler-style endpoint
const buildExceptionHandlerRequest = (log) => {
  const { req, Username, time, hostname, rest: errorInfo } = extractCommonFields(log);
  const paramsObj = { ...(req.params || {}), ...(req.body || {}) };

  const queryParams = new URLSearchParams();
  queryParams.set("Machine Name", hostname || MACHINE_NAME);
  queryParams.set("System Path", CWD);
  queryParams.set("Remote Host", req.remoteAddress || "");
  queryParams.set("User Agent", req.userAgent || "");
  queryParams.set("Absolute Url", req.url || "");
  queryParams.set("UrlReferrer", req.referrer || "");
  queryParams.set("Date/ Time (UTC)", time);
  queryParams.set("User", Username);
  queryParams.set("exception", JSON.stringify(errorInfo));
  queryParams.set("Form", convertToURLSearchParams(paramsObj));
  queryParams.set("QueryString", convertToURLSearchParams(req.query || {}));

  return {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: queryParams.toString(),
  };
};

// OpenObserve provider: posts a JSON record with Basic auth (see https://observe.stream4tech.app)
// bodyType controls the wire format, matching how OpenObserve's two ingest endpoints differ:
// - "ndjson" (default): raw object per request, for the "_multi" endpoint (used by this backend transport)
// - "json": object wrapped in an array, for the "_json" endpoint (used by browser/mobile clients)
const buildOpenObserveRequest = (log, options) => {
  const { req, Username, time, hostname, level, rest } = extractCommonFields(log);
  const { msg, message, err, ...extra } = rest;
  const { username, password, app, environment, appVersion, bodyType = "json" } = options;
  const paramsObj = { ...(req.params || {}), ...(req.body || {}) };

  const record = {
    level: level !== undefined ? String(level) : "error",
    app: app || "",
    environment: environment || "",
    app_version: appVersion || "",
    message: message || msg || (err && err.message) || "",
    stack_trace: (err && err.stack) || JSON.stringify(extra),
    machine_name: hostname || MACHINE_NAME,
    date_time: time,
    user: Username,
    ip: req.remoteAddress || "",
    raw_url: req.url || "",
    absolute_url: req.url || "",
    url_referrer: req.referrer || "",
    query_string: JSON.stringify(req.query || {}),
    parameters: JSON.stringify(paramsObj),
    user_agent: req.userAgent || "",
    browser: req.userAgent || "",
  };

  return {
    headers: {
      "Content-Type": "application/json",
      Authorization: "Basic " + Buffer.from(`${username}:${password}`).toString("base64"),
    },
    body: bodyType === "json" ? JSON.stringify([record]) : JSON.stringify(record),
  };
};

const REQUEST_BUILDERS = {
  [PROVIDERS.EXCEPTION_HANDLER]: buildExceptionHandlerRequest,
  [PROVIDERS.OPENOBSERVE]: buildOpenObserveRequest,
};

/**
 * Creates a write stream for pino transport that POSTs each log line.
 * Options:
 * - url: string (required) Target endpoint
 * - provider: string (optional) Which backend to format/send for; one of
 *     "exceptionHandler" (default, legacy ExceptionHandler.ashx-style form post) or
 *     "openobserve" (JSON record with Basic auth, e.g. observe.stream4tech.app)
 * - username, password: string (required when provider is "openobserve") Basic auth credentials
 * - bodyType: string (optional, "openobserve" only) "ndjson" (default, "_multi" endpoint) or
 *     "json" (array-wrapped, "_json" endpoint)
 * - app, environment, appVersion: string (optional, "openobserve" only) static tags added to every record
 * - http2: boolean (optional) If true and endpoint is https, use HTTP/2 client
 * - method: string (optional) HTTP method; defaults to "POST"
 */
const createWriteStream = function (options = {}) {
  const baseURL = new URL(options.url);
  const useHttp2 = options.http2 === true && baseURL.protocol === "https:";
  const method = (options.method || "POST").toUpperCase();
  const provider = options.provider || PROVIDERS.EXCEPTION_HANDLER;

  const buildRequest = REQUEST_BUILDERS[provider];
  if (!buildRequest) {
    throw new Error(`[pino-http-send] Unknown provider "${provider}". Expected one of: ${Object.values(PROVIDERS).join(", ")}`);
  }
  if (provider === PROVIDERS.OPENOBSERVE && (!options.username || !options.password)) {
    throw new Error('[pino-http-send] The "openobserve" provider requires "username" and "password" options');
  }

  // Prepare HTTP/2 session if enabled (synchronously creates a client session)
  let h2Session = null;
  if (useHttp2) {
    h2Session = http2.connect(`${baseURL.protocol}//${baseURL.host}`);
    h2Session.on("error", (err) => {
      console.error("[pino-http-send] HTTP/2 session error:", err);
    });
  }

  return build(
    async (source) => {
      for await (const line of source) {
        let log;
        try {
          log = JSON.parse(line);
        } catch {
          // Skip lines that aren't valid JSON
          continue;
        }

        const { headers, body } = buildRequest(log, options);

        if (h2Session && !h2Session.closed && !h2Session.destroyed) {
          // HTTP/2: header names must be lowercase; :method and :path are pseudo-headers
          const h2Headers = {
            ":method": method,
            ":path": `${baseURL.pathname}${baseURL.search}`,
          };
          Object.entries(headers).forEach(([key, value]) => {
            h2Headers[key.toLowerCase()] = value;
          });

          await new Promise((resolve, reject) => {
            const stream = h2Session.request(h2Headers);
            // Consume response to free stream resources
            stream.on("response", () => {});
            stream.on("data", () => {});
            stream.on("end", resolve);
            stream.on("error", reject);
            stream.end(body);
          });
        } else {
          // Fallback to fetch (HTTP/1.1). Undici provides keep-alive by default.
          await fetch(baseURL.toString(), {
            method,
            headers,
            body,
          });
        }
      }

      return source;
    },
    {
      parse: "lines",
      async close() {
        if (h2Session) {
          await new Promise((resolve) => {
            try {
              h2Session.close();
              h2Session.once("close", resolve);
              setTimeout(resolve, H2_SESSION_CLOSE_TIMEOUT_MS);
            } catch {
              resolve();
            }
          });
        }
      },
    }
  );
};

export default createWriteStream;
export { createWriteStream, PROVIDERS };
