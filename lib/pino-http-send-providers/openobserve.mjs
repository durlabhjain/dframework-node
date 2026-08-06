import { MACHINE_NAME, extractCommonFields } from "./shared.mjs";

// OpenObserve provider: posts JSON records with Basic auth (see https://observe.stream4tech.app)
// bodyType controls the wire format, matching how OpenObserve's two ingest endpoints differ:
// - "ndjson" (default): newline-delimited JSON (one JSON object per line), for the "_multi" endpoint
// - "json": records wrapped in a JSON array, for the "_json" endpoint
const NAME = "openobserve";
const DEFAULT_BODY_TYPE = "ndjson";
const SUPPORTED_BODY_TYPES = new Set(["ndjson", "json"]);

const validateOptions = (options) => {
  if (!options.username || !options.password) {
    throw new Error(`[pino-http-send] The "${NAME}" provider requires "username" and "password" options`);
  }
  if (options.bodyType && !SUPPORTED_BODY_TYPES.has(options.bodyType)) {
    throw new Error(`[pino-http-send] The "${NAME}" provider only supports bodyType values: ${Array.from(SUPPORTED_BODY_TYPES).join(", ")}`);
  }
};

const createRequestContext = (options) => {
  const {
    username,
    password,
    app = "",
    environment = "",
    appVersion = "",
    bodyType = DEFAULT_BODY_TYPE,
  } = options;

  return {
    app,
    environment,
    appVersion,
    bodyType,
    headers: {
      "Content-Type": "application/json",
      Authorization: "Basic " + Buffer.from(`${username}:${password}`).toString("base64"),
    },
  };
};

const buildRecord = (log, context) => {
  const { req, Username, time, hostname, level, rest } = extractCommonFields(log);
  const { msg, message, err, ...extra } = rest;
  const paramsObj = { ...(req.params || {}), ...(req.body || {}) };

  return {
    level: level ?? 50, // 50 = pino "error" level, used when the log has no level field
    app: context.app,
    environment: context.environment,
    app_version: context.appVersion,
    message: message || msg || (err && err.message) || "",
    stack_trace: JSON.stringify(err ? { stack: err.stack, query: extra.query || "" } : extra),
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
};

const buildRequest = (log, options, requestContext = createRequestContext(options)) => {
  const record = buildRecord(log, requestContext);

  return {
    headers: requestContext.headers,
    body: requestContext.bodyType === "json" ? JSON.stringify([record]) : JSON.stringify(record),
  };
};

const buildBatchRequest = (logs, options, requestContext = createRequestContext(options)) => {
  const records = logs.map((log) => buildRecord(log, requestContext));
  const body = requestContext.bodyType === "json"
    ? JSON.stringify(records)
    : records.map((record) => JSON.stringify(record)).join("\n");

  return {
    headers: requestContext.headers,
    body,
  };
};

export { NAME, DEFAULT_BODY_TYPE, validateOptions, createRequestContext, buildRecord, buildRequest, buildBatchRequest };
