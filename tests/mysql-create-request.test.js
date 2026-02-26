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

// Test 3: No stack overflow after many createRequest calls
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
