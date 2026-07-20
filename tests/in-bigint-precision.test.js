/**
 * Tests for Sql.prototype.in()'s handling of large integer strings.
 * Values beyond Number.MAX_SAFE_INTEGER (e.g. bigint IDs) must not be
 * silently rounded by a Number() conversion before binding.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import mssql from 'mssql';
import Sql from '../lib/sql.js';

function createMockRequest() {
    return {
        parameters: {},
        input(name, type, value) {
            this.parameters[name] = { type, value };
        }
    };
}

test('in(): BigInt sqlType binds a large numeric string without precision loss', () => {
    const sql = new Sql();
    const request = createMockRequest();
    const largeId = '9223372036854775807';
    sql.in({ request, fieldName: 'Id', paramName: 'Id', values: [largeId], sqlType: mssql.BigInt, strategy: 'in' });
    assert.equal(request.parameters.Id_0.value, 9223372036854775807n);
});

test('in(): BigInt sqlType still rejects a non-numeric string', () => {
    const sql = new Sql();
    const request = createMockRequest();
    assert.throws(
        () => sql.in({ request, fieldName: 'Id', paramName: 'Id', values: ['abc'], sqlType: mssql.BigInt, strategy: 'in' }),
        /Invalid value abc for Id/
    );
});

test('in(): Int sqlType rejects a non-numeric string (Number.isNaN check actually fires)', () => {
    const sql = new Sql();
    const request = createMockRequest();
    assert.throws(
        () => sql.in({ request, fieldName: 'Id', paramName: 'Id', values: ['abc'], sqlType: mssql.Int, strategy: 'in' }),
        /Invalid value abc for Id/
    );
});

test('in(): Int sqlType still binds ordinary numeric strings as numbers', () => {
    const sql = new Sql();
    const request = createMockRequest();
    sql.in({ request, fieldName: 'Id', paramName: 'Id', values: ['1', '2'], sqlType: mssql.Int, strategy: 'in' });
    assert.equal(request.parameters.Id_0.value, 1);
    assert.equal(request.parameters.Id_1.value, 2);
});

test('in(): ignoreZero skips both 0 and 0n', () => {
    const sql = new Sql();
    const request = createMockRequest();
    const result = sql.in({ request, fieldName: 'Id', paramName: 'Id', values: ['0', '5'], sqlType: mssql.BigInt, ignoreZero: true, strategy: 'in' });
    assert.equal(result.paramNames.length, 1);
    assert.equal(request.parameters.Id_1.value, 5n);
});

test('addParameters(): an IN array of large numeric-ID strings infers BigInt and binds without precision loss', () => {
    const sql = new Sql();
    const request = createMockRequest();
    const largeId = '9223372036854775807';
    sql.addParameters({
        query: 'SELECT 1 FROM T',
        request,
        parameters: { Id: { value: [largeId, '1'], operator: '=', useTvp: false, inOperatorStrategy: 'in' } },
        forWhere: true
    });
    assert.equal(request.parameters.Id_0.type, mssql.BigInt);
    assert.equal(request.parameters.Id_0.value, 9223372036854775807n);
});
