import build from "pino-abstract-transport";
import os from "os";
import http2 from "node:http2";

// Constants computed once
const MACHINE_NAME = os.hostname();
const CWD = process.cwd();
const H2_SESSION_CLOSE_TIMEOUT_MS = 300;

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

// Only formattedQuery gets real line breaks in the email; other fields stay JSON-escaped.
const MULTILINE_KEYS = new Set(["formattedQuery"]);

// Recursively swaps multi-line string fields for placeholder tokens so JSON.stringify
// can safely escape everything else (including backslashes in Windows file paths)
// without us having to un-escape the result afterwards.
const extractMultilineFields = (value, placeholders) => {
  if (Array.isArray(value)) {
    return value.map((item) => extractMultilineFields(item, placeholders));
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  const result = {};
  for (const [key, val] of Object.entries(value)) {
    if (typeof val === "string" && MULTILINE_KEYS.has(key)) {
      const token = `@@MULTILINE_${placeholders.length}@@`;
      placeholders.push(val);
      result[key] = token;
    } else {
      result[key] = extractMultilineFields(val, placeholders);
    }
  }
  return result;
};

const stringifyWithMultilineFields = (value) => {
  const placeholders = [];
  const sanitized = extractMultilineFields(value, placeholders);
  let text = JSON.stringify(sanitized);
  placeholders.forEach((original, i) => {
    // Convert literal \n / \t / \r two-char sequences to real whitespace
    const unescaped = original.replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\r/g, "\r");
    text = text.split(`"@@MULTILINE_${i}@@"`).join(unescaped);
  });
  return text;
};

/**
 * Creates a write stream for pino transport that POSTs each log line.
 * Options:
 * - url: string (required) Target endpoint
 * - http2: boolean (optional) If true and endpoint is https, use HTTP/2 client
 * - method: string (optional) HTTP method; defaults to "POST"
 */
const createWriteStream = function (options = {}) {
  const baseURL = new URL(options.url);
  const useHttp2 = options.http2 === true && baseURL.protocol === "https:";
  const method = (options.method || "POST").toUpperCase();

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
        const paramsObj = { ...(req.params || {}), ...(req.body || {}) };

        // Build query params per line
        const queryParams = new URLSearchParams();
        queryParams.set("Machine Name", hostname || MACHINE_NAME);
        queryParams.set("System Path", CWD);
        queryParams.set("Remote Host", req.remoteAddress || "");
        queryParams.set("User Agent", req.userAgent || "");
        queryParams.set("Absolute Url", req.url || "");
        queryParams.set("UrlReferrer", req.referrer || "");
        queryParams.set("Date/ Time (UTC)", time);
        queryParams.set("User", Username);
        queryParams.set("exception", stringifyWithMultilineFields(errorInfo));
        queryParams.set("Form", convertToURLSearchParams(paramsObj));
        queryParams.set("QueryString", convertToURLSearchParams(req.query || {}));

        if (h2Session && !h2Session.closed && !h2Session.destroyed) {
          // HTTP/2: header names must be lowercase; :method and :path are pseudo-headers
          const headers = {
            ":method": method,
            ":path": `${baseURL.pathname}${baseURL.search}`,
            "content-type": "application/x-www-form-urlencoded"
          };

          await new Promise((resolve, reject) => {
            const stream = h2Session.request(headers);
            // Consume response to free stream resources
            stream.on("response", () => {});
            stream.on("data", () => {});
            stream.on("end", resolve);
            stream.on("error", reject);
            stream.end(queryParams.toString());
          });
        } else {
          // Fallback to fetch (HTTP/1.1). Undici provides keep-alive by default.
          const headers = {
            "Content-Type": "application/x-www-form-urlencoded",
          };
          await fetch(baseURL.toString(), {
            method,
            headers,
            body: queryParams.toString(),
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
export { createWriteStream };