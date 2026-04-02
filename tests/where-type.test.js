/**
 * Test for where condition type support
 * Tests that when type is "date" (or other date types), UPPER() is not applied
 * in forceCaseInsensitive mode, and that sqlType is correctly inferred.
 */

import Sql from '../lib/sql.js';

// Create a mock request object
function createMockRequest() {
    return {
        parameters: {},
        input: function(name, typeOrValue, value) {
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

console.log('Testing where condition type support...\n');

// Test 1: With forceCaseInsensitive=true, a string value WITHOUT type gets UPPER()
console.log('Test 1: String without type gets UPPER() with forceCaseInsensitive');
{
    const sql = new Sql();
    sql.forceCaseInsensitive = true;
    const request = createMockRequest();
    const result = sql.addParameters({
        query: 'SELECT 1',
        request,
        parameters: { name: { value: 'john' } },
        forWhere: true
    });
    test('Query contains UPPER(name)', result.includes('UPPER(name)'), result);
    test('Parameter value is uppercased', request.parameters['name'].value === 'JOHN', JSON.stringify(request.parameters));
}

// Test 2: With forceCaseInsensitive=true, a string value WITH type="date" does NOT get UPPER()
console.log('\nTest 2: Date string with type="date" skips UPPER() with forceCaseInsensitive');
{
    const sql = new Sql();
    sql.forceCaseInsensitive = true;
    const request = createMockRequest();
    const result = sql.addParameters({
        query: 'SELECT 1',
        request,
        parameters: { createdDate: { value: '2024-01-15', type: 'date' } },
        forWhere: true
    });
    test('Query does NOT contain UPPER(createdDate)', !result.includes('UPPER(createdDate)'), result);
    test('Parameter value is NOT uppercased', request.parameters['createdDate'].value === '2024-01-15', JSON.stringify(request.parameters));
}

// Test 3: With forceCaseInsensitive=true, type="dateTime" also skips UPPER()
console.log('\nTest 3: Date string with type="dateTime" skips UPPER() with forceCaseInsensitive');
{
    const sql = new Sql();
    sql.forceCaseInsensitive = true;
    const request = createMockRequest();
    const result = sql.addParameters({
        query: 'SELECT 1',
        request,
        parameters: { createdDate: { value: '2024-01-15 00:00:00', type: 'dateTime' } },
        forWhere: true
    });
    test('Query does NOT contain UPPER(createdDate)', !result.includes('UPPER(createdDate)'), result);
    test('Parameter value is NOT uppercased', request.parameters['createdDate'].value === '2024-01-15 00:00:00', JSON.stringify(request.parameters));
}

// Test 4: With forceCaseInsensitive=true, type="dateTimeLocal" also skips UPPER()
console.log('\nTest 4: Date string with type="dateTimeLocal" skips UPPER() with forceCaseInsensitive');
{
    const sql = new Sql();
    sql.forceCaseInsensitive = true;
    const request = createMockRequest();
    const result = sql.addParameters({
        query: 'SELECT 1',
        request,
        parameters: { createdDate: { value: '2024-01-15T00:00:00', type: 'dateTimeLocal' } },
        forWhere: true
    });
    test('Query does NOT contain UPPER(createdDate)', !result.includes('UPPER(createdDate)'), result);
    test('Parameter value is NOT uppercased', request.parameters['createdDate'].value === '2024-01-15T00:00:00', JSON.stringify(request.parameters));
}

// Test 5: With type="date", sqlType is inferred as DateTime2 when not explicitly set
console.log('\nTest 5: sqlType is inferred as DateTime2 when type="date"');
{
    const sql = new Sql();
    const request = createMockRequest();
    sql.addParameters({
        query: 'SELECT 1',
        request,
        parameters: { createdDate: { value: '2024-01-15', type: 'date' } },
        forWhere: true
    });
    test('Parameter type is DateTime2', request.parameters['createdDate'].type === sql.dataTypes.date, JSON.stringify(request.parameters));
}

// Test 6: With type="date" but explicit sqlType, explicit sqlType takes precedence
console.log('\nTest 6: Explicit sqlType is not overridden by type="date"');
{
    const sql = new Sql();
    const request = createMockRequest();
    sql.addParameters({
        query: 'SELECT 1',
        request,
        parameters: { createdDate: { value: '2024-01-15', type: 'date', sqlType: sql.dataTypes.string } },
        forWhere: true
    });
    test('Parameter type is VarChar (explicit sqlType)', request.parameters['createdDate'].type === sql.dataTypes.string, JSON.stringify(request.parameters));
}

// Test 7: Without type, sqlType is NOT inferred
console.log('\nTest 7: Without type, sqlType is not inferred automatically');
{
    const sql = new Sql();
    const request = createMockRequest();
    sql.addParameters({
        query: 'SELECT 1',
        request,
        parameters: { createdDate: { value: '2024-01-15' } },
        forWhere: true
    });
    // Should use input(name, value) form (no type in stored params)
    test('Parameter has no explicit sqlType', request.parameters['createdDate'].type === undefined, JSON.stringify(request.parameters));
}

// Test 8: With forceCaseInsensitive=false, date type behaves normally (no UPPER either way)
console.log('\nTest 8: Without forceCaseInsensitive, date type has no effect on UPPER');
{
    const sql = new Sql();
    sql.forceCaseInsensitive = false;
    const request = createMockRequest();
    const result = sql.addParameters({
        query: 'SELECT 1',
        request,
        parameters: { createdDate: { value: '2024-01-15', type: 'date' } },
        forWhere: true
    });
    test('Query does NOT contain UPPER(createdDate)', !result.includes('UPPER(createdDate)'), result);
}

// Test 9: With type="datetime" (lowercase) also skips UPPER()
console.log('\nTest 9: Date string with type="datetime" skips UPPER() with forceCaseInsensitive');
{
    const sql = new Sql();
    sql.forceCaseInsensitive = true;
    const request = createMockRequest();
    const result = sql.addParameters({
        query: 'SELECT 1',
        request,
        parameters: { createdDate: { value: '2024-01-15', type: 'datetime' } },
        forWhere: true
    });
    test('Query does NOT contain UPPER(createdDate)', !result.includes('UPPER(createdDate)'), result);
    test('Parameter value is NOT uppercased', request.parameters['createdDate'].value === '2024-01-15', JSON.stringify(request.parameters));
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
