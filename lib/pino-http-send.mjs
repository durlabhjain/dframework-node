import build from "pino-abstract-transport";
import os from 'os';


// Function to find the value of a specific header
function getHeaderValue(headersArray = [], headerName) {
    const index = headersArray.indexOf(headerName);
    if (index !== -1 && index < headersArray.length - 1) {
        return headersArray[index + 1];
    }
    return null; // Header not found
}

const convertToURLSearchParams = (obj) => {
    const params = new URLSearchParams();
  
    Object.entries(obj).forEach(([key, value]) => {
      typeof value === 'object' && value !== null
        ? params.append(key, JSON.stringify(value))
        : params.append(key, value);
    });
  
    return params.toString();
  };

const createWriteStream = async function (options) {
    /**
     * @type {Array<Promise>} Send tasks.
     */
    const tasks = [];

    return build(
        async (source) => {
            // We use an async iterator to read log lines.
            for await (let line of source) {
                const { err = {}, error = {}, req = {}, machineName, rawUrl } = JSON.parse(line);
                const params = { ...req.params, ...req.body };
                const formParams = new URLSearchParams({
                    SystemPath: process.cwd(),
                    RemoteHost: req.remoteAddress || '',
                    Form: convertToURLSearchParams(params),
                    QueryString: convertToURLSearchParams(req.query),
                    UserAgent: req.headers ? req.headers['user-agent'] : getHeaderValue(req?.rawHeaders, 'User-Agent') || '',
                    RawUrl: rawUrl ?? (req.url || ''),
                    User: req.Username || '',
                    AbsoluteUrl: `${req.serverUrl ?? ''}${req.url ?? ''}`
                });
                const task = fetch(options.url + `?${formParams.toString()}`, {
                    method: 'POST', // Specify the POST method
                    headers: {
                        MachineName: machineName ?? os.hostname(),
                        ...options.headers
                    },
                    body: (err || error).stack
                });
                tasks.push(task);
            }
            return source;
        },
        {
            parse: "lines",
            async close() {
                // Wait for all send tasks to complete.
                await Promise.all(tasks);
            },
        }
    );
};

export default createWriteStream;

export { createWriteStream };