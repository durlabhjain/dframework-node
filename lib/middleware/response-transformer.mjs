import ObjectsToCsv from 'objects-to-csv';
import { toExcel } from '../reports.mjs';
import js2xmlparser from 'js2xmlparser';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import util from '../util.js';
import enums from '../enums.mjs';

dayjs.extend(utc);

const escapeHTML = str => typeof str === 'string' ? str.replace(/[&<>'"]/g,
    tag => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;'
    }[tag])) : str;

/**
 * Renders a single table cell (<td>) as an HTML string, applying optional formatting, styling, and rowspan.
 *
 * @param {Object} params - The parameters object.
 * @param {*} params.value - The value to display in the cell.
 * @param {Object} params.item - The full data row the cell belongs to.
 * @param {Object} params.column - Column definition containing optional formatter, type, rowStyle, colStyle, escapeHTMLTags, and colClass.
 * @param {number} [params.rowspan] - Optional rowspan for merged cells.
 * @returns {Object} An object containing:
 *   - {string} rowClass - Row-level CSS style returned from column.rowStyle (if any).
 *   - {string} html - The final <td> HTML string with applied styles, classes, formatter, and optional rowspan.
 */
const renderCell = ({ value, item, column, rowspan }) => {
    const { formatter, type, rowStyle, colStyle, escapeHTMLTags = true, colClass: colClassFn } = column;

    let v = value;
    let rowClass = '';
    let colClass = '';

    // Apply formatter first to ensure consistent display
    if (formatter) {
        v = formatter(v, item);
    }

    // Apply row and column styles
    if (rowStyle) {
        rowClass = rowStyle(v, item);
    }
    if (colStyle) {
        colClass = colStyle(v, item);
    }

    const tdClass = type === 'number' ? 'table-number' : (colClassFn ? colClassFn(v, item) : '');
    const cellValue = v === undefined || v === null ? '' : (!escapeHTMLTags ? v : escapeHTML(v));

    // Build the final <td> HTML with optional rowspan
    const html = `<td${tdClass ? ` class="${tdClass}"` : ''}` + `${colClass ? ` style="${colClass}"` : ''}` + `${rowspan ? ` rowspan="${rowspan}"` : ''}>${cellValue}</td>`;

    return { rowClass, html };
};

/**
 * Converts data rows to an HTML table.
 *
 * @param {Object} params - The parameters object.
 * @param {Array} params.rows - The data rows to display.
 * @param {Array} [params.columns] - The column definitions.
 * @param {Object} [params.summaryRow] - Optional summary row.
 * @param {Object} [params.exportColumns] - Optional export column definitions.
 * @param {boolean} [params.isCustomExport] - Whether to use custom export columns.
 * @param {string} [params.tableRowHeaderStyle='background-color: #4a5568; color: white;'] - CSS style string applied to table row headers. Default is dark gray background with white text.
 * @param {boolean} [params.showTableBorder=true] - Whether to show table borders. Default is true.
 * @param {string} [params.groupByKey=null] - When set, rows with the same value for this key will be grouped together, and columns specified in rowspanColumns will use rowspan to merge cells across the group.
 * @param {Array} [params.rowspanColumns=null] - Array of column dataKeys that should use rowspan when grouping.
 * @returns {string} HTML table as a string.
 */
const toHtmlTable = ({ rows, columns, summaryRow, exportColumns, isCustomExport, tableRowHeaderStyle = 'background-color: #4a5568; color: white;', showTableBorder = true, groupByKey = null, rowspanColumns = null }) => {
    if (!rows) {
        return '';
    }
    rows = ensureArray(rows);
    if (rows.length === 0) {
        return;
    }
    if (!columns) {
        const keys = Object.keys(isCustomExport ? exportColumns : rows[0]).filter(key => !exportColumns[key]?.isHyperLinkColumn);
        columns = [];
        for (const dataKey of keys) {
            const { name: title = dataKey, ...others } = exportColumns[dataKey] || {};
            columns.push({ dataKey, title, ...others });
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
    let rowClass = '', colClass = '';

    for (const column of columns) {
        row.push(column.type === 'number' ? `<col class="table-number">` : `<col>`);
    }
    tableRows.push("<colgroup>" + row.join('') + "</colgroup>");

    row = [];
    for (const column of columns) {
        row.push(escapeHTML(column.title || column.dataKey));
    }
    tableRows.push(`<thead><tr style='${tableRowHeaderStyle}'><th>` + row.join("</th><th>") + "</th></tr></thead>");

    // Handle grouping with rowspan
    if (groupByKey && rowspanColumns) {
        const grouped = {};
        const groupOrder = [];

        rows.forEach((item, index) => {
            let key = item[groupByKey];
            if (key === null || key === undefined || key === '') {
                // Assign a unique placeholder for empty/null keys
                key = `__ungrouped__${index}`;
            }
            if (!grouped[key]) {
                grouped[key] = [];
                groupOrder.push(key);
            }
            grouped[key].push(item);
        });

        groupOrder.forEach(groupKey => {
            const groupItems = grouped[groupKey];

            groupItems.forEach((item, itemIndex) => {
                row = [];
                rowClass = '';

                for (const column of columns) {
                    const { dataKey } = column;
                    const isGroupedCol = rowspanColumns.includes(dataKey);
                    const isFirstRow = itemIndex === 0;

                    // Skip grouped columns for non-first rows
                    if (isGroupedCol && !isFirstRow) {
                        continue;
                    }

                    // Render the cell, applying rowspan if needed
                    const { rowClass: rClass, html } = renderCell({ value: item[dataKey], item, column, rowspan: isGroupedCol && groupItems.length > 1 ? groupItems.length : null });
                    if (!rowClass) {
                        rowClass = rClass;
                    }
                    row.push(html);
                }

                tableRows.push(`<tr style="${rowClass}">${row.join('')}</tr>`);
            });
        });
    } else {
        // Default behavior without grouping
        for (const item of rows) {
            row = [];
            rowClass = '';

            for (const column of columns) {
                const { rowClass: rClass, html } = renderCell({ value: item[column.dataKey], item, column });
                if (!rowClass) {
                    rowClass = rClass;
                }
                row.push(html);
            }

            tableRows.push(`<tr style="${rowClass}">${row.join('')}</tr>`);
        }
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
    return `<table style="font-family: Verdana, sans-serif; font-size: 12px;" ${showTableBorder ? "border='1'" : ""}> ${tableRows.join("")} </table>`;
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

const arrayResponseTypes = [mimeTypes.csv, mimeTypes.xlsx, mimeTypes.html];
const isForXMLResponseType = [mimeTypes.xlsx, mimeTypes.xml, mimeTypes.html];

const ensureArray = function (data) {
    if (!Array.isArray(data)) {
        return [data];
    }
    return data;
}

/**
 * Formats a date/time value based on the provided format and localization settings.
 *
 * @param {Object} params - The parameters for formatting.
 * @param {*} params.value - The date/time value to format.
 * @param {string} params.format - The dayjs format string.
 * @param {boolean} [params.localize=false] - Whether to apply the user's timezone offset.
 * @param {number} [params.userTimezoneOffset] - The user's timezone offset in minutes.
 * @returns {string} The formatted date/time string.
 */
const formatDateTime = function ({ value, format, localize = false, userTimezoneOffset }) {
    if (!value) {
        return '';
    }
    const langL = 'en';
    let d = dayjs.utc(value);
    if (localize) {
        if (userTimezoneOffset !== undefined && userTimezoneOffset !== null) {
            d = d.utcOffset(Number(userTimezoneOffset));
        } else {
            // Fallback to machine local if localization is requested but no offset is provided
            d = dayjs(value);
        }
    }
    return d.locale(langL).format(format);
}

/**
 * Transforms an array of data objects by updating their keys and formatting values based on provided mappings and options.
 *
 * @param {Object} params - The parameters for the transformation.
 * @param {Array<Object>} params.data - The array of data records to transform.
 * @param {Object} params.keyMapping - An object mapping original keys to new keys.
 * @param {Object} params.columns - An object describing each column's value type and options.
 * @param {boolean} [params.isForXML=false] - Whether to use XML key names.
 * @param {string} params.userDateFormat - The date format to use for date fields.
 * @param {string} params.userDateTimeFormat - The date-time format to use for date-time fields.
 * @param {number} params.userTimezoneOffset - The user's timezone offset in minutes.
 * @param {Object} params.lookups - Lookup objects for mapping values to labels.
 * @param {Object} [params.lookupFields={}] - Fields that require lookup transformation.
 * @returns {Array<Object>} The transformed array of data records with updated keys and formatted values.
 */
const updateKeys = function ({ data, keyMapping, columns, isForXML = false, userDateFormat, userDateTimeFormat, userTimezoneOffset, lookups, lookupFields = {} }) {
    if (!data || !Array.isArray(data) || data.length === 0) {
        return [];
    }

    const updatedObject = data.map(record => {
        const updatedRecord = {};

        for (const ele of Object.keys(keyMapping)) {
            if (columns[ele]) {
                const keyName = isForXML ? ele : keyMapping[ele];
                const { valueType, localize = false } = columns[ele];

                let value = record[ele];

                const isParsable = columns[ele]?.isParsable !== false ? true : columns[ele]?.isParsable;

                if (util.dateTimeFields.includes(valueType)) {
                    if (value !== null && value !== undefined) {
                        value = formatDateTime({ value, format: valueType === 'date' ? userDateFormat : userDateTimeFormat, localize, userTimezoneOffset });
                    } else {
                        value = '';
                    }
                } else if (valueType === 'boolean') {
                    value = value === true || value === 1 ? 'Yes' : 'No';
                } else if (valueType === 'number' && isParsable) {
                    value = value !== null ? parseInt(value) : '';
                } else if (valueType === 'percentage') {
                    value = util.percentageFormatter(value);
                }

                for (const field in lookupFields) {
                    const lookupKeyName = lookupFields[field].keyName;
                    const key = isForXML ? keyName : ele;
                    if (lookupKeyName.includes(key)) {
                        const lookupValue = lookupFields[field].lookupKey;
                        const indexValue = lookups[lookupValue]?.findIndex(e => e.value === value);
                        if (indexValue > -1) {
                            value = lookups[lookupValue][indexValue].label;
                        }
                    }
                }

                updatedRecord[keyName] = [undefined, null].includes(value) ? '' : value;
            }
        }

        return updatedRecord;
    });

    return updatedObject;
}

const acceptableMimeTypes = Object.entries(mimeTypes).map(([, value]) => value);

const updateLookups = ({ data, exportColumns, lookups = {} }) => {
    const columnsArray = Object.values(exportColumns);
    const newLookups = Object.fromEntries(
        Object.entries(lookups).map(([key, value]) => [key.toUpperCase(), value])
    );

    const lookupKeys = new Set(Object.keys(newLookups));
    // Create a map of columns that have matching headers in lookupKeys
    const headerToFieldMap = columnsArray
        .filter(column => lookupKeys.has(column.headerName.toUpperCase()) || (column.lookup && lookupKeys.has(column.lookup.toUpperCase())))
        .reduce((map, column) => {
            map[column.headerName.toUpperCase()] = column.field;
            if (column.lookup) {
                map[column.lookup.toUpperCase()] = column.field;
            }
            return map;
        }, {});

    // Iterate through data once and update values
    data.forEach(dataItem => {
        Object.entries(headerToFieldMap).forEach(([headerName, field]) => {
            const lookupItem = newLookups[headerName]?.find(
                item => item.value === dataItem[field]
            );
            if (lookupItem) {
                dataItem[field] = lookupItem.label;
            }
        });
    });

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

/**
 * Sanitizes and transforms an array of data records based on specified column definitions.
 *
 * @param {Object} params - Parameters for sanitizing the data.
 * @param {Array<Object>} params.data - The original array of data records to sanitize.
 * @param {Object} [params.columns={}] - An object defining the columns to retain and rename.
 * Each key is a field in the original data, and its value may contain a `name` property
 * to rename the field in the output.
 *
 * @returns {Array<Object>} - A new array of sanitized data records,
 * including only the specified fields with `null`, `undefined`, or falsy values replaced by an empty string.
 */
const sanitizeData = ({ data, columns = {}, responseType }) => {
    const fieldsToKeep = Object.keys(columns).filter(key => !columns[key]?.isHyperLinkColumn);

    if (!fieldsToKeep.length) return data;

    return data.map(record =>
        fieldsToKeep.reduce((acc, field) => {
            let name = columns[field]?.name || field;
            // Fallback logic: check both the original field and the renamed column name.
            // This handles cases where columns have been renamed and the original field name might not exist in the record.
            const value = record[field] ?? record[name];
            if (responseType === mimeTypes.xml) {
                // Ensure name is a string before calling replace
                name = (typeof name === 'string' ? name : String(name || field)).replace(/[^a-zA-Z0-9._-]/g, '');
            }
            acc[name] = !value ? '' : value;
            return acc;
        }, {})
    );
};

/**
 * Express middleware that attaches a `res.transform()` helper to the response object,
 * enabling format-aware data serialisation (JSON, CSV, XLSX, XML, HTML) from a single call site.
 *
 * ---
 * ## Workflow
 *
 * 1. **Attach helper** — adds `res.transform(result, options?)` to the response and calls `next()`.
 * 2. **Guard on success** — if `result.success` is `false`, immediately responds with HTTP 400
 *    `{ success: false, message }` and returns.
 * 3. **Resolve response type** — uses `options.responseType` when provided; otherwise negotiates
 *    via `req.accepts(...)` against the accepted MIME types (json/csv/xlsx/xml/html/txt).
 *    Short aliases (`"json"`, `"csv"`, `"xlsx"`, `"xml"`, `"html"`) are resolved to full MIME strings.
 * 4. **Detect export operation** — an export is active when `result.exportColumns` is a non-empty object.
 *    - Builds an internal `columns` map and `columnKeyMappings` (original field → header name).
 *    - Handles three data shapes: Elasticsearch (`isElastic`), DB response with `.columns` metadata,
 *      and plain arrays.
 *    - Registers hyperlink index columns as hidden `isHyperLinkColumn` entries.
 *    - Applies lookup replacement via `updateLookups`.
 *    - Normalises data to an array for array-based response types (CSV, XLSX, HTML).
 *    - Runs `updateKeys` on each sheet to rename fields and format date/dateTime/boolean/number/percentage values.
 * 5. **Hyperlink URL columns** — for non-XLSX exports, if a column declares `hyperlinkURL` + `hyperlinkIndex`,
 *    appends a `"<Header> - URL"` column whose value is `hyperlinkURL` with `{0}` replaced
 *    by the row's index-field value.
 * 6. **Sanitise filename** — strips unsafe characters from `options.fileName` (falls back to `req.path`,
 *    then `'export'`) and appends a full timestamp.
 * 7. **Serialise and respond** — switches on `responseType`:
 *    - `application/json` → sanitises data, sends JSON.
 *    - `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` → streams XLSX via `toExcel`.
 *    - `text/csv` → sanitises data, sends CSV attachment.
 *    - `text/xml` → sanitises data, sends XML via `js2xmlparser`.
 *    - `text/html` → renders an HTML `<table>` via `toHtmlTable`.
 *    - anything else → `res.send(data)`.
 *
 * ---
 * ## Middleware signature
 *
 * @param {import('express').Request}  req  - Express request (used for content negotiation and path-based filename).
 * @param {import('express').Response} res  - Express response; receives the `transform` method.
 * @param {import('express').NextFunction} next - Calls the next middleware in the chain.
 * @returns {void}
 *
 * ---
 * ## `res.transform(result, options?)` — the attached async method
 *
 * @param {Object}  result              - The data object returned by a controller or service.
 * @param {boolean} result.success      - `true` → proceed with transformation; `false` → HTTP 400.
 * @param {Array|Object} result[data]   - The payload to transform. The key is `options.data` (default `"data"`).
 *
 * @param {Object<string, ExportColumn>} [result.exportColumns]
 *   Map of source-field keys to column definitions. When non-empty, activates export mode.
 *   **ExportColumn shape:**
 *   ```js
 *   {
 *     headerName:    string,   // Column header / display name used in the output file.
 *     field:         string,   // Key in the source data record (used for Elastic / plain-array data).
 *     type:          string,   // Value type: 'date' | 'dateTime' | 'number' | 'boolean' | 'percentage'.
 *     width:         number,   // Column width (pixels); divided by excelColumnWidthEnum for XLSX.
 *     localize:      boolean,  // Apply user's timezone offset for this column when true.
 *     isParsable:    boolean,  // When false, skips parseInt for number-typed columns.
 *     hyperlinkURL:  string,   // URL template with a {0} placeholder, e.g. '/records/{0}'.
 *     hyperlinkIndex: string,  // Field key whose value is substituted into {0} in hyperlinkURL.
 *     lookup:        string,   // Optional lookup name; overrides headerName for lookup matching.
 *   }
 *   ```
 *
 * @param {string} [result.userDateFormat]
 *   A dayjs-compatible format string applied to `date`-typed columns (e.g. `"MM/DD/YYYY"`).
 *   Datetime columns use this value concatenated with `util.dateTimeExportFormat`.
 *
 * @param {number} [result.userTimezoneOffset]
 *   The user's UTC offset in **minutes**. Applied to dateTime fields by setting the Dayjs instance
 *   offset via `utcOffset(Number(userTimezoneOffset))` when `localize` is set to `true` on the column.
 *
 * @param {boolean} [result.isElastic=false]
 *   When `true`, data is assumed to come from Elasticsearch. Key mapping uses `exportColumn.field`
 *   → `exportColumn.headerName` directly (no `.columns` metadata lookup).
 *
 * @param {Object<string, Array<{value: *, label: string}>>} [result.lookups={}]
 *   Named lookup arrays. Each entry maps a raw value to a human-readable label.
 *   Keys are matched case-insensitively against column `headerName` or `lookup` properties.
 *   Example: `{ STATUS: [{ value: 1, label: 'Active' }, { value: 0, label: 'Inactive' }] }`.
 *
 * @param {Object} [result.lookupFields={}]
 *   Specifies which columns require lookup substitution via `updateKeys`.
 *   Each entry maps a field key to `{ keyName: string[], lookupKey: string }`.
 *
 * @param {boolean} [result.isMultiSheetExport=false]
 *   When `true`, `result[data]` must be an array of sheet descriptors:
 *   `Array<{ title: string, columns: Object, rows: Array<Object> }>`.
 *   Each sheet is processed independently and written as a separate tab in the XLSX output.
 *
 * @param {Object}  [options={}]                  - Transform options.
 * @param {string}  [options.responseType]         - Desired output format. Accepts full MIME types or short aliases:
 *   `"json"` | `"csv"` | `"xlsx"` | `"xml"` | `"html"` | `"txt"`.
 *   Defaults to HTTP content negotiation (`req.accepts`).
 * @param {string}  [options.fileName]             - Base filename for file downloads (without extension).
 *   A timestamp is always appended. Unsafe characters are stripped automatically.
 *   Falls back to `req.path`, then `'export'`.
 * @param {string}  [options.data="data"]          - Key within `result` that holds the data payload.
 *
 * @returns {Promise<void>} Resolves when the HTTP response has been sent.
 */
const responseTransformer = async function (req, res, next) {
    res.transform = async function ({ success, ...others }, { responseType, fileName, data: dataField = "data" } = {}) {
        let data = success === true ? others[dataField] : {};
        if (!success) {
            return res.status(400).json({ success: false, message: data });
        }

        const exportColumns = others?.exportColumns, userDateFormat = others?.userDateFormat, isElastic = others?.isElastic, userTimezoneOffset = others?.userTimezoneOffset, lookups = others?.lookups, lookupFields = others?.lookupFields;
        const dateTimeFormat = userDateFormat + util.dateTimeExportFormat;
        const isMultiSheetExport = others?.isMultiSheetExport || false;

        // Sanitize the fileName if provided, else use req.path to generate fileName, if req.path is not available(for tasks), use 'export' as fileName
        fileName = util.sanitizeFilename(fileName || req.path || 'export');
        fileName = `${fileName}-${dayjs().format(enums.fullDateFormat)}`;

        if (data !== undefined && data !== null && typeof data === 'object') {
            if (!responseType) {
                responseType = req.accepts(acceptableMimeTypes) || 'application/json';
            }
        }
        if (responseType?.indexOf('/') === -1) {
            responseType = mimeTypes[responseType];
        }

        const isExportOperation = (typeof exportColumns === 'object' && Object.keys(exportColumns).length > 0);
        let columns = {};
        const columnKeyMappings = {};
        let jsonResponse = others;
        let sheets = [];
        if (isExportOperation) {
            for (const key in exportColumns) {
                const exportColumn = exportColumns[key];

                const commonProperties = { width: exportColumn.width / util.excelColumnWidthEnum, name: exportColumn.headerName, valueType: exportColumn.type, isParsable: exportColumn.isParsable, hyperlinkURL: exportColumn.hyperlinkURL, hyperlinkIndex: exportColumn.hyperlinkIndex, field: exportColumn.field, localize: exportColumn.localize };

                columns[key] = { ...commonProperties };

                if (isElastic) {
                    columnKeyMappings[exportColumn.field] = exportColumn.headerName;
                } else if (data.columns && data.columns[key]?.name) {
                    const dataColumn = data.columns[key];
                    columns[key] = { ...commonProperties, ...dataColumn, name: exportColumn.headerName };
                    columnKeyMappings[dataColumn.name] = exportColumn.headerName;
                } else if (Array.isArray(data)) {
                    columns[key].name = exportColumn.headerName;
                    columnKeyMappings[exportColumn.field] = exportColumn.headerName;
                }
                if (exportColumn.hyperlinkURL && exportColumn.hyperlinkIndex) {
                    columnKeyMappings[exportColumn.hyperlinkIndex] = exportColumn.hyperlinkIndex;
                    columns[exportColumn.hyperlinkIndex] = { name: data.columns?.[exportColumn.hyperlinkIndex]?.name, valueType: data.columns?.[exportColumn.hyperlinkIndex]?.type, isHyperLinkColumn: true };
                }
            }

            if (Object.keys(columns)?.length === 0) {
                columns = data.columns || {};
            }

            const hyperlinkCols = Object.entries(exportColumns)
                .filter(([, col]) => col.hyperlinkURL && col.hyperlinkIndex);

            updateLookups({ data, exportColumns, lookups });

            if (arrayResponseTypes.includes(responseType)) {
                data = ensureArray(data);
            }

            if (exportColumns && Object.keys(exportColumns)?.length > 0) {
                sheets = isMultiSheetExport ? data : [{ title: "Main", columns, rows: data }];
                for (const sheet of sheets) {
                    if (sheet.rows && sheet.rows.length > 0) {
                        sheet.rows = updateKeys({ data: sheet.rows, keyMapping: isMultiSheetExport ? sheet.columns : columnKeyMappings, columns: sheet.columns, userDateFormat, userDateTimeFormat: dateTimeFormat, userTimezoneOffset, lookups, lookupFields, isForXML: isForXMLResponseType.includes(responseType) });
                    }
                }
            }
            data = sheets[0].rows;

            if (responseType !== mimeTypes.xlsx && data && hyperlinkCols.length > 0) {
                const isForXML = isForXMLResponseType.includes(responseType);
                for (const [key, colConfig] of hyperlinkCols) {
                    const { headerName, hyperlinkURL, hyperlinkIndex } = colConfig;
                    const urlColumnKey = isForXML ? `${key}_URL` : `${headerName} - URL`;
                    const urlHeaderName = `${headerName} - URL`;

                    data.forEach((row, index) => {
                        const indexValue = data[index]?.[hyperlinkIndex];
                        if (indexValue !== null && indexValue !== undefined) {
                            row[urlColumnKey] = hyperlinkURL.replace('{0}', String(indexValue));
                        } else {
                            row[urlColumnKey] = '';
                        }
                    });

                    columns[urlColumnKey] = { name: urlHeaderName };
                }
            }
        }
        switch (responseType) {
            case mimeTypes.json:
                data = sanitizeData({ data, columns });
                res.set('Content-Type', 'application/json');
                if (exportColumns && Object.keys(exportColumns)?.length > 0) {
                    if (!isExportOperation) {
                        data = updateKeys({ data, keyMapping: columnKeyMappings, columns, userDateFormat, userDateTimeFormat: dateTimeFormat, userTimezoneOffset, lookups, lookupFields });
                    }
                    jsonResponse = data;
                }
                return Object.keys(others).length === 1 ? res.json(data) : res.json(jsonResponse);
            case mimeTypes.xlsx:
                res.set('Content-Type', responseType);
                res.set('Content-Disposition', `attachment; filename="${fileName}.xlsx"`);
                return await toExcel({ sheets, stream: res, exportColumns: true, userDateFormat });
            case mimeTypes.csv:
                if (data.length > 0) {
                    data = sanitizeData({ data, columns });
                    const csv = new ObjectsToCsv(data);
                    res.set('Content-Disposition', `attachment; filename="${fileName}.csv"`);
                    res.set('Content-Type', responseType);
                    return res.send(await csv.toString());
                }
                break;
            case mimeTypes.txt:
                break;
            case mimeTypes.xml:
                data = sanitizeData({ data, columns, responseType });
                res.set('Content-Type', 'text/xml');
                return res.send(js2xmlparser.parse("root", data));
            case mimeTypes.html:
                if (data.length > 0) {
                    if (Object.keys(columns)?.length === 0) {
                        columns = data.columns || {};
                    }
                    return res.send(toHtmlTable({ rows: data, exportColumns: columns, isCustomExport: true }));
                }
                break;
            default:
                return res.send(data);
        }
        return res.send('No data!, for the selected operation');
    }
    next();
};

export default responseTransformer;