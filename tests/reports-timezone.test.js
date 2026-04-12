/**
 * Tests for timezone and localization in Excel export (writeExcelSheet / toExcel)
 */

import { toExcel } from '../lib/reports.mjs';
import ExcelJS from 'exceljs';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';

dayjs.extend(utc);
dayjs.extend(timezone);

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

// Helper: write toExcel to a buffer and read the first data row
async function getFirstDataRow({ rows, columns, userDateFormat, userTimezone }) {
    const chunks = [];
    const stream = {
        write(chunk) { chunks.push(Buffer.from(chunk)); },
        end() { },
        on() { return this; },
        once() { return this; },
        emit() { return this; },
        removeListener() { return this; },
        // ExcelJS writes via pipe; mock writable stream interface
        _write(chunk, enc, cb) { chunks.push(chunk); cb(); },
        writable: true,
    };

    // Use a temp file instead of a stream for simplicity
    const tmpFile = path.join(os.tmpdir(), `tz-test-${Date.now()}.xlsx`);
    await toExcel({ rows, columns, userDateFormat, userTimezone, filePath: tmpFile });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(tmpFile);
    fs.unlinkSync(tmpFile);

    const sheet = workbook.worksheets[0];
    // Row 1 is the header (table header), row 2 is the first data row
    const row = sheet.getRow(2);
    return row;
}

const UTC_TIMESTAMP = '2024-03-15T14:30:00.000Z'; // 14:30 UTC
const UTC_DATE_ONLY = '2024-03-15';

console.log('='.repeat(60));
console.log('TESTING TIMEZONE / LOCALIZE IN EXCEL EXPORT');
console.log('='.repeat(60));

// ── Fix 1: null-guard — column key in rows but not in columns ─────────────
await (async () => {
    console.log('\n--- Fix 1: null-guard on colConfig ---');
    const rows = [{ knownCol: 'hello', unknownCol: 'world' }];
    const columns = { knownCol: { title: 'Known' } };
    // unknownCol has no entry in columns → would previously throw TypeError
    try {
        const tmpFile = path.join(os.tmpdir(), `tz-null-guard-${Date.now()}.xlsx`);
        await toExcel({ rows, columns, filePath: tmpFile });
        fs.unlinkSync(tmpFile);
        test('No crash when row has column key missing from columns', true);
    } catch (err) {
        test('No crash when row has column key missing from columns', false, err.message);
    }
})();

// ── Fix 2 & 3: userTimezone/userDateFormat fallbacks ──────────────────────
await (async () => {
    console.log('\n--- Fix 2 & 3: fallbacks for missing userTimezone/userDateFormat ---');
    const rows = [{ ts: new Date(UTC_TIMESTAMP) }];
    const columns = { ts: { title: 'Timestamp', valueType: 'dateTime', localize: true } };

    // No userTimezone, no userDateFormat — should not throw and should produce a non-empty string
    try {
        const tmpFile = path.join(os.tmpdir(), `tz-fallback-${Date.now()}.xlsx`);
        await toExcel({ rows, columns, filePath: tmpFile });
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.readFile(tmpFile);
        fs.unlinkSync(tmpFile);
        const cellValue = wb.worksheets[0].getRow(2).getCell(1).value;
        test('No crash when userTimezone and userDateFormat are undefined', true);
        test('Cell value is a non-empty string (not "undefined ...")', typeof cellValue === 'string' && cellValue.length > 0 && !cellValue.startsWith('undefined'), `Got: ${cellValue}`);
    } catch (err) {
        test('No crash when userTimezone and userDateFormat are undefined', false, err.message);
        test('Cell value is a non-empty string (not "undefined ...")', false);
    }
})();

// ── Fix 2 & 3 with actual timezone ────────────────────────────────────────
await (async () => {
    console.log('\n--- Timezone conversion correctness ---');
    const rows = [{ ts: new Date(UTC_TIMESTAMP) }];
    const columns = { ts: { title: 'Timestamp', valueType: 'dateTime', localize: true } };
    const userDateFormat = 'MM/DD/YYYY';
    const userTimezone = 'America/New_York'; // UTC-4 in March (EDT)

    try {
        const tmpFile = path.join(os.tmpdir(), `tz-conversion-${Date.now()}.xlsx`);
        await toExcel({ rows, columns, userDateFormat, userTimezone, filePath: tmpFile });
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.readFile(tmpFile);
        fs.unlinkSync(tmpFile);
        const cellValue = wb.worksheets[0].getRow(2).getCell(1).value;
        // 14:30 UTC → 10:30 AM EDT (UTC-4)
        const expected = dayjs.utc(UTC_TIMESTAMP).tz(userTimezone).format(userDateFormat + ' hh:mm:ss A');
        test('Localized dateTime cell matches expected timezone conversion', cellValue === expected, `expected "${expected}", got "${cellValue}"`);
    } catch (err) {
        test('Localized dateTime cell matches expected timezone conversion', false, err.message);
    }
})();

// ── Fix 4: hyperlink display text uses userTimezone (not machine-local) ───
await (async () => {
    console.log('\n--- Fix 4: hyperlink localize uses userTimezone ---');
    const rows = [{ ts: new Date(UTC_TIMESTAMP), id: 42 }];
    const columns = {
        ts: { title: 'Timestamp', valueType: 'dateTime', localize: true, hyperlinkURL: '/records/{0}', hyperlinkIndex: 'id' },
        id: { isHyperLinkColumn: true },
    };
    const userDateFormat = 'MM/DD/YYYY';
    const userTimezone = 'America/New_York';

    try {
        const tmpFile = path.join(os.tmpdir(), `tz-hyperlink-${Date.now()}.xlsx`);
        await toExcel({ rows, columns, userDateFormat, userTimezone, filePath: tmpFile });
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.readFile(tmpFile);
        fs.unlinkSync(tmpFile);
        const cell = wb.worksheets[0].getRow(2).getCell(1);
        const cellVal = cell.value;
        const displayText = typeof cellVal === 'object' ? cellVal.text : cellVal;
        const expected = dayjs.utc(UTC_TIMESTAMP).tz(userTimezone).format(userDateFormat + ' hh:mm:ss A');
        test('Hyperlink localize display text matches userTimezone conversion', displayText === expected, `expected "${expected}", got "${displayText}"`);
        test('Hyperlink cell has hyperlink property set', typeof cellVal === 'object' && !!cellVal.hyperlink);
    } catch (err) {
        test('Hyperlink localize display text matches userTimezone conversion', false, err.message);
        test('Hyperlink cell has hyperlink property set', false);
    }
})();

// ── Fix 5: numFmt not applied for localized columns ───────────────────────
await (async () => {
    console.log('\n--- Fix 5: numFmt skipped for localized columns ---');
    const rows = [{ ts: new Date(UTC_TIMESTAMP) }];
    const columnsLocalized = { ts: { title: 'Timestamp', valueType: 'dateTime', localize: true } };
    const columnsNotLocalized = { ts: { title: 'Timestamp', valueType: 'dateTime' } };
    const userDateFormat = 'MM/DD/YYYY';
    const userTimezone = 'America/New_York';

    try {
        const tmpLocalized = path.join(os.tmpdir(), `tz-numfmt-localized-${Date.now()}.xlsx`);
        const tmpNotLocalized = path.join(os.tmpdir(), `tz-numfmt-normal-${Date.now()}.xlsx`);
        await toExcel({ rows, columns: columnsLocalized, userDateFormat, userTimezone, filePath: tmpLocalized });
        await toExcel({ rows, columns: columnsNotLocalized, userDateFormat, filePath: tmpNotLocalized });
        const wbLoc = new ExcelJS.Workbook();
        await wbLoc.xlsx.readFile(tmpLocalized);
        const wbNorm = new ExcelJS.Workbook();
        await wbNorm.xlsx.readFile(tmpNotLocalized);
        fs.unlinkSync(tmpLocalized);
        fs.unlinkSync(tmpNotLocalized);

        // Localized: cell value should be a string (pre-formatted)
        const localizedCell = wbLoc.worksheets[0].getRow(2).getCell(1);
        test('Localized column cell value is a string (not a Date)', typeof localizedCell.value === 'string');

        // Non-localized: cell value should remain a Date object (Excel handles format via numFmt)
        const normalCell = wbNorm.worksheets[0].getRow(2).getCell(1);
        test('Non-localized column cell value is a Date', normalCell.value instanceof Date);
    } catch (err) {
        test('Localized column cell value is a string (not a Date)', false, err.message);
        test('Non-localized column cell value is a Date', false);
    }
})();

// ── Fix 6: render() and reports.execute() accept userTimezone/userDateFormat ─
await (async () => {
    console.log('\n--- Fix 6: render() / reports.execute() thread userTimezone ---');
    const { render, reports } = await import('../lib/reports.mjs');

    // Test render() with toFile=false (just checks it doesn't crash)
    try {
        await render({ title: 'test', rows: [{ ts: new Date(UTC_TIMESTAMP) }], toFile: false, columns: {}, userDateFormat: 'MM/DD/YYYY', userTimezone: 'America/New_York' });
        test('render() accepts userDateFormat and userTimezone without crash', true);
    } catch (err) {
        test('render() accepts userDateFormat and userTimezone without crash', false, err.message);
    }

    // Test reports.execute() threads through userTimezone/userDateFormat
    try {
        class TzReport {
            title = 'TzTestReport';
            reportType = 'csv';
            columns = { ts: { title: 'Timestamp' } };
            async execute() { return [{ ts: UTC_TIMESTAMP }]; }
        }
        const result = await reports.execute({ ReportType: TzReport, options: { userDateFormat: 'MM/DD/YYYY', userTimezone: 'America/New_York' } });
        test('reports.execute() with userTimezone/userDateFormat returns success', result.success === true);
        if (result.filePath) { try { fs.unlinkSync(result.filePath); } catch { /* ignore */ } }
    } catch (err) {
        test('reports.execute() with userTimezone/userDateFormat returns success', false, err.message);
    }
})();

// ── Summary ───────────────────────────────────────────────────────────────
console.log('\n' + '='.repeat(60));
console.log('SUMMARY');
console.log('='.repeat(60));
console.log(`✓ Passed: ${passed}`);
console.log(`✗ Failed: ${failed}`);
console.log('='.repeat(60));
if (failed > 0) {
    console.log('\n❌ Some tests failed!');
    process.exit(1);
} else {
    console.log('\n✅ All tests passed!');
    process.exit(0);
}
