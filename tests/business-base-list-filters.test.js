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
    const capturedQueries = [];
    let capturedRequest;
    // Real adapter, so addParameters/findOutermostToken/addPaging behave as they do in production.
    const sql = new Sql();
    sql.createRequest = () => ({
        parameters: {},
        input(name, typeOrValue, value) {
            this.parameters[name] = arguments.length === 2 ? { value: typeOrValue } : { type: typeOrValue, value };
        }
    });
    sql.runQuery = async ({ query, request }) => {
        capturedQuery = query;
        capturedQueries.push(query);
        capturedRequest = request;
        return { recordsets: [/SELECT COUNT\(1\) AS TotalCount/.test(query) ? [{ TotalCount: 2 }] : []] };
    };
    BusinessBase.businessObject = { sql };

    return { bo, sql, getCapturedQuery: () => capturedQuery, getCapturedQueries: () => capturedQueries, getCapturedRequest: () => capturedRequest };
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

test('count projection preserves the outer query and leading CTEs', () => {
    const { bo } = createBo();
    const cases = [
        ['WITH c AS (SELECT a FROM y) SELECT Main.* FROM (SELECT a FROM c) Main WHERE EXISTS (SELECT 1 FROM z)',
            'WITH c AS (SELECT a FROM y) SELECT COUNT(1) AS TotalCount FROM (SELECT a FROM c) Main WHERE EXISTS (SELECT 1 FROM z)'],
        [';WITH c AS (SELECT a FROM y)\nSELECT Main.*\nFROM c Main',
            ';WITH c AS (SELECT a FROM y)\nSELECT COUNT(1) AS TotalCount FROM c Main'],
        ["/* SELECT FROM ( */ WITH c AS (SELECT ')' a FROM y) SELECT ' from ', [select], (SELECT a FROM z) AS x FROM c Main",
            "/* SELECT FROM ( */ WITH c AS (SELECT ')' a FROM y) SELECT COUNT(1) AS TotalCount FROM c Main"],
        ['SELECT (SELECT a FROM z) AS x FROM y Main',
            'SELECT COUNT(1) AS TotalCount FROM y Main'],
    ];
    for (const [query, expected] of cases) {
        assert.equal(bo.buildTotalStatement({ query }), expected);
    }
});

test('paged CTE list counts the same filtered outer rows', async () => {
    const { bo, getCapturedQueries } = createBo({
        selectStatement: 'WITH c AS (SELECT * FROM Users) SELECT Main.* FROM (SELECT * FROM c) Main'
    });
    await bo.list({ filter: filterOnTwoFields, limit: 10, sort: 'UserId' });
    const [countQuery, dataQuery] = getCapturedQueries();
    assert.match(countQuery, /^WITH c AS \(SELECT \* FROM Users\) SELECT COUNT\(1\) AS TotalCount FROM \(SELECT \* FROM c\) Main WHERE Main\.FirstName LIKE @filter_0 AND Main\.LastName LIKE @filter_1$/);
    assert.match(dataQuery, /ORDER BY UserId OFFSET @z_start ROWS FETCH NEXT @z_limit ROWS ONLY;$/);
});

test('explicit null filters retain SQL NULL semantics for strings', async () => {
    for (const [operator, predicate] of [['isNull', 'IS NULL'], ['isNotNull', 'IS NOT NULL']]) {
        const { bo, getCapturedQuery } = createBo();
        await bo.list({ filter: [{ field: 'FirstName', operator, type: 'string' }], limit: 0 });
        assert.equal(getCapturedQuery(), `SELECT Main.* FROM Users Main WHERE Main.FirstName ${predicate};`);
    }
});

test('OR membership remains a predicate instead of restricting every result with a JOIN', async () => {
    for (const useTvp of [true, false]) {
        const { bo, getCapturedQuery } = createBo({ clientBased: true });
        bo.useTvp = useTvp;
        await bo.list({
            filter: [
                { field: 'UserId', operator: 'isAnyOf', value: [1, 2] },
                { field: 'FirstName', operator: 'contains', value: 'jo' }
            ],
            logicalOperator: 'OR', limit: 0
        });
        const query = getCapturedQuery();
        assert.doesNotMatch(query, /INNER JOIN/);
        assert.match(query, /WHERE Main\.ClientId = @ClientId AND \(EXISTS \(.+\) OR Main\.FirstName LIKE @filter_1\)/);
    }
});

test('empty string filters and non-string empty filters remain distinct', async () => {
    for (const [operator, type, expected] of [
        ['isEmpty', 'string', "(Main.FirstName IS NULL OR Main.FirstName = '')"],
        ['isNotEmpty', 'string', "(Main.FirstName IS NOT NULL AND Main.FirstName != '')"],
        ['isEmpty', 'number', 'Main.FirstName IS NULL'],
        ['isNotEmpty', 'date', 'Main.FirstName IS NOT NULL']
    ]) {
        const { bo, getCapturedQuery } = createBo();
        await bo.list({ filter: [{ field: 'FirstName', operator, type }], limit: 0 });
        assert.equal(getCapturedQuery(), `SELECT Main.* FROM Users Main WHERE ${expected};`);
    }
});

test('repeated filters on the same field bind independent values', async () => {
    const { bo, getCapturedQuery, getCapturedRequest } = createBo();
    await bo.list({ filter: [
        { field: 'FirstName', operator: 'contains', value: 'jo' },
        { field: 'FirstName', operator: 'notContains', value: 'smith' }
    ], limit: 0 });
    assert.match(getCapturedQuery(), /Main.FirstName LIKE @filter_0 AND \(Main.FirstName IS NULL OR Main.FirstName NOT LIKE @filter_1\)/);
    assert.equal(getCapturedRequest().parameters.filter_0.value, '%jo%');
    assert.equal(getCapturedRequest().parameters.filter_1.value, '%smith%');
});

test('field qualification flags and standard audit aliases', async () => {
    for (const [properties, field, expected] of [
        [{ useColumnField: true }, 'FirstName', 'FirstName'],
        [{ useColumnField: true, useAliasName: true }, 'FirstName', 'Main.FirstName'],
        [{ standardTable: true, useView: false }, 'CreatedByUser', 'Created_.CreatedByUser'],
        [{}, 'CreatedByUser', 'Main.CreatedByUser']
    ]) {
        const { bo, getCapturedQuery } = createBo();
        Object.assign(bo, properties);
        await bo.list({ filter: [{ field, operator: 'contains', value: 'jo' }], limit: 0 });
        assert.ok(getCapturedQuery().includes(`${expected} LIKE @filter_0`), getCapturedQuery());
    }
});

test('list hooks share consumed filters, bind parameters, and decorate results in order', async () => {
    const { bo, getCapturedQuery, getCapturedRequest } = createBo();
    const calls = [];
    bo.beforeList = (context) => {
        calls.push('before');
        context.limit = 0;
        context.filter.push({ field: 'LastName', operator: 'contains', value: 'smith' });
    };
    bo.getListStatement = (context) => {
        calls.push('statement');
        const { first } = bo.extractAndRemoveFilters(context.filter, { field: 'FirstName', key: 'first' });
        context.parameters.first = first;
        return 'SELECT Main.*, @first AS SearchValue FROM Users Main';
    };
    bo.customizeQuery = (context) => {
        calls.push('query');
        context.query += ' AND Main.IsActive = 1';
    };
    bo.customizeList = () => {
        calls.push('customize');
        return [{ UserId: 1 }];
    };
    bo.afterList = ({ listResult }) => {
        calls.push('after');
        listResult.decorated = true;
    };
    const result = await bo.list({ filter: JSON.stringify([{ field: 'FirstName', operator: 'contains', value: 'jo' }]) });
    assert.deepEqual(calls, ['before', 'statement', 'query', 'customize', 'after']);
    assert.deepEqual(result.records, [{ UserId: 1 }]);
    assert.equal(result.decorated, true);
    assert.equal(getCapturedRequest().parameters.first.value, 'jo');
    assert.match(getCapturedQuery(), /WHERE Main.LastName LIKE @filter_1 AND Main.IsActive = 1;$/);
    assert.doesNotMatch(getCapturedQuery(), /Main.FirstName|OFFSET/);
});

test('multiple GROUP BY fields precede ordering and paging', async () => {
    const { bo, getCapturedQuery } = createBo({ selectStatement: 'SELECT FirstName, LastName FROM Users Main' });
    await bo.list({ groupBy: ['FirstName', 'LastName'], sort: 'FirstName', limit: 10, returnCount: false });
    assert.match(getCapturedQuery(), /GROUP BY FirstName, LastName ORDER BY FirstName OFFSET/);
});

test('outer token scanning ignores quoted text, escaped identifiers, and nested comments', () => {
    const { sql } = createBo();
    const query = 'SELECT \'it\'\'s ( FROM\', "a""FROM", [a]]FROM], `a``FROM` /* outer /* FROM */ ) */ FROM Users -- WHERE (\nWHERE EXISTS (SELECT 1 FROM Other WHERE x = 1) ORDER BY UserId';
    assert.equal(sql.findOutermostToken(query, /\bFROM\b/), query.indexOf('FROM Users'));
    assert.equal(sql.findOutermostToken(query, /\bWHERE\b/), query.indexOf('WHERE EXISTS'));
    assert.equal(sql.findOutermostToken(query, /\bORDER\s+BY\b/, query.indexOf('SELECT 1')), query.indexOf('ORDER BY'));
    assert.equal(sql.findOutermostToken('/* unterminated FROM', /\bFROM\b/), -1);
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
