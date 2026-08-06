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
 * - batchSize: number (optional, "openobserve" only) Number of parsed log records to send per request; defaults to 1
 * - app, environment, appVersion: string (optional, "openobserve" only) static tags added to every record
 * - http2: boolean (optional) If true and endpoint is https, use HTTP/2 client
 * - method: string (optional) HTTP method; defaults to "POST"
 */
const createWriteStream = function (options = {}) {
  const baseURL = new URL(options.url);
  const useHttp2 = options.http2 === true && baseURL.protocol === "https:";
  const method = (options.method || "POST").toUpperCase();
  const providerName = options.provider || PROVIDERS.EXCEPTION_HANDLER;
  const batchSize = Math.max(1, Number(options.batchSize) || 1);

  const provider = PROVIDER_MODULES[providerName];
  if (!provider) {
    throw new Error(`[pino-http-send] Unknown provider "${providerName}". Expected one of: ${Object.values(PROVIDERS).join(", ")}`);
  }
  provider.validateOptions(options);
  const providerRequestContext = provider.createRequestContext?.(options);

  const sendRequest = async (headers, body) => {
    if (h2Session && !h2Session.closed && !h2Session.destroyed) {
      const h2Headers = {
        ":method": method,
        ":path": `${baseURL.pathname}${baseURL.search}`,
      };
      Object.entries(headers).forEach(([key, value]) => {
        h2Headers[key.toLowerCase()] = value;
      });

      await new Promise((resolve, reject) => {
        const stream = h2Session.request(h2Headers);
        let statusCode = 0;
        let responseBody = "";

        stream.setEncoding("utf8");
        stream.on("response", (responseHeaders) => {
          statusCode = Number(responseHeaders[http2.constants.HTTP2_HEADER_STATUS] || 0);
        });
        stream.on("data", (chunk) => {
          responseBody += chunk;
        });
        stream.on("end", () => {
          if (statusCode >= 200 && statusCode < 300) {
            resolve();
            return;
          }
          reject(new Error(`[pino-http-send] Request failed with status ${statusCode}${responseBody ? `: ${responseBody}` : ""}`));
        });
        stream.on("error", reject);
        stream.end(body);
      });

      return;
    }

    const response = await fetch(baseURL.toString(), {
      method,
      headers,
      body,
    });

    if (!response.ok) {
      const responseBody = await response.text().catch(() => "");
      throw new Error(`[pino-http-send] Request failed with status ${response.status}${responseBody ? `: ${responseBody}` : ""}`);
    }
  };

  const flushBatch = async (logs) => {
    if (logs.length === 0) {
      return;
    }

    if (logs.length > 1 && typeof provider.buildBatchRequest === "function") {
      const { headers, body } = provider.buildBatchRequest(logs, options, providerRequestContext);
      await sendRequest({ ...(options.headers || {}), ...headers }, body);
      return;
    }

    // No batch support (or a single log): send every log individually so none are dropped.
    for (const log of logs) {
      const { headers, body } = provider.buildRequest(log, options, providerRequestContext);
      await sendRequest({ ...(options.headers || {}), ...headers }, body);
    }
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
      const pendingLogs = [];

      for await (const line of source) {
        let log;
        try {
          log = JSON.parse(line);
        } catch {
          // Skip lines that aren't valid JSON
          continue;
        }

        pendingLogs.push(log);
        if (pendingLogs.length >= batchSize) {
          await flushBatch(pendingLogs.splice(0, pendingLogs.length));
        }
      }

      await flushBatch(pendingLogs);
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
