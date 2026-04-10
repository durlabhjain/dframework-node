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
    // Simulate the kind of value a DB driver might return (e.g. a plain array of bytes)
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

// Test 10: addParameters with type=gzip compresses string to Buffer
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
    test('Gzip value is a Buffer', Buffer.isBuffer(stored), String(typeof stored));
    const decompressed = zlib.gunzipSync(stored).toString('utf8');
    test('Gzip value decompresses correctly', decompressed === original, decompressed);
}

// Test 11: addParameters with type=gzipJson stringifies object and compresses
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
    test('GzipJson value is a Buffer', Buffer.isBuffer(stored));
    const parsed = JSON.parse(zlib.gunzipSync(stored).toString('utf8'));
    test('GzipJson decompresses and parses correctly', parsed.key === 'val' && parsed.n === 7);
}

// Test 12: addParameters with type=gzipJson and string value compresses as-is
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
    test('GzipJson string value stored as Buffer', Buffer.isBuffer(stored));
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

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
