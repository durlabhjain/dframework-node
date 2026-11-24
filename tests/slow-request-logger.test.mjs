/**
 * Tests for slowRequestLogger: a completed HTTP response emits both 'finish' and 'close', so the
 * middleware must report a slow request exactly once per response rather than once per event,
 * and must prefer the 'slow' level when the application logger defines it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import slowRequestLogger from '../lib/middleware/slow-request-logger.mjs';

const makeLogger = ({ withSlow } = {}) => {
    const calls = { slow: [], error: [] };
    const logger = { error: (payload, message) => calls.error.push({ payload, message }) };
    if (withSlow) logger.slow = (payload, message) => calls.slow.push({ payload, message });
    return { logger, calls };
};

/** Drives one real request through the middleware and resolves once the response has settled. */
const request = async ({ logger, threshold = 0, handler }) => {
    const middleware = slowRequestLogger({ threshold });
    const server = http.createServer((req, res) => {
        req.log = logger;
        req.originalUrl = req.url;
        middleware(req, res, () => handler(req, res));
    });
    await new Promise(resolve => server.listen(0, resolve));
    const { port } = server.address();
    try {
        await fetch(`http://127.0.0.1:${port}/report?ClientId=5`).then(response => response.arrayBuffer(), () => { });
    } finally {
        await new Promise(resolve => setTimeout(resolve, 50));
        await new Promise(resolve => server.close(resolve));
    }
};

test('reports a slow request once per response, not once per response event', async () => {
    const { logger, calls } = makeLogger();
    await request({ logger, handler: (req, res) => res.end('ok') });
    assert.equal(calls.error.length, 1);
    assert.equal(calls.error[0].message, 'slow request');
    assert.equal(calls.error[0].payload.url, '/report?ClientId=5');
});

test('keeps the request body out of the OTLP-reserved "body" key', async () => {
    const { logger, calls } = makeLogger({ withSlow: true });
    await request({ logger, handler: (req, res) => res.end('ok') });
    const { payload } = calls.slow[0];
    // A top-level 'body' would replace the log message with the request body at ingestion.
    assert.ok(!('body' in payload), 'payload must not use the reserved key "body"');
    assert.ok('requestBody' in payload);
});

test('uses the slow level when the logger defines it', async () => {
    const { logger, calls } = makeLogger({ withSlow: true });
    await request({ logger, handler: (req, res) => res.end('ok') });
    assert.equal(calls.slow.length, 1);
    assert.equal(calls.error.length, 0);
});

test('stays silent for a request below the threshold', async () => {
    const { logger, calls } = makeLogger({ withSlow: true });
    await request({ logger, threshold: 60_000, handler: (req, res) => res.end('ok') });
    assert.equal(calls.slow.length + calls.error.length, 0);
});

test('still reports a response that closes without finishing', async () => {
    const { logger, calls } = makeLogger({ withSlow: true });
    await request({ logger, handler: (req, res) => res.destroy() });
    assert.equal(calls.slow.length, 1);
});
