const slowRequestLogger = ({ threshold = 1000 } = {}) => {
    return (req, res, next) => {
        const start = process.hrtime.bigint();
        // Captured synchronously at dispatch time: by the time 'finish'/'close'
        // fire, the original request call stack has already unwound, so a stack
        // taken there would only show event-emitter internals.
        const stack = new Error('slow request trace').stack;
        const logDuration = (eventName) => {
            const durMs = Number(process.hrtime.bigint() - start) / 1e6;
            if (durMs < threshold) return;
            const logger = req.log || console;
            logger.error({
                durMs: Math.round(durMs),
                statusCode: res.statusCode,
                url: req.originalUrl || req.url,
                method: req.method,
                params: req.params,
                body: req.body,
                stack
            }, 'slow request');
        };

        res.on('finish', () => logDuration('finish'));
        res.on('close', () => logDuration('close'));

        next();
    }
};

export default slowRequestLogger;
