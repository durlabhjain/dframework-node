import ExcelJS from 'exceljs';
import fse from "fs-extra";
import { Readable } from 'stream';
import logger from './logger.js';
import dayjs from 'dayjs';
import { util } from '../index.js';
const { reportDatesFormat, reportTypes, dateTimeExcelExportFormat, dateTimeExcelRowExportFormat } = util;

const sheetName = /[^\w\s-]/gi;
const tableNameRegex = /[^\w]/gi
const defaultFileType = reportTypes?.excel;
/**
 * 
 * @param {Object} configuration
 * @param {string} configuration.title - Report title if single sheet
 * @param {string} configuration.rows - Array of rows
 * @param {string} configuration.columns - Array of columns
 * @param {string} configuration.stream - If excel should be written to the stream instead of file name with title
 * @param {string} configuration.sheets - Array containing title, rows, columns - for multiple sheets
 * @param {string} configuration.fileName - Optional fileName (not required if stream is used)
 */
const toExcel = async function ({ title, rows, columns, stream, sheets, fileName, exportColumns = false, userDateFormat }) {
    const workbook = new ExcelJS.Workbook();
    if (!sheets) {
        sheets = [{ title, rows, columns }];
    }
    for (const sheetDetail of sheets) {
        await writeExcelSheet({ title, ...sheetDetail, workbook, exportColumns, userDateFormat });
    }
    if (stream) {
        await workbook.xlsx.write(stream);
    } else {
        fileName = fileName || `./${title}.xlsx`;
        await workbook.xlsx.writeFile(fileName);
        return fileName;
    }
}
function getTableOrSheetName({ name, workbook, isSheetName = true }) {
    if (!workbook) {
        return name;
    }
    const existingTableNames = [];
    workbook._worksheets.forEach(sheet => {
        const names = isSheetName ? [sheet.name] : Object.keys(sheet.tables)
        existingTableNames.push(...names);
    });

    let suffix = 0;
    if (existingTableNames.includes(name)) {
        while (existingTableNames.includes(`${name}${++suffix}`)) {
            /* empty */
        }
        name = `${name}${++suffix}`;
    }
    return name;
}
const operations = { "Mul": "*", "Add": "+", "Sub": "-", "Div": "/" };
const writeExcelSheet = function ({ title = "main", rows, columns, name, workbook, tableName, exportColumns = false, userDateFormat }) {
    workbook = workbook || new ExcelJS.Workbook();
    name = name || title.replace(sheetName, '');
    name = getTableOrSheetName({ name, workbook })
    const worksheet = workbook.addWorksheet(name);
    if (!tableName) {
        tableName = 'table' + name.replace(tableNameRegex, '');
    }
    tableName = getTableOrSheetName({ name: tableName, workbook, isSheetName: false });
    const excelColumns = [];
    const firstRow = rows[0] || {};
    const keys = Object.keys(exportColumns ? columns : firstRow);
    const columnsForExport = exportColumns ? firstRow : columns;
    if (keys?.length === 0) {
        for (const column in columnsForExport) {
            if (!keys.includes(column)) {
                keys.push(column);
            }
        }
    }
    const colFormats = [];
    const rowsWithDateFields = {}
    let index = 0;
    for (const key of keys) {
        index++;
        const colConfig = columns[key];
        let name = key;
        if (colConfig) {
            // eslint-disable-next-line no-unused-vars
            const { title: colTitle, callback, ...others } = colConfig;
            name = colTitle || name;
            if (Object.keys(others).length > 0) {
                if (['date', 'datetime', 'dateTime', 'dateTimeLocal'].includes(others.valueType)) {
                    others.numFmt = others.valueType === 'date' ? userDateFormat : userDateFormat + dateTimeExcelExportFormat;
                    rowsWithDateFields[others.name] = others.valueType === 'date' ? userDateFormat : userDateFormat + dateTimeExcelRowExportFormat;
                }
                colFormats.push({ ...others, index });
            }
        }
        excelColumns.push({ name: name, filterButton: rows.length > 0, width: 200, ...columns[key] });
    }

    const tableRows = [];
    for (const row of rows) {
        const rowData = [];
        for (const key of keys) {
            if (Object.keys(rowsWithDateFields).includes(key) && row[key]) {
                const format = rowsWithDateFields[key]
                row[key] = dayjs(row[key]).format(format)
            }
            rowData.push(row[key] ?? null);
        }
        tableRows.push(rowData);
    }

    worksheet.addTable({
        name: tableName,
        ref: "A1",
        headerRow: true,
        style: {
            showRowStripes: true,
        },
        columns: excelColumns,
        rows: tableRows?.length > 0 ? tableRows : [['']]
    });

    for (const [colNumber, key] of keys.entries()) {
        // const callback = columns[key]?.callback;
        const formula = columns[key]?.formula;
        // if (callback) {
        //     for (const [rowNumber, rowData] of rows.entries()) {
        //         await callback({ workbook, worksheet, colNumber: 1 + colNumber, rowNumber: 2 + rowNumber, rowData, length: tableRows.length });
        //     }
        // }
        if (formula) {
            const { columns: col = [] } = formula;
            if (!operations[formula?.type]) continue;
            const selectedColumn = 1 + colNumber;
            const columnNumbers = col.map((k) => keys.findIndex((v) => v === k)).filter((v) => v != -1);
            if (columnNumbers.length != col.length) continue;
            for (const [rowNumber] of rows.entries()) {
                const formulas = [];
                const selectedRow = 2 + rowNumber;
                for (const index of columnNumbers) {
                    formulas.push(worksheet.getCell(selectedRow, (index + 1))?.address)
                }
                worksheet.getCell(selectedRow, selectedColumn).value = {
                    formula: formulas.join(operations[formula?.type]),
                }
            }
        }
    }

    for (const colFormat of colFormats) {
        const { index: colIndex, ...others } = colFormat;
        const column = worksheet.getColumn(colIndex);
        Object.assign(column, others);
    }
};

const format = {
    date: (value) => {
        if (!value) {
            return null;
        }
        return dayjs(value).toISOString().split("T")[0]
    }
}
const toTextFile = async ({ title = "main", rows, stream, settings, reportType = reportTypes.csv }) => {
    let textFile;
    const isJson = reportType === reportTypes.json, keysOrder = Object.keys(settings.columns);
    if (!isJson) {
        textFile = '';
        const { useHeader = false, delimiter = "|", columns = {} } = settings || {};
        if (Object.keys(columns)?.length) {
            //filter columns
            for (const item of rows) {
                for (const key in item) {
                    if (columns[key]) continue;
                    delete item[key]
                }
            }
            for (const item of rows) {
                for (const key in item) {
                    const { format: formatKey } = columns[key];
                    const formatValue = format[formatKey];
                    if (typeof formatValue === "function") {
                        item[key] = formatValue(item[key])
                    }
                }
            }

        }
        if (useHeader && rows.length) {
            textFile += `${Object.keys(rows[0]).join(delimiter)}`;
        }
        for (const [index, row] of rows.entries()) {
            const orderedVal = []
            for (const key of keysOrder) {
                orderedVal.push(row[key])
            }
            const newLine = !textFile && index === 0 ? "" : "\n";
            textFile += `${newLine}${Object.values(orderedVal).join(delimiter)}`;
        }
    }

    if (stream) {
        const readable = new Readable();
        readable.push(textFile.toString());
        readable.push(null) //end of stream
        readable.pipe(stream);
        return;
    }
    if (isJson) {
        await fse.writeJSON(`./${title}.${reportType}`, rows);
        return;
    }
    await fse.writeFile(`./${title}.${reportType}`, textFile)
}
//TODO: Add handler for JSON and txt files
const handlers = {
    [reportTypes?.excel]: toExcel,
    [reportTypes?.csv]: toTextFile,
    [reportTypes?.text]: toTextFile,
    [reportTypes?.json]: toTextFile
}

const render = async function ({ reportName, title, rows, toFile, columns, sheets, reportType = defaultFileType, settings }) {
    if (rows === 0) {
        logger.info("No records found");
        return;
    }
    if (toFile) {
        const reportHandler = handlers[reportType];
        if (typeof reportHandler !== "function") {
            logger.error(`handler not defined for ${reportType}`)
            return;
        }
        await reportHandler({ reportName, title, rows, columns, sheets, settings, reportType });

        return;
    }
    console.table(rows);
}

const reports = {
    execute: async function ({ ReportType, options }) {
        const report = new ReportType();
        let sheets;
        const rows = await report.execute(options);
        if (!rows || !rows?.length) {
            return { success: false }
        }
        const reportType = report.reportType || defaultFileType;
        if (report.hasMultipleSheets) {
            sheets = rows;
        }
        let columns = report.columns;

        if (typeof columns === 'function') {
            columns = report.columns();
        } else if (!columns) {
            columns = {};
        }

        if (report.title.includes('{ExtractionDate}')) {
            report.title = report.title.replace('{ExtractionDate}', dayjs().format(reportDatesFormat.dateFileName))
        }

        await render({ title: report.title, rows, toFile: true, columns, sheets, reportType, settings: report.reportSettings || {} });
        return { title: report.title, file: `${report.title}.${reportType}`, tags: report.tags || null, success: true };
    }
};

export {
    reports,
    toExcel
}