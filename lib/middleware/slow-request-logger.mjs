const slowRequestLogger = ({ threshold = 1000 } = {}) => {
    return (req, res, next) => {
        const start = process.hrtime.bigint();
        let logged = false;
        const logDuration = () => {
            // 'finish' and 'close' both fire for one response; report it once.
            if (logged) return;
            logged = true;
            const durMs = Number(process.hrtime.bigint() - start) / 1e6;
            if (durMs < threshold) return;
            const logger = req.log || console;
            // Use the 'slow' level when configured, so slow requests stay out of the error stream.
            const level = typeof logger.slow === 'function' ? 'slow' : 'error';
            // 'body' is an OTLP record field: a payload key of that name replaces the message.
            logger[level]({
                durMs: Math.round(durMs),
                statusCode: res.statusCode,
                url: req.originalUrl || req.url,
                method: req.method,
                params: req.params,
                requestBody: req.body
            }, 'slow request');
        };

        res.on('finish', logDuration);
        res.on('close', logDuration);

        next();
    }
};

export default slowRequestLogger;
