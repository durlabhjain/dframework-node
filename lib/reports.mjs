import ExcelJS from 'exceljs';
import fse from "fs-extra";
import path from 'path';
import { Readable } from 'stream';
import logger from './logger.js';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import util from './util.js';
dayjs.extend(utc);

const { reportDatesFormat, reportTypes, dateTimeExcelExportFormat } = util;

const sheetName = /[^\w\s-]/gi;
const tableNameRegex = /[^\w]/gi
const defaultFileType = reportTypes?.excel;

const resolveFilePath = ({filePath, title, outputPath, extension}) => {
    if (filePath) {
        return filePath;
    }
    // Sanitize title to a safe basename to prevent path traversal
    const safeTitle = util.sanitizeFilename(title || 'report') || 'report';
    return path.join(outputPath, `${safeTitle}.${extension}`);
}

/**
 * 
 * @param {Object} configuration
 * @param {string} configuration.title - Report title if single sheet
 * @param {string} configuration.rows - Array of rows
 * @param {string} configuration.columns - Array of columns
 * @param {string} configuration.stream - If excel should be written to the stream instead of file name with title
 * @param {string} configuration.sheets - Array containing title, rows, columns - for multiple sheets
 * @param {string} configuration.filePath - Optional full file path with extension
 * @param {string} configuration.fileName - Deprecated. Use filePath instead.
 * @param {string} configuration.outputPath - Output folder (default: '.'). Used only when filePath is not provided.
 */
const toExcel = async function ({ title, rows, columns, stream, sheets, filePath, fileName, exportColumns = false, userDateFormat, outputPath = '.' }) {
    // fileName is deprecated; use filePath instead
    filePath = filePath || fileName;
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
        filePath = resolveFilePath({ filePath, title, outputPath, extension: 'xlsx' });
        await workbook.xlsx.writeFile(filePath);
        return filePath;
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
    const keys = Object.keys(exportColumns ? columns : firstRow).filter(key => !columns[key]?.isHyperLinkColumn);
    const columnsForExport = exportColumns ? firstRow : columns;
    if (keys?.length === 0) {
        for (const column in columnsForExport) {
            if (!keys.includes(column)) {
                keys.push(column);
            }
        }
    }
    const colFormats = [];
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
                if (['date', 'dateTime'].includes(others.valueType)) {
                    const format = others.valueType === 'date' ? userDateFormat : userDateFormat + dateTimeExcelExportFormat;
                    others.numFmt = format;
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
            let value = row[key] ?? null;
            const colConfig = columns[key];
            if (value !== null && !(value instanceof Date) && colConfig && ['date', 'dateTime'].includes(colConfig.valueType)) {
                const parsed = colConfig.valueType === 'date' ? dayjs(value) : dayjs.utc(value);
                if (parsed.isValid()) {
                    value = parsed.toDate();
                }
            }
            rowData.push(value);
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
        const { hyperlinkURL, hyperlinkIndex } = columns[key] || {};
        // if (callback) {
        //     for (const [rowNumber, rowData] of rows.entries()) {
        //         await callback({ workbook, worksheet, colNumber: 1 + colNumber, rowNumber: 2 + rowNumber, rowData, length: tableRows.length });
        //     }
        // }
        if (hyperlinkURL && hyperlinkIndex) {
            for (const [rowNumber] of rows.entries()) {
                const cellValue = tableRows[rowNumber]?.[colNumber];
                if (cellValue === null || cellValue === undefined || cellValue === '') continue;
                const sourceRow = rows[rowNumber];
                const indexValue = sourceRow?.[hyperlinkIndex];
                if (indexValue === null || indexValue === undefined) continue;
                const url = hyperlinkURL.replace('{0}', String(indexValue));
                const cell = worksheet.getCell(2 + rowNumber, 1 + colNumber);
                const displayText = String(cellValue);
                cell.value = { formula: `HYPERLINK("${url.replace(/"/g, '""')}","${displayText.replace(/"/g, '""')}")` };
                cell.font = { color: { argb: 'FF0000FF' }, underline: true };
            }
        }
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
const toTextFile = async ({ title = "main", rows, stream, settings, reportType = reportTypes.csv, filePath, outputPath = '.' }) => {
    let textFile;
    const isJson = reportType === reportTypes.json;
    if (!isJson) {
        const keysOrder = Object.keys(settings?.columns ?? {});
        const effectiveKeysOrder = keysOrder.length > 0 ? keysOrder : Object.keys(rows[0] ?? {});
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
            textFile += `${effectiveKeysOrder.join(delimiter)}`;
        }
        for (const [index, row] of rows.entries()) {
            const orderedVal = []
            for (const key of effectiveKeysOrder) {
                orderedVal.push(row[key])
            }
            const newLine = !textFile && index === 0 ? "" : "\n";
            textFile += `${newLine}${Object.values(orderedVal).join(delimiter)}`;
        }
    }

    if (stream) {
        const readable = new Readable();
        readable.push(isJson ? JSON.stringify(rows) : textFile.toString());
        readable.push(null) //end of stream
        readable.pipe(stream);
        return;
    }
    filePath = resolveFilePath({ filePath, title, outputPath, extension: reportType });
    if (isJson) {
        await fse.writeJSON(filePath, rows);
    } else {
        await fse.writeFile(filePath, textFile);
    }
    return filePath;
}

const handlers = {
    [reportTypes?.excel]: toExcel,
    [reportTypes?.csv]: toTextFile,
    [reportTypes?.text]: toTextFile,
    [reportTypes?.json]: toTextFile
}

const render = async function ({ reportName, title, rows, toFile, columns, sheets, reportType = defaultFileType, settings, exportColumns, outputPath = '.', logger: customLogger }) {
    const log = customLogger || logger;
    if (!rows || rows.length === 0) {
        log.info("No records found");
        return;
    }
    if (toFile) {
        const reportHandler = handlers[reportType];
        if (typeof reportHandler !== "function") {
            log.error({
                reportType,
                availableHandlers: Object.keys(handlers),
                reportName,
                title
            }, `Report handler not defined for type: ${reportType}`);
            return;
        }
        return reportHandler({ reportName, title, rows, columns, sheets, settings, reportType, exportColumns, outputPath });
    }
    // Display in console for debugging - use logger.debug for structured output
    log.debug({ rowCount: rows.length, reportName, title }, 'Report data generated');
}

const reports = {
    execute: async function ({ ReportType, options = {} }) {
        const report = new ReportType();
        // Set logger on report instance if provided (for reports that extend ReportBase)
        if (options.logger) {
            report.logger = options.logger;
        }
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

        const customLogger = options.logger || logger;
        if (options.reportFolder) {
            customLogger.warn('`options.reportFolder` is deprecated and will be removed in a future release. Please use `options.outputPath` instead.');
        }
        const outputPath = options.outputPath || options.reportFolder || '.';
        const filePath = await render({ title: report.title, rows, toFile: true, columns, sheets, reportType, settings: report.reportSettings || {}, exportColumns: report.exportColumns || false, outputPath, logger: customLogger });
        const fileName = path.basename(filePath);
        return { title: report.title, filePath, file: fileName, tags: report.tags || null, success: true };
    }
};

export {
    reports,
    render,
    toExcel
}