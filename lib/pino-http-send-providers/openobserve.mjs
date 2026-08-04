import { MACHINE_NAME, extractCommonFields } from "./shared.mjs";

// OpenObserve provider: posts a JSON record with Basic auth (see https://observe.stream4tech.app)
// bodyType controls the wire format, matching how OpenObserve's two ingest endpoints differ:
// - "ndjson" (default): raw object per request, for the "_multi" endpoint (used by this backend transport)
// - "json": object wrapped in an array, for the "_json" endpoint (used by browser/mobile clients)
const NAME = "openobserve";

const validateOptions = (options) => {
  if (!options.username || !options.password) {
    throw new Error(`[pino-http-send] The "${NAME}" provider requires "username" and "password" options`);
  }
};

const buildRequest = (log, options) => {
  const { req, Username, time, hostname, level, rest } = extractCommonFields(log);
  const { msg, message, err, ...extra } = rest;
  const { username, password, app, environment, appVersion, bodyType = "ndjson" } = options;
  const paramsObj = { ...(req.params || {}), ...(req.body || {}) };

  const record = {
    level: level !== undefined ? String(level) : "error",
    app: app || "",
    environment: environment || "",
    app_version: appVersion || "",
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

  return {
    headers: {
      "Content-Type": "application/json",
      Authorization: "Basic " + Buffer.from(`${username}:${password}`).toString("base64"),
    },
    body: bodyType === "json" ? JSON.stringify([record]) : JSON.stringify(record),
  };
};

export { NAME, validateOptions, buildRequest };
