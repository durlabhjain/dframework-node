import { test } from 'node:test';
import assert from 'node:assert/strict';
import Sql, { createQueryLogger, formatSqlQueryForLog, mssql } from '../lib/sql.js';

const buildParameters = () => {
    const request = new mssql.Request();
    request.input('Id', mssql.Int, 5);
    request.input('Name', mssql.VarChar(20), "O'Brien");
    request.input('CreatedOn', mssql.DateTime2, new Date('2025-01-02T03:04:05.678Z'));
    request.input('IsActive', mssql.Bit, true);
    request.input('OptionalValue', mssql.Int, null);
    return request.parameters;
};

test('formatSqlQueryForLog prints DECLARE statements and readable SQL', () => {
    const query = 'SELECT *\nFROM Users\tWHERE Id = @Id';
    const formattedQuery = formatSqlQueryForLog({ query, parameters: buildParameters() });

    assert.match(formattedQuery, /DECLARE @Id INT = 5/);
    assert.match(formattedQuery, /DECLARE @Name VARCHAR\(20\) = 'O''Brien'/);
    assert.match(formattedQuery, /DECLARE @CreatedOn DATETIME2 = '2025-01-02 03:04:05\.678'/);
    assert.match(formattedQuery, /DECLARE @IsActive BIT = 1/);
    assert.match(formattedQuery, /DECLARE @OptionalValue INT = NULL/);
    assert.ok(formattedQuery.endsWith(query));
});

test('createQueryLogger logs formatted multiline SQL when threshold is exceeded', async () => {
    const calls = [];
    const logger = {
        warn: (...args) => calls.push(args)
    };
    const queryLogger = createQueryLogger({ queryLogThreshold: 5, timeoutLogLevel: 'warn', logger });
    const query = 'SELECT *\nFROM Users\tWHERE Id = @Id';

    await queryLogger({
        query,
        start: 100,
        end: 200,
        parameters: buildParameters()
    });

    assert.strictEqual(calls.length, 1);
    assert.match(calls[0][0], /SQL query duration 100ms/);
    assert.match(calls[0][0], /DECLARE @Id INT = 5/);
    assert.ok(calls[0][0].includes('\nFROM Users\tWHERE Id = @Id'));
});

test('slow-query and error log sites use formatted SQL output', async () => {
    const warnCalls = [];
    const errorCalls = [];
    const mockLogger = {
        warn: (...args) => warnCalls.push(args),
        error: (...args) => errorCalls.push(args)
    };
    const sql = new Sql();
    const query = 'SELECT *\nFROM Users\tWHERE Id = @Id';
    const parameters = buildParameters();

    const originalDateNow = Date.now;
    Date.now = () => 1000;
    try {
        sql.logSlowQuery({
            startTime: 100,
            query,
            type: 'query',
            request: { _logger: mockLogger, parameters }
        });
    } finally {
        Date.now = originalDateNow;
    }

    assert.strictEqual(warnCalls.length, 1);
    assert.match(warnCalls[0][0], /Query execution exceeded 500 milliseconds/);
    assert.match(warnCalls[0][0], /DECLARE @Id INT = 5/);
    assert.ok(warnCalls[0][0].includes('\nFROM Users\tWHERE Id = @Id'));

    const expectedError = new Error('forced failure');
    const result = await sql.runQuery({
        request: {
            _logger: mockLogger,
            parameters,
            query: async () => {
                throw expectedError;
            }
        },
        type: 'query',
        query
    });

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.err, expectedError);
    assert.strictEqual(errorCalls.length, 1);
    assert.strictEqual(errorCalls[0][0].err, expectedError);
    assert.strictEqual(errorCalls[0][0].type, 'query');
    assert.match(errorCalls[0][1], /SQL query failed/);
    assert.match(errorCalls[0][1], /DECLARE @Id INT = 5/);
    assert.ok(errorCalls[0][1].includes('\nFROM Users\tWHERE Id = @Id'));
});
