import { test } from 'node:test';
import assert from 'node:assert/strict';
import Sql from '../lib/sql.js';
import Mysql from '../lib/mysql.js';

for (const Driver of [Sql, Mysql]) {
    for (const type of ['query', 'execute']) {
        test(`${Driver.name}.${type} captures a trace only for an enabled slow log`, async () => {
            const driver = new Driver();
            const originalError = globalThis.Error;
            const originalNow = Date.now;
            const failure = new Error('database failed');
            let allocations = 0;
            let now = 1000;
            let duration = 1;
            let enabled = true;
            let fail = false;
            const calls = [];
            const logger = {
                isLevelEnabled: level => level === 'warn' && enabled,
                warn: (...args) => calls.push(args),
                error() {},
            };
            const request = {
                _logger: logger,
                _sqlDialect: Driver === Mysql ? 'mysql' : 'mssql',
                parameters: {}, params: {},
                async [type]() {
                    now += duration;
                    if (fail) throw failure;
                    return Driver === Mysql ? [[{ id: 1 }], []] : { recordset: [{ id: 1 }] };
                },
            };
            globalThis.Error = class extends originalError {
                constructor(...args) {
                    super(...args);
                    if (args[0] === 'slow query trace') allocations++;
                }
            };
            Date.now = () => now;
            try {
                const run = () => driver.runQuery({ request, type, query: 'SELECT 1' });
                assert.equal((await run()).success, true);
                duration = 500;
                await run();
                assert.equal(allocations, 0, 'fast and threshold queries allocate no trace');
                duration = 501;
                enabled = false;
                await run();
                assert.equal(allocations, 0, 'disabled warn level allocates no trace');
                enabled = true;
                const result = await run();
                assert.equal(result.success, true);
                assert.deepEqual(result.data, [{ id: 1 }]);
                assert.equal(allocations, 1);
                assert.equal(calls.length, 1);
                assert.equal(calls[0][0].executionTimeMs, 501);
                assert.match(calls[0][0].stack, /slow query trace/);
                fail = true;
                assert.equal((await run()).err, failure);
                assert.equal(allocations, 1, 'failed queries retain their original error');
                fail = false;
                logger.warn = () => { throw failure; };
                assert.equal((await run()).success, true, 'logging failure cannot fail the query');
            } finally {
                globalThis.Error = originalError;
                Date.now = originalNow;
            }
        });
    }
}
