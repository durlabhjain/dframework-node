import build from "pino-abstract-transport";

const createWriteStream = async function (options) {
    /**
     * @type {Array<Promise>} Send tasks.
     */
    const tasks = [];

    return build(
        async (source) => {
            // We use an async iterator to read log lines.
            for await (let line of source) {
                const task = fetch(options.url, {
                    ...options,
                    body: JSON.stringify({ message: line })
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