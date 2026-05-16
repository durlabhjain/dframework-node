/**
 * Tests for configurable case-insensitive WHERE clause handling and shadow columns.
 *
 * Covers:
 *  - caseInsensitiveMode: 'upper' (default) — existing UPPER() behaviour
 *  - caseInsensitiveMode: 'ilike'            — ILIKE operator for Starrocks / PostgreSQL
 *  - caseInsensitiveMode: custom function    — full custom control per dialect
 *  - shadowColumns                           — ORDER BY shadow column substitution
 *  - setConfig picks up the new options
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Sql from '../lib/sql.js';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

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

function makeSql(overrides = {}) {
    const instance = new Sql();
    Object.assign(instance, overrides);
    return instance;
}

// ---------------------------------------------------------------------------
// applyCaseInsensitive — 'upper' mode (default)
// ---------------------------------------------------------------------------

test("applyCaseInsensitive 'upper': uppercases string value and wraps field in UPPER()", () => {
    const sql = makeSql({ caseInsensitiveMode: 'upper', dataTypes: new Sql().dataTypes });
    const result = sql.applyCaseInsensitive({ fieldName: 'UserName', value: 'john', operator: '=' });
    assert.equal(result.fieldName, 'UPPER(UserName)');
    assert.equal(result.value, 'JOHN');
    assert.equal(result.operator, '=');
});

test("applyCaseInsensitive 'upper': uppercases array elements that are strings", () => {
    const sql = makeSql({ caseInsensitiveMode: 'upper', dataTypes: new Sql().dataTypes });
    const result = sql.applyCaseInsensitive({ fieldName: 'Tag', value: ['alpha', 'beta', 42], operator: 'IN' });
    assert.equal(result.fieldName, 'UPPER(Tag)');
    assert.deepEqual(result.value, ['ALPHA', 'BETA', 42]);
    assert.equal(result.operator, 'IN');
});

test("applyCaseInsensitive 'upper': non-string non-array value keeps original", () => {
    const sql = makeSql({ caseInsensitiveMode: 'upper', dataTypes: new Sql().dataTypes });
    const result = sql.applyCaseInsensitive({ fieldName: 'Count', value: 5, operator: '>' });
    assert.equal(result.fieldName, 'Count');
    assert.equal(result.value, 5);
    assert.equal(result.operator, '>');
});

// ---------------------------------------------------------------------------
// applyCaseInsensitive — 'ilike' mode
// ---------------------------------------------------------------------------

test("applyCaseInsensitive 'ilike': '=' operator becomes 'ILIKE'", () => {
    const sql = makeSql({ caseInsensitiveMode: 'ilike', dataTypes: new Sql().dataTypes });
    const result = sql.applyCaseInsensitive({ fieldName: 'UserName', value: 'john', operator: '=' });
    assert.equal(result.fieldName, 'UserName');
    assert.equal(result.value, 'john');
    assert.equal(result.operator, 'ILIKE');
});

test("applyCaseInsensitive 'ilike': 'LIKE' operator becomes 'ILIKE'", () => {
    const sql = makeSql({ caseInsensitiveMode: 'ilike', dataTypes: new Sql().dataTypes });
    const result = sql.applyCaseInsensitive({ fieldName: 'UserName', value: '%jo%', operator: 'LIKE' });
    assert.equal(result.operator, 'ILIKE');
    assert.equal(result.value, '%jo%');
    assert.equal(result.fieldName, 'UserName');
});

test("applyCaseInsensitive 'ilike': 'NOT LIKE' operator becomes 'NOT ILIKE'", () => {
    const sql = makeSql({ caseInsensitiveMode: 'ilike', dataTypes: new Sql().dataTypes });
    const result = sql.applyCaseInsensitive({ fieldName: 'UserName', value: '%jo%', operator: 'NOT LIKE' });
    assert.equal(result.operator, 'NOT ILIKE');
});

test("applyCaseInsensitive 'ilike': '!=' operator becomes 'NOT ILIKE'", () => {
    const sql = makeSql({ caseInsensitiveMode: 'ilike', dataTypes: new Sql().dataTypes });
    const result = sql.applyCaseInsensitive({ fieldName: 'UserName', value: 'john', operator: '!=' });
    assert.equal(result.operator, 'NOT ILIKE');
});

test("applyCaseInsensitive 'ilike': unrecognised operator is left unchanged", () => {
    const sql = makeSql({ caseInsensitiveMode: 'ilike', dataTypes: new Sql().dataTypes });
    const result = sql.applyCaseInsensitive({ fieldName: 'Count', value: 5, operator: '>' });
    assert.equal(result.operator, '>');
    assert.equal(result.fieldName, 'Count');
    assert.equal(result.value, 5);
});

// ---------------------------------------------------------------------------
// applyCaseInsensitive — custom function mode
// ---------------------------------------------------------------------------

test("applyCaseInsensitive custom function: called with correct args and return used", () => {
    let calledWith = null;
    const customFn = (params) => {
        calledWith = params;
        return { fieldName: `LOWER(${params.fieldName})`, value: params.value.toLowerCase(), operator: params.operator };
    };
    const sql = makeSql({ caseInsensitiveMode: customFn, dataTypes: new Sql().dataTypes });
    const result = sql.applyCaseInsensitive({ fieldName: 'UserName', value: 'JOHN', operator: '=' });
    assert.ok(calledWith);
    assert.equal(calledWith.fieldName, 'UserName');
    assert.equal(result.fieldName, 'LOWER(UserName)');
    assert.equal(result.value, 'john');
});

// ---------------------------------------------------------------------------
// addParameters uses caseInsensitiveMode via applyCaseInsensitive
// ---------------------------------------------------------------------------

test("addParameters with ILIKE mode: builds ILIKE condition instead of UPPER()", () => {
    const sql = makeSql({ forceCaseInsensitive: true, caseInsensitiveMode: 'ilike' });
    const request = createMockRequest();
    const query = sql.addParameters({
        query: 'SELECT 1',
        request,
        parameters: { UserName: { value: 'john' } },
        forWhere: true
    });
    assert.ok(query.includes('ILIKE'), `Expected ILIKE in: ${query}`);
    assert.ok(!query.includes('UPPER('), `Should not contain UPPER(): ${query}`);
    assert.equal(request.parameters['UserName'].value, 'john'); // value NOT uppercased
});

test("addParameters with ILIKE mode: LIKE becomes ILIKE for contains-style filter", () => {
    const sql = makeSql({ forceCaseInsensitive: true, caseInsensitiveMode: 'ilike' });
    const request = createMockRequest();
    const query = sql.addParameters({
        query: 'SELECT 1',
        request,
        parameters: { UserName: { operator: 'LIKE', value: '%jo%' } },
        forWhere: true
    });
    assert.ok(query.includes('ILIKE'), `Expected ILIKE in: ${query}`);
    assert.equal(request.parameters['UserName'].value, '%jo%');
});

test("addParameters with UPPER mode: wraps field in UPPER() (existing behaviour)", () => {
    const sql = makeSql({ forceCaseInsensitive: true, caseInsensitiveMode: 'upper' });
    const request = createMockRequest();
    const query = sql.addParameters({
        query: 'SELECT 1',
        request,
        parameters: { UserName: { value: 'john' } },
        forWhere: true
    });
    assert.ok(query.includes('UPPER(UserName)'), `Expected UPPER(UserName) in: ${query}`);
    assert.equal(request.parameters['UserName'].value, 'JOHN');
});

test("addParameters with custom function: custom transformation is applied", () => {
    const customFn = ({ fieldName, value, operator }) => ({
        fieldName: `LOWER(${fieldName})`,
        value: typeof value === 'string' ? value.toLowerCase() : value,
        operator
    });
    const sql = makeSql({ forceCaseInsensitive: true, caseInsensitiveMode: customFn });
    const request = createMockRequest();
    const query = sql.addParameters({
        query: 'SELECT 1',
        request,
        parameters: { UserName: { value: 'JOHN' } },
        forWhere: true
    });
    assert.ok(query.includes('LOWER(UserName)'), `Expected LOWER(UserName) in: ${query}`);
    assert.equal(request.parameters['UserName'].value, 'john');
});

test("addParameters with ILIKE mode: date fields are not transformed", () => {
    const sql = makeSql({ forceCaseInsensitive: true, caseInsensitiveMode: 'ilike' });
    const request = createMockRequest();
    const query = sql.addParameters({
        query: 'SELECT 1',
        request,
        parameters: { CreatedOn: { value: '2024-01-15', type: 'date' } },
        forWhere: true
    });
    assert.ok(!query.includes('ILIKE'), `Date field should not use ILIKE: ${query}`);
    assert.ok(!query.includes('UPPER('), `Date field should not use UPPER(): ${query}`);
});

// ---------------------------------------------------------------------------
// setConfig picks up caseInsensitiveMode and shadowColumns
// ---------------------------------------------------------------------------

test("setConfig sets caseInsensitiveMode", async () => {
    const sql = new Sql();
    // Mock createPoolConnection so we don't need a real DB
    sql.createPoolConnection = async () => null;
    await sql.setConfig({ caseInsensitiveMode: 'ilike' });
    assert.equal(sql.caseInsensitiveMode, 'ilike');
});

test("setConfig sets shadowColumns", async () => {
    const sql = new Sql();
    sql.createPoolConnection = async () => null;
    const shadows = { FullName: 'FullName_Shadow' };
    await sql.setConfig({ shadowColumns: shadows });
    assert.deepEqual(sql.shadowColumns, shadows);
});

test("setConfig does not override caseInsensitiveMode when not provided", async () => {
    const sql = new Sql();
    sql.caseInsensitiveMode = 'ilike'; // set beforehand
    sql.createPoolConnection = async () => null;
    await sql.setConfig({}); // no caseInsensitiveMode key
    assert.equal(sql.caseInsensitiveMode, 'ilike');
});

// ---------------------------------------------------------------------------
// applyShadowColumns
// ---------------------------------------------------------------------------

test("applyShadowColumns: replaces field with shadow column", () => {
    const sql = makeSql({ shadowColumns: { FullName: 'FullName_Shadow' } });
    const result = sql.applyShadowColumns('FullName ASC');
    assert.equal(result, 'FullName_Shadow ASC');
});

test("applyShadowColumns: replaces only the matching field in a multi-field sort", () => {
    const sql = makeSql({ shadowColumns: { FullName: 'FullName_Shadow' } });
    const result = sql.applyShadowColumns('FullName ASC, CreatedOn DESC');
    assert.equal(result, 'FullName_Shadow ASC, CreatedOn DESC');
});

test("applyShadowColumns: leaves non-mapped fields unchanged", () => {
    const sql = makeSql({ shadowColumns: { FullName: 'FullName_Shadow' } });
    const result = sql.applyShadowColumns('CreatedOn DESC');
    assert.equal(result, 'CreatedOn DESC');
});

test("applyShadowColumns: returns original clause when shadowColumns is null", () => {
    const sql = makeSql({ shadowColumns: null });
    const result = sql.applyShadowColumns('FullName ASC');
    assert.equal(result, 'FullName ASC');
});

test("applyShadowColumns: returns original clause when sortClause is empty", () => {
    const sql = makeSql({ shadowColumns: { FullName: 'FullName_Shadow' } });
    assert.equal(sql.applyShadowColumns(''), '');
    assert.equal(sql.applyShadowColumns(null), null);
});

test("applyShadowColumns: handles sort without direction keyword", () => {
    const sql = makeSql({ shadowColumns: { FullName: 'FullName_Shadow' } });
    const result = sql.applyShadowColumns('FullName');
    assert.equal(result, 'FullName_Shadow');
});

test("applyShadowColumns: handles multiple shadow columns", () => {
    const sql = makeSql({ shadowColumns: { FullName: 'FullName_Shadow', Email: 'Email_Lower' } });
    const result = sql.applyShadowColumns('FullName ASC, Email DESC, CreatedOn ASC');
    assert.equal(result, 'FullName_Shadow ASC, Email_Lower DESC, CreatedOn ASC');
});

// ---------------------------------------------------------------------------
// applyCaseInsensitive — 'ilike-fn' mode (StarRocks function-call syntax)
// ---------------------------------------------------------------------------

test("applyCaseInsensitive 'ilike-fn': '=' operator returns statementTemplate with = 1", () => {
    const sql = makeSql({ caseInsensitiveMode: 'ilike-fn', dataTypes: new Sql().dataTypes });
    const result = sql.applyCaseInsensitive({ fieldName: 'Name', value: '%DOH%', operator: '=' });
    assert.equal(result.statementTemplate, 'ILIKE(Name, {param}) = 1');
    assert.equal(result.value, '%DOH%');
});

test("applyCaseInsensitive 'ilike-fn': 'LIKE' operator returns statementTemplate with = 1", () => {
    const sql = makeSql({ caseInsensitiveMode: 'ilike-fn', dataTypes: new Sql().dataTypes });
    const result = sql.applyCaseInsensitive({ fieldName: 'Name', value: '%DOH%', operator: 'LIKE' });
    assert.equal(result.statementTemplate, 'ILIKE(Name, {param}) = 1');
});

test("applyCaseInsensitive 'ilike-fn': '!=' operator returns statementTemplate with = 0", () => {
    const sql = makeSql({ caseInsensitiveMode: 'ilike-fn', dataTypes: new Sql().dataTypes });
    const result = sql.applyCaseInsensitive({ fieldName: 'Name', value: 'DOH', operator: '!=' });
    assert.equal(result.statementTemplate, 'ILIKE(Name, {param}) = 0');
});

test("applyCaseInsensitive 'ilike-fn': 'NOT LIKE' operator returns statementTemplate with = 0", () => {
    const sql = makeSql({ caseInsensitiveMode: 'ilike-fn', dataTypes: new Sql().dataTypes });
    const result = sql.applyCaseInsensitive({ fieldName: 'Name', value: '%DOH%', operator: 'NOT LIKE' });
    assert.equal(result.statementTemplate, 'ILIKE(Name, {param}) = 0');
});

test("applyCaseInsensitive 'ilike-fn': unrecognised operator falls through unchanged", () => {
    const sql = makeSql({ caseInsensitiveMode: 'ilike-fn', dataTypes: new Sql().dataTypes });
    const result = sql.applyCaseInsensitive({ fieldName: 'Age', value: 5, operator: '>' });
    assert.equal(result.fieldName, 'Age');
    assert.equal(result.operator, '>');
    assert.equal(result.value, 5);
    assert.ok(!result.statementTemplate);
});

// ---------------------------------------------------------------------------
// addParameters with 'ilike-fn' mode
// ---------------------------------------------------------------------------

test("addParameters with 'ilike-fn' mode: builds ILIKE(field, @param) = 1 for '=' operator", () => {
    const sql = makeSql({ forceCaseInsensitive: true, caseInsensitiveMode: 'ilike-fn' });
    const request = createMockRequest();
    const query = sql.addParameters({
        query: 'SELECT 1',
        request,
        parameters: { Name: { value: '%DOH%' } },
        forWhere: true
    });
    assert.ok(query.includes('ILIKE(Name, @Name) = 1'), `Expected ILIKE fn syntax in: ${query}`);
    assert.ok(!query.includes('UPPER('), `Should not contain UPPER(): ${query}`);
    assert.equal(request.parameters['Name'].value, '%DOH%');
});

test("addParameters with 'ilike-fn' mode: builds ILIKE(field, @param) = 0 for '!=' operator", () => {
    const sql = makeSql({ forceCaseInsensitive: true, caseInsensitiveMode: 'ilike-fn' });
    const request = createMockRequest();
    const query = sql.addParameters({
        query: 'SELECT 1',
        request,
        parameters: { Name: { operator: '!=', value: 'DOH' } },
        forWhere: true
    });
    assert.ok(query.includes('ILIKE(Name, @Name) = 0'), `Expected ILIKE fn negation in: ${query}`);
});

test("addParameters with 'ilike-fn' mode: LIKE becomes ILIKE fn for contains-style filter", () => {
    const sql = makeSql({ forceCaseInsensitive: true, caseInsensitiveMode: 'ilike-fn' });
    const request = createMockRequest();
    const query = sql.addParameters({
        query: 'SELECT 1',
        request,
        parameters: { Name: { operator: 'LIKE', value: '%DOH%' } },
        forWhere: true
    });
    assert.ok(query.includes('ILIKE(Name, @Name) = 1'), `Expected ILIKE fn syntax in: ${query}`);
});

test("addParameters with 'ilike-fn' mode: dotted param name uses last segment as @param", () => {
    const sql = makeSql({ forceCaseInsensitive: true, caseInsensitiveMode: 'ilike-fn' });
    const request = createMockRequest();
    const query = sql.addParameters({
        query: 'SELECT 1',
        request,
        parameters: { 'Location.Name': { value: '%DOH%' } },
        forWhere: true
    });
    assert.ok(query.includes('ILIKE(Location.Name, @Name) = 1'), `Expected ILIKE fn with dotted field in: ${query}`);
});

test("addParameters with 'ilike-fn' mode: date fields are not transformed", () => {
    const sql = makeSql({ forceCaseInsensitive: true, caseInsensitiveMode: 'ilike-fn' });
    const request = createMockRequest();
    const query = sql.addParameters({
        query: 'SELECT 1',
        request,
        parameters: { CreatedOn: { value: '2024-01-15', type: 'date' } },
        forWhere: true
    });
    assert.ok(!query.includes('ILIKE('), `Date field should not use ILIKE fn: ${query}`);
});

// ---------------------------------------------------------------------------
// applyOrderByCaseInsensitive
// ---------------------------------------------------------------------------

test("applyOrderByCaseInsensitive: returns field unchanged when caseInsensitiveOrderBy is false", () => {
    const sql = makeSql({ caseInsensitiveOrderBy: false });
    assert.equal(sql.applyOrderByCaseInsensitive('Name'), 'Name');
});

test("applyOrderByCaseInsensitive: wraps field with UPPER() when caseInsensitiveOrderBy is true", () => {
    const sql = makeSql({ caseInsensitiveOrderBy: true });
    assert.equal(sql.applyOrderByCaseInsensitive('Name'), 'UPPER(Name)');
});

test("applyOrderByCaseInsensitive: wraps field with UPPER() when caseInsensitiveOrderBy is 'upper'", () => {
    const sql = makeSql({ caseInsensitiveOrderBy: 'upper' });
    assert.equal(sql.applyOrderByCaseInsensitive('Name'), 'UPPER(Name)');
});

test("applyOrderByCaseInsensitive: custom function is called and its return value used", () => {
    const customFn = (field) => `LOWER(${field})`;
    const sql = makeSql({ caseInsensitiveOrderBy: customFn });
    assert.equal(sql.applyOrderByCaseInsensitive('Name'), 'LOWER(Name)');
});

// ---------------------------------------------------------------------------
// setConfig picks up caseInsensitiveOrderBy
// ---------------------------------------------------------------------------

test("setConfig sets caseInsensitiveOrderBy to true", async () => {
    const sql = new Sql();
    sql.createPoolConnection = async () => null;
    await sql.setConfig({ caseInsensitiveOrderBy: true });
    assert.equal(sql.caseInsensitiveOrderBy, true);
});

test("setConfig sets caseInsensitiveOrderBy to false explicitly", async () => {
    const sql = new Sql();
    sql.createPoolConnection = async () => null;
    sql.caseInsensitiveOrderBy = true; // set beforehand
    await sql.setConfig({ caseInsensitiveOrderBy: false });
    assert.equal(sql.caseInsensitiveOrderBy, false);
});

test("setConfig does not override caseInsensitiveOrderBy when not provided", async () => {
    const sql = new Sql();
    sql.caseInsensitiveOrderBy = true;
    sql.createPoolConnection = async () => null;
    await sql.setConfig({});
    assert.equal(sql.caseInsensitiveOrderBy, true);
});
