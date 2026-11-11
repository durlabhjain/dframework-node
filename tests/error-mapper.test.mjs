/**
 * Tests for ErrorMapper.map(): a mapping entry that interpolates a captured group only has safe
 * output for the names it has labels for, so an unrecognized index or constraint name must fall
 * back to a generic message rather than reaching the caller.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ErrorMapper, sqlErrorMapper, mapDatabaseError, getDuplicateKeyObject } from '../lib/business/error-mapper.mjs';
import BusinessBase from '../lib/business/business-base.mjs';

const GENERIC = 'A record with the same value already exists.';
const DB_OBJECT_NAME = /\b(?:IX|UQ|PK)_\w+/;

const entries = [
    {
        title: 'named unique indexes',
        pattern: "Cannot insert duplicate key row in object .+ unique index '([^']+)'",
        description: '${1} already exists. Please use a different name.',
        mappings: { IX_UserGroup_GroupName_ClientId: 'Group Name' }
    },
    {
        title: 'unique / primary key constraints',
        pattern: "Violation of (?:UNIQUE KEY|PRIMARY KEY) constraint '([^']+)'",
        description: 'That value is already taken.',
        mappings: {}
    }
];

let directory;
let file;

const duplicateKeyError = (index) =>
    `Cannot insert duplicate key row in object 'dbo.UserGroup' with unique index '${index}'. The duplicate key value is (Test Group, 12).`;

before(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dframework-error-mapper-'));
    file = path.join(directory, 'sql-error-mappings.json');
    fs.writeFileSync(file, JSON.stringify(entries));
});

after(() => {
    fs.rmSync(directory, { recursive: true, force: true });
});

test('interpolates the friendly label for a mapped index name', () => {
    const mapper = new ErrorMapper({ file });
    assert.equal(
        mapper.map(duplicateKeyError('IX_UserGroup_GroupName_ClientId')),
        'Group Name already exists. Please use a different name.'
    );
});

test('falls back to the generic message for an unmapped index name', () => {
    const mapper = new ErrorMapper({ file });
    assert.equal(mapper.map(duplicateKeyError('IX_Some_Unmapped_Index')), GENERIC);
});

test('never emits a database object name for an unmapped duplicate key', () => {
    const mapper = new ErrorMapper({ file });
    const errors = [
        duplicateKeyError('IX_Some_Unmapped_Index'),
        "Violation of UNIQUE KEY constraint 'UQ_Unmapped'. Cannot insert duplicate key in object 'dbo.A'.",
        "Violation of PRIMARY KEY constraint 'PK_Unmapped'. Cannot insert duplicate key in object 'dbo.A'."
    ];
    for (const error of errors) {
        const mapped = mapper.map(error);
        assert.ok(!DB_OBJECT_NAME.test(mapped), `leaked a database object name: ${mapped}`);
    }
});

test('keeps a constant description as written instead of substituting the generic message', () => {
    const mapper = new ErrorMapper({ file });
    assert.equal(
        mapper.map("Violation of UNIQUE KEY constraint 'UQ_Anything'. Cannot insert duplicate key in object 'dbo.A'."),
        'That value is already taken.'
    );
});

test('scrubs a message that already carries a database object name', () => {
    const mapper = new ErrorMapper({ file });
    assert.equal(mapper.map('IX_Foo_Bar already exists. Please use a different name.'), GENERIC);
});

test('honours a caller-supplied generic message', () => {
    const mapper = new ErrorMapper({ file, genericMessage: 'Duplicate value.' });
    assert.equal(mapper.map(duplicateKeyError('IX_Some_Unmapped_Index')), 'Duplicate value.');
});

test('leaves an unrelated message unchanged', () => {
    const mapper = new ErrorMapper({ file });
    assert.equal(mapper.map('Something else failed'), 'Something else failed');
});

test('returns a non-string input unchanged without reading the mappings', () => {
    const mapper = new ErrorMapper({ file: path.join(directory, 'missing.json') });
    const error = new Error('boom');
    assert.equal(mapper.map(error), error);
    assert.equal(mapper.map(undefined), undefined);
    assert.equal(mapper.map(null), null);
});

test('constructs without arguments', () => {
    assert.doesNotThrow(() => new ErrorMapper());
});

// --- per-business-object messages -------------------------------------------------------------

const UNIQUE_KEY_ERROR = (name) =>
    `Violation of UNIQUE KEY constraint '${name}'. Cannot insert duplicate key in object 'dbo.A'.`;

test('extracts the index name from a duplicate key row error', () => {
    assert.equal(getDuplicateKeyObject(duplicateKeyError('IX_A_B')), 'IX_A_B');
});

test('extracts the constraint name from a unique and a primary key violation', () => {
    assert.equal(getDuplicateKeyObject(UNIQUE_KEY_ERROR('UQ_A')), 'UQ_A');
    assert.equal(
        getDuplicateKeyObject("Violation of PRIMARY KEY constraint 'PK_A'. Cannot insert duplicate key in object 'dbo.A'."),
        'PK_A'
    );
});

test('returns null for a message that names no duplicate key object', () => {
    assert.equal(getDuplicateKeyObject('Something else failed'), null);
    assert.equal(getDuplicateKeyObject(undefined), null);
});

test('uses a configured label with the default duplicate template', () => {
    const duplicateKeyMessages = { IX_UserGroup_GroupName_ClientId: 'Group Name' };
    assert.equal(
        mapDatabaseError(duplicateKeyError('IX_UserGroup_GroupName_ClientId'), { duplicateKeyMessages }),
        'Group Name already exists. Please use a different name.'
    );
});

test('uses a configured full message verbatim', () => {
    const duplicateKeyMessages = { UQ_Translation_Key_Locale: { message: 'This translation key already exists for the selected language.' } };
    assert.equal(
        mapDatabaseError(UNIQUE_KEY_ERROR('UQ_Translation_Key_Locale'), { duplicateKeyMessages }),
        'This translation key already exists for the selected language.'
    );
});

test('falls back to the generic message when nothing is configured and no mappings file exists', () => {
    const mapped = mapDatabaseError(duplicateKeyError('IX_Not_Configured'), { duplicateKeyMessages: {} });
    assert.equal(mapped, GENERIC);
    assert.ok(!DB_OBJECT_NAME.test(mapped));
});

test('leaves an unrelated message unchanged with no configuration', () => {
    assert.equal(mapDatabaseError('Something else failed'), 'Something else failed');
    const error = new Error('boom');
    assert.equal(mapDatabaseError(error), error);
});

test('BusinessBase.mapDatabaseError reads duplicateKeyMessages off the instance', () => {
    class Widget extends BusinessBase {
        duplicateKeyMessages = { IX_Widget_Name_ClientId: 'Widget Name' };
    }
    const widget = new Widget();
    assert.equal(
        widget.mapDatabaseError(duplicateKeyError('IX_Widget_Name_ClientId')),
        'Widget Name already exists. Please use a different name.'
    );
    assert.equal(widget.mapDatabaseError(duplicateKeyError('IX_Widget_Other')), GENERIC);
});

test('a business object with no duplicateKeyMessages still never leaks a db object name', () => {
    const plain = new (class extends BusinessBase { })();
    assert.ok(!DB_OBJECT_NAME.test(plain.mapDatabaseError(duplicateKeyError('IX_Unknown'))));
});

// --- application registration -----------------------------------------------------------------

test('register() adds app-wide duplicate-key messages, checked after the caller and before mappings', () => {
    const mapper = new ErrorMapper({ file: false }).register({
        duplicateKeyMessages: { IX_Widget_Name_ClientId: 'Widget Name', UQ_Widget_Code: { message: 'Code is taken.' } }
    });
    assert.equal(mapper.map(duplicateKeyError('IX_Widget_Name_ClientId')), 'Widget Name already exists. Please use a different name.');
    assert.equal(mapper.map(UNIQUE_KEY_ERROR('UQ_Widget_Code')), 'Code is taken.');
    assert.equal(
        mapper.map(duplicateKeyError('IX_Widget_Name_ClientId'), { duplicateKeyMessages: { IX_Widget_Name_ClientId: 'Name' } }),
        'Name already exists. Please use a different name.',
        'a business object overrides the app-wide label'
    );
    assert.equal(mapper.map(duplicateKeyError('IX_Not_Registered')), GENERIC, 'unregistered duplicate keys are generic without any file');
});

test('register() adds regex mappings ahead of the file and a custom generic message', () => {
    const mapper = new ErrorMapper({ file }).register({
        mappings: [{ pattern: 'conflicted with the FOREIGN KEY constraint', description: 'The selected item no longer exists.' }],
        genericMessage: 'Already exists.'
    });
    assert.equal(mapper.map('The INSERT statement conflicted with the FOREIGN KEY constraint "FK_A_B".'), 'The selected item no longer exists.');
    assert.equal(mapper.map(duplicateKeyError('IX_UserGroup_GroupName_ClientId')), 'Group Name already exists. Please use a different name.', 'file mappings still apply');
    assert.equal(mapper.map(duplicateKeyError('IX_Unmapped')), 'Already exists.');
});

test('register() rejects a name that is not a database object name', () => {
    assert.throws(() => new ErrorMapper({ file: false }).register({ duplicateKeyMessages: { "IX_Bad'; DROP": 'x' } }), /Invalid duplicateKeyMessages key/);
});

test('the shared mapper accepts registrations used by mapDatabaseError and BusinessBase', () => {
    sqlErrorMapper.register({ duplicateKeyMessages: { IX_Registered_Globally: 'Global Name' } });
    assert.equal(mapDatabaseError(duplicateKeyError('IX_Registered_Globally')), 'Global Name already exists. Please use a different name.');
    const plain = new (class extends BusinessBase { })();
    assert.equal(plain.mapDatabaseError(duplicateKeyError('IX_Registered_Globally')), 'Global Name already exists. Please use a different name.');
});
