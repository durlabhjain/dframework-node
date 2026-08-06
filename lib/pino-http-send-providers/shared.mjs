import os from "os";

// Constants computed once
export const MACHINE_NAME = os.hostname();
export const CWD = process.cwd();

// Convert nested objects into URLSearchParams-friendly strings
export const convertToURLSearchParams = (obj) => {
  const params = new URLSearchParams();
  Object.entries(obj || {}).forEach(([key, value]) => {
    typeof value === "object" && value !== null
      ? params.append(key, JSON.stringify(value))
      : params.append(key, value ?? "");
  });
  return params.toString();
};

// Pulls the fields every provider needs out of a parsed pino log line
export const extractCommonFields = (log) => {
  const { req = {}, ...others } = log;
  const { Username = "", time = new Date().toISOString(), hostname, pid, level, ...rest } = others;
  return { req, Username, time, hostname, pid, level, rest };
};
