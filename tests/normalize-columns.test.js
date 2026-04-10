/**
 * Tests for normalizeColumns and compressed addParameters support
 */

import zlib from 'zlib';
import Sql from '../lib/sql.js';
import enums from '../lib/enums.mjs';

const { columnTypes } = enums;

// Create a mock request object
function createMockRequest() {
    return {
        parameters: {},
        input: function (name, typeOrValue, value) {
            if (arguments.length === 2) {
                this.parameters[name] = { value: typeOrValue };
            } else {
                this.parameters[name] = { type: typeOrValue, value: value };
            }
        }
    };
}

let passed = 0;
let failed = 0;

function test(name, condition, extra = '') {
    if (condition) {
        console.log(`✓ ${name}`);
        passed++;
    } else {
        console.log(`✗ ${name}${extra ? ': ' + extra : ''}`);
        failed++;
    }
}

// ─── normalizeColumns tests ────────────────────────────────────────────────

console.log('Testing normalizeColumns...\n');

// Test 1: normalizeColumns with gzip type
console.log('Test 1: normalizeColumns decompresses gzip column (Buffer)');
{
    const sql = new Sql();
    const original = 'hello world';
    const compressed = zlib.gzipSync(Buffer.from(original));
    const rows = [{ data: compressed, other: 'unchanged' }];
    sql.normalizeColumns(rows, { data: columnTypes.gzip });
    test('Gzip column decompressed to string', rows[0].data === original, JSON.stringify(rows[0].data));
    test('Other column unchanged', rows[0].other === 'unchanged');
}

// Test 2: normalizeColumns with gzipJson type
console.log('\nTest 2: normalizeColumns decompresses gzip column and parses JSON');
{
    const sql = new Sql();
    const original = { key: 'value', num: 42 };
    const compressed = zlib.gzipSync(Buffer.from(JSON.stringify(original)));
    const rows = [{ metadata: compressed }];
    sql.normalizeColumns(rows, { metadata: columnTypes.gzipJson });
    test('GzipJson column decompressed to object', typeof rows[0].metadata === 'object', String(rows[0].metadata));
    test('GzipJson object has correct key', rows[0].metadata.key === 'value');
    test('GzipJson object has correct num', rows[0].metadata.num === 42);
}

// Test 3: normalizeColumns with json type
console.log('\nTest 3: normalizeColumns parses json string column');
{
    const sql = new Sql();
    const original = { foo: 'bar' };
    const rows = [{ config: JSON.stringify(original) }];
    sql.normalizeColumns(rows, { config: columnTypes.json });
    test('JSON column parsed to object', typeof rows[0].config === 'object');
    test('JSON object has correct value', rows[0].config.foo === 'bar');
}

// Test 4: normalizeColumns skips null values
console.log('\nTest 4: normalizeColumns skips null/undefined column values');
{
    const sql = new Sql();
    const rows = [{ data: null, meta: undefined }];
    sql.normalizeColumns(rows, { data: columnTypes.gzip, meta: columnTypes.json });
    test('Null gzip column stays null', rows[0].data === null);
    test('Undefined json column stays undefined', rows[0].meta === undefined);
}

// Test 5: normalizeColumns handles multiple rows
console.log('\nTest 5: normalizeColumns processes multiple rows');
{
    const sql = new Sql();
    const rows = [
        { data: zlib.gzipSync(Buffer.from('row1')) },
        { data: zlib.gzipSync(Buffer.from('row2')) },
        { data: null }
    ];
    sql.normalizeColumns(rows, { data: columnTypes.gzip });
    test('Row 1 decompressed', rows[0].data === 'row1');
    test('Row 2 decompressed', rows[1].data === 'row2');
    test('Row 3 null stays null', rows[2].data === null);
}

// Test 6: normalizeColumns with no columns arg is a no-op
console.log('\nTest 6: normalizeColumns returns rows unchanged when columns is falsy');
{
    const sql = new Sql();
    const rows = [{ data: 'test' }];
    const result = sql.normalizeColumns(rows, null);
    test('Returns same rows reference', result === rows);
    test('Row data unchanged', rows[0].data === 'test');
}

// Test 7: normalizeColumns handles non-Buffer binary (e.g. UInt8Array from DB)
console.log('\nTest 7: normalizeColumns decompresses non-Buffer binary');
{
    const sql = new Sql();
    const original = 'binary string';
    const compressed = zlib.gzipSync(Buffer.from(original));
    // Simulate the kind of value a DB driver might return (e.g. a Uint8Array of bytes)
    const asUint8 = new Uint8Array(compressed);
    const rows = [{ data: asUint8 }];
    sql.normalizeColumns(rows, { data: columnTypes.gzip });
    test('Non-Buffer binary decompressed', rows[0].data === original, String(rows[0].data));
}

// ─── addParameters compression tests ──────────────────────────────────────

console.log('\nTesting addParameters with compression types...\n');

// Test 8: addParameters with type=json serializes object to JSON string
console.log('Test 8: addParameters with type="json" serializes object to string');
{
    const sql = new Sql();
    const request = createMockRequest();
    const obj = { hello: 'world' };
    sql.addParameters({
        query: 'SELECT 1',
        request,
        parameters: { payload: { value: obj, type: columnTypes.json } }
    });
    test('JSON parameter value is a string', typeof request.parameters['payload'].value === 'string');
    test('JSON string parses back correctly', JSON.parse(request.parameters['payload'].value).hello === 'world');
}

// Test 9: addParameters with type=json and string value leaves it as-is
console.log('\nTest 9: addParameters with type="json" and string value leaves value unchanged');
{
    const sql = new Sql();
    const request = createMockRequest();
    sql.addParameters({
        query: 'SELECT 1',
        request,
        parameters: { payload: { value: '{"a":1}', type: columnTypes.json } }
    });
    test('String value stays as string', request.parameters['payload'].value === '{"a":1}');
}

// Test 10: addParameters with type=gzip compresses string to Buffer, binds under original name
console.log('\nTest 10: addParameters with type="gzip" compresses string to Buffer');
{
    const sql = new Sql();
    const request = createMockRequest();
    const original = 'compress me';
    sql.addParameters({
        query: 'SELECT 1',
        request,
        parameters: { data: { value: original, type: columnTypes.gzip } }
    });
    const stored = request.parameters['data'].value;
    test('Gzip value is a Buffer (bound under original name)', Buffer.isBuffer(stored), String(typeof stored));
    const decompressed = zlib.gunzipSync(stored).toString('utf8');
    test('Gzip value decompresses correctly', decompressed === original, decompressed);
}

// Test 11: addParameters with type=gzipJson stringifies object and compresses, binds under original name
console.log('\nTest 11: addParameters with type="gzipJson" stringifies and compresses object');
{
    const sql = new Sql();
    const request = createMockRequest();
    const obj = { key: 'val', n: 7 };
    sql.addParameters({
        query: 'SELECT 1',
        request,
        parameters: { meta: { value: obj, type: columnTypes.gzipJson } }
    });
    const stored = request.parameters['meta'].value;
    test('GzipJson value is a Buffer (bound under original name)', Buffer.isBuffer(stored));
    const parsed = JSON.parse(zlib.gunzipSync(stored).toString('utf8'));
    test('GzipJson decompresses and parses correctly', parsed.key === 'val' && parsed.n === 7);
}

// Test 12: addParameters with type=gzipJson and string value compresses as-is, binds under original name
console.log('\nTest 12: addParameters with type="gzipJson" and string value compresses the string');
{
    const sql = new Sql();
    const request = createMockRequest();
    const str = '{"a":2}';
    sql.addParameters({
        query: 'SELECT 1',
        request,
        parameters: { meta: { value: str, type: columnTypes.gzipJson } }
    });
    const stored = request.parameters['meta'].value;
    test('GzipJson string value stored as Buffer (bound under original name)', Buffer.isBuffer(stored));
    const decompressed = zlib.gunzipSync(stored).toString('utf8');
    test('GzipJson string decompresses correctly', decompressed === str, decompressed);
}

// Test 13: addParameters with compression type and null value skips (ignoreNull=true default)
console.log('\nTest 13: addParameters with type="gzip" and null value skips the parameter');
{
    const sql = new Sql();
    const request = createMockRequest();
    sql.addParameters({
        query: 'SELECT 1',
        request,
        parameters: { data: { value: null, type: columnTypes.gzip } }
    });
    test('Null gzip value is not added to request', request.parameters['data'] === undefined);
}

// Test 14: columnTypes enum values
console.log('\nTest 14: columnTypes enum has expected values');
{
    test('columnTypes.gzip is "gzip"', columnTypes.gzip === 'gzip');
    test('columnTypes.gzipJson is "gzipJson"', columnTypes.gzipJson === 'gzipJson');
    test('columnTypes.json is "json"', columnTypes.json === 'json');
}

// ─── binaryColumnSuffix tests ──────────────────────────────────────────────

console.log('\nTesting binaryColumnSuffix behaviour...\n');

// Test 15: default binaryColumnSuffix is "_Binary"
console.log('Test 15: default binaryColumnSuffix is "_Binary"');
{
    const sql = new Sql();
    test('Default binaryColumnSuffix is "_Binary"', sql.binaryColumnSuffix === '_Binary');
}

// Test 16: normalizeColumns reads from "Col_Binary", writes to "Col", removes "Col_Binary"
console.log('\nTest 16: gzip column read from suffixed property, written to logical name');
{
    const sql = new Sql();
    const original = 'memo content';
    const compressed = zlib.gzipSync(Buffer.from(original));
    const rows = [{ Memo_Binary: compressed, Name: 'Alice' }];
    sql.normalizeColumns(rows, { Memo: columnTypes.gzip });
    test('Logical column "Memo" populated', rows[0].Memo === original, String(rows[0].Memo));
    test('"Memo_Binary" removed from row', !('Memo_Binary' in rows[0]));
    test('"Name" still present', rows[0].Name === 'Alice');
}

// Test 17: gzipJson column read from suffixed property, written to logical name as object
console.log('\nTest 17: gzipJson column read from suffixed property, parsed as JSON');
{
    const sql = new Sql();
    const original = { info: 'data', n: 5 };
    const compressed = zlib.gzipSync(Buffer.from(JSON.stringify(original)));
    const rows = [{ Meta_Binary: compressed }];
    sql.normalizeColumns(rows, { Meta: columnTypes.gzipJson });
    test('"Meta" column is an object', typeof rows[0].Meta === 'object');
    test('"Meta" object has correct value', rows[0].Meta.info === 'data' && rows[0].Meta.n === 5);
    test('"Meta_Binary" removed', !('Meta_Binary' in rows[0]));
}

// Test 18: if no suffixed column exists, fall back to direct column name
console.log('\nTest 18: falls back to direct column name when no suffixed column exists');
{
    const sql = new Sql();
    const original = 'fallback value';
    const compressed = zlib.gzipSync(Buffer.from(original));
    const rows = [{ Data: compressed }]; // no "Data_Binary"
    sql.normalizeColumns(rows, { Data: columnTypes.gzip });
    test('"Data" decompressed from direct column', rows[0].Data === original, String(rows[0].Data));
}

// Test 19: json type is never affected by binaryColumnSuffix
console.log('\nTest 19: json type column is not affected by binaryColumnSuffix');
{
    const sql = new Sql();
    const rows = [{ Config_Binary: '{"x":1}', Config: '{"y":2}' }];
    sql.normalizeColumns(rows, { Config: columnTypes.json });
    test('"Config" parsed as JSON from direct column', rows[0].Config.y === 2);
    test('"Config_Binary" untouched', rows[0].Config_Binary === '{"x":1}');
}

// Test 20: binaryColumnSuffix can be overridden per instance
console.log('\nTest 20: binaryColumnSuffix can be overridden');
{
    const sql = new Sql();
    sql.binaryColumnSuffix = '_Blob';
    const original = 'custom suffix';
    const compressed = zlib.gzipSync(Buffer.from(original));
    const rows = [{ Note_Blob: compressed }];
    sql.normalizeColumns(rows, { Note: columnTypes.gzip });
    test('"Note" populated from "_Blob" suffixed column', rows[0].Note === original, String(rows[0].Note));
    test('"Note_Blob" removed', !('Note_Blob' in rows[0]));
}

// Test 21: null value in suffixed column is skipped
console.log('\nTest 21: null value in suffixed column is skipped');
{
    const sql = new Sql();
    const rows = [{ Memo_Binary: null, Name: 'Bob' }];
    sql.normalizeColumns(rows, { Memo: columnTypes.gzip });
    test('"Memo" not added when suffixed column is null', !('Memo' in rows[0]));
    test('"Memo_Binary" stays as null', rows[0].Memo_Binary === null);
}

// ─── addParameters binaryColumnSuffix tests ───────────────────────────────

console.log('\nTesting addParameters binaryColumnSuffix behaviour...\n');

// Test 22: gzip parameter bound under original paramName, fieldName uses suffix
console.log('Test 22: addParameters gzip — parameter bound under original name, fieldName suffixed');
{
    const sql = new Sql();
    const request = createMockRequest();
    sql.addParameters({
        query: 'SELECT 1',
        request,
        parameters: { Memo: { value: 'hello', type: columnTypes.gzip } }
    });
    test('"Memo" parameter exists in request', request.parameters['Memo'] !== undefined);
    test('"Memo_Binary" not in request', request.parameters['Memo_Binary'] === undefined);
    test('"Memo" value is a Buffer', Buffer.isBuffer(request.parameters['Memo'].value));
    test('Decompresses correctly', zlib.gunzipSync(request.parameters['Memo'].value).toString('utf8') === 'hello');
}

// Test 23: gzipJson parameter bound under original paramName, fieldName uses suffix
console.log('\nTest 23: addParameters gzipJson — parameter bound under original name, fieldName suffixed');
{
    const sql = new Sql();
    const request = createMockRequest();
    sql.addParameters({
        query: 'SELECT 1',
        request,
        parameters: { Config: { value: { x: 1 }, type: columnTypes.gzipJson } }
    });
    test('"Config" parameter exists in request', request.parameters['Config'] !== undefined);
    test('"Config_Binary" not in request', request.parameters['Config_Binary'] === undefined);
    const parsed = JSON.parse(zlib.gunzipSync(request.parameters['Config'].value).toString('utf8'));
    test('GzipJson decompresses and parses correctly', parsed.x === 1);
}

// Test 24: json type is NOT suffixed
console.log('\nTest 24: addParameters json — parameter NOT suffixed');
{
    const sql = new Sql();
    const request = createMockRequest();
    sql.addParameters({
        query: 'SELECT 1',
        request,
        parameters: { Settings: { value: { y: 2 }, type: columnTypes.json } }
    });
    test('"Settings" parameter exists (no suffix)', request.parameters['Settings'] !== undefined);
    test('"Settings_Binary" not in request', request.parameters['Settings_Binary'] === undefined);
}

// Test 25: binaryColumnSuffix only applies to fieldName, not paramName
console.log('\nTest 25: addParameters honours overridden binaryColumnSuffix (fieldName only)');
{
    const sql = new Sql();
    sql.binaryColumnSuffix = '_Blob';
    const request = createMockRequest();
    sql.addParameters({
        query: 'SELECT 1',
        request,
        parameters: { Note: { value: 'text', type: columnTypes.gzip } }
    });
    test('"Note" parameter exists (paramName unsuffixed)', request.parameters['Note'] !== undefined);
    test('"Note_Blob" not in request', request.parameters['Note_Blob'] === undefined);
    test('"Note_Binary" not in request', request.parameters['Note_Binary'] === undefined);
}

// Test 26: binaryColumnSuffix="" disables suffix in addParameters
console.log('\nTest 26: addParameters with empty binaryColumnSuffix binds under original name');
{
    const sql = new Sql();
    sql.binaryColumnSuffix = '';
    const request = createMockRequest();
    sql.addParameters({
        query: 'SELECT 1',
        request,
        parameters: { Data: { value: 'raw', type: columnTypes.gzip } }
    });
    test('"Data" bound directly when suffix is empty', request.parameters['Data'] !== undefined);
    test('"Data_Binary" not in request', request.parameters['Data_Binary'] === undefined);
}

// Test 27: normalizeColumns error includes column name and row index
console.log('\nTest 27: normalizeColumns error includes column name and row index');
{
    const sql = new Sql();
    const rows = [{ data: Buffer.from('not-gzipped') }];
    let caughtError;
    try {
        sql.normalizeColumns(rows, { data: columnTypes.gzip });
    } catch (err) {
        caughtError = err;
    }
    test('Error is thrown for invalid gzip data', caughtError instanceof Error);
    test('Error message includes column name', caughtError && caughtError.message.includes('"data"'));
    test('Error message includes row index', caughtError && caughtError.message.includes('row 0'));
    test('Original error preserved as cause', caughtError && caughtError.cause instanceof Error);
}

// Test 28: normalizeColumns JSON parse error includes column name and row index
console.log('\nTest 28: normalizeColumns JSON parse error includes column name and row index');
{
    const sql = new Sql();
    const rows = [{ config: 'not-valid-json' }];
    let caughtError;
    try {
        sql.normalizeColumns(rows, { config: columnTypes.json });
    } catch (err) {
        caughtError = err;
    }
    test('Error is thrown for invalid JSON', caughtError instanceof Error);
    test('Error message includes column name', caughtError && caughtError.message.includes('"config"'));
    test('Error message includes row index', caughtError && caughtError.message.includes('row 0'));
    test('Original SyntaxError preserved as cause', caughtError && caughtError.cause instanceof SyntaxError);
}

// Test 29: addParameters gzip throws TypeError for Buffer input
console.log('\nTest 29: addParameters gzip — throws TypeError for Buffer value');
{
    const sql = new Sql();
    const request = createMockRequest();
    let caughtError;
    try {
        sql.addParameters({
            query: 'SELECT 1',
            request,
            parameters: { data: { value: Buffer.from('raw'), type: columnTypes.gzip } }
        });
    } catch (err) {
        caughtError = err;
    }
    test('TypeError thrown for Buffer gzip input', caughtError instanceof TypeError);
    test('Error message mentions columnTypes.gzip', caughtError && caughtError.message.includes('columnTypes.gzip'));
}

// Test 30: addParameters gzipJson throws TypeError for Buffer input
console.log('\nTest 30: addParameters gzipJson — throws TypeError for Buffer value');
{
    const sql = new Sql();
    const request = createMockRequest();
    let caughtError;
    try {
        sql.addParameters({
            query: 'SELECT 1',
            request,
            parameters: { data: { value: Buffer.from('raw'), type: columnTypes.gzipJson } }
        });
    } catch (err) {
        caughtError = err;
    }
    test('TypeError thrown for Buffer gzipJson input', caughtError instanceof TypeError);
    test('Error message mentions columnTypes.gzipJson', caughtError && caughtError.message.includes('columnTypes.gzipJson'));
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
