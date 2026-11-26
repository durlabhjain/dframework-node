import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import createHttpLogger from '../lib/middleware/http-logger.mjs';
import pino from 'pino';

const run = async ({ headers = {}, ...options } = {}) => {
    const lines = [];
    const logger = pino({ level: 'info' }, { write: line => lines.push(JSON.parse(line)) });
    const middleware = createHttpLogger({ logger, ...options });
    const server = http.createServer((req, res) => middleware(req, res, () => res.end('ok')));
    await new Promise(resolve => server.listen(0, resolve));
    try {
        const res = await fetch(`http://127.0.0.1:${server.address().port}/a/b?ClientId=5&x=1`, { headers });
        await res.arrayBuffer();
        await new Promise(resolve => setTimeout(resolve, 50));
    } finally {
        await new Promise(resolve => server.close(resolve));
    }
    return { entry: lines.find(l => l.req), res: lines.find(l => l.req)?.res };
};

test('logs the framework request shape and keeps the raw query string', async () => {
    const { entry } = await run({ headers: { 'x-request-id': 'abc' } });
    assert.equal(entry.req.id, 'abc');
    assert.match(entry.req.url, /\/a\/b$/);
    assert.equal(entry.req.queryString, 'ClientId=5&x=1');
    assert.equal(entry.res.statusCode, 200);
});

test('generates a request id when none is sent', async () => {
    const { entry } = await run();
    assert.match(entry.req.id, /^[0-9a-f-]{36}$/);
});

test('overrides: customProps, genReqId and per-key serializers', async () => {
    const { entry } = await run({
        customProps: () => ({ Username: 'bob' }),
        genReqId: () => 'fixed',
        serializers: { req: req => ({ id: req.id }) },
    });
    assert.equal(entry.Username, 'bob');
    assert.deepEqual(entry.req, { id: 'fixed' });
    assert.equal(entry.res.statusCode, 200);
});
