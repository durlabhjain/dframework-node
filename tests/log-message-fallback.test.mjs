/**
 * Tests the log title fallback: OTLP sends the pino message as the record body, so a caller that
 * logs only an object would ship an empty body. The hook derives a title from the error it carries
 * without changing calls that already pass a message.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveLogMessage, logMethod } from '../lib/logging.mjs';

/** Captures what the hook forwards to pino's underlying log method. */
const capture = () => {
    const calls = [];
    const method = function (...args) { calls.push(args); };
    return { calls, log: (...args) => logMethod.call({}, args, method) };
};

test('derives a title from an error message', () => {
    assert.equal(deriveLogMessage({ err: new Error('Invalid column name') }), 'Invalid column name');
    assert.equal(deriveLogMessage({ error: new Error('mapped error') }), 'mapped error');
});

test('derives a title from the first stack line when there is no message', () => {
    assert.equal(deriveLogMessage({ err: { stack: 'AlertDefinitionId: 42 has no schedule' } }),
        'AlertDefinitionId: 42 has no schedule');
    assert.equal(deriveLogMessage({ err: { stack: 'first line\n    at somewhere' } }), 'first line');
});

test('has nothing to derive without an error or message', () => {
    assert.equal(deriveLogMessage({ custom: 'value' }), '');
});

test('the hook supplies a message when a caller logs only an object', () => {
    const { calls, log } = capture();
    log({ err: { stack: 'AlertDefinitionId: 42 has no schedule' } });
    assert.equal(calls.length, 1);
    assert.equal(calls[0][1], 'AlertDefinitionId: 42 has no schedule');
});

test('the hook leaves an explicit message untouched', () => {
    const { calls, log } = capture();
    log({ err: new Error('inner') }, 'SQL query failed');
    assert.equal(calls[0][1], 'SQL query failed');
    log({ err: new Error('inner'), msg: 'already set' });
    assert.equal(calls[1].length, 1);
});

test('the hook leaves strings and Error arguments to pino', () => {
    const { calls, log } = capture();
    log('plain message');
    assert.deepEqual(calls[0], ['plain message']);
    const error = new Error('bare error');
    log(error);
    assert.deepEqual(calls[1], [error]);
});
