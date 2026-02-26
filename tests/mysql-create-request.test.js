/**
 * Test for MySQL createRequest - verifies that repeated calls do not cause
 * "Maximum call stack size exceeded" by mutating the pool's query/execute methods.
 */

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

console.log('Testing MySQL createRequest does not mutate the pool...\n');

// Test 1: Pool query/execute are not modified after createRequest
console.log('Test 1: Pool query/execute methods are not mutated by createRequest');
const mysql1 = new Mysql();
mysql1.pool = createMockPool();
await mysql1.setConfig();

const poolQueryBefore = mysql1.pool.query;
const poolExecuteBefore = mysql1.pool.execute;

mysql1.createRequest();
mysql1.createRequest();
mysql1.createRequest();

const poolQueryAfter = mysql1.pool.query;
const poolExecuteAfter = mysql1.pool.execute;

const queryNotMutated = poolQueryBefore === poolQueryAfter;
const executeNotMutated = poolExecuteBefore === poolExecuteAfter;
console.log('Pool query not mutated:', queryNotMutated);
console.log('Pool execute not mutated:', executeNotMutated);
console.log('Match:', queryNotMutated && executeNotMutated);
console.log('');

// Test 2: Each createRequest call returns an independent request object
console.log('Test 2: Each createRequest returns a fresh independent object');
const mysql2 = new Mysql();
mysql2.pool = createMockPool();
await mysql2.setConfig();

const req1 = mysql2.createRequest();
const req2 = mysql2.createRequest();

req1.params['a'] = 1;
const req2HasNoA = req2.params['a'] === undefined;
console.log('req1.params independent from req2.params:', req2HasNoA);
console.log('Match:', req2HasNoA);
console.log('');

// Test 3: No stack overflow after many createRequest calls
console.log('Test 3: No stack overflow after 2000 createRequest calls');
const mysql3 = new Mysql();
mysql3.pool = createMockPool();
await mysql3.setConfig();

let stackOverflow = false;
try {
    for (let i = 0; i < 2000; i++) {
        mysql3.createRequest();
    }
    // Actually execute a query to trigger the proxy chain
    const req = mysql3.createRequest();
    await req.query('SELECT 1', {});
} catch (err) {
    if (err instanceof RangeError && err.message.includes('call stack')) {
        stackOverflow = true;
        console.log('Stack overflow error:', err.message);
    } else {
        // Other errors (e.g., from mock) are ok
        console.log('Non-stack-overflow error (acceptable):', err.message);
    }
}
console.log('Stack overflow occurred:', stackOverflow);
console.log('Match (no stack overflow):', !stackOverflow);
console.log('');

console.log('All tests completed!');
