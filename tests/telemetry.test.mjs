import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import { once } from 'node:events';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
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
    const ready = await prepareLoggingConfig({ config, env: {}, resolver: { async resolveEnvironmentSecrets() {}, async getSecret() { throw new Error('secret value'); } }, onWarning: value => warnings.push(value) });
    assert.equal(ready, false);
    assert.equal(config.logging.otherConfig.otelConfig, null);
    assert.equal(warnings.length, 1);
    assert.doesNotMatch(warnings[0], /secret value/);
});

test('failed OTEL environment expansion is sanitized even without logging config', async () => {
    const env = { OTEL_EXPORTER_OTLP_LOGS_HEADERS: 'vault:private:headers' };
    const warnings = [];
    const ready = await prepareLoggingConfig({ config: {}, env, onWarning: value => warnings.push(value) });
    assert.equal(ready, false);
    assert.deepEqual(env, { OTEL_EXPORTER_OTLP_LOGS_HEADERS: 'vault:private:headers' });
    assert.deepEqual(warnings, ['OTLP logging disabled; could not load a valid logging secret']);
});

for (const mode of ['missing settings', 'Vault denied']) {
    test(`framework logger writes locally without remote requests after ${mode}`, { timeout: 15000 }, async t => {
        const requests = [];
        const server = http.createServer((req, res) => {
            requests.push(req.method);
            res.writeHead(403).end('private-response-body');
        });
        server.listen(0, '127.0.0.1'); await once(server, 'listening');
        const cwd = await mkdtemp(join(tmpdir(), 'dframework-logging-fallback-'));
        t.after(async () => {
            await new Promise(resolve => server.close(resolve));
            assert.equal(dirname(cwd), tmpdir());
            await rm(cwd, { recursive: true, force: true });
        });
        const endpoint = `http://127.0.0.1:${server.address().port}`;
        await writeFile(join(cwd, 'config.json'), JSON.stringify({ logging: { otherConfig: {
            stdout: false,
            otelConfig: { endpoint: `${endpoint}/v1/logs` },
            httpConfig: { url: endpoint, organization: 'test', streamName: 'fixture', auth: { username: 'user', password: 'pass' } },
        } } }));
        const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(OTEL_|VAULT_)/i.test(key)));
        const result = await promisify(execFile)(process.execPath, [fileURLToPath(new URL('./fixtures/logger-fallback-worker.mjs', import.meta.url))], {
            cwd, windowsHide: true, timeout: 10000,
            env: { ...env, VAULT_ADDR: endpoint, VAULT_TOKEN: mode === 'Vault denied' ? 'fixture-token' : '',
                OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: `${endpoint}/v1/logs`,
                OTEL_EXPORTER_OTLP_LOGS_HEADERS: 'vault:private:headers' },
        });
        assert.match(result.stderr, /OTLP logging disabled/);
        assert.doesNotMatch(result.stderr, /private-response-body|fixture-token|vault:private/);
        assert.deepEqual(requests, mode === 'Vault denied' ? ['GET'] : []);
        const files = await readdir(join(cwd, 'logs'), { withFileTypes: true });
        let localLogs = '';
        for (const file of files.filter(file => file.isFile())) localLogs += await readFile(join(cwd, 'logs', file.name), 'utf8');
        assert.match(localLogs, /local-fallback-probe/);
    });
}
test('legacy logging path aliases and already-expanded dictionaries remain usable', async () => {
    for (const key of ['httpConfigPath', 'otelConfigPath']) {
        const config = { logging: { otherConfig: { [key]: 'existing-path' } } };
        const secret = { endpoint: 'http://collector.test/v1/logs' };
        await prepareLoggingConfig({ config, env: {}, resolver: { async resolveEnvironmentSecrets() {}, async getSecret(path) { assert.equal(path, 'existing-path'); return secret; } } });
        assert.deepEqual(config.logging.otherConfig.otelConfig, secret);
    }
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
