import build from "pino-abstract-transport";
import http2 from "node:http2";
import * as exceptionHandlerProvider from "./pino-http-send-providers/exception-handler.mjs";
import * as openObserveProvider from "./pino-http-send-providers/openobserve.mjs";

const H2_SESSION_CLOSE_TIMEOUT_MS = 300;

const PROVIDERS = {
  EXCEPTION_HANDLER: exceptionHandlerProvider.NAME,
  OPENOBSERVE: openObserveProvider.NAME,
};

const PROVIDER_MODULES = {
  [exceptionHandlerProvider.NAME]: exceptionHandlerProvider,
  [openObserveProvider.NAME]: openObserveProvider,
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
  const providerName = options.provider || PROVIDERS.EXCEPTION_HANDLER;

  const provider = PROVIDER_MODULES[providerName];
  if (!provider) {
    throw new Error(`[pino-http-send] Unknown provider "${providerName}". Expected one of: ${Object.values(PROVIDERS).join(", ")}`);
  }
  provider.validateOptions(options);

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

        const { headers, body } = provider.buildRequest(log, options);

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
