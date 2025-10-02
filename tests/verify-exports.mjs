#!/usr/bin/env node

/**
 * Verification script for new exports
 * Tests all the newly added exports to ensure they work correctly
 */

import { 
    Framework, 
    Sql,
    MySql,
    SqlHelper,
    ListParameters,
    reports,
    toExcel,
    generateReport,
    enums,
    // Also test that existing exports still work
    mssql,
    mysql,
    Azure,
    util,
    httpAuth,
    Elastic,
    adapters,
    logger,
    appConfig,
    lookup,
    sqlErrorMapper,
    BusinessBase,
    responseTransformer,
    ElasticBusinessBase,
    BusinessBaseRouter,
    Auth
} from '../index.js';

let passCount = 0;
let failCount = 0;

function test(name, condition) {
    if (condition) {
        console.log(`✓ ${name}`);
        passCount++;
    } else {
        console.log(`✗ ${name}`);
        failCount++;
    }
}

console.log('='.repeat(60));
console.log('TESTING NEW EXPORTS FROM index.js');
console.log('='.repeat(60));

// Test new exports
test('Sql class is exported', typeof Sql === 'function');
test('MySql class is exported', typeof MySql === 'function');
test('SqlHelper is exported', typeof SqlHelper === 'function');
test('ListParameters is exported', typeof ListParameters === 'function');
test('reports is exported', typeof reports === 'object' && typeof reports.execute === 'function');
test('toExcel is exported', typeof toExcel === 'function');
test('generateReport is exported', typeof generateReport === 'function');
test('enums is exported', typeof enums === 'object');

console.log('\n' + '='.repeat(60));
console.log('TESTING EXISTING EXPORTS (should still work)');
console.log('='.repeat(60));

// Test existing exports still work
test('Framework is exported', typeof Framework === 'function');
test('mssql is exported', typeof mssql === 'object');
test('mysql is exported', typeof mysql === 'object');
test('Azure is exported', typeof Azure === 'function');
test('util is exported', typeof util === 'object');
test('httpAuth is exported', typeof httpAuth === 'object');
test('Elastic is exported', typeof Elastic === 'function');
test('adapters is exported', typeof adapters === 'object');
test('logger is exported', typeof logger === 'object');
test('BusinessBase is exported', typeof BusinessBase === 'function');

console.log('\n' + '='.repeat(60));
console.log('TESTING ListParameters FUNCTIONALITY');
console.log('='.repeat(60));

// Test ListParameters functionality
const params = new ListParameters({
    start: 10,
    limit: 25,
    sort: 'name',
    dir: 'desc'
});

test('ListParameters can be instantiated', params instanceof ListParameters);
test('ListParameters.start is set correctly', params.start === 10);
test('ListParameters.limit is set correctly', params.limit === 25);
test('ListParameters.sort is set correctly', params.sort === 'name');
test('ListParameters.dir is set correctly', params.dir === 'desc');
test('ListParameters.action has default value', params.action === 'list');

const paramsWithFilter = new ListParameters({
    start: 0,
    limit: 50,
    sort: 'createdDate',
    dir: 'asc',
    filters: [{
        field: 'status',
        type: 'string',
        value: 'active',
        comparison: '='
    }]
});

const formData = paramsWithFilter.toFormData();
test('toFormData returns object', typeof formData === 'object');
test('toFormData includes start', formData.start === 0);
test('toFormData includes limit', formData.limit === 50);
test('toFormData includes sort', formData.sort === 'createdDate');
test('toFormData converts dir to uppercase', formData.dir === 'ASC');
test('toFormData includes filter field', formData['filter[0][field]'] === 'status');
test('toFormData includes filter value', formData['filter[0][data][value]'] === 'active');

console.log('\n' + '='.repeat(60));
console.log('TESTING enums CONTENT');
console.log('='.repeat(60));

test('enums.dateTimeFields is an array', Array.isArray(enums.dateTimeFields));
test('enums.authMethods exists', typeof enums.authMethods === 'object');
test('enums.authMethods.basicAuth is correct', enums.authMethods.basicAuth === 'basicAuth');
test('enums.authMethods.entraIdAuth is correct', enums.authMethods.entraIdAuth === 'entraIdAuth');
test('enums.ENTRA_APP_STAGES exists', typeof enums.ENTRA_APP_STAGES === 'object');
test('enums.ENTRA_APP_STAGES.SIGN_IN is correct', enums.ENTRA_APP_STAGES.SIGN_IN === 'sign_in');

console.log('\n' + '='.repeat(60));
console.log('TESTING SUBPATH IMPORTS');
console.log('='.repeat(60));

// Test subpath imports
Promise.all([
    import('../lib/sql.js'),
    import('../lib/mysql.js'),
    import('../lib/business/sql-helper.mjs'),
    import('../lib/list-parameters.js'),
    import('../lib/reports.mjs'),
    import('../lib/business/query-base.mjs'),
    import('../lib/enums.mjs')
]).then(([sql, mysql, sqlHelper, listParams, reportsModule, queryBase, enumsModule]) => {
    test('Subpath ./lib/sql.js works', typeof sql.default === 'function');
    test('Subpath ./lib/mysql.js works', typeof mysql.default === 'function');
    test('Subpath ./lib/business/sql-helper.mjs works', typeof sqlHelper.default === 'function');
    test('Subpath ./lib/list-parameters.js works', typeof listParams.default === 'function');
    test('Subpath ./lib/reports.mjs works', typeof reportsModule.reports === 'object');
    test('Subpath ./lib/reports.mjs exports toExcel', typeof reportsModule.toExcel === 'function');
    test('Subpath ./lib/business/query-base.mjs works', typeof queryBase.default === 'function');
    test('Subpath ./lib/enums.mjs works', typeof enumsModule.default === 'object');
    
    console.log('\n' + '='.repeat(60));
    console.log('SUMMARY');
    console.log('='.repeat(60));
    console.log(`✓ Passed: ${passCount}`);
    console.log(`✗ Failed: ${failCount}`);
    console.log('='.repeat(60));
    
    if (failCount > 0) {
        console.log('\n❌ Some tests failed!');
        process.exit(1);
    } else {
        console.log('\n✅ All tests passed!');
        process.exit(0);
    }
}).catch(err => {
    console.error('\n❌ Error during subpath import testing:', err);
    process.exit(1);
});
