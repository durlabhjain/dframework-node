#!/usr/bin/env node

/**
 * Test script for report configuration
 * Verifies that defaultReportPath works correctly
 */

import { reports, setReportConfig, toExcel } from '../lib/reports.mjs';
import fs from 'fs-extra';
import path from 'path';

console.log('='.repeat(60));
console.log('TESTING REPORT CONFIGURATION');
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

// Create a test directory in /tmp
const testDir = '/tmp/report-config-test';
fs.ensureDirSync(testDir);

// Test 1: Verify setReportConfig function exists
test('setReportConfig function is exported', typeof setReportConfig === 'function');

// Test 2: Test programmatic configuration
try {
    setReportConfig({ defaultReportPath: testDir });
    test('setReportConfig accepts configuration', true);
} catch (err) {
    console.error('Error setting config:', err);
    test('setReportConfig accepts configuration', false);
}

// Test 3: Test toExcel uses the configured default path
(async () => {
    try {
        const title = 'TestReport';
        const rows = [
            { id: 1, name: 'John', age: 30 },
            { id: 2, name: 'Jane', age: 25 }
        ];
        const columns = {
            id: { title: 'ID' },
            name: { title: 'Name' },
            age: { title: 'Age' }
        };

        const filePath = await toExcel({ title, rows, columns });
        test('toExcel returns a file path', !!filePath);

        const expectedPath = path.join(testDir, `${title}.xlsx`);
        test('toExcel uses configured default path', filePath === expectedPath);

        const fileExists = fs.existsSync(filePath);
        test('toExcel creates file in configured path', fileExists);

        // Clean up
        if (fileExists) {
            fs.unlinkSync(filePath);
        }
    } catch (err) {
        console.error('Error during toExcel test:', err);
        test('toExcel returns a file path', false);
        test('toExcel uses configured default path', false);
        test('toExcel creates file in configured path', false);
    }

    // Test 4: Test that explicit outputPath overrides default
    try {
        const customDir = '/tmp/report-config-test-override';
        fs.ensureDirSync(customDir);

        const title = 'TestReportOverride';
        const rows = [{ id: 1, name: 'Test' }];
        const columns = { id: { title: 'ID' }, name: { title: 'Name' } };

        const filePath = await toExcel({ title, rows, columns, outputPath: customDir });

        const expectedPath = path.join(customDir, `${title}.xlsx`);
        test('Explicit outputPath overrides default', filePath === expectedPath);

        const fileExists = fs.existsSync(filePath);
        test('toExcel creates file in overridden path', fileExists);

        // Clean up
        if (fileExists) {
            fs.unlinkSync(filePath);
        }
        fs.rmdirSync(customDir);
    } catch (err) {
        console.error('Error during override test:', err);
        test('Explicit outputPath overrides default', false);
        test('toExcel creates file in overridden path', false);
    }

    // Test 5: Test reports.execute uses configured default
    try {
        // Define a simple test report class (without date columns to avoid userDateFormat issue)
        class TestReport {
            title = 'TestExecuteReport';
            reportType = 'csv';  // Use CSV instead of excel to avoid userDateFormat issue
            columns = {
                id: { title: 'ID' },
                value: { title: 'Value' }
            };

            async execute() {
                return [
                    { id: 1, value: 'A' },
                    { id: 2, value: 'B' }
                ];
            }
        }

        const result = await reports.execute({ ReportType: TestReport });
        test('reports.execute returns success', result.success === true);
        test('reports.execute returns filePath', !!result.filePath);

        const expectedPath = path.join(testDir, `TestExecuteReport.csv`);
        test('reports.execute uses configured default path', result.filePath === expectedPath);

        const fileExists = fs.existsSync(result.filePath);
        test('reports.execute creates file in configured path', fileExists);

        // Clean up
        if (fileExists) {
            fs.unlinkSync(result.filePath);
        }
    } catch (err) {
        console.error('Error during reports.execute test:', err);
        test('reports.execute returns success', false);
        test('reports.execute returns filePath', false);
        test('reports.execute uses configured default path', false);
        test('reports.execute creates file in configured path', false);
    }

    // Clean up test directory
    try {
        fs.rmdirSync(testDir);
    } catch (err) {
        // Directory might not be empty or might not exist
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
})();
