/**
 * Tests the single-log contract for failed queries: the adapter logs the failure with its query
 * context and marks the error, so an application-level error handler can skip logging the same
 * failure a second time. The marker must stay invisible to serialization so it is never ingested
 * as a log field.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Sql, { mssql } from '../lib/sql.js';
import Mysql from '../lib/mysql.js';
import { markErrorLogged, isErrorLogged } from '../lib/logging.mjs';

/** Adapter instance without a connection: only the failure path is exercised. */
const adapter = (Type, logger) => {
    const instance = Object.create(Type.prototype);
    instance.logger = logger;
    return instance;
};

const recordingLogger = () => {
    const calls = [];
    return { calls, error: (payload, message) => calls.push({ payload, message }), warn: () => { } };
};

const failingRequest = (logger, message) => ({
    parameters: {}, params: {}, _logger: logger,
    query: async () => { throw new Error(message); }
});

/** Runs a failing query on an MSSQL-shaped request (no `params`) and returns its one log call. */
const failWith = async (logger, parameters) => {
    const request = { parameters, _logger: logger, query: async () => { throw new Error('boom'); } };
    await adapter(Sql, logger).runQuery({ request, type: 'query', query: 'SELECT ClientID FROM dbo.Client' });
    assert.equal(logger.calls.length, 1);
    return logger.calls[0];
};

for (const [dialect, Type] of [['MSSQL', Sql], ['MySQL', Mysql]]) {
    test(`a failed ${dialect} query is logged once and the error is marked`, async () => {
        const logger = recordingLogger();
        const { success, err } = await adapter(Type, logger).runQuery({
            request: failingRequest(logger, "Invalid column name 'ClientID'."),
            type: 'query', query: 'SELECT ClientID FROM dbo.Client'
        });
        assert.equal(success, false);
        assert.equal(logger.calls.length, 1);
        assert.equal(logger.calls[0].payload.query, 'SELECT ClientID FROM dbo.Client');
        assert.ok(isErrorLogged(err), 'the returned error should be marked as already logged');
    });
}

test('omits formattedQuery when it would repeat the query', async () => {
    const logger = recordingLogger();
    const { payload } = await failWith(logger, {});
    assert.equal(payload.query, 'SELECT ClientID FROM dbo.Client');
    assert.ok(!('formattedQuery' in payload), 'an unparameterised query needs no formatted copy');
});

test('keeps formattedQuery when it adds the parameter declarations', async () => {
    const logger = recordingLogger();
    const { payload } = await failWith(logger, { ClientId: { value: 5, type: mssql.Int } });
    assert.notEqual(payload.formattedQuery, payload.query);
    assert.match(payload.formattedQuery, /DECLARE @ClientId INT = 5/);
});

test('an error nobody logged is not marked', () => {
    assert.equal(isErrorLogged(new Error('never logged')), false);
    assert.equal(isErrorLogged(undefined), false);
    assert.equal(isErrorLogged('a string'), false);
});

test('the marker returns the error and stays out of serialization', () => {
    const error = new Error('boom');
    assert.equal(markErrorLogged(error), error);
    assert.ok(isErrorLogged(error));
    // Spread copies own enumerable symbols, so this covers the marker too.
    assert.equal(JSON.stringify({ ...error }), '{}');
});
