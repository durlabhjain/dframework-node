#!/usr/bin/env node

/**
 * Test script for the modernized logger
 * Verifies that the logger works with pino-roll and async logging
 */

import logger from '../lib/logger.js';
import fs from 'fs';

console.log('='.repeat(60));
console.log('TESTING MODERNIZED LOGGER');
console.log('='.repeat(60));

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

// Test 1: Logger is exported and is an object
test('Logger is exported', typeof logger === 'object');
test('Logger is not null', logger !== null);

// Test 2: Logger has expected methods
test('Logger has info method', typeof logger.info === 'function');
test('Logger has debug method', typeof logger.debug === 'function');
test('Logger has error method', typeof logger.error === 'function');
test('Logger has warn method', typeof logger.warn === 'function');
test('Logger has trace method', typeof logger.trace === 'function');

// Test 3: Test basic logging (should not throw)
try {
    logger.info('Test info message');
    logger.debug('Test debug message');
    logger.warn('Test warning message');
    logger.error('Test error message');
    test('Basic logging works without errors', true);
} catch (err) {
    console.error('Error during logging:', err);
    test('Basic logging works without errors', false);
}

// Test 4: Test child logger
try {
    const childLogger = logger.child({ module: 'test' });
    test('Child logger can be created', typeof childLogger === 'object');
    childLogger.info('Test child logger message');
    test('Child logger works', true);
} catch (err) {
    console.error('Error with child logger:', err);
    test('Child logger works', false);
}

// Test 5: Verify logs folder is created
const logsFolder = './logs';
setTimeout(() => {
    try {
        const exists = fs.existsSync(logsFolder);
        test('Logs folder is created', exists);
        
        if (exists) {
            // Check for log files (they might not be created immediately due to buffering)
            const files = fs.readdirSync(logsFolder);
            console.log(`\nLog files created: ${files.length > 0 ? files.join(', ') : 'None yet (buffered)'}`);
        }
    } catch (err) {
        console.error('Error checking logs folder:', err);
        test('Logs folder is created', false);
    }
    
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
}, 1000); // Wait a bit for async operations
