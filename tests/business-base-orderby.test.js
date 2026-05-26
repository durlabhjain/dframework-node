import { test } from 'node:test';
import assert from 'node:assert/strict';
import BusinessBase from '../lib/business/business-base.mjs';

function createBoWithSql(sql) {
    class TestBusinessObject extends BusinessBase { }
    const bo = new TestBusinessObject();
    bo.standardTable = false;
    bo.tableName = 'Users';
    bo.keyField = 'UserId';
    bo.user = {};

    let capturedQuery = '';
    BusinessBase.businessObject = {
        sql: {
            ...sql,
            createRequest: () => ({
                query: async (query) => {
                    capturedQuery = query;
                    return { recordset: [] };
                }
            })
        }
    };

    return {
        bo,
        getCapturedQuery: () => capturedQuery,
    };
}

test('list sanitizes ORDER BY direction token to ASC/DESC only', async () => {
    const { bo, getCapturedQuery } = createBoWithSql({
        addParameters: ({ query }) => query,
        applyShadowColumns: (field) => field,
        applyOrderByCaseInsensitive: (field) => `UPPER(${field})`,
    });

    await bo.list({ sort: 'Name DESC OFFSET 1 ROWS', limit: 0, returnCount: false });
    const query = getCapturedQuery();

    assert.ok(query.includes('ORDER BY UPPER(Name) DESC'));
    assert.ok(!query.includes('OFFSET 1 ROWS'), `Unexpected injected token in ORDER BY: ${query}`);
});

test('list does not wrap substituted shadow sort fields', async () => {
    let applyOrderByCaseInsensitiveCallCount = 0;
    const { bo, getCapturedQuery } = createBoWithSql({
        addParameters: ({ query }) => query,
        applyShadowColumns: (field) => field === 'Name' ? 'Name_Shadow' : field,
        applyOrderByCaseInsensitive: (field) => {
            applyOrderByCaseInsensitiveCallCount += 1;
            return `UPPER(${field})`;
        },
    });

    await bo.list({ sort: 'Name ASC', limit: 0, returnCount: false });
    const query = getCapturedQuery();

    assert.ok(query.includes('ORDER BY Name_Shadow ASC'));
    assert.equal(applyOrderByCaseInsensitiveCallCount, 0);
});
