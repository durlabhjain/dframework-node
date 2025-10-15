const slowRequestLogger = ({ threshold = 1000 } = {}) => {
    return (req, res, next) => {
        const start = process.hrtime.bigint();
        const logDuration = (eventName) => {
            const durMs = Number(process.hrtime.bigint() - start) / 1e6;
            if (durMs < threshold) return;
            const logger = req.log || console;
            logger.error({
                durMs: Math.round(durMs),
                statusCode: res.statusCode,
                url: req.originalUrl || req.url,
                method: req.method
            }, 'slow request');
        };

        res.on('finish', () => logDuration('finish'));
        res.on('close', () => logDuration('close'));

        next();
    }
};

export default slowRequestLogger;