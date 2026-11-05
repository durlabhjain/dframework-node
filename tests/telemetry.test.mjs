import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import { once } from 'node:events';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createOtelTarget, normalizeFileConfig, prepareLoggingConfig } from '../lib/logging.mjs';

test('telemetry is opt-in and standard environment settings keep their precedence', () => {
    assert.equal(createOtelTarget({ env: {} }), null);
    const target = createOtelTarget({ env: { OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: 'http://localhost/v1/logs', OTEL_SERVICE_NAME: 'test' }, serviceName: 'fixture', config: { invalid: true } });
    assert.equal(target.target, 'pino-opentelemetry-transport');
    assert.equal(target.options.resourceAttributes['service.name'], 'test');
});
test('old file rotation settings have equivalent modern options', () => {
    assert.deepEqual(normalizeFileConfig({ frequency: '24h', max_logs: '10d', date_format: 'YYYY-MM-DD', size: '1m' }), { frequency: 'daily', limit: { count: 10 }, dateFormat: 'yyyy-MM-dd', size: '1m' });
});
test('a logging secret failure leaves local logging available', async () => {
    const config = { logging: { otherConfig: { otelConfigPath: 'path' } } };
    const warnings = [];
    await prepareLoggingConfig({ config, env: {}, resolver: { async resolveEnvironmentSecrets() {}, async getSecret() { throw new Error('secret value'); } }, onWarning: value => warnings.push(value) });
    assert.equal(config.logging.otherConfig.otelConfig, null);
    assert.equal(warnings.length, 1);
    assert.doesNotMatch(warnings[0], /secret value/);
});
for (const legacy of [false, true]) {
    test(`real Pino worker flushes ${legacy ? 'existing OpenObserve secret' : 'OTLP configuration'} as OTLP with redaction`, { timeout: 15000 }, async t => {
        const requests = [];
        const server = http.createServer(async (req, res) => {
            let body = '';
            for await (const chunk of req) body += chunk;
            requests.push({ url: req.url, headers: req.headers, body });
            res.setHeader('content-type', 'application/json'); res.end('{}');
        });
        server.listen(0, '127.0.0.1'); await once(server, 'listening');
        t.after(() => new Promise(resolve => server.close(resolve)));
        const endpoint = `http://127.0.0.1:${server.address().port}`;
        const config = legacy ? { url: endpoint, organization: 'default', streamName: 'fixture', auth: { username: 'user', password: 'pass' } }
            : { endpoint: `${endpoint}/v1/logs`, protocol: 'http/json', headers: { 'stream-name': 'fixture' } };
        await promisify(execFile)(process.execPath, [fileURLToPath(new URL('./fixtures/otel-worker.mjs', import.meta.url))], {
            windowsHide: true, timeout: 10000,
            env: { ...process.env, RUNTIME_TARGET: JSON.stringify(createOtelTarget({ env: {}, config, serviceName: 'runtime-test' })) },
        });
        assert.equal(requests.length, 1);
        assert.equal(requests[0].url, legacy ? '/api/default/v1/logs' : '/v1/logs');
        assert.equal(requests[0].headers['stream-name'], 'fixture');
        assert.match(requests[0].body, /resourceLogs/);
        assert.match(requests[0].body, /probe/);
        assert.doesNotMatch(requests[0].body, /do-not-export/);
    });
}
