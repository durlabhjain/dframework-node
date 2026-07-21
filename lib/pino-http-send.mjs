import build from "pino-abstract-transport";
import os from "os";
import http2 from "node:http2";

// Constants computed once
const MACHINE_NAME = os.hostname();
const CWD = process.cwd();
const H2_SESSION_CLOSE_TIMEOUT_MS = 300;

// Standard pino level numbers -> label, used to render a human severity string
const STANDARD_LEVEL_LABELS = { 10: "trace", 20: "debug", 30: "info", 40: "warn", 50: "error", 60: "fatal" };

// Flatten a payload object into URLSearchParams, JSON-stringifying nested values
const toURLSearchParams = (obj) => {
  const params = new URLSearchParams();
  Object.entries(obj || {}).forEach(([key, value]) => {
    typeof value === "object" && value !== null
      ? params.append(key, JSON.stringify(value))
      : params.append(key, value ?? "");
  });
  return params;
};

/**
 * Creates a write stream for pino transport that POSTs each log line.
 * Options:
 * - url: string (required) Target endpoint
 * - http2: boolean (optional) If true and endpoint is https, use HTTP/2 client
 * - method: string (optional) HTTP method; defaults to "POST"
 * - format: string (optional) "urlencoded" (default) or "json"; both send the same payload
 *   fields (error, message, stackTrace, exceptionType, severity, occurredAt, source,
 *   systemPath, environment, correlationId, userName, method, url, referrer, remoteHost,
 *   userAgent, form, queryString, exception) and only differ in serialization
 * - headers: object (optional) extra headers sent with every request
 * - apiKey: string (optional) sent as the "X-Exception-Api-Key" header
 * - environment: string (optional) reported in JSON format; defaults to NODE_ENV or "production"
 * - customLevels: object (optional) name->number map used to render "severity" labels
 */
const createWriteStream = function (options = {}) {
  const baseURL = new URL(options.url);
  const useHttp2 = options.http2 === true && baseURL.protocol === "https:";
  const method = (options.method || "POST").toUpperCase();
  const format = (options.format || "urlencoded").toLowerCase();
  const environment = options.environment || process.env.NODE_ENV || "production";
  const levelLabels = { ...STANDARD_LEVEL_LABELS };
  Object.entries(options.customLevels || {}).forEach(([name, value]) => {
    levelLabels[value] = name;
  });
  const extraHeaders = {
    ...(options.headers || {}),
    ...({ "X-Exception-Api-Key": options.exceptionMonitorApiKey } || {}),
  };

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

        const { req = {}, ...others } = log;
        const { Username = "", time = new Date().toISOString(), hostname, pid, level, ...errorInfo } = others;

        const err = errorInfo.err || {};
        const payload = {
          error: err.message || "",
          message: errorInfo.query || errorInfo.msg || "",
          stackTrace: err.stack || "",
          exceptionType: err.type || "",
          severity: levelLabels[level] || String(level ?? ""),
          occurredAt: time,
          source: hostname || MACHINE_NAME,
          systemPath: CWD,
          environment,
          correlationId: req.id || req.correlationId || errorInfo.reqId || errorInfo.correlationId || "",
          userName: Username,
          method: req.method || "",
          url: req.url || "",
          referrer: req.referrer || "",
          remoteHost: req.remoteAddress || "",
          userAgent: req.userAgent || "",
          requestParams: req.params || {},
          requestBody: req.body || {},
          requestHeaders: req.headers || {},
          queryString: req.query || {},
          exception: errorInfo,
        };

        let contentType;
        let body;

        if (format === "json") {
          contentType = "application/json";
          body = JSON.stringify(payload);
        } else {
          contentType = "application/x-www-form-urlencoded";
          body = toURLSearchParams(payload).toString();
        }

        if (h2Session && !h2Session.closed && !h2Session.destroyed) {
          // HTTP/2: header names must be lowercase; :method and :path are pseudo-headers
          const headers = {
            ":method": method,
            ":path": `${baseURL.pathname}${baseURL.search}`,
            "content-type": contentType,
            ...Object.fromEntries(Object.entries(extraHeaders).map(([key, value]) => [key.toLowerCase(), value])),
          };

          await new Promise((resolve, reject) => {
            const stream = h2Session.request(headers);
            // Consume response to free stream resources
            stream.on("response", () => {});
            stream.on("data", () => {});
            stream.on("end", resolve);
            stream.on("error", reject);
            stream.end(body);
          });
        } else {
          // Fallback to fetch (HTTP/1.1). Undici provides keep-alive by default.
          const headers = {
            "Content-Type": contentType,
            ...extraHeaders,
          };
          try {
            await fetch(baseURL.toString(), {
              method,
              headers,
              body,
            });
          } catch (err) {
            console.error("[pino-http-send] Fetch error:", err);
          }
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
export { createWriteStream };