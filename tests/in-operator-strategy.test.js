/**
 * Test for IN operator strategy optimization
 * Tests the configurable IN operator strategies: innerJoin, exists, and in
 */

import Sql from '../lib/sql.js';

// Mock mssql module
const mockMssql = {
    VarChar: 'VarChar',
    Int: 'Int',
    DateTime2: 'DateTime2',
    Bit: 'Bit',
    TinyInt: 'TinyInt',
    SmallInt: 'SmallInt',
    BigInt: 'BigInt',
    Decimal: 'Decimal',
    Float: 'Float',
    Money: 'Money',
    SmallMoney: 'SmallMoney',
    Table: class {
        constructor(type) {
            this.type = type;
            this.columns = {
                add: () => {}
            };
            this.rows = {
                add: () => {}
            };
        }
    }
};

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

console.log('Testing IN operator strategy optimization...\n');

// Test 1: Default strategy (innerJoin) with non-TVP
console.log('Test 1: Default strategy (innerJoin) with non-TVP');
const sql1 = new Sql();
const request1 = createMockRequest();
const result1 = sql1.in({
    request: request1,
    fieldName: 'UserId',
    paramName: 'UserId',
    values: [1, 2, 3],
    sqlType: mockMssql.Int
});
console.log('Statement:', result1.statement);
console.log('Expected: INNER JOIN with derived table');
console.log('Match:', result1.statement.includes('INNER JOIN') && result1.statement.includes('_tvp'));
console.log('');

// Test 2: EXISTS strategy with non-TVP
console.log('Test 2: EXISTS strategy with non-TVP');
const sql2 = new Sql();
sql2.inOperatorStrategy = 'exists';
const request2 = createMockRequest();
const result2 = sql2.in({
    request: request2,
    fieldName: 'UserId',
    paramName: 'UserId',
    values: [1, 2, 3],
    sqlType: mockMssql.Int
});
console.log('Statement:', result2.statement);
console.log('Expected: EXISTS with subquery');
console.log('Match:', result2.statement.includes('EXISTS') && result2.statement.includes('_tvp'));
console.log('');

// Test 3: Traditional IN strategy
console.log('Test 3: Traditional IN strategy');
const sql3 = new Sql();
sql3.inOperatorStrategy = 'in';
const request3 = createMockRequest();
const result3 = sql3.in({
    request: request3,
    fieldName: 'UserId',
    paramName: 'UserId',
    values: [1, 2, 3],
    sqlType: mockMssql.Int
});
console.log('Statement:', result3.statement);
console.log('Expected: Traditional IN (field IN (@param1, @param2, ...))');
console.log('Match:', result3.statement.includes('IN (') && result3.statement.includes('@UserId'));
console.log('');

// Test 4: NOT IN with innerJoin strategy (should use NOT EXISTS)
console.log('Test 4: NOT IN with innerJoin strategy');
const sql4 = new Sql();
sql4.inOperatorStrategy = 'innerJoin';
const request4 = createMockRequest();
const result4 = sql4.in({
    request: request4,
    fieldName: 'UserId',
    paramName: 'UserId',
    values: [1, 2, 3],
    operator: '!=',
    sqlType: mockMssql.Int
});
console.log('Statement:', result4.statement);
console.log('Expected: NOT EXISTS with subquery');
console.log('Match:', result4.statement.includes('NOT EXISTS'));
console.log('');

// Test 5: Multiple calls should increment alias counter
console.log('Test 5: Multiple IN operations should use different aliases');
const sql5 = new Sql();
const request5 = createMockRequest();
const result5a = sql5.in({
    request: request5,
    fieldName: 'UserId',
    paramName: 'UserId',
    values: [1, 2, 3],
    sqlType: mockMssql.Int
});
const result5b = sql5.in({
    request: request5,
    fieldName: 'ProductId',
    paramName: 'ProductId',
    values: [10, 20, 30],
    sqlType: mockMssql.Int
});
console.log('First statement:', result5a.statement);
console.log('Second statement:', result5b.statement);
console.log('Expected: Different aliases (_tvp1, _tvp2)');
const hasFirstAlias = result5a.statement.includes('_tvp1');
const hasSecondAlias = result5b.statement.includes('_tvp2');
console.log('Match:', hasFirstAlias && hasSecondAlias);
console.log('');

// Test 6: Override strategy parameter
console.log('Test 6: Override strategy with parameter');
const sql6 = new Sql();
sql6.inOperatorStrategy = 'innerJoin'; // Default is innerJoin
const request6 = createMockRequest();
const result6 = sql6.in({
    request: request6,
    fieldName: 'UserId',
    paramName: 'UserId',
    values: [1, 2, 3],
    sqlType: mockMssql.Int,
    strategy: 'in' // Override to use traditional IN
});
console.log('Statement:', result6.statement);
console.log('Expected: Traditional IN despite default being innerJoin');
console.log('Match:', result6.statement.includes('IN (') && !result6.statement.includes('INNER JOIN'));
console.log('');

// Test 7: setConfig should set the strategy
console.log('Test 7: setConfig should set inOperatorStrategy');
const sql7 = new Sql();
console.log('Default strategy:', sql7.inOperatorStrategy);
console.log('Expected: innerJoin');
console.log('Match:', sql7.inOperatorStrategy === 'innerJoin');
console.log('');

// Test 8: Invalid strategy should throw error
console.log('Test 8: Invalid strategy should throw error');
const sql8 = new Sql();
const request8 = createMockRequest();
let errorThrown = false;
try {
    sql8.in({
        request: request8,
        fieldName: 'UserId',
        paramName: 'UserId',
        values: [1, 2, 3],
        sqlType: mockMssql.Int,
        strategy: 'invalid' // Invalid strategy
    });
} catch (err) {
    errorThrown = true;
    console.log('Error message:', err.message);
}
console.log('Expected: Error thrown for invalid strategy');
console.log('Match:', errorThrown);
console.log('');

console.log('All tests completed!');
