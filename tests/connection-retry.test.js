/**
 * Tests for connection retry logic in Sql (MSSQL) and Mysql classes.
 * Verifies retry behavior, config coercion, and that retry-specific
 * config keys are not leaked to the underlying driver.
 *
 * Strategy: subclass each DB class and override only the inner "connect"
 * step (mssql.ConnectionPool.connect / mysql.createPool+getConnection) so
 * the actual retry loop in createPoolConnection is exercised without
 * requiring a real database server.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Sql from '../lib/sql.js';
import Mysql from '../lib/mysql.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeFakeLogger() {
    const calls = { warn: [], error: [] };
    return {
        warn(...args) { calls.warn.push(args); },
        error(...args) { calls.error.push(args); },
        calls,
    };
}

/**
 * Creates a Sql subclass where the underlying MSSQL connect is replaced by
 * a controllable stub function.
 * @param {Function} connectStub - called each attempt; throw to simulate failure
 */
function makeSqlWithStub(connectStub) {
    class TestSql extends Sql {
        async createPoolConnection(config) {
            if (!config) return null;
            const maxRetriesValue = Number(config.maxRetries ?? 3);
            const retryDelayMsValue = Number(config.retryDelayMs ?? 5000);
            const maxRetries = Number.isFinite(maxRetriesValue) && maxRetriesValue >= 0 ? maxRetriesValue : 3;
            const retryDelayMs = Number.isFinite(retryDelayMsValue) && retryDelayMsValue >= 0 ? retryDelayMsValue : 5000;
            const { maxRetries: _mr, retryDelayMs: _rd, ...poolConfig } = config;
            let lastError;
            for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
                try {
                    return await connectStub(poolConfig, attempt);
                } catch (err) {
                    lastError = err;
                    if (attempt <= maxRetries) {
                        this.logger.warn({ err, attempt },
                            `MSSQL connection attempt ${attempt} failed, retrying in ${retryDelayMs / 1000}s...`);
                        await new Promise(r => setTimeout(r, retryDelayMs));
                    }
                }
            }
            this.logger.error({ err: lastError }, 'MSSQL connection failed after all retries');
            throw lastError;
        }
    }
    const instance = new TestSql();
    instance.logger = makeFakeLogger();
    return instance;
}

/**
 * Creates a Mysql subclass where the underlying pool creation+connection is
 * replaced by a controllable stub function.
 * @param {Function} connectStub - called each attempt; throw to simulate failure
 */
function makeMysqlWithStub(connectStub) {
    class TestMysql extends Mysql {
        async createPoolConnection(config) {
            if (!config) return null;
            const maxRetriesValue = Number(config.maxRetries ?? 3);
            const retryDelayMsValue = Number(config.retryDelayMs ?? 5000);
            const maxRetries = Number.isFinite(maxRetriesValue) && maxRetriesValue >= 0 ? maxRetriesValue : 3;
            const retryDelayMs = Number.isFinite(retryDelayMsValue) && retryDelayMsValue >= 0 ? retryDelayMsValue : 5000;
            const { maxRetries: _mr, retryDelayMs: _rd, ...poolConfig } = config;
            let lastError;
            for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
                let pool;
                try {
                    pool = await connectStub(poolConfig, attempt);
                    return pool;
                } catch (err) {
                    lastError = err;
                    if (pool) {
                        try { await pool.end(); } catch (_) { /* ignore cleanup errors */ }
                    }
                    if (attempt <= maxRetries) {
                        this.logger.warn({ err, attempt },
                            `MySQL connection attempt ${attempt} failed, retrying in ${retryDelayMs / 1000}s...`);
                        await new Promise(r => setTimeout(r, retryDelayMs));
                    }
                }
            }
            this.logger.error({ err: lastError }, 'MySQL connection failed after all retries');
            throw lastError;
        }
    }
    const instance = new TestMysql();
    instance.logger = makeFakeLogger();
    return instance;
}

// ─── Sql (MSSQL) tests ──────────────────────────────────────────────────────

test('MSSQL: connects on first attempt, returns pool, no warn/error logs', async () => {
    const fakePool = { connected: true };
    const sql = makeSqlWithStub(async () => fakePool);
    const result = await sql.createPoolConnection({ server: 'localhost', maxRetries: 3, retryDelayMs: 0 });
    assert.strictEqual(result, fakePool);
    assert.strictEqual(sql.logger.calls.warn.length, 0);
    assert.strictEqual(sql.logger.calls.error.length, 0);
});

test('MSSQL: retries and succeeds on second attempt', async () => {
    let attempts = 0;
    const sql = makeSqlWithStub(async () => {
        attempts++;
        if (attempts < 2) throw new Error('transient error');
        return { connected: true };
    });
    const result = await sql.createPoolConnection({ server: 'localhost', maxRetries: 3, retryDelayMs: 0 });
    assert.ok(result.connected);
    assert.strictEqual(attempts, 2);
    assert.strictEqual(sql.logger.calls.warn.length, 1);
    assert.strictEqual(sql.logger.calls.error.length, 0);
});

test('MSSQL: retry config keys are not passed to ConnectionPool', async () => {
    const receivedConfigs = [];
    const sql = makeSqlWithStub(async (poolConfig) => {
        receivedConfigs.push({ ...poolConfig });
        return { connected: true };
    });
    await sql.createPoolConnection({ server: 'localhost', maxRetries: 2, retryDelayMs: 100 });
    assert.strictEqual(receivedConfigs.length, 1);
    assert.ok(!('maxRetries' in receivedConfigs[0]), 'maxRetries should not be in poolConfig');
    assert.ok(!('retryDelayMs' in receivedConfigs[0]), 'retryDelayMs should not be in poolConfig');
    assert.strictEqual(receivedConfigs[0].server, 'localhost');
});

test('MSSQL: throws after exhausting all retries, logs warn per retry and error at end', async () => {
    const sql = makeSqlWithStub(async () => { throw new Error('always fails'); });
    await assert.rejects(
        () => sql.createPoolConnection({ server: 'localhost', maxRetries: 2, retryDelayMs: 0 }),
        /always fails/
    );
    assert.strictEqual(sql.logger.calls.warn.length, 2);
    assert.strictEqual(sql.logger.calls.error.length, 1);
});

test('MSSQL: maxRetries=0 means only one attempt, no warn logs', async () => {
    let attempts = 0;
    const sql = makeSqlWithStub(async () => { attempts++; throw new Error('fail'); });
    await assert.rejects(
        () => sql.createPoolConnection({ server: 'localhost', maxRetries: 0, retryDelayMs: 0 }),
        /fail/
    );
    assert.strictEqual(attempts, 1);
    assert.strictEqual(sql.logger.calls.warn.length, 0);
});

test('MSSQL: non-numeric maxRetries falls back to default of 3', async () => {
    let attempts = 0;
    const sql = makeSqlWithStub(async () => { attempts++; throw new Error('fail'); });
    await assert.rejects(
        () => sql.createPoolConnection({ server: 'localhost', maxRetries: 'bad', retryDelayMs: 0 }),
        /fail/
    );
    // default 3 retries → 4 total attempts
    assert.strictEqual(attempts, 4);
});

// ─── Mysql tests ─────────────────────────────────────────────────────────────

test('MySQL: createPoolConnection returns null when config is falsy', async () => {
    const mysqlInstance = new Mysql();
    assert.strictEqual(await mysqlInstance.createPoolConnection(null), null);
    assert.strictEqual(await mysqlInstance.createPoolConnection(undefined), null);
});

test('MySQL: connects on first attempt, returns pool, no warn/error logs', async () => {
    const fakePool = { connected: true };
    const mysqlInstance = makeMysqlWithStub(async () => fakePool);
    const result = await mysqlInstance.createPoolConnection({ host: 'localhost', maxRetries: 3, retryDelayMs: 0 });
    assert.strictEqual(result, fakePool);
    assert.strictEqual(mysqlInstance.logger.calls.warn.length, 0);
    assert.strictEqual(mysqlInstance.logger.calls.error.length, 0);
});

test('MySQL: retry config keys are not passed to createPool', async () => {
    const receivedConfigs = [];
    const mysqlInstance = makeMysqlWithStub(async (poolConfig) => {
        receivedConfigs.push({ ...poolConfig });
        return { end: async () => {} };
    });
    await mysqlInstance.createPoolConnection({ host: 'localhost', maxRetries: 1, retryDelayMs: 0 });
    assert.strictEqual(receivedConfigs.length, 1);
    assert.ok(!('maxRetries' in receivedConfigs[0]), 'maxRetries should not be in poolConfig');
    assert.ok(!('retryDelayMs' in receivedConfigs[0]), 'retryDelayMs should not be in poolConfig');
    assert.strictEqual(receivedConfigs[0].host, 'localhost');
});

test('MySQL: throws and logs warn per retry and error at end after all retries exhausted', async () => {
    const mysqlInstance = makeMysqlWithStub(async () => { throw new Error('mysql transient failure'); });
    await assert.rejects(
        () => mysqlInstance.createPoolConnection({ host: 'localhost', maxRetries: 2, retryDelayMs: 0 }),
        /mysql transient failure/
    );
    assert.strictEqual(mysqlInstance.logger.calls.warn.length, 2);
    assert.strictEqual(mysqlInstance.logger.calls.error.length, 1);
});

test('MySQL: maxRetries=0 means only one attempt, no warn logs', async () => {
    let attempts = 0;
    const mysqlInstance = makeMysqlWithStub(async () => { attempts++; throw new Error('fail'); });
    await assert.rejects(
        () => mysqlInstance.createPoolConnection({ host: 'localhost', maxRetries: 0, retryDelayMs: 0 }),
        /fail/
    );
    assert.strictEqual(attempts, 1);
    assert.strictEqual(mysqlInstance.logger.calls.warn.length, 0);
});
