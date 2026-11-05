import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';
import { createVaultResolver } from '../lib/vault.mjs';
import { validateConfig } from '../lib/config.mjs';

const config = { environment: 'DEV', vault: { addr: 'http://vault.test', token: 'sensitive-token' } };
const reply = data => new Response(JSON.stringify({ data: { data } }), { headers: { 'content-type': 'application/json' } });

test('expands nested objects, keys, arrays, JSON and environment tokens with one read per secret', async () => {
    const calls = [];
    const resolver = createVaultResolver({ config, env: {}, fetchImpl: async (url, options) => {
        calls.push({ url, options });
        return reply({ password: 'secret', options: '{"port":6379}', nested: ['literal', 'vault:coolr/${environment}/app:password'] });
    } });
    const input = { database: { password: 'vault:coolr/${environment}/app:password' }, options: 'vault:coolr/${environment}/app:options' };
    assert.deepEqual(await resolver.resolveConfigSecrets(input), { database: { password: 'secret' }, options: { port: 6379 } });
    assert.equal(input.database.password, 'secret');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'http://vault.test/v1/kv/data/coolr/dev/app');
    assert.equal(calls[0].options.headers['X-Vault-Token'], 'sensitive-token');
    const entire = await resolver.resolveSecret('vault:coolr/dev/app');
    assert.deepEqual(entire.nested, ['literal', 'secret']);
});
test('supports KV v1, namespace and environment bootstrap settings', async () => {
    let request;
    const resolver = createVaultResolver({ config: {}, env: { VAULT_ADDR: 'http://vault.test', VAULT_TOKEN: 'token', VAULT_KV_VERSION: '1', VAULT_NAMESPACE: 'team' }, fetchImpl: async (url, options) => {
        request = { url, options }; return new Response(JSON.stringify({ data: { value: 'ok' } }));
    } });
    assert.equal(await resolver.getSecret('service', 'value'), 'ok');
    assert.equal(request.url, 'http://vault.test/v1/kv/service');
    assert.equal(request.options.headers['X-Vault-Namespace'], 'team');
});
test('plain values need no vault; missing or circular references fail without partial writes', async () => {
    const plain = createVaultResolver({ config: {}, env: {} });
    assert.deepEqual(await plain.resolveConfigSecrets({ port: 8883 }), { port: 8883 });
    await assert.rejects(plain.resolveSecret('vault:app:key'), /Vault settings/);
    const resolver = createVaultResolver({ config, env: {}, fetchImpl: async () => reply({ loop: 'vault:app:loop', good: 'value' }) });
    await assert.rejects(resolver.resolveSecret('vault:app:loop'), /circular/);
    const value = { a: 'vault:app:good', b: 'vault:app:missing' };
    await assert.rejects(resolver.resolveConfigSecrets(value), /missing/);
    assert.equal(value.a, 'vault:app:good');
});
test('TTL, stale fallback, scoped invalidation and no cached fallback on first failure', async () => {
    let time = 0;
    let offline = false;
    const warnings = [];
    const resolver = createVaultResolver({ config, env: {}, now: () => time, cacheTtlMs: 10, onWarning: message => warnings.push(message), fetchImpl: async () => {
        if (offline) return new Response('sensitive-response', { status: 403 });
        return reply({ password: 'sensitive-value' });
    } });
    assert.equal(await resolver.getSecret('app', 'password'), 'sensitive-value');
    offline = true;
    time = 11;
    assert.equal(await resolver.getSecret('app', 'password'), 'sensitive-value');
    assert.equal(warnings.length, 1);
    resolver.clearSecretCache('app');
    await assert.rejects(resolver.getSecret('app', 'password'), error => !/sensitive/.test(error.message));
});
test('environment references resolve atomically before transports start', async () => {
    const env = { OTEL_EXPORTER_OTLP_LOGS_HEADERS: 'vault:app:headers', LOG_LEVEL: 'info' };
    const resolver = createVaultResolver({ config, env, fetchImpl: async () => reply({ headers: 'Authorization=Basic%20fixture' }) });
    await resolver.resolveEnvironmentSecrets();
    assert.equal(env.OTEL_EXPORTER_OTLP_LOGS_HEADERS, 'Authorization=Basic%20fixture');
    assert.equal(env.LOG_LEVEL, 'info');
});
test('descriptive schema errors expose paths and never dump configuration values', () => {
    assert.throws(() => validateConfig(z.object({ port: z.number().int() }), { port: 'private-value' }), error => /port/.test(error.message) && !error.message.includes('private-value'));
});
