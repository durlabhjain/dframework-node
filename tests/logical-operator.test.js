/**
 * Tests for addParameters logicalOperator and appendAnd options.
 * Covers: OR grouping with parentheses, AND default, appendAnd mode, and
 * invalid logicalOperator rejection.
 */

import Sql from '../lib/sql.js';

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

console.log('Testing logicalOperator and appendAnd options...\n');

// Test 1: Default (AND) — multiple conditions joined with AND, no parentheses
console.log('Test 1: Default AND joins conditions without parentheses');
{
    const sql = new Sql();
    const request = createMockRequest();
    const result = sql.addParameters({
        query: 'SELECT 1 FROM T',
        request,
        parameters: { a: { value: 1 }, b: { value: 2 } },
        forWhere: true
    });
    test('Query contains WHERE', result.includes('WHERE'), result);
    test('Conditions joined with AND', result.includes(' AND '), result);
    test('No parentheses around conditions', !result.includes('(a') && !result.includes('(b'), result);
}

// Test 2: logicalOperator='OR' with multiple conditions — wrapped in parentheses
console.log('\nTest 2: OR with multiple conditions wraps group in parentheses');
{
    const sql = new Sql();
    const request = createMockRequest();
    const result = sql.addParameters({
        query: 'SELECT 1 FROM T',
        request,
        parameters: { a: { value: 1 }, b: { value: 2 } },
        forWhere: true,
        logicalOperator: 'OR'
    });
    test('Query contains WHERE', result.includes('WHERE'), result);
    test('Conditions wrapped in parentheses', result.includes('('), result);
    test('Conditions joined with OR', result.includes(' OR '), result);
    test('Opening paren precedes first condition', /WHERE \(/.test(result), result);
}

// Test 3: logicalOperator='OR' with a single condition — no parentheses needed
console.log('\nTest 3: OR with single condition does not add extra parentheses');
{
    const sql = new Sql();
    const request = createMockRequest();
    const result = sql.addParameters({
        query: 'SELECT 1 FROM T',
        request,
        parameters: { a: { value: 1 } },
        forWhere: true,
        logicalOperator: 'OR'
    });
    test('Query contains WHERE', result.includes('WHERE'), result);
    test('Single condition has no wrapping parens', !/WHERE \(/.test(result), result);
}

// Test 4: appendAnd=true — uses AND instead of WHERE
console.log('\nTest 4: appendAnd=true appends AND instead of WHERE');
{
    const sql = new Sql();
    const request = createMockRequest();
    const result = sql.addParameters({
        query: 'SELECT 1 FROM T WHERE IsDeleted = 0',
        request,
        parameters: { a: { value: 1 } },
        forWhere: true,
        appendAnd: true
    });
    test('Query does not add a second WHERE', (result.match(/\bWHERE\b/g) || []).length === 1, result);
    test('New condition joined with AND', / AND a =/.test(result), result);
}

// Test 5: appendAnd=true with OR — OR group still wrapped in parens
console.log('\nTest 5: appendAnd=true with OR wraps group in parentheses');
{
    const sql = new Sql();
    const request = createMockRequest();
    const result = sql.addParameters({
        query: 'SELECT 1 FROM T WHERE IsDeleted = 0',
        request,
        parameters: { a: { value: 1 }, b: { value: 2 } },
        forWhere: true,
        logicalOperator: 'OR',
        appendAnd: true
    });
    test('Only one WHERE keyword', (result.match(/\bWHERE\b/g) || []).length === 1, result);
    test('OR group wrapped in parens and joined with AND', / AND \(/.test(result), result);
    test('Conditions joined with OR inside parens', result.includes(' OR '), result);
}

// Test 6: null logicalOperator throws
console.log('\nTest 6: null logicalOperator throws an error');
{
    const sql = new Sql();
    const request = createMockRequest();
    let threw = false;
    try {
        sql.addParameters({
            query: 'SELECT 1 FROM T',
            request,
            parameters: { a: { value: 1 } },
            forWhere: true,
            logicalOperator: null
        });
    } catch (e) {
        threw = true;
    }
    test('Throws for null logicalOperator', threw);
}

// Test 7: invalid logicalOperator throws
console.log('\nTest 7: invalid logicalOperator throws an error');
{
    const sql = new Sql();
    const request = createMockRequest();
    let threw = false;
    let errMsg = '';
    try {
        sql.addParameters({
            query: 'SELECT 1 FROM T',
            request,
            parameters: { a: { value: 1 } },
            forWhere: true,
            logicalOperator: 'OR 1=1; --'
        });
    } catch (e) {
        threw = true;
        errMsg = e.message;
    }
    test('Throws for invalid logicalOperator', threw, errMsg);
    test('Error message mentions the invalid value', errMsg.includes('OR 1=1; --'), errMsg);
}

// Test 8: case-insensitive logicalOperator ('or' / 'and')
console.log('\nTest 8: logicalOperator is case-insensitive');
{
    const sql = new Sql();
    const request = createMockRequest();
    const result = sql.addParameters({
        query: 'SELECT 1 FROM T',
        request,
        parameters: { a: { value: 1 }, b: { value: 2 } },
        forWhere: true,
        logicalOperator: 'or'
    });
    test('Lowercase "or" is accepted', result.includes(' OR '), result);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
