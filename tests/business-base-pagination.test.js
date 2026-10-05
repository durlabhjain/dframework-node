import { test } from 'node:test';
import assert from 'node:assert/strict';
import BusinessBase from '../lib/business/business-base.mjs';
import Sql, { mssql } from '../lib/sql.js';
import Mysql from '../lib/mysql.js';
import ConcatenatedColumns from '../lib/business/concatenated-columns.mjs';

// Real query builders, parameter binding and runQuery normalization; only the
// driver boundary is mocked. These tests never connect to a database.
function createFixture(adapterName, responses) {
    const sql = adapterName === 'mysql' ? new Mysql() : new Sql();
    const calls = [];
    sql.logger = { error() {}, warn() {}, info() {} };
    async function driver(query, params) {
        calls.push({ query, params: params || this.parameters });
        assert.ok(calls.length <= responses.length, `Unexpected query: ${query}`);
        const rows = responses[calls.length - 1];
        if (rows instanceof Error) throw rows;
        return adapterName === 'mysql' ? [rows, []] : { recordset: rows, recordsets: [rows] };
    }
    if (adapterName === 'mysql') {
        sql.pool = { query: driver, execute: driver };
    } else {
        sql.createRequest = () => {
            const request = new mssql.Request();
            request.query = driver;
            return request;
        };
    }
    BusinessBase.businessObject = { [adapterName]: sql };
    const bo = new BusinessBase();
    Object.assign(bo, {
        dbAdapter: adapterName, standardTable: false, clientBased: false,
        tableName: 'Users', keyField: 'UserId', user: {},
        selectStatement: 'SELECT Main.* FROM Users Main', defaultSortOrder: 'UserId'
    });
    return { bo, calls };
}

for (const adapterName of ['sql', 'mysql']) {
    test(`${adapterName}: count-first pagination`, { concurrency: 1 }, async (t) => {
        for (const total of [0, '0', 0n]) {
            await t.test(`zero ${typeof total} total skips data query and preserves count type`, async () => {
                const { bo, calls } = createFixture(adapterName, [[{ TotalCount: total }]]);
                assert.deepEqual(await bo.list({}), { records: [], recordCount: total });
                assert.equal(calls.length, 1);
                assert.match(calls[0].query, /^SELECT COUNT\(1\) AS TotalCount FROM Users Main$/);
                assert.doesNotMatch(calls[0].query, /ORDER BY|OFFSET|LIMIT|SELECT Main\.\*/);
            });
        }

        await t.test('nonzero count fetches the same page and preserves filters, parameters and count', async () => {
            const { bo, calls } = createFixture(adapterName, [[{ TotalCount: '12' }], [{ UserId: 6 }]]);
            bo.clientBased = true;
            bo.user.scopeId = 7;
            bo.customizeQuery = (context) => {
                context.parameters.active = 1;
                context.query += ` AND Main.IsActive = ${adapterName === 'mysql' ? ':' : '@'}active`;
            };
            const result = await bo.list({
                start: '5', limit: '10', sort: 'UserId DESC',
                filter: [{ field: 'FirstName', operator: 'contains', value: 'jo' }]
            });
            assert.deepEqual(result, { records: [{ UserId: 6 }], recordCount: '12' });
            assert.equal(calls.length, 2);
            assert.match(calls[0].query, /^SELECT COUNT\(1\) AS TotalCount/);
            assert.match(calls[1].query, /^SELECT Main\.\*/);
            assert.doesNotMatch(calls[1].query, /TotalCount/);
            for (const { query, params } of calls) {
                assert.match(query, /WHERE Main\.ClientId = [@:]ClientId AND Main\.FirstName LIKE [@:]filter_0 AND Main\.IsActive = [@:]active/);
                const value = name => adapterName === 'mysql' ? params[name] : params[name].value;
                assert.equal(value('ClientId'), 7);
                assert.equal(value('filter_0'), '%jo%');
                assert.equal(value('active'), 1);
                assert.equal(value('z_start'), 5);
                assert.equal(value('z_limit'), 10);
            }
            assert.match(calls[1].query, adapterName === 'mysql'
                ? /ORDER BY UserId DESC LIMIT :z_start, :z_limit;$/
                : /ORDER BY UserId DESC OFFSET @z_start ROWS FETCH NEXT @z_limit ROWS ONLY;$/);
        });

        await t.test('nonzero count still fetches an empty page beyond the total', async () => {
            const { bo, calls } = createFixture(adapterName, [[{ TotalCount: 3 }], []]);
            assert.deepEqual(await bo.list({ start: 100 }), { records: [], recordCount: 3 });
            assert.equal(calls.length, 2);
        });

        await t.test('disabled counts fetch data once and omit recordCount', async () => {
            const { bo, calls } = createFixture(adapterName, [[{ UserId: 1 }]]);
            assert.deepEqual(await bo.list({ returnCount: false }), { records: [{ UserId: 1 }] });
            assert.equal(calls.length, 1);
            assert.doesNotMatch(calls[0].query, /TotalCount/);
        });

        for (const limit of [0, -1, '0']) {
            await t.test(`unpaged limit ${limit} uses returned records for count`, async () => {
                const { bo, calls } = createFixture(adapterName, [[{ UserId: 1 }]]);
                assert.deepEqual(await bo.list({ limit }), { records: [{ UserId: 1 }], recordCount: 1 });
                assert.equal(calls.length, 1);
                assert.doesNotMatch(calls[0].query, /TotalCount|OFFSET|LIMIT/);
            });
        }

        await t.test('count errors propagate without a data query', async () => {
            const error = new Error('count failed');
            const { bo, calls } = createFixture(adapterName, [error]);
            await assert.rejects(bo.list({}), err => err === error);
            assert.equal(calls.length, 1);
        });

        await t.test('data errors propagate after a nonzero count', async () => {
            const error = new Error('data failed');
            const { bo, calls } = createFixture(adapterName, [[{ TotalCount: 1 }], error]);
            await assert.rejects(bo.list({}), err => err === error);
            assert.equal(calls.length, 2);
        });

        for (const total of [null, undefined]) {
            await t.test(`${total} is not treated as zero`, async () => {
                const { bo, calls } = createFixture(adapterName, [[{ TotalCount: total }], [{ UserId: 1 }]]);
                assert.deepEqual(await bo.list({}), { records: [{ UserId: 1 }], recordCount: total });
                assert.equal(calls.length, 2);
            });
        }

        await t.test('empty grouped count skips data', async () => {
            const { bo, calls } = createFixture(adapterName, [[]]);
            bo.selectStatement = 'SELECT FirstName FROM Users Main';
            assert.deepEqual(await bo.list({ groupBy: 'FirstName', sort: 'FirstName' }), { records: [], recordCount: 0 });
            assert.equal(calls.length, 1);
            assert.match(calls[0].query, / GROUP BY FirstName$/);
        });

        await t.test('nonempty grouped count keeps existing first-group count semantics', async () => {
            const { bo, calls } = createFixture(adapterName, [[{ TotalCount: 2 }, { TotalCount: 3 }], [{ FirstName: 'Jo' }]]);
            bo.selectStatement = 'SELECT FirstName FROM Users Main';
            assert.deepEqual(await bo.list({ groupBy: 'FirstName', sort: 'FirstName' }), {
                records: [{ FirstName: 'Jo' }], recordCount: 2
            });
            assert.equal(calls.length, 2);
            assert.match(calls[1].query, /GROUP BY FirstName ORDER BY FirstName/);
        });

        await t.test('CTEs remain complete in both separate statements', async () => {
            const { bo, calls } = createFixture(adapterName, [[{ TotalCount: 1 }], [{ UserId: 1 }]]);
            bo.selectStatement = 'WITH c AS (SELECT * FROM Users) SELECT Main.* FROM c Main';
            await bo.list({});
            assert.equal(calls.length, 2);
            for (const { query } of calls) assert.match(query, /^WITH c AS \(SELECT \* FROM Users\) SELECT/);
            assert.doesNotMatch(calls[0].query, /ORDER BY|OFFSET|LIMIT/);
        });

        await t.test('embedded hook IN placeholders are expanded in both statements', async () => {
            const { bo, calls } = createFixture(adapterName, [[{ TotalCount: 1 }], [{ UserId: 1 }]]);
            const prefix = adapterName === 'mysql' ? ':' : '@';
            bo.getListStatement = context => {
                context.parameters.ids = { value: [1, 2], useTvp: false };
                return `SELECT Main.* FROM Users Main WHERE Main.UserId IN (${prefix}{ids})`;
            };
            await bo.list({});
            assert.equal(calls.length, 2);
            for (const { query } of calls) {
                assert.doesNotMatch(query, /\{ids\}/);
                assert.match(query, /UserId IN \([@:]ids_0, [@:]ids_1\)/);
            }
        });

        await t.test('zero retains hooks but avoids concatenated-column and row-group queries', async (t) => {
            const { bo, calls } = createFixture(adapterName, [[{ TotalCount: 0 }]]);
            const hooks = [];
            const concat = t.mock.method(ConcatenatedColumns, 'addColumns', async () => {
                throw new Error('empty records must not be decorated');
            });
            bo.concatenatedColumns = [{ name: 'Detail' }];
            bo.beforeList = () => { hooks.push('before'); };
            bo.customizeList = ({ listResult }) => {
                hooks.push('customize');
                assert.deepEqual(listResult, { records: [], recordCount: 0 });
                return { decorated: true };
            };
            bo.afterList = ({ listResult }) => {
                hooks.push('after');
                listResult.finished = true;
            };
            assert.deepEqual(await bo.list({ rowGroupField: 'FirstName' }), {
                records: [], recordCount: 0, decorated: true, finished: true
            });
            assert.deepEqual(hooks, ['before', 'customize', 'after']);
            assert.equal(calls.length, 1);
            assert.equal(concat.mock.callCount(), 0);
        });

        await t.test('beforeList can disable counting', async () => {
            const { bo, calls } = createFixture(adapterName, [[{ UserId: 1 }]]);
            bo.beforeList = context => { context.returnCount = false; };
            assert.deepEqual(await bo.list({}), { records: [{ UserId: 1 }] });
            assert.equal(calls.length, 1);
        });

        await t.test('nonzero totals retain decoration, hooks and row-group summaries', async (t) => {
            const { bo, calls } = createFixture(adapterName, [
                [{ TotalCount: 2 }], [{ UserId: 1, FirstName: 'Jo' }],
                [{ FirstName: 'Jo', childrenCount: 2 }]
            ]);
            bo.concatenatedColumns = [{ name: 'Detail' }];
            const concat = t.mock.method(ConcatenatedColumns, 'addColumns', async ({ records }) =>
                records.map(record => ({ ...record, Detail: 'decorated' })));
            bo.customizeList = ({ listResult }) => {
                assert.equal(listResult.records[0].Detail, 'decorated');
                return { customized: true };
            };
            bo.afterList = ({ listResult }) => { listResult.finished = true; };
            const result = await bo.list({ rowGroupField: 'FirstName' });
            assert.equal(result.recordCount, 2);
            assert.equal(result.customized, true);
            assert.equal(result.finished, true);
            assert.equal(result.records.length, 2);
            assert.equal(result.records[0].childrenCount, 2);
            assert.equal(result.records[1].Detail, 'decorated');
            assert.equal(concat.mock.callCount(), 1);
            assert.equal(calls.length, 3);
            assert.match(calls[2].query, /AS PivotSource GROUP BY FirstName$/);
        });
    });
}
