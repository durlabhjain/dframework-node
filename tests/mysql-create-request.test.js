/**
 * Test for MySQL createRequest - verifies that repeated calls do not cause
 * "Maximum call stack size exceeded" by mutating the pool's query/execute methods.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Mysql from '../lib/mysql.js';

// Minimal mock MySQL pool
function createMockPool() {
    const originalQuery = async function (sql, params) {
        return [[{ id: 1 }], []];
    };
    const originalExecute = async function (sql, params) {
        return [[{ id: 1 }], []];
    };
    return {
        query: originalQuery,
        execute: originalExecute,
        _originalQuery: originalQuery,
        _originalExecute: originalExecute,
    };
}

function createMysqlWithMockPool() {
    const instance = new Mysql();
    instance.pool = createMockPool();
    instance.queryLogThreshold = 1000;
    instance.timeoutLogLevel = 'info';
    return instance;
}

// Test 1: Pool query/execute are not modified after createRequest
test('Pool query/execute methods are not mutated by createRequest', () => {
    const mysql1 = createMysqlWithMockPool();
    const poolQueryBefore = mysql1.pool.query;
    const poolExecuteBefore = mysql1.pool.execute;

    mysql1.createRequest();
    mysql1.createRequest();
    mysql1.createRequest();

    assert.strictEqual(mysql1.pool.query, poolQueryBefore);
    assert.strictEqual(mysql1.pool.execute, poolExecuteBefore);
});

// Test 2: Each createRequest call returns an independent request object
test('Each createRequest returns a fresh independent object with its own params', () => {
    const mysql2 = createMysqlWithMockPool();
    const req1 = mysql2.createRequest();
    const req2 = mysql2.createRequest();

    req1.params['a'] = 1;
    assert.strictEqual(req2.params['a'], undefined);
});

// Test 3: createPoolConnection returns a pool without using new keyword
test('createPoolConnection returns pool from mysql.createPool (no new keyword)', async () => {
    const instance = new Mysql();
    const fakePool = { query: () => {}, execute: () => {} };
    // Monkey-patch mysql.createPool to verify it is called without new
    const mysql2 = await import('mysql2/promise');
    const originalCreatePool = mysql2.default.createPool;
    let calledAsFunction = false;
    // We can't easily detect `new` vs function call for a factory, so we verify
    // the returned pool is the one from createPool (not a new object from new)
    mysql2.default.createPool = function (cfg) {
        calledAsFunction = true;
        return fakePool;
    };
    try {
        const pool = await instance.createPoolConnection({ host: 'localhost' });
        assert.strictEqual(pool, fakePool, 'Should return the pool from mysql.createPool');
        assert.strictEqual(calledAsFunction, true, 'createPool should be called as a function');
    } finally {
        mysql2.default.createPool = originalCreatePool;
    }
});

// Test 4: createPoolConnection returns null when no config provided
test('createPoolConnection returns null when config is not provided', async () => {
    const instance = new Mysql();
    const result = await instance.createPoolConnection(null);
    assert.strictEqual(result, null);
});

// Test 5: No stack overflow after many createRequest calls
test('No stack overflow after 2000 createRequest calls', async () => {
    const mysql3 = createMysqlWithMockPool();

    for (let i = 0; i < 2000; i++) {
        mysql3.createRequest();
    }
    // Actually execute a query to trigger the proxy chain
    const req = mysql3.createRequest();
    try {
        await req.query('SELECT 1', {});
    } catch (err) {
        if (err instanceof RangeError && err.message.includes('call stack')) {
            throw err;
        }
        // Any other error type is unexpected and should fail the test
        console.error('Unexpected error during createRequest stress test:', err);
        throw err;
    }
});
