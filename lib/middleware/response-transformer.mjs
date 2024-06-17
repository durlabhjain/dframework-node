import ObjectsToCsv from 'objects-to-csv';
import { toExcel } from '../reports.mjs';
import js2xmlparser from 'js2xmlparser';
import dateFormat from 'dateformat';
import dayjs from 'dayjs';
import { util } from '../../index.js';

const escapeHTML = str => typeof str === 'string' ? str.replace(/[&<>'"]/g,
    tag => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;'
    }[tag])) : str;

const toHtmlTable = (rows, columns, summaryRow, exportColumns, isCustomExport) => {
    if (!rows) {
        return '';
    }
    rows = ensureArray(rows);
    if (rows.length === 0) {
        return;
    }
    if (!columns) {
        const keys = Object.keys(isCustomExport ? exportColumns : rows[0]);
        columns = [];
        for (const dataKey of keys) {
            columns.push({ dataKey, title: isCustomExport ? exportColumns[dataKey]?.name : dataKey });
        }
    }

    if (!summaryRow) {
        const hasSummary = columns.some(column => column.summary);
        if (hasSummary) {
            summaryRow = {};
            columns.forEach(column => {
                const { summary } = column;
                if (!summary) return;
                const key = column.dataKey || column.id;
                if (typeof summary === 'function') {
                    summaryRow[key] = rows.reduce(summary(key), 0);
                } else if (summary === 'sum') {
                    summaryRow[key] = rows.reduce((total, row) => total + (typeof row[key] === 'number' ? row[key] : 0), 0);
                } else if (summary === 'first') {
                    summaryRow[key] = rows.length > 0 ? rows[0][key] : '';
                } else if (summary === 'last') {
                    summaryRow[key] = rows.length > 0 ? rows[rows.length - 1][key] : '';
                } else {
                    summaryRow[key] = summary;
                }
            });
        }
    }

    const tableRows = [];
    let row = [];
    let rowClass = '';

    for (const column of columns) {
        row.push(column.type === 'number' ? `<col class="table-number">` : `<col>`);
    }
    tableRows.push("<colgroup>" + row.join('') + "</colgroup>");

    row = [];
    for (const column of columns) {
        row.push(escapeHTML(column.title || column.dataKey));
    }
    tableRows.push("<thead><tr><th>" + row.join("</th><th>") + "</th></tr></thead>");
    for (const item of rows) {
        row = [];
        for (const { dataKey, formatter, type, rowStyle } of columns) {
            let v = item[dataKey];
            if (formatter) {
                v = formatter(v, item);
            }
            if (rowStyle) {
                rowClass = rowStyle(v, item);
            }
            const tdClass = type === 'number' ? 'table-number' : '';
            row.push((tdClass ? `<td class=${tdClass}>` : '<td>') + (v === undefined || v === null ? '' : escapeHTML(v)) + '</td>');
        }
        tableRows.push(`<tr style="${rowClass}">` + row.join("") + "</tr>");
    }

    if (summaryRow) {
        row = [];
        for (const { dataKey, formatter, type } of columns) {
            let v = summaryRow[dataKey];
            if (formatter) {
                v = formatter(v, summaryRow, { summary: true });
            }
            const tdClass = type === 'number' ? 'table-number' : '';
            row.push((tdClass ? `<td class=${tdClass}>` : '<td>') + (v === undefined || v === null ? '' : escapeHTML(v)) + '</td>');
        }
        tableRows.push("<tfoot><tr>" + row.join("") + "</tr></tfoot>");
    }
    return "<table border='1'>" + tableRows.join("") + "</table>";
}

export { toHtmlTable };

const mimeTypes = {
    json: 'application/json',
    csv: 'text/csv',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    txt: 'text/plain',
    xml: 'text/xml',
    html: 'text/html'
};

const ensureArray = function (data) {
    if (!Array.isArray(data)) {
        return [data];
    }
    return data;
}

const formatDateTime = function ({ value, format }) {
    if (!value) {
        return '';
    }
    const langL = 'en';
    const dateShow = ((typeof value === 'string') && value.includes('T')) ? dayjs(value).locale(langL).utc().format(format) : dayjs(value).locale(langL).format(format);
    return dateShow;
}

const updateKeys = function ({ data, keyMapping, columns, isForXML = false, userDateFormat, userDateTimeFormat, userTimezoneOffset, lookups, lookupFields = {} }) {
    if (!data || !Array.isArray(data) || data.length === 0) {
        return [];
    }

    const updatedObject = data.map(record => {
        const updatedRecord = {};

        for (const ele of Object.keys(keyMapping)) {
            const keyName = isForXML ? ele : keyMapping[ele];
            const { valueType, keepUTC = false } = columns[ele];

            let value = record[ele];

            const isParsable = columns[ele]?.isParsable !== false ? true : columns[ele]?.isParsable;

            if (util.dateTimeFields.includes(valueType)) {
                if (value !== null && value !== undefined) {
                    value = dayjs.utc(value);
                    if (userTimezoneOffset && !keepUTC) {
                        value = dayjs.utc(value).add(Number(userTimezoneOffset), 'minute')
                    }
                    value = formatDateTime({ value, format: valueType === 'date' ? userDateFormat : userDateTimeFormat });
                } else {
                    value = '';
                }
            } else if (valueType === 'boolean') {
                value = value === true || value === 1 ? 'Yes' : 'No';
            } else if (valueType === 'number' && isParsable) {
                value = value !== null ? parseInt(value) : '';
            }

            for (const field in lookupFields) {
                if (Object.hasOwn(lookupFields, field)) {
                    const lookupKeyName = lookupFields[field].keyName;
                    if (lookupKeyName.includes(keyName)) {
                        const lookupValue = lookupFields[field].lookupKey;
                        const indexValue = lookups[lookupValue].findIndex(e => e.value === value);
                        if (indexValue > -1) {
                            value = lookups[lookupValue][indexValue].label;
                        }
                    }
                }
            }

            updatedRecord[keyName] = value;
        }

        return updatedRecord;
    });

    return updatedObject;
}

const acceptableMimeTypes = Object.entries(mimeTypes).map(([, value]) => value);

const updateLookups = ({ data }) => {
    if (Array.isArray(data)) {
        data.forEach(item => {
            if (item.FrequencyType !== undefined) {
                item.FrequencyType = util.getFrequencyType(item.FrequencyType);
            }
            if (item.Priority !== undefined) {
                item.Priority = util.getPriority(item.Priority);
            }
            if (item.DefinedDays !== undefined) {
                item.DefinedDays = util.getSelectedDays(item.DefinedDays);
            }
        });
    }
};

const responseTransformer = async function (req, res, next) {
    res.transform = async function ({ success, ...others }, { responseType, fileName, data: dataField = "data" } = {}) {
        let data = null;
        let dataArr = others?.dataField;
        if (!dataArr) {
            dataArr = [dataField];
        }
        for (const dataFieldKey of dataArr) {
            data = success === true ? others[dataFieldKey] : null;
            if (!success) {
                return res.status(400).json({ success: false, message: data });
            }

            const exportColumns = others?.exportColumns, userDateFormat = others?.userDateFormat, isElastic = others?.isElastic, userTimezoneOffset = others?.userTimezoneOffset;
            const dateTimeFormat = userDateFormat + util.dateTimeExportFormat
            const lookups = others?.lookups;
            const lookupFields = others?.lookupFields;
            fileName = `${!fileName ? req.path.substr(1).replace(util.fileNameRegex, '-') : fileName}-${dateFormat(new Date(), "isoDateTime").replace(/:/g, '')}`;

            if (data !== undefined && data !== null && typeof data === 'object') {
                if (!responseType) {
                    responseType = req.accepts(acceptableMimeTypes) || 'application/json';
                }
            }
            if (responseType?.indexOf('/') === -1) {
                responseType = mimeTypes[responseType];
            }
            let columns = {};
            const columnKeyMappings = {};
            for (const key in exportColumns) {
                const exportColumn = exportColumns[key];

                const commonProperties = { width: exportColumn.width / util.excelColumnWidthEnum, name: exportColumn.headerName, valueType: exportColumn.type, keepUTC: exportColumn.keepUTC, isParsable: exportColumn.isParsable };

                columns[key] = { ...commonProperties };

                if (isElastic) {
                    columnKeyMappings[exportColumn.field] = exportColumn.headerName;
                } else if (data.columns[key]?.name) {
                    const dataColumn = data.columns[key];
                    columns[key] = { ...commonProperties, ...dataColumn, name: exportColumn.headerName };
                    columnKeyMappings[dataColumn.name] = exportColumn.headerName;
                }
            }

            if (Object.keys(columns)?.length === 0) {
                columns = data.columns || {};
            }
            let jsonResponse = others;
            const isExportOperation = (typeof exportColumns === 'object' && Object.keys(exportColumns).length > 0);
            if (isExportOperation) {
                updateLookups({ data });
            }
            switch (responseType) {
                case mimeTypes.csv:
                    data = ensureArray(data);
                    if (data.length > 0) {
                        if (exportColumns && Object.keys(exportColumns)?.length > 0) {
                            data = updateKeys({ data, keyMapping: columnKeyMappings, columns, userDateFormat, userDateTimeFormat: dateTimeFormat, userTimezoneOffset, lookups, lookupFields });
                        }
                        const csv = new ObjectsToCsv(data);
                        res.set('Content-Type', responseType);
                        return res.send(await csv.toString())
                    }
                    break;
                case mimeTypes.json:
                    res.set('Content-Type', 'application/json');
                    if (exportColumns && Object.keys(exportColumns)?.length > 0) {
                        data = updateKeys({ data, keyMapping: columnKeyMappings, columns, userDateFormat, userDateTimeFormat: dateTimeFormat, userTimezoneOffset, lookups, lookupFields });
                        jsonResponse = data;
                    }
                    return Object.keys(others).length === 1 ? res.json(data) : res.json(jsonResponse);
                case mimeTypes.xlsx:
                    data = data.data || data;
                    data = ensureArray(data);
                    if (data.length > 0) {
                        if (exportColumns && Object.keys(exportColumns)?.length > 0) {
                            data = updateKeys({ data, keyMapping: columnKeyMappings, columns, isForXML: true, userDateFormat, userDateTimeFormat: dateTimeFormat, userTimezoneOffset, lookups, lookupFields });
                        }
                        res.set('Content-Type', responseType);
                        res.set('Content-Disposition', `attachment; filename="${fileName}.xlsx"`);
                        return await toExcel({ title: "Main", columns, rows: data, stream: res, exportColumns: true, userDateFormat, userDateTimeFormat: dateTimeFormat, userTimezoneOffset, lookups, lookupFields });
                    }
                    break;
                case mimeTypes.txt:
                    break;
                case mimeTypes.xml:
                    res.set('Content-Type', 'text/xml');
                    if (exportColumns && Object.keys(exportColumns)?.length > 0) {
                        data = updateKeys({ data, keyMapping: columnKeyMappings, columns, isForXML: true, userDateFormat, userDateTimeFormat: dateTimeFormat, userTimezoneOffset, lookups, lookupFields });
                    }
                    return res.send(js2xmlparser.parse("root", data));
                case mimeTypes.html:
                    data = ensureArray(data);
                    if (data.length > 0) {
                        if (exportColumns && Object.keys(exportColumns)?.length > 0) {
                            data = updateKeys({ data, keyMapping: columnKeyMappings, columns, isForXML: true, userDateFormat, userDateTimeFormat: dateTimeFormat, userTimezoneOffset, lookups, lookupFields });
                        }
                        return res.send(toHtmlTable(data, undefined, undefined, columns, true));
                    }
                    break;
                default:
                    return res.send(data);
            }
        }
        return res.send('No data!, for the selected operation');
    }
    next();
};

export default responseTransformer;