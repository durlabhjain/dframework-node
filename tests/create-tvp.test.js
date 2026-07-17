/**
 * Tests for createTVP's up-front value validation (isSupportedValue).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Sql from '../lib/sql.js';

function makeSql(overrides = {}) {
    const instance = new Sql();
    Object.assign(instance, overrides);
    return instance;
}

test('createTVP: accepts a batch of ordinary numbers', () => {
    const sql = makeSql();
    const tvp = sql.createTVP({ values: [{ Amount: 5 }, { Amount: 10 }] });
    assert.deepEqual(tvp.rows, [[5], [10]]);
});

test('createTVP: rejects NaN up front instead of silently binding it', () => {
    const sql = makeSql();
    assert.throws(
        () => sql.createTVP({ values: [{ Amount: NaN }, { Amount: 5 }] }),
        /Invalid type for Amount/
    );
});

test('createTVP: rejects Infinity up front instead of silently binding it', () => {
    const sql = makeSql();
    assert.throws(
        () => sql.createTVP({ values: [{ Amount: Infinity }, { Amount: 5 }] }),
        /Invalid type for Amount/
    );
});

test('createTVP: rejects -Infinity up front instead of silently binding it', () => {
    const sql = makeSql();
    assert.throws(
        () => sql.createTVP({ values: [{ Amount: -Infinity }, { Amount: 5 }] }),
        /Invalid type for Amount/
    );
});

test('createTVP: still rejects genuinely unsupported types (e.g. plain objects)', () => {
    const sql = makeSql();
    assert.throws(
        () => sql.createTVP({ values: [{ Amount: { nested: 1 } }, { Amount: 5 }] }),
        /Invalid type for Amount: object/
    );
});
