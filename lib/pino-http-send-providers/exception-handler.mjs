import { MACHINE_NAME, CWD, convertToURLSearchParams, extractCommonFields } from "./shared.mjs";

// Legacy provider: posts form-urlencoded params to an ExceptionHandler-style endpoint
const NAME = "exceptionHandler";

const validateOptions = () => {};

const buildRequest = (log) => {
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

export { NAME, validateOptions, buildRequest };
