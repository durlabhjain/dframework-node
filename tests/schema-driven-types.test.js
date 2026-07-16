/**
 * Tests for schema-driven column type resolution:
 *  - resolveColumnSqlType precedence: static schemaTypes override -> discovered/cached schema -> value inference
 *  - schemaTypes key matching: raw tableName, normalized "schema.name", and bare unqualified name
 *  - discoverColumnTypes: INFORMATION_SCHEMA mapping and caching
 *  - clearSchemaCache: per-table and full-cache invalidation
 *  - addParameters: schema-driven resolution wired through tableName/fieldName
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import mssql from 'mssql';
import Sql from '../lib/sql.js';

function makeSql(overrides = {}) {
    const instance = new Sql();
    Object.assign(instance, overrides);
    return instance;
}

function createMockRequest() {
    return {
        parameters: {},
        input: function (name, typeOrValue, value) {
            if (arguments.length === 2) {
                this.parameters[name] = { value: typeOrValue };
            } else {
                this.parameters[name] = { type: typeOrValue, value };
            }
        }
    };
}

function makeInformationSchemaRow({ columnName, dataType, maxLength = null, precision = null, scale = null }) {
    return {
        COLUMN_NAME: columnName,
        DATA_TYPE: dataType,
        CHARACTER_MAXIMUM_LENGTH: maxLength,
        NUMERIC_PRECISION: precision,
        NUMERIC_SCALE: scale
    };
}

function mockDiscovery(sql, recordset) {
    const inputs = [];
    sql.createRequest = () => ({
        input: (name, type, value) => inputs.push({ name, type, value }),
        query: async () => ({ recordset })
    });
    return inputs;
}

// ---------------------------------------------------------------------------
// resolveColumnSqlType: precedence
// ---------------------------------------------------------------------------

test('resolveColumnSqlType: static schemaTypes override wins over discovered schema', () => {
    const sql = makeSql({
        schemaTypes: { 'dbo.Users': { Age: { sqlType: mssql.TinyInt } } },
        schemaDrivenTypes: true
    });
    sql._schemaCache.set('dbo.Users', { Age: mssql.BigInt });
    const result = sql.resolveColumnSqlType({ tableName: 'dbo.Users', columnName: 'Age', value: 42 });
    assert.equal(result, mssql.TinyInt);
});

test('resolveColumnSqlType: falls back to discovered/cached schema when no static override', () => {
    const sql = makeSql({ schemaDrivenTypes: true });
    sql._schemaCache.set('dbo.Users', { Age: mssql.TinyInt });
    const result = sql.resolveColumnSqlType({ tableName: 'dbo.Users', columnName: 'Age', value: 42 });
    assert.equal(result, mssql.TinyInt);
});

test('resolveColumnSqlType: falls back to value inference when schemaDrivenTypes is false, even with a warm cache', () => {
    const sql = makeSql({ schemaDrivenTypes: false });
    sql._schemaCache.set('dbo.Users', { Age: mssql.TinyInt });
    const result = sql.resolveColumnSqlType({ tableName: 'dbo.Users', columnName: 'Age', value: 42 });
    assert.notEqual(result, mssql.TinyInt);
    assert.equal(result, mssql.Int);
});

test('resolveColumnSqlType: falls back to value inference when column is not in the cached schema', () => {
    const sql = makeSql({ schemaDrivenTypes: true });
    sql._schemaCache.set('dbo.Users', { Name: mssql.VarChar(50) });
    const result = sql.resolveColumnSqlType({ tableName: 'dbo.Users', columnName: 'Age', value: 42 });
    assert.equal(result, mssql.Int);
});

test('resolveColumnSqlType: falls back to value inference with no tableName', () => {
    const sql = makeSql({ schemaTypes: { Users: { Age: { sqlType: mssql.TinyInt } } } });
    const result = sql.resolveColumnSqlType({ columnName: 'Age', value: 42 });
    assert.equal(result, mssql.Int);
});

test('resolveColumnSqlType: cache read never blocks - missing cache entry falls straight to inference', () => {
    const sql = makeSql({ schemaDrivenTypes: true });
    const result = sql.resolveColumnSqlType({ tableName: 'dbo.Users', columnName: 'Age', value: 42 });
    assert.equal(result, mssql.Int);
});

// ---------------------------------------------------------------------------
// resolveColumnSqlType: schemaTypes key matching
// ---------------------------------------------------------------------------

test('resolveColumnSqlType: matches schemaTypes keyed by the exact raw tableName', () => {
    const sql = makeSql({ schemaTypes: { 'dbo.Users': { Age: { sqlType: mssql.TinyInt } } } });
    const result = sql.resolveColumnSqlType({ tableName: 'dbo.Users', columnName: 'Age', value: 42 });
    assert.equal(result, mssql.TinyInt);
});

test('resolveColumnSqlType: matches schemaTypes keyed by normalized "schema.name" even when caller passes a bracket-quoted tableName', () => {
    const sql = makeSql({ schemaTypes: { 'dbo.Users': { Age: { sqlType: mssql.TinyInt } } } });
    const result = sql.resolveColumnSqlType({ tableName: '[dbo].[Users]', columnName: 'Age', value: 42 });
    assert.equal(result, mssql.TinyInt);
});

test('resolveColumnSqlType: matches schemaTypes keyed by the bare unqualified table name', () => {
    const sql = makeSql({ schemaTypes: { Users: { Age: { sqlType: mssql.TinyInt } } } });
    const result = sql.resolveColumnSqlType({ tableName: 'dbo.Users', columnName: 'Age', value: 42 });
    assert.equal(result, mssql.TinyInt);
});

test('resolveColumnSqlType: static override entry may be a bare sqlType instead of { sqlType }', () => {
    const sql = makeSql({ schemaTypes: { 'dbo.Users': { Age: mssql.TinyInt } } });
    const result = sql.resolveColumnSqlType({ tableName: 'dbo.Users', columnName: 'Age', value: 42 });
    assert.equal(result, mssql.TinyInt);
});

// ---------------------------------------------------------------------------
// discoverColumnTypes
// ---------------------------------------------------------------------------

test('discoverColumnTypes: maps length-bearing types with their discovered length', async () => {
    const sql = makeSql();
    mockDiscovery(sql, [
        makeInformationSchemaRow({ columnName: 'Name', dataType: 'varchar', maxLength: 100 }),
        makeInformationSchemaRow({ columnName: 'Notes', dataType: 'nvarchar', maxLength: -1 })
    ]);
    const columns = await sql.discoverColumnTypes('dbo.Users');
    assert.deepEqual(columns.Name, mssql.VarChar(100));
    assert.deepEqual(columns.Notes, mssql.NVarChar(mssql.MAX));
});

test('discoverColumnTypes: maps DECIMAL/NUMERIC using discovered precision/scale', async () => {
    const sql = makeSql();
    mockDiscovery(sql, [
        makeInformationSchemaRow({ columnName: 'Price', dataType: 'decimal', precision: 9, scale: 2 })
    ]);
    const columns = await sql.discoverColumnTypes('dbo.Products');
    assert.deepEqual(columns.Price, mssql.Decimal(9, 2));
});

test('discoverColumnTypes: maps plain (non length/precision) types to the bare constructor', async () => {
    const sql = makeSql();
    mockDiscovery(sql, [
        makeInformationSchemaRow({ columnName: 'Age', dataType: 'int' }),
        makeInformationSchemaRow({ columnName: 'IsActive', dataType: 'bit' })
    ]);
    const columns = await sql.discoverColumnTypes('dbo.Users');
    assert.equal(columns.Age, mssql.Int);
    assert.equal(columns.IsActive, mssql.Bit);
});

test('discoverColumnTypes: skips columns whose DATA_TYPE has no known mssql mapping', async () => {
    const sql = makeSql();
    mockDiscovery(sql, [
        makeInformationSchemaRow({ columnName: 'Geo', dataType: 'geography' }),
        makeInformationSchemaRow({ columnName: 'Age', dataType: 'int' })
    ]);
    const columns = await sql.discoverColumnTypes('dbo.Users');
    assert.equal(columns.Geo, undefined);
    assert.equal(columns.Age, mssql.Int);
});

test('discoverColumnTypes: caches the result and does not re-query on a second call', async () => {
    const sql = makeSql();
    let queryCount = 0;
    sql.createRequest = () => ({
        input: () => {},
        query: async () => {
            queryCount++;
            return { recordset: [makeInformationSchemaRow({ columnName: 'Age', dataType: 'int' })] };
        }
    });
    const first = await sql.discoverColumnTypes('dbo.Users');
    const second = await sql.discoverColumnTypes('dbo.Users');
    assert.equal(queryCount, 1);
    assert.equal(first, second);
});

test('discoverColumnTypes: normalizes table name variants to the same cache entry', async () => {
    const sql = makeSql();
    let queryCount = 0;
    sql.createRequest = () => ({
        input: () => {},
        query: async () => {
            queryCount++;
            return { recordset: [makeInformationSchemaRow({ columnName: 'Age', dataType: 'int' })] };
        }
    });
    await sql.discoverColumnTypes('dbo.Users');
    await sql.discoverColumnTypes('[dbo].[Users]');
    await sql.discoverColumnTypes('Users');
    assert.equal(queryCount, 1);
});

test('resolveColumnSqlType: uses the schema warmed by a prior discoverColumnTypes call', async () => {
    const sql = makeSql({ schemaDrivenTypes: true });
    mockDiscovery(sql, [
        makeInformationSchemaRow({ columnName: 'Age', dataType: 'tinyint' })
    ]);
    await sql.discoverColumnTypes('dbo.Users');
    const result = sql.resolveColumnSqlType({ tableName: 'dbo.Users', columnName: 'Age', value: 42 });
    assert.equal(result, mssql.TinyInt);
});

// ---------------------------------------------------------------------------
// clearSchemaCache
// ---------------------------------------------------------------------------

test('clearSchemaCache: with a tableName only clears that table\'s cache entry', () => {
    const sql = makeSql();
    sql._schemaCache.set('dbo.Users', { Age: mssql.Int });
    sql._schemaCache.set('dbo.Orders', { Total: mssql.Decimal(9, 2) });
    sql.clearSchemaCache('dbo.Users');
    assert.equal(sql._schemaCache.has('dbo.Users'), false);
    assert.equal(sql._schemaCache.has('dbo.Orders'), true);
});

test('clearSchemaCache: normalizes the table name before clearing', () => {
    const sql = makeSql();
    sql._schemaCache.set('dbo.Users', { Age: mssql.Int });
    sql.clearSchemaCache('[dbo].[Users]');
    assert.equal(sql._schemaCache.has('dbo.Users'), false);
});

test('clearSchemaCache: with no tableName clears the entire cache', () => {
    const sql = makeSql();
    sql._schemaCache.set('dbo.Users', { Age: mssql.Int });
    sql._schemaCache.set('dbo.Orders', { Total: mssql.Decimal(9, 2) });
    sql.clearSchemaCache();
    assert.equal(sql._schemaCache.size, 0);
});

test('clearSchemaCache: forces the next discoverColumnTypes call to re-query', async () => {
    const sql = makeSql();
    let queryCount = 0;
    sql.createRequest = () => ({
        input: () => {},
        query: async () => {
            queryCount++;
            return { recordset: [makeInformationSchemaRow({ columnName: 'Age', dataType: 'int' })] };
        }
    });
    await sql.discoverColumnTypes('dbo.Users');
    sql.clearSchemaCache('dbo.Users');
    await sql.discoverColumnTypes('dbo.Users');
    assert.equal(queryCount, 2);
});

// ---------------------------------------------------------------------------
// addParameters: schema-driven resolution end-to-end
// ---------------------------------------------------------------------------

test('addParameters: static schemaTypes override is used instead of value-based inference', () => {
    const sql = makeSql({ schemaTypes: { 'dbo.Users': { Age: { sqlType: mssql.TinyInt } } } });
    const request = createMockRequest();
    sql.addParameters({
        query: 'UPDATE dbo.Users SET Age = @Age',
        request,
        tableName: 'dbo.Users',
        parameters: { Age: 42 }
    });
    assert.equal(request.parameters.Age.type, mssql.TinyInt);
});

test('addParameters: override is matched via fieldName, not the bind parameter key', () => {
    const sql = makeSql({ schemaTypes: { 'dbo.Users': { Age: { sqlType: mssql.TinyInt } } } });
    const request = createMockRequest();
    sql.addParameters({
        query: 'UPDATE dbo.Users SET Age = @userAge',
        request,
        tableName: 'dbo.Users',
        parameters: { userAge: { fieldName: 'Age', value: 42 } }
    });
    assert.equal(request.parameters.userAge.type, mssql.TinyInt);
});

test('addParameters: explicit sqlType on the parameter wins over any schema-driven resolution', () => {
    const sql = makeSql({ schemaTypes: { 'dbo.Users': { Age: { sqlType: mssql.TinyInt } } } });
    const request = createMockRequest();
    sql.addParameters({
        query: 'UPDATE dbo.Users SET Age = @Age',
        request,
        tableName: 'dbo.Users',
        parameters: { Age: { value: 42, sqlType: mssql.BigInt } }
    });
    assert.equal(request.parameters.Age.type, mssql.BigInt);
});

test('addParameters: without tableName, falls back to plain value-based inference', () => {
    const sql = makeSql({ schemaTypes: { 'dbo.Users': { Age: { sqlType: mssql.TinyInt } } } });
    const request = createMockRequest();
    sql.addParameters({
        query: 'UPDATE dbo.Users SET Age = @Age',
        request,
        parameters: { Age: 42 }
    });
    assert.equal(request.parameters.Age.type, mssql.Int);
});

test('addParameters: schemaDrivenTypes reads the warm cache without awaiting a DB round trip', async () => {
    const sql = makeSql({ schemaDrivenTypes: true });
    mockDiscovery(sql, [
        makeInformationSchemaRow({ columnName: 'Age', dataType: 'tinyint' })
    ]);
    await sql.discoverColumnTypes('dbo.Users');
    const request = createMockRequest();
    sql.addParameters({
        query: 'UPDATE dbo.Users SET Age = @Age',
        request,
        tableName: 'dbo.Users',
        parameters: { Age: 42 }
    });
    assert.equal(request.parameters.Age.type, mssql.TinyInt);
});
