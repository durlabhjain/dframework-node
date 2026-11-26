import crypto from 'node:crypto';
import pinoHttp from 'pino-http';

const defaultSerializers = {
    req(req) {
        const [urlPath, ...queryParts] = (req.originalUrl || req.url).split('?');
        return {
            id: req.id,
            method: req.method,
            url: `${req.headers.host}${urlPath}`,
            query: req.query,
            // OpenObserve lowercases ingested field names, so parsed query keys lose their case;
            // the raw string keeps what the client sent.
            queryString: queryParts.join('?'),
            params: req.params,
            body: req.body,
            userAgent: req.headers['user-agent'],
            remoteAddress: req.ip || req.remoteAddress || req.socket?.remoteAddress || undefined,
            referrer: req.headers['x-page-url'] || req.headers.referer || '',
        };
    },
    res: res => ({ statusCode: res.statusCode }),
};

/**
 * Creates the pino-http middleware with the framework's request/response log shape.
 * Any pino-http option can be passed to override a default; `serializers` are merged per key.
 * Requires the optional peer dependency `pino-http`.
 */
const createHttpLogger = ({ logger, serializers, ...options } = {}) => pinoHttp({
    logger,
    genReqId: req => req.headers['x-request-id'] || crypto.randomUUID(),
    wrapSerializers: false,
    ...options,
    serializers: { ...defaultSerializers, ...serializers },
});

export default createHttpLogger;
