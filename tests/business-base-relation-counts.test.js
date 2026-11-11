/**
 * Tests for countInList relation counts in BusinessBase.list():
 * the count JOIN and its optional client scoping, the derived-column expression that filters and
 * projections resolve to, export paging, and the always-present dynamicColumns key.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import BusinessBase, { RelationshipTypes } from '../lib/business/business-base.mjs';
import Sql from '../lib/sql.js';

function createBo({ relations, showCount = false, scopeId = 7, createDynamicColumns } = {}) {
    class TestBusinessObject extends BusinessBase { }
    const bo = new TestBusinessObject();
    bo.tableName = 'UserGroup';
    bo.keyField = 'UserGroupId';
    bo.standardTable = false;
    bo.clientBased = false;
    bo.user = { scopeId };
    bo.showCount = showCount;
    bo.relations = relations;
    bo.selectStatement = 'SELECT Main.* FROM UserGroup Main';
    if (createDynamicColumns) {
        bo.createDynamicColumns = createDynamicColumns;
    }

    const queries = [];
    const sql = new Sql();
    sql.createRequest = () => ({
        parameters: {},
        input(name, type, value) { this.parameters[name] = { type, value }; return this; }
    });
    sql.runQuery = async ({ query, request }) => {
        queries.push({ query, parameters: request.parameters });
        return {
            recordsets: query.includes('AS TotalCount')
                ? [[{ TotalCount: 2 }]]
                : [[{ UserGroupMemberCount: null }, { UserGroupMemberCount: 5 }]]
        };
    };
    BusinessBase.businessObject = { sql };
    bo.getDatabaseAdapter = () => sql;
    return { bo, queries };
}

const countRelation = (extra = {}) => [{
    relation: 'UserGroupMember',
    type: RelationshipTypes.OneToMany,
    countInList: true,
    foreignTable: 'ClientUser',
    ...extra
}];

test('an unscoped count joins the relation table alone', async () => {
    const { bo, queries } = createBo({ relations: countRelation() });
    await bo.list({ limit: 10 });
    const { query } = queries.at(-1);
    assert.ok(query.includes('FROM [UserGroupMember] WHERE IsDeleted = 0'), query);
    assert.ok(!query.includes('INNER JOIN'), query);
    assert.ok(query.includes('ISNULL([UserGroupMember].UserGroupMemberCount, 0) UserGroupMemberCount'), query);
});

test('showCount scopes the counted rows through the foreign table, with a bound client id', async () => {
    const { bo, queries } = createBo({ relations: countRelation(), showCount: true });
    await bo.list({ limit: 10 });
    const { query, parameters } = queries.at(-1);
    assert.ok(query.includes('INNER JOIN ClientUser Joined_ClientUser ON Joined_ClientUser.ClientUserId = UserGroupMember.ClientUserId'), query);
    assert.ok(query.includes('Joined_ClientUser.ClientId = @UserGroupMember_CountClientId'), query);
    assert.ok(query.includes('Joined_ClientUser.IsDeleted = 0'), query);
    assert.equal(parameters.UserGroupMember_CountClientId.value, 7);
    // The scope must never be interpolated into the statement.
    assert.ok(!/ClientId = \d/.test(query), query);
    // Grouping is qualified, so the join cannot make the key ambiguous.
    assert.ok(query.includes('GROUP BY UserGroupMember.UserGroupId'), query);
});

test('isActiveConfig additionally requires the scoped row to be active', async () => {
    const { bo, queries } = createBo({ relations: countRelation({ isActiveConfig: true }), showCount: true });
    await bo.list({ limit: 10 });
    assert.ok(queries.at(-1).query.includes('Joined_ClientUser.IsActive = 1'), queries.at(-1).query);
});

test('countConfig scopes through the relation join table', async () => {
    const relations = countRelation({ countConfig: true, joinTable: 'Location', field: 'LocationId', table: 'SurveyMasterAssignment' });
    const { bo, queries } = createBo({ relations });
    await bo.list({ limit: 10 });
    const { query } = queries.at(-1);
    assert.ok(query.includes('INNER JOIN Location ON Location.LocationId = SurveyMasterAssignment.LocationId'), query);
    assert.ok(query.includes('Location.ClientId = @UserGroupMember_CountClientId'), query);
});

test('a missing client scope binds NULL rather than producing invalid SQL', async () => {
    const { bo, queries } = createBo({ relations: countRelation(), showCount: true, scopeId: null });
    await bo.list({ limit: 10 });
    const { query, parameters } = queries.at(-1);
    assert.ok(query.includes('= @UserGroupMember_CountClientId'), query);
    assert.equal(parameters.UserGroupMember_CountClientId.value, null);
    assert.ok(!query.includes('undefined'), query);
});

test('a filter on the count resolves to the join alias, not Main, in both queries', async () => {
    const { bo, queries } = createBo({ relations: countRelation(), showCount: true });
    await bo.list({ limit: 10, filter: [{ field: 'UserGroupMemberCount', operator: '=', value: 0, type: 'number' }] });
    assert.equal(queries.length, 2);
    for (const { query } of queries) {
        assert.ok(query.includes('ISNULL([UserGroupMember].UserGroupMemberCount, 0) = @filter_0'), query);
        assert.ok(!query.includes('Main.UserGroupMemberCount'), query);
        // One join only - the relation must not be counted twice.
        assert.equal(query.split(') [UserGroupMember]').length - 1, 1, query);
    }
});

test('a hook may register its own derived column for filtering', async () => {
    const { bo, queries } = createBo({ relations: [] });
    bo.addAdditionalColumns = (hookParameters) => {
        hookParameters.derivedColumns.AssignmentCount = 'ISNULL(Agg.AssignmentCount, 0)';
        return { listStatement: hookParameters.listStatement + ' LEFT OUTER JOIN Agg ON Agg.UserGroupId = Main.UserGroupId' };
    };
    await bo.list({ limit: 10, filter: [{ field: 'AssignmentCount', operator: '>', value: 1, type: 'number' }] });
    const { query } = queries.at(-1);
    assert.ok(query.includes('ISNULL(Agg.AssignmentCount, 0) > @filter_0'), query);
    assert.ok(!query.includes('Main.AssignmentCount'), query);
});

test('a count is returned as 0, never null, for a parent with no children', async () => {
    const { bo } = createBo({ relations: countRelation() });
    const result = await bo.list({ limit: 10 });
    assert.equal(result.records[0].UserGroupMemberCount, 0);
    assert.equal(result.records[1].UserGroupMemberCount, 5);
});

test('an export drops paging and the count query', async () => {
    const { bo, queries } = createBo({ relations: countRelation() });
    await bo.list({ limit: 10, responseType: 'excel' });
    assert.equal(queries.length, 1);
    assert.ok(!queries[0].query.includes('OFFSET'), queries[0].query);
});

test('dynamicColumns is set only when the hook exists, leaving the result shape otherwise untouched', async () => {
    const { bo: plain } = createBo({ relations: [] });
    const plainResult = await plain.list({ limit: 10 });
    assert.ok(!('dynamicColumns' in plainResult));

    const columns = [{ field: 'Custom_1' }];
    const { bo } = createBo({ relations: [], createDynamicColumns: () => columns });
    const result = await bo.list({ limit: 10 });
    assert.deepEqual(result.dynamicColumns, columns);
});
