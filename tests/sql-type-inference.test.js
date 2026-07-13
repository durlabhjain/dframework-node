import { test } from 'node:test';
import assert from 'node:assert/strict';
import mssql from 'mssql';
import { isAsciiString, getDecimalSqlType, getStringSqlType, inferSqlType, inferBatchSqlType } from '../lib/sql-type-inference.js';

const typeOf = (sqlType) => (typeof sqlType === 'function' ? sqlType() : sqlType);

test('isAsciiString detects ASCII vs Unicode content', () => {
    assert.equal(isAsciiString('Hello World'), true);
    assert.equal(isAsciiString(''), true);
    assert.equal(isAsciiString('Café'), false);
    assert.equal(isAsciiString('你好'), false);
});

test('inferSqlType: booleans map to Bit', () => {
    assert.equal(inferSqlType(true), mssql.Bit);
    assert.equal(inferSqlType(false), mssql.Bit);
});

test('inferSqlType: Dates map to DateTime2', () => {
    assert.equal(inferSqlType(new Date()), mssql.DateTime2);
});

test('inferSqlType: null/undefined fall back to NVarChar', () => {
    assert.equal(inferSqlType(null), mssql.NVarChar);
    assert.equal(inferSqlType(undefined), mssql.NVarChar);
});

test('inferSqlType: whole numbers map to Int within Int32 range', () => {
    const sqlType = typeOf(inferSqlType(42));
    assert.equal(sqlType.type, mssql.Int);
});

test('inferSqlType: whole numbers outside Int32 range map to BigInt', () => {
    const sqlType = typeOf(inferSqlType(9999999999));
    assert.equal(sqlType.type, mssql.BigInt);
});

test('inferSqlType: never infers TinyInt/SmallInt for a lone scalar (avoids plan-cache fragmentation)', () => {
    for (const n of [1, 5, 200, 500]) {
        const sqlType = typeOf(inferSqlType(n));
        assert.equal(sqlType.type, mssql.Int, `expected Int for scalar ${n}, not a narrower type`);
    }
});

test('inferSqlType: fractional numbers map to Decimal, not Float', () => {
    const sqlType = inferSqlType(12.5);
    assert.equal(sqlType.type, mssql.Decimal);
    assert.ok(sqlType.precision >= 3);
    assert.ok(sqlType.scale >= 1);
});

test('inferSqlType: ASCII strings map to VarChar', () => {
    const sqlType = inferSqlType('hello');
    assert.equal(sqlType.type, mssql.VarChar);
    assert.ok(sqlType.length >= 5);
});

test('inferSqlType: non-ASCII strings map to NVarChar', () => {
    const sqlType = inferSqlType('Café');
    assert.equal(sqlType.type, mssql.NVarChar);
});

test('getStringSqlType buckets length instead of leaving it unbounded', () => {
    const short = getStringSqlType('hi');
    const long = getStringSqlType('x'.repeat(300));
    assert.ok(short.length <= 100);
    assert.ok(long.length >= 300 && long.length < mssql.MAX);
});

test('inferSqlType: Buffers map to VarBinary with a bucketed length', () => {
    const sqlType = inferSqlType(Buffer.from('hello world'));
    assert.equal(sqlType.type, mssql.VarBinary);
    assert.ok(sqlType.length >= 11);
});

test('getDecimalSqlType buckets precision/scale into fixed tiers', () => {
    const a = getDecimalSqlType(1.5);
    const b = getDecimalSqlType(3.25);
    // Different exact values landing in the same tier keep the same declared
    // type, which is what allows SQL Server to reuse one cached plan.
    assert.equal(a.scale, b.scale);
    assert.equal(a.precision, b.precision);
});

test('inferBatchSqlType: batch of small non-negative integers narrows to TinyInt', () => {
    const sqlType = inferBatchSqlType([1, 5, 10, 255]);
    assert.equal(sqlType, mssql.TinyInt);
});

test('inferBatchSqlType: batch with a negative value cannot use TinyInt, narrows to SmallInt', () => {
    const sqlType = inferBatchSqlType([-1, 5, 10]);
    assert.equal(sqlType, mssql.SmallInt);
});

test('inferBatchSqlType: batch with a large value widens to Int', () => {
    const sqlType = inferBatchSqlType([1, 2, 70000]);
    assert.equal(sqlType, mssql.Int);
});

test('inferBatchSqlType: scans every row, not just the first (fractional value later in the batch)', () => {
    const sqlType = typeOf(inferBatchSqlType([1, 2, 3.5]));
    assert.equal(sqlType.type, mssql.Decimal);
});

test('inferBatchSqlType: scans every row for strings (non-ASCII later in the batch)', () => {
    const sqlType = inferBatchSqlType(['Alpha', 'Beta', 'Café']);
    assert.equal(sqlType.type, mssql.NVarChar);
});

test('inferBatchSqlType: empty/all-null batch falls back to NVarChar', () => {
    assert.equal(inferBatchSqlType([]), mssql.NVarChar);
    assert.equal(inferBatchSqlType([null, undefined]), mssql.NVarChar);
});
