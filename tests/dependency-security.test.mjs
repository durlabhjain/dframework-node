import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import responseTransformer from '../lib/middleware/response-transformer.mjs';
import { CryptoProvider } from '@azure/msal-node';

test('MSAL keeps generating GUIDs with the patched CommonJS-compatible UUID package', () => {
    assert.match(new CryptoProvider().createNewGuid(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
});

test('actual CSV response preserves numeric values and escapes spreadsheet formulas', async () => {
    const headers = {};
    let output;
    const res = { set(name, value) { headers[name] = value; return this; }, send(value) { output = value; } };
    let nextCalled = false;
    await responseTransformer({ path: '/fixture' }, res, () => { nextCalled = true; });
    assert.equal(nextCalled, true);
    await res.transform({ success: true, data: [{ Name: 'A, "quoted" outlet', Count: -42, Notes: '=1+1' }] }, { responseType: 'csv' });
    assert.equal(headers['Content-Type'], 'text/csv');
    assert.match(output, /"A, ""quoted"" outlet"/);
    assert.match(output, /,-42,'=1\+1/);
});

test('patched ExcelJS transitive dependencies retain XLSX comments and values', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Fixture');
    sheet.addRow(['Outlet', 42]);
    sheet.getCell('A1').note = 'Note';
    const restored = new ExcelJS.Workbook();
    await restored.xlsx.load(await workbook.xlsx.writeBuffer());
    assert.equal(restored.getWorksheet('Fixture').getCell('B1').value, 42);
    assert.equal(restored.getWorksheet('Fixture').getCell('A1').note, 'Note');
});
