import pino from "pino";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import { MACHINE_NAME, extractCommonFields } from "./shared.mjs";

dayjs.extend(utc);

// OpenObserve provider: posts JSON records with Basic auth (see https://observe.stream4tech.app)
// bodyType controls the wire format, matching how OpenObserve's two ingest endpoints differ:
// - "ndjson" (default): newline-delimited JSON (one JSON object per line), for the "_multi" endpoint
// - "json": records wrapped in a JSON array, for the "_json" endpoint
const NAME = "openobserve";
const DEFAULT_BODY_TYPE = "ndjson";
const SUPPORTED_BODY_TYPES = new Set(["ndjson", "json"]);

const capitalize = (word) => word.charAt(0).toUpperCase() + word.slice(1);

const formatUtcDate = (time) => dayjs.utc(time).toISOString();

// Maps a numeric pino level (standard or app-defined via the "customLevels" option,
// e.g. { slow: 35, clienterror: 45 } from dframework's logger config) to its severity name
const buildSeverityByLevel = (customLevels = {}) => {
  const levelValues = { ...pino.levels.values, ...customLevels }; // name -> numeric value
  return Object.fromEntries(Object.entries(levelValues).map(([name, value]) => [value, capitalize(name)]));
};

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
    customLevels,
  } = options;

  return {
    app,
    environment,
    appVersion,
    bodyType,
    severityByLevel: buildSeverityByLevel(customLevels),
    headers: {
      "Content-Type": "application/json",
      Authorization: "Basic " + Buffer.from(`${username}:${password}`).toString("base64"),
    },
  };
};

// Drops keys with no value so OpenObserve doesn't index empty/null noise
const withoutEmpty = (obj) => Object.fromEntries(Object.entries(obj).filter(([, value]) => {
  if (value === undefined || value === null || value === "") return false;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}));

const buildRecord = (log, context) => {
  const { req, Username, time, hostname, level, rest } = extractCommonFields(log);
  const { msg, message, err, query } = rest;
  const stackTrace = err ? `${err.stack || err.message || ""}${query ? `\r\nquery: ${query}` : ""}` : "";

  return withoutEmpty({
    level, // omitted when the log has no level field; severity below still defaults to "Error"
    severity: context.severityByLevel[level] ?? "Error",
    application_name: context.app,
    environment: context.environment,
    app_version: context.appVersion,
    message: message || msg || (err && err.message) || "",
    stack_trace: stackTrace,
    machine_name: hostname || MACHINE_NAME,
    utc_date: formatUtcDate(time),
    user: Username,
    ip: req.remoteAddress,
    raw_url: req.url,
    absolute_url: req.url,
    url_referrer: req.referrer,
    query_string: req.query,
    form: req.params,
    body_parameters: req.body,
    browser: req.userAgent,
  });
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
