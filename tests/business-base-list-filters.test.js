/**
 * Tests for the two-pass WHERE assembly in BusinessBase.list():
 * system conditions are always AND-joined, user filters are joined with the caller's
 * logicalOperator, and the pass-2 append only fires against an outermost WHERE.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import BusinessBase from '../lib/business/business-base.mjs';
import Sql from '../lib/sql.js';

function createBo({ selectStatement, clientBased = false } = {}) {
    class TestBusinessObject extends BusinessBase { }
    const bo = new TestBusinessObject();
    bo.standardTable = false;
    bo.tableName = 'Users';
    bo.keyField = 'UserId';
    bo.user = { scopeId: 7 };
    bo.clientBased = clientBased;
    bo.selectStatement = selectStatement || 'SELECT Main.* FROM Users Main';

    let capturedQuery = '';
    // Real adapter, so addParameters/findOutermostToken/addPaging behave as they do in production.
    const sql = new Sql();
    sql.createRequest = () => ({
        parameters: {},
        input(name, typeOrValue, value) {
            this.parameters[name] = arguments.length === 2 ? { value: typeOrValue } : { type: typeOrValue, value };
        }
    });
    sql.runQuery = async ({ query }) => {
        capturedQuery = query;
        return { recordsets: [[]] };
    };
    BusinessBase.businessObject = { sql };

    return { bo, sql, getCapturedQuery: () => capturedQuery };
}

const filterOnTwoFields = JSON.stringify([
    { field: 'FirstName', operator: 'contains', value: 'jo', type: 'string' },
    { field: 'LastName', operator: 'contains', value: 'sm', type: 'string' }
]);

test('BusinessBase.list WHERE assembly', { concurrency: 1 }, async (t) => {
    await t.test('defaults to AND and does not parenthesize user filters', async () => {
        const { bo, getCapturedQuery } = createBo();

        await bo.list({ filter: filterOnTwoFields, limit: 0, returnCount: false });
        const query = getCapturedQuery();

        assert.match(query, /WHERE Main\.FirstName LIKE @\w+ AND Main\.LastName LIKE @\w+/);
        assert.equal(query.match(/\bWHERE\b/g).length, 1);
    });

    await t.test('logicalOperator OR groups user filters in parentheses', async () => {
        const { bo, getCapturedQuery } = createBo();

        await bo.list({ filter: filterOnTwoFields, limit: 0, returnCount: false, logicalOperator: 'OR' });
        const query = getCapturedQuery();

        assert.match(query, /WHERE \(Main\.FirstName LIKE @\w+ OR Main\.LastName LIKE @\w+\)/);
    });

    await t.test('OR filters are AND-ed onto system conditions rather than weakening them', async () => {
        const { bo, getCapturedQuery } = createBo({ clientBased: true });

        await bo.list({ filter: filterOnTwoFields, limit: 0, returnCount: false, logicalOperator: 'OR' });
        const query = getCapturedQuery();

        // Client scoping comes from pass 1, so it must survive as an AND-ed sibling of the OR group.
        assert.match(query, /WHERE Main\.ClientId = @\w+ AND \(Main\.FirstName LIKE @\w+ OR Main\.LastName LIKE @\w+\)/);
        assert.equal(query.match(/\bWHERE\b/g).length, 1);
    });

    await t.test('a WHERE nested inside a subquery does not swallow the user filters', async () => {
        const { bo, getCapturedQuery } = createBo({
            selectStatement: 'SELECT Main.* FROM (SELECT * FROM Users WHERE IsDeleted = 0) Main'
        });

        await bo.list({ filter: filterOnTwoFields, limit: 0, returnCount: false });
        const query = getCapturedQuery();

        // Pass 1 contributes nothing here, so pass 2 must open its own outermost WHERE
        // instead of AND-ing onto the subquery's.
        assert.match(query, /\) Main WHERE Main\.FirstName LIKE @\w+ AND Main\.LastName LIKE @\w+/);
        assert.equal(query.match(/\bWHERE\b/g).length, 2);
    });
});

const doesNotContainFilter = JSON.stringify([
    { field: 'FirstName', operator: 'doesNotContain', value: 'jo', type: 'string' }
]);

test('BusinessBase.list negated string filters keep valueless rows', { concurrency: 1 }, async (t) => {
    await t.test('doesNotContain widens NOT LIKE with an IS NULL branch', async () => {
        const { bo, getCapturedQuery } = createBo();

        await bo.list({ filter: doesNotContainFilter, limit: 0, returnCount: false });

        assert.match(getCapturedQuery(), /WHERE \(Main\.FirstName IS NULL OR Main\.FirstName NOT LIKE @\w+\)/);
    });

    await t.test('notContains is the same operator under its other name', async () => {
        const { bo, getCapturedQuery } = createBo();
        const filter = JSON.stringify([{ field: 'FirstName', operator: 'notContains', value: 'jo', type: 'string' }]);

        await bo.list({ filter, limit: 0, returnCount: false });

        assert.match(getCapturedQuery(), /WHERE \(Main\.FirstName IS NULL OR Main\.FirstName NOT LIKE @\w+\)/);
    });

    await t.test('contains is left untouched', async () => {
        const { bo, getCapturedQuery } = createBo();
        const filter = JSON.stringify([{ field: 'FirstName', operator: 'contains', value: 'jo', type: 'string' }]);

        await bo.list({ filter, limit: 0, returnCount: false });

        const query = getCapturedQuery();
        assert.match(query, /WHERE Main\.FirstName LIKE @\w+/);
        assert.doesNotMatch(query, /IS NULL/);
    });

    await t.test("forceCaseInsensitive 'upper' tests the plain column, not the UPPER() wrapper", async () => {
        const { bo, sql, getCapturedQuery } = createBo();
        sql.forceCaseInsensitive = true;

        await bo.list({ filter: doesNotContainFilter, limit: 0, returnCount: false });

        assert.match(getCapturedQuery(), /WHERE \(Main\.FirstName IS NULL OR UPPER\(Main\.FirstName\) NOT LIKE @\w+\)/);
    });

    await t.test("forceCaseInsensitive 'ilike' keeps the IS NULL branch outside NOT ILIKE", async () => {
        const { bo, sql, getCapturedQuery } = createBo();
        sql.forceCaseInsensitive = true;
        sql.caseInsensitiveMode = 'ilike';

        await bo.list({ filter: doesNotContainFilter, limit: 0, returnCount: false });

        assert.match(getCapturedQuery(), /WHERE \(Main\.FirstName IS NULL OR Main\.FirstName NOT ILIKE @\w+\)/);
    });

    await t.test("forceCaseInsensitive 'ilike-fn' wraps the whole function comparison", async () => {
        const { bo, sql, getCapturedQuery } = createBo();
        sql.forceCaseInsensitive = true;
        sql.caseInsensitiveMode = 'ilike-fn';

        await bo.list({ filter: doesNotContainFilter, limit: 0, returnCount: false });

        assert.match(getCapturedQuery(), /WHERE \(Main\.FirstName IS NULL OR ILIKE\(Main\.FirstName, @\w+\) = 0\)/);
    });
});
