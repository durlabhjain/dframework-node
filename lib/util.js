import { promisify } from 'util';
import got from 'got'
import stream from 'stream';
import fs from 'fs';
import prompt from 'prompt';
import { Buffer } from 'buffer';
import config from './appConfig.mjs';
import dayjs from 'dayjs';
import mssql from './wrappers/mssql.js';
import mysql from './wrappers/mysql.js';
import enums from './enums.mjs';
import BusinessBase from './business/business-base.mjs';
import logger from './logger.js';

const macRegex = /([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/

const pipeline = promisify(stream.pipeline);

const defaultTemplate = /\${((\w+)\.)?(\w+)}/gm;

export default {
    req: {},
    macRegex,

    dateFormat: 'M-D-Y',

    dateTimeFormat: 'M-D-Y HH:mm:ss',

    SECOND: 1000,

    MINUTE: 60 * 1000,

    HOUR: 60 * 60 * 1000,

    DAY: 24 * 60 * 60 * 1000,

    dataModes: {
        asFile: 'file'
    },

    mappings: {
        "assets": {
            "Code": "LocationCode"
        },
        "locationgroup": {
            "Address": "CONCAT(ISNULL(street,''),ISNULL(country,''),ISNULL(state,''))"
        }
    },

    formatDate: function (date, dateFormat) {
        dateFormat = dateFormat || this.dateFormat;
        if (!date) return date;
        if (typeof date === 'string' && date.length === 17) {
            date = this.parseDate(date);
        }
        if (!date.getFullYear) { return date; }
        return dateFormat.replace('Y', date.getFullYear())
            .replace('y', date.getFullYear().toString().substr(2))
            .replace('M', (date.getMonth() + 1).toString().padStart(2, '0'))
            .replace('D', date.getDate().toString().padStart(2, '0'))
            .replace('HH', date.getHours().toString().padStart(2, '0'))
            .replace('mm', date.getMinutes().toString().padStart(2, '0'))
            .replace('ss', date.getSeconds().toString().padStart(2, '0'))
    },

    formatDateTime: function (date, dateFormat) {
        return this.formatDate(date, dateFormat || this.dateTimeFormat);
    },

    isMacAddress: function (value) {
        return typeof value === 'string' && macRegex.test(value);
    },

    parseDate: function (value) {
        //20171025121944933
        if (value && value.length > 10) {
            return new Date(value.substr(0, 4), value.substr(4, 2) - 1, value.substr(6, 2), value.substr(8, 2), value.substr(10, 2), value.substr(12, 2), value.substr(14, 3));
        }
        return value;
    },

    unique: function (collection, key) {
        return [...new Set(collection.map(item => item[key]))];
    },

    join: function ({ left, right, join, columns }) {
        const lookup = {};
        let key = join[1];
        for (const entry of right) {
            if (entry.hasOwnProperty(key)) {
                const keyValue = entry[key];
                if (keyValue !== undefined && keyValue !== null) {
                    lookup[keyValue] = entry;
                }
            }
        }
        key = join[0];
        for (const row of left) {
            let lookupEntry = {};
            if (row.hasOwnProperty(key)) {
                const keyValue = row[key];
                lookupEntry = lookup[keyValue] || {};
            }
            for (const column of columns) {
                row[column] = lookupEntry[column];
            }
        }
    },

    /**
     * Return a default value if date is not a valid date
     * @param date Date value to be evaluated
     * @param defaultDate Date optional - value to be assigned if date is invalid/ empty. Defaultst to 1/1/2000
     * @returns date a valid date
     */
    safeDate: function (date, defaultDate = new Date(2000, 0, 1)) {
        if (date === null || typeof date.getMonth !== 'function') {
            return defaultDate;
        }
        return date;
    },

    /**
     * Returns the minimum value in the array
     * @param arr Array elements
     * @param min Any default minimum value
     * @returns Minimum value in the array
     */
    min: function (arr, min = Infinity) {
        let len = arr.length;
        while (len--) {
            if (arr[len] < min) {
                min = arr[len];
            }
        }
        return min;
    },

    /**
     * Returns the maximum value in the array
     * @param arr Array elements
     * @param min Any default maximum value
     * @returns Maximum value in the array
     */
    max: function (arr, max = -Infinity) {
        let len = arr.length
        while (len--) {
            if (arr[len] > max) {
                max = arr[len];
            }
        }
        return max;
    },

    /**
     * Downloads a file from a url
     * @param {String} url
     * @param {Object} options
     * @param {any} options.dest - string/ function({ filename, response }) - destination file path or function to return a destination file path
     * @returns 
     */
    download: function (url, { dest } = {}) {
        return new Promise((resolve, reject) => {
            got.stream(url)
                .on('response', async response => {
                    if (response.statusCode !== 200) {
                        return reject(new Error('Invalid status'), response);
                    }
                    let filename = response.headers['content-disposition'].split('filename=')[1];
                    if (filename) {
                        filename = filename.replace(/\"/g, '');
                    }
                    if (typeof dest === 'function') {
                        filename = dest({ filename, response });
                    } else if (typeof dest === 'string') {
                        filename = dest;
                    }
                    if (!filename) {
                        return reject(new Error('No filename'), response);
                    }
                    const outFile = fs.createWriteStream(filename);
                    await pipeline(
                        response,
                        outFile
                    );
                    resolve();
                })
                .resume();
        });
    },

    prompt,

    confirm: async function (options) {
        if (typeof options === 'string') {
            options = {
                description: options
            };
        }
        options = {
            description: 'Are you sure?',
            pattern: /^[yn]$/,
            required: true,
            message: 'Please enter y or n',
            ...options
        };
        const { confirm } = await prompt.get({
            properties: {
                confirm: options
            }
        });
        return confirm === 'y';
    },

    /**
     * @description Replaces the given tags in the given source with the given values.
     * @param {string} source The source to replace the tags in.
     * @param {object} values The values to replace the tags with.
     * @param {object} options template - Regex to use for matching tags, keepMissingTags - Whether to keep tags that are not replaced.
     * @returns {string} The source with the tags replaced.
     * @example
     * // Replaces all tags in the given source with the given values.
     * console.log(template("${firstName} ${lastName}", { firstName: "John", lastName: "Doe" }));
     * // -> "John Doe"
     * // Two level tags are supported.
     * console.log(template("${user.firstName} ${user.lastName}", { user: { firstName: "John", lastName: "Doe" } }));
     * // -> "John Doe"
     **/
    replaceTags: function (source, tags, { template = defaultTemplate, keepMissingTags = false } = {}) {
        if (!source || !tags) {
            return source;
        }

        return source.replace(template, function (match, g1, g2, g3) {
            const container = g2 ? tags[g2] || {} : tags;
            if (container[g3] === undefined) {
                return keepMissingTags ? match : "";
            }
            return container[g3];
        });
    },

    request: async function ({
        authentication,
        reauthenticateCodes = [401, 403],
        body,
        form,
        ...options
    }) {
        // custom header options
        options.headers = options.headers || {};
        const headers = options.headers;
        options.method = options.method || 'POST';
        options.https = config.httpsOptions;

        // if authentication is specified and it may need renewal, we might need to try the request twice
        let authorizationHeader;
        const makeRequest = async (firstTry = true) => {
            if (authentication) {
                authorizationHeader = await authentication.getAuthorizationHeader({ renew: !firstTry });
                if (authorizationHeader) {
                    headers.Authorization = authorizationHeader;
                } else if (!firstTry) {
                    throw new Error('Authorization renewal failed');
                }
            }
            const bodyData = typeof body === 'function' ? await body() : body;
            const formData = typeof form === 'function' ? await form() : form;
            return got({ body: bodyData, form: formData, ...options });
        };

        try {
            return await makeRequest();
        } catch (error) {
            if (authorizationHeader && reauthenticateCodes.includes(error.response?.statusCode) && authentication.mayRequireRenewal) {
                return makeRequest(false);
            } else {
                throw error;
            }
        }
    },

    /**
     * Adds object as file to FormData - you can specify a key and value/ buffer/ stream/ blob with optional filename and contentType
     * @param {Object} options.formData     FormData object
     * @param {String} options.key          Form object key
     * @param {Object} options.value        Form object value (if an object or string needs to be sent as a file)
     * @param {Object} options.buffer       Buffer object to be sent as a file (optional)
     * @param {Object} options.stream       Readable stream to be sent as a file (optional)
     * @param {Object} options.blob         Blob object to be sent as a file (optional)
     * @param {String} options.filename     File name (optional)
     * @param {String} options.contentType  File content type (optional)
     * @returns 
     */

    appendFileToForm: function ({ formData, key, value, buffer, stream, blob, fileName, contentType = 'application/octet-stream' }) {
        if (fileName) {
            blob = fs.createReadStream(fileName);
        } else if (buffer) {
            blob = buffer;
        } else if (value) {
            blob = typeof (value) === 'string' ? Buffer.from(value) : Buffer.from(JSON.stringify(value));
            contentType = 'application/json';
        } else if (stream) {
            blob = stream;
        }
        formData.append(this.dataModes.asFile, blob, { fileName, contentType });
        return formData;
    },

    toFormData: function (options) {
        if (arguments.length === 1) {
            options = { data: options };
        }
        const {
            data,
            formData = new FormData(),
            parentKey
        } = options;
        for (const key in data) {
            let value = data[key];
            if (value === undefined) {
                continue;
            }
            if (value === null) {
                value = '';
            }
            if (typeof value === 'object'
                && !(value instanceof Date)
                && !(value instanceof Buffer)
                && !(value instanceof stream.Stream)) {
                this.toFormData({
                    data: value,
                    formData,
                    parentKey: key
                });
            } else {
                formData.append(parentKey ? `${parentKey}[${key}]` : key, value);
            }
        }
        return formData;
    },
    baseDateFormat: {
        MMMMYYYY: "MMMM YYYY",
        YYYYMMDD: "YYYY-MM-DD"
    },
    RelationTypes: {
        Elastic: 'elastic',
        SQL: 'sql'
    },
    elasticBaseQuery: { "size": 10, "from": 0, "sort": [], "track_total_hits": true, "query": { "bool": { "filter": { "bool": { "must": [], "must_not": [], "should": [] } } } }, "_source": { "includes": [] } },
    getFrequencyType: (val) => {
        switch (val) {
            case "V": return "At every visit";
            case "O": return "Every outlet only once";
            case "W": return "Once per week";
            case "M": return "Once per month";
            case "Q": return "Once per quarter";
            case "Y": return "Once per Year";
            default: return "";
        }
    },
    getPriority: (val) => {
        switch (val) {
            case 1: return "High";
            case 2: return "Medium";
            case 3: return "Low";
            default: return "";
        }
    },
    getSelectedDays: (value) => {
        const daysOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const selectedDays = [];
        for (let i = 0, iLen = value.length; i < iLen; i++) {
            if (value[i] === '1') {
                selectedDays.push(daysOfWeek[i]);
            }
        }
        return selectedDays.join(', ');
    },
    dateTimeFields: ['date', 'datetime', 'dateTime', 'dateTimeLocal'],
    dateTimeExportFormat: ' hh:mm:ss A',
    excelColumnWidthEnum: 6,
    dateTimeCSVExportFormat: '-hh:mm:ss A',
    reportDatesFormat: {
        dateTime: "MM/DD/YYYY HH:mm:ss A",
        date: "MM/DD/YYYY",
        dateFileName: "MM-DD-YYYY",
        ukRAGReportDate: "MM/DD/YYYY",
        yyyymmdd: 'YYYY-MM-DD'
    },
    reportTypes: {
        excel: "xlsx",
        csv: "csv",
        json: "json",
        text: "txt"
    },
    dateTimeExcelExportFormat: ' hh:mm:ss AM/PM',
    dateTimeExcelRowExportFormat: ' hh:mm:ss A',
    fileNameRegex: /[^A-Za-z0-9-_]/g,
    elasticQueryMaxSize: 10000,
    useSqlParameterLength: config?.useSqlParameterLength || false,
    sqlParameterLength: config?.sqlParameterLength || {
        varchar: 8000,
        nvarchar: 4000,
        decimal_precision: 38,
        decimal_scale: 17
    },
    splitQueryBasedOnFrom: function ({ query }) {
        const fromMatch = [...query.matchAll(/ from /gi)].pop(); // Find the last ' FROM ' (case-insensitive)
        if (!fromMatch || typeof fromMatch.index !== 'number') {
            return [query, ''];
        }
        const fromIndex = fromMatch.index;
        const beforeFrom = query.slice(0, fromIndex); // Find last 'SELECT' before the last ' FROM '
        const selectMatch = [...beforeFrom.matchAll(/select/gi)].pop();
        if (!selectMatch || typeof selectMatch.index !== 'number') {
            return [query, ''];
        }
        const selectIndex = selectMatch.index;
        return [
            query.slice(0, selectIndex), // Before SELECT
            ` FROM ${query.slice(fromIndex + ' from '.length)}` // Added FROM and the remaining part of the query
        ];
    },
    getClientConfig: async ({ label, clientId = 0 }) => {
        const { sql } = BusinessBase.businessObject;
        const request = sql.createRequest();
        let query = "SELECT TOP 1 ConfigValue FROM ClientConfig";
        const where = {
            "ClientId": { value: [0, clientId], operator: "IN" },
            "ConfigLabel": label
        }
        query = sql.addParameters({ query, request, parameters: where, forWhere: true });
        query += " ORDER BY ClientId DESC"
        const result = await request.query(query);
        if (result.recordset.length === 0)
            return {};
        const configValue = result.recordset[0].ConfigValue;
        const config = {};
        config[label] = configValue;
        return config;
    },
    importLimit: 20000,
    getProductPricings: async function ({ productIds, clientId, sql }) {
        const productIdString = productIds.join(",");
        const request = sql.createRequest();
        const query = `SELECT Product.ProductId, PP.ProductPricingId, PP.CaseOptionId, PP.Size, DBO.Product.ShortName
            FROM (SELECT Value AS ProductId FROM DBO.CsvToList('${productIdString}')) Request 
                            INNER JOIN dbo.Product ON dbo.Product.ProductId = Request.ProductId
                            OUTER APPLY
                ( SELECT TOP 1 DBO.ProductPricing.ProductPricingId,DBO.ProductPricing.CaseOptionId,DBO.ProductPricing.Size
                                    FROM DBO.ProductPricing 
                                    WHERE DBO.Product.ProductId = DBO.ProductPricing.ProductId
                                    AND DBO.ProductPricing.IsDeleted = 0
                                    AND DBO.ProductPricing.CaseOptionId > 0
                                    AND DBO.ProductPricing.Size > 0
                ) PP 
                            WHERE ClientId = ${clientId} AND DBO.Product.IsDeleted = 0`;

        const result = await request.query(query);
        const productPricingData = {};
        result.recordset.forEach(item => {
            productPricingData[item.ProductId] = item;
        })
        return productPricingData;

    },
    modifyPlanogramImportData: async function ({ data, clientId, errors, sql }) {
        const planogramData = {};
        const today = new Date(); // Get the current date and time
        const formattedDate = today.toLocaleDateString('en-US', { // Use US locale for consistent formatting
            month: "2-digit", // Two-digit month (01-12)
            day: "2-digit"  // Two-digit day (01-31)  
        }).replace(/-/g, "-");
        const productIds = [];
        let rowCount = 0;
        data.forEach(item => {
            rowCount++;
            if (!item.PlanogramName.value) {
                item.PlanogramName.value = item.AssetId.originalValue + "_" + formattedDate.replace("/", "_");
            }
            else {
                item.PlanogramName.value = item.PlanogramName.value + "_" + formattedDate.replace("/", "_");
            }
            if (!planogramData[item.PlanogramName.value + "-" + item.AssetId.value]) {
                planogramData[item.PlanogramName.value + "-" + item.AssetId.value] = {
                    ReplenishModelId: item.ReplenishModelId,
                    PlanogramName: item.PlanogramName,
                    AssetId: item.AssetId,
                    Shelf: {},
                    ValidData: true,
                    products: {}
                }
            }
            const planoData = planogramData[item.PlanogramName.value + "-" + item.AssetId.value];
            planoData["ReplenishModelId"] = item.ReplenishModelId;
            if (this.validatePlanogramItem(item)) {
                planogramData[item.PlanogramName.value + "-" + item.AssetId.value].ValidData = false;
            }

            if (item.ProductId.value > 0) {
                planogramData[item.PlanogramName.value + "-" + item.AssetId.value].products[item.ProductId.value] = planogramData[item.PlanogramName.value + "-" + item.AssetId.value].products[item.ProductId.value] ? planogramData[item.PlanogramName.value + "-" + item.AssetId.value].products[item.ProductId.value] + 1 : 1;
                if (!productIds.includes(item.ProductId.value)) productIds.push(item.ProductId.value);
            }
            const shelfData = { id: Number(item.ProductId.value), stackSize: Number(item.Stack.value) };
            if (!planoData.Shelf[item.Shelf.value]) {
                planoData.Shelf[item.Shelf.value] = [];
            }
            const planoShelf = planoData.Shelf[item.Shelf.value];
            planoShelf.push(shelfData);
            if (planoShelf.length > 255) {
                errors.push({
                    rowNumber: rowCount,
                    error: "Maximum Product Exceeds",
                    message: `You can only import 255 Products in single shelf at a time`
                });
                planogramData[item.PlanogramName.value + "-" + item.AssetId.value].ValidData = false;
            }
        })
        const productPricingData = await util.getProductPricings({ productIds, clientId, sql });
        for (const key in planogramData) {
            const planogram = planogramData[key];
            if (!planogram.ValidData) {
                delete planogramData[key];
                continue;
            }

            const planogramTier = {};
            Object.values(planogram.Shelf).forEach(shelf => {
                shelf.forEach(item => {
                    planogramTier[item.id] = {
                        id: item.id,
                        tier: (planogramTier[item.id]?.tier || 0) + (item.stackSize || 1)
                    };
                });
            });


            const replenishDetail = [];
            const replenishProductIds = Object.keys(planogram.products).map(Number);

            // Step 1: For each ProductId, find the entry in `data` with the highest Shelf value
            const productShelfMap = {};

            data.forEach((item, index) => {
                const productId = item.ProductId?.value;
                const shelf = item.Shelf?.value ?? 0;

                if (productShelfMap[productId]) {
                    const existing = productShelfMap[productId];
                    // Choose the item with the higher shelf value
                    if (shelf > existing.shelf) {
                        productShelfMap[productId] = { shelf, index };
                    }
                } else {
                    productShelfMap[productId] = { shelf, index };
                }
            });

            // Step 2: Generate replenishDetail using the selected Shelf and Position
            replenishProductIds.forEach(item => {
                const productPricing = productPricingData[item];
                if (productPricing) {
                    const size = productPricing.Size || 0;
                    const caseOption = this.CasePriceOption[productPricing.CaseOptionId] || "Case";

                    const shelfInfo = productShelfMap[productPricing.ProductId];
                    const shelf = shelfInfo?.shelf ?? 0;
                    const position = (shelfInfo?.index ?? 0) + 1; // use index from data array

                    replenishDetail.push({
                        ProductId: productPricing.ProductId,
                        Description: productPricing.ShortName,
                        Tiers: planogramTier[productPricing.ProductId]?.tier,
                        Units: 1,
                        ProductPriceId: productPricing.ProductPricingId || 0,
                        CaseType: `${caseOption} of ${size}`,
                        Shelve: shelf,
                        Position: position
                    });
                }
            });
            replenishDetail.sort((a, b) => a.Shelve - b.Shelve);
            const shelf = planogram.Shelf;
            const shelfNumber = Object.keys(shelf).map(Number);
            const highestShelfNumber = Math.max(...shelfNumber);
            planogramData[key]["Shelves"] = { value: highestShelfNumber, originalValue: highestShelfNumber };
            const newData = Object.values(shelf).map((value) => ({
                products: value,
            }));
            let newDataWithAllShelf = newData;
            for (let i = 1; i <= highestShelfNumber; i++) {
                if (!shelfNumber.includes(i)) {
                    const emptyValue = { products: [] };
                    newDataWithAllShelf = [...newDataWithAllShelf.slice(0, i - 1), emptyValue, ...newDataWithAllShelf.slice(i - 1)]
                }
            }
            const facings = Object.values(planogram.products).reduce((accumulator, currentValue) => accumulator + currentValue, 0);
            planogramData[key].FacingsDetail = { originalValue: JSON.stringify(newData), value: JSON.stringify(newDataWithAllShelf) }
            planogramData[key].ReplenishDetail = { originalValue: JSON.stringify(replenishDetail), value: JSON.stringify(replenishDetail) };
            planogramData[key].Facings = { originalValue: facings, value: facings };
            planogramData[key].FacingsDistinct = { originalValue: replenishProductIds.length, value: replenishProductIds.length };
            delete planogramData[key]["Shelf"];
            delete planogramData[key]["ValidData"];
        }

        return Object.values(planogramData);
    },
    modifyUserImportData: function (data) {
        data.forEach(item => item["Password"] = { value: this.generatePassword({}), originalValue: '' });
        return data;
    },
    filterClients: function ({ ClientIds, selectedClients, scopeId, IsSuperAdmin }) {
        //userClientIds - Client access to user - coming from login sp
        const userClientIds = ClientIds?.split(',').map(ele => Number(ele.trim())).filter(num => num > 0) || [];
        selectedClients = selectedClients ? selectedClients.filter(num => num > 0) : scopeId > 0 ? [scopeId] : [];
        selectedClients = selectedClients && selectedClients.length > 0 ? selectedClients : (scopeId > 0 ? [scopeId] : []);
        //Security Check - From client side selectedClients is passed then check if user has access to those clients
        if (selectedClients.length > 0 && userClientIds.length > 0 && !IsSuperAdmin) {
            selectedClients.splice(0, selectedClients.length, ...selectedClients.filter(clientId => userClientIds.includes(clientId)));
        }
        return selectedClients?.length ? selectedClients : [-1];
    },
    getUserDetailsWithClientIds: async function ({ username, selectedClients, sql, mssql }) {
        // Centralized helper for TVP + GetUserDetails
        const request = sql.createRequest();
        const selectedClientIds = selectedClients.map((id, i) => ({ Value: id, Sequence: i + 1 }));
        request.input('Username', mssql.VarChar, username);
        sql.createTVP({ values: selectedClientIds, request, paramName: 'SelectedClientIds', columnTypes: { Value: mssql.Int, Sequence: mssql.Int } });
        const result = await request.execute('dbo.GetUserDetails');
        return result.recordsets;
    },
    loadUserFilterQuery: async function ({ username, selectedClients, globalFilters = {}, IsSuperAdmin = false, aliasField = 'LocationId', clientFieldAlias = '', sql, mssql }) {
        //removed clientIds filter from global filters as it is already passed in selectedClients
        if (globalFilters['ClientId']) {
            delete globalFilters['ClientId'];
        }
        const isGlobalFilterApplied = Object.keys(globalFilters).length > 0;
        // Transform 'ChannelId' into 'LocationTypeId' in globalFilters
        if (isGlobalFilterApplied) {
            globalFilters = Object.fromEntries(
                Object.entries(globalFilters).map(([key, value]) => [key === 'ChannelId' ? 'LocationTypeId' : key, value])
            );
        }
        //Handle SuperAdmin/Admin case
        if (IsSuperAdmin) {
            // Early return for SuperAdmin without global filters
            if (!isGlobalFilterApplied) return "";

            // Build query for admin with global filters
            const queryConditions = Object.entries(globalFilters)
                .filter(([, values]) => values?.length)     //Added filter to skip empty value arrays
                .map(([column, values]) => `Location.${column} IN (${values.join(',')})`);

            return queryConditions.length
                ? `(${aliasField} IN (SELECT LocationId FROM Location WHERE IsDeleted = 0 AND ${queryConditions.join(" AND ")}))`
                : "";
        }
        //Hanle client User and multi client user case
        else {
            try {
                const clientConditions = new Map();
                const clientConditionsWithoutUserLevel = new Map();
                const [clientInfo, markets, classifications, distributors, keyAccounts] = await util.getUserDetailsWithClientIds({ username, selectedClients, sql, mssql });

                for (const row of clientInfo) {
                    const { ClientId, RoleId, ClientUserId } = row;

                    const MarketIds = markets.filter(m => m.ClientId === ClientId && m.ClientUserId === ClientUserId).map(m => m.MarketId);
                    const ClassificationIds = classifications.filter(c => c.ClientId === ClientId && c.ClientUserId === ClientUserId).map(c => c.ClassificationId);
                    const DistributorIds = distributors.filter(d => d.ClientId === ClientId && d.ClientUserId === ClientUserId).map(d => d.DistributorId);
                    const KeyAccountIds = keyAccounts.filter(k => k.ClientId === ClientId && k.ClientUserId === ClientUserId).map(k => k.KeyAccountId);


                    if (!selectedClients.includes(ClientId)) continue;
                    if (!MarketIds.length && !ClassificationIds.length && !DistributorIds.length && !KeyAccountIds.length && !isGlobalFilterApplied && RoleId != enums.SalesRepeId) {
                        clientConditionsWithoutUserLevel.set(ClientId, []);
                        continue;
                    }

                    const conditions = [];
                    const addCondition = (field, columnName) => {
                        let selectIds = [];
                        if (field.length > 0) {
                            selectIds = isGlobalFilterApplied && globalFilters[columnName] ? field.filter(id => globalFilters[columnName].includes(id)) : field;
                        } else if (!field.length && isGlobalFilterApplied && globalFilters[columnName]) {
                            selectIds = globalFilters[columnName];
                        }
                        selectIds.length > 0 && conditions.push(`Location.${columnName} IN (${selectIds.join(',')})`);
                    };

                    addCondition(MarketIds, 'MarketId');
                    addCondition(ClassificationIds, 'ClassificationId');
                    addCondition(DistributorIds, 'DistributorId');
                    addCondition(KeyAccountIds, 'KeyAccountId');

                    if (RoleId == enums.SalesRepeId) {
                        conditions.push(`(${aliasField} IN (SELECT Location.LocationId FROM Location INNER JOIN LocationRep ON LocationRep.LocationId = Location.LocationId WHERE Location.IsDeleted = 0 AND LocationRep.RepId IN (${ClientUserId})))`);
                    }
                    if (globalFilters['LocationTypeId']) {
                        conditions.push(`Location.LocationTypeId IN (${globalFilters['LocationTypeId'].join(',')})`);
                    }

                    if (conditions.length > 0) {
                        const conditionString = conditions.length > 1 ? `(${conditions.join(' AND ')})` : conditions[0];
                        if (!clientConditions.has(ClientId)) {
                            clientConditions.set(ClientId, []);
                        }
                        clientConditions.get(ClientId).push(conditionString);
                    }
                }

                // Build the final query for multi-client/single-client user
                let queryConditions = Array.from(clientConditions.entries()).map(
                    ([clientId, conditions]) => conditions.length > 0 ? `(${conditions.join(" AND ")} AND ClientId = ${clientId})` : `(ClientId = ${clientId})`
                );
                queryConditions = queryConditions.length > 0 ? `(${aliasField} IN (SELECT LocationId FROM Location WHERE IsDeleted = 0 AND ${queryConditions.join(" OR ")}))` : "";
                let clientQueryConditions = Array.from(clientConditionsWithoutUserLevel.entries()).map(
                    ([clientId]) => `(${clientFieldAlias ? `${clientFieldAlias}.` : ''}ClientId = ${clientId})`
                );
                clientQueryConditions = clientQueryConditions.length > 0 ? `${clientQueryConditions.join(' OR ')}` : "";
                let toReturn = '';
                if (queryConditions) {
                    toReturn = `${queryConditions}`;
                    if (clientQueryConditions) {
                        toReturn = `(${queryConditions} OR ${clientQueryConditions})`;
                    }
                }
                return toReturn;

            } catch (error) {
                logger.error({ error }, 'Error fetching filters for multi-client user:');
            }

        }
    },
    replaceClientWithDemo: function (query) {
        if (typeof query === 'string' && query.includes('ClientName')) {
            // Use a regular expression to replace all occurrences of ClientName
            // optionally followed by AS and an alias
            return query.replace(/ClientName(\s+AS\s+\w+)?/gi, function (match) {
                if (match.includes('AS')) {
                    return match.replace('ClientName', 'DemoClientName');
                } else {
                    return 'DemoClientName AS ClientName';
                }
            });
        }
        // Return the original query if no replacement is needed
        return query;
    },
    getLookup: async ({ lookupType, user, isForImport = true, tableLookupFields }) => {
        let source = "vwLookupList";
        let fields = "LookupId, DisplayValue";
        if (!isForImport && tableLookupFields) {
            fields = tableLookupFields;
        }
        const marketIds = user.tags.MarketIds !== "" ? user.tags.MarketIds.split(",").map(Number) : [];
        const classificationIds = user.tags.ClassificationIds !== "" ? user.tags.ClassificationIds.split(",").map(Number) : [];
        const distributorIds = user.tags.DistributorIds !== "" ? user.tags.DistributorIds.split(",").map(Number) : [];
        const keyAccountIds = user.tags.KeyAccountIds !== "" ? user.tags.KeyAccountIds.split(",").map(Number) : [];
        const where = {};
        switch (lookupType) {
            case enums.LookupType.Manufaturer:
                source = "vwManufacturerLookupList";
                where["ClientId"] = { value: [0, user.scopeId], operator: 'IN' };
                break;
            case enums.LookupType.LocationCode:
                fields = "LookupId, OutletCode as DisplayValue";
                source = "vwLocationLookupList";
                if (user.scopeId != 0)
                    where["CustomValue"] = user.scopeId;
                break;
            case enums.LookupType.ParentAssetType:
                fields = "LookupId, DisplayValue, ScopeId AS LocationId";
                source = "vwParentAssetTypeLookupList";
                if (user.scopeId != 0)
                    where["ClientId"] = user.scopeId;
                break;
            case enums.LookupType.AssetType:
                source = "vwAssetTypeLookupList";
                if (user.scopeId != 0)
                    where["ClientId"] = user.scopeId;
                break;
            case enums.LookupType.Planogram:
                fields = "LookupId, DisplayValue, CustomValue AS AssetTypeId";
                source = "vwPlanogramLookupList";
                if (user.scopeId != 0)
                    where["ClientId"] = user.scopeId;
                break;
            case enums.LookupType.Role:
                source = "vwRoleLookupList";
                if (user.scopeId != 0)
                    where["IsClientRole"] = 1;
                break;
            case enums.LookupType.EmployerType:
                source = "vwClientLookupList";
                where["ClientId"] = user.scopeId;
                break;
            case enums.LookupType.KeyAccountType:
                source = "vwClientLookupList";
                where["ClientId"] = user.scopeId;
                if (keyAccountIds.length > 0)
                    where["LookupId"] = { value: keyAccountIds, operator: 'IN' };
                break;
            case enums.LookupType.Market:
                source = "vwMarketLookupList";
                if (user.scopeId != 0)
                    where["ClientId"] = user.scopeId;
                if (marketIds.length > 0)
                    where["LookupId"] = { value: marketIds, operator: 'IN' };
                break;
            case enums.LookupType.LocationClassification:
                source = "vwLocationClassificationLookupList";
                if (user.scopeId != 0)
                    where["ClientId"] = user.scopeId;
                if (classificationIds.length > 0)
                    where["LookupId"] = { value: classificationIds, operator: 'IN' };
                break;
            case enums.LookupType.Distributor:
                source = "vwDistributorLookupList";
                if (user.scopeId != 0)
                    where["ScopeId"] = user.scopeId;
                if (distributorIds.length > 0)
                    where["LookupId"] = { value: distributorIds, operator: 'IN' };
                break;
            case enums.LookupType.Country:
                source = "vwCountryLookupList";
                break;
            case enums.LookupType.SalesPerson:
                source = "vwSalesPersonLookupList";
                if (user.scopeId != 0)
                    where["ClientId"] = user.scopeId;
                break;
            case enums.LookupType.ClientUserType:
                fields = "LookupId, CustomValue AS DisplayValue"
                source = "vwClientUserNameLookupList";
                if (user.scopeId != 0)
                    where["ScopeId"] = user.scopeId;
                break;
            case enums.LookupType.TimeZone:
                source = "vwTimeZoneLookupList";
                break;
            case enums.LookupType.RouteType:
                source = "vwRouteTypeLookupList";
                if (user.scopeId != 0)
                    where["ClientId"] = user.scopeId;
                break;
            case enums.LookupType.ProductCategory:
                source = "vwProductCategoryLookupList";
                break;
            case enums.LookupType.ClientUserLookup:
                source = "vwClientUserList";
                if (user.scopeId != 0)
                    where["ClientId"] = user.scopeId;
                break;
            case enums.LookupType.ProductSecondCategoryType:
                source = "vwClientLookupList";
                if (user.scopeId != 0)
                    where["ClientId"] = user.scopeId;
                break;
            case enums.LookupType.Asset:
                source = "vwAssetLookupList";
                if (user.scopeId != 0)
                    where["ClientScopeId"] = user.scopeId;
                break;
            case enums.LookupType.Product:
                fields = "LookupId, SKU as DisplayValue";
                source = "vwProductLookupList";
                if (user.scopeId != 0)
                    where["ClientId"] = user.scopeId;
                break;
            case enums.LookupType.DoorHandleLocationType:
            case enums.LookupType.OrientationType:
                fields = "CustomValue AS LookupId, DisplayValue";
                break;
            case enums.LookupType.ExternalAssetCode:
                fields = "ExternalAssetCode AS LookupId, ExternalAssetCode AS DisplayValue, SerialNumber";
                source = "Asset";
                if (user.scopeId != 0)
                    where["ClientId"] = user.scopeId;
                where["IsDeleted"] = 0;
                break;
            case enums.LookupType.AlertUserLookup:
                source = "Security_User";
                break;
        }
        const { sql } = BusinessBase.businessObject;
        const request = sql.createRequest();
        let query = `SELECT ${fields} FROM ${source}`;
        if (lookupType > 0) {
            where["LookupTypeId"] = lookupType;
        }
        query = sql.addParameters({ query, request, parameters: where, forWhere: true });
        const result = await request.query(query);
        if (isForImport) {
            return result.recordset.reduce((acc, obj) => {
                if (obj.DisplayValue && !acc[obj.DisplayValue.toUpperCase()])
                    acc[obj.DisplayValue.toUpperCase()] = obj;
                return acc;
            }, {});
        } else {
            return result.recordset.filter(Boolean);
        }
    },
    getDateFilter: function ({ value, operator, key, modifiedKey }) {
        let startKeyIndex = `${key}_${0}`;
        let endKeyIndex = `${key}_${1}`;
        if (modifiedKey) {
            startKeyIndex = modifiedKey
            endKeyIndex = modifiedKey + 1;
        }
        if (startKeyIndex.indexOf('.') > -1) {
            startKeyIndex = startKeyIndex.replace(/\./gi, '_');
            endKeyIndex = endKeyIndex.replace(/\./gi, '_');
        }
        value = Array.isArray(value) ? value[0] : value
        let start, end;
        let query = '';
        let where = {};
        switch (operator) {
            case "DATETIME": {
                const start = dayjs(new Date(value)).format(enums.filterDateFormat)
                const end = dayjs(start).add(1, 'm').format(enums.filterDateFormat)
                query = `${key} >= @${startKeyIndex} AND ${key} < @${endKeyIndex}`;
                if (operator === "!=" || operator === 'NOT BETWEEN') {
                    query = `NOT (${query})`
                }
                where = { [startKeyIndex]: { value: start, operator: ">=", sqlType: mssql.DateTime }, [endKeyIndex]: { value: end, operator: "<", sqlType: mssql.DateTime } };
                break;
            }
            case "=":
            case "BETWEEN":
            case "NOT BETWEEN":
            case "!=": {
                start = dayjs(value).startOf('day').format(enums.filterDateFormat);
                end = dayjs(value).endOf('day').format(enums.filterDateFormat);
                query = `${key} >= @${startKeyIndex} AND ${key} <= @${endKeyIndex}`;
                if (operator === "!=" || operator === 'NOT BETWEEN') {
                    query = `NOT (${query})`
                }
                where = { [startKeyIndex]: { value: start, operator: ">=", sqlType: mssql.DateTime }, [endKeyIndex]: { value: end, operator: "<", sqlType: mssql.DateTime } };
                break;
            }
            case ">":
                value = dayjs(value).endOf('day').format(enums.filterDateFormat);
                query = `${key} ${operator} @${startKeyIndex} `;
                where = { [startKeyIndex]: { value, operator, sqlType: mssql.DateTime } };
                break;
            case ">=": {
                value = dayjs(value).startOf('day').format(enums.filterDateFormat);
                query = `${key} ${operator} @${startKeyIndex} `;
                where = { [startKeyIndex]: { value, operator, sqlType: mssql.DateTime } };
                break;
            }
            case "<":
                value = dayjs(value).startOf('day').format(enums.filterDateFormat);
                query = `${key} ${operator} @${startKeyIndex} `;
                where = { [startKeyIndex]: { value, operator, sqlType: mssql.DateTime } };
                break;
            case "<=": {
                value = dayjs(value).endOf('day').format(enums.filterDateFormat);
                query = `${key} ${operator} @${startKeyIndex} `;
                where = { [startKeyIndex]: { value, operator, sqlType: mssql.DateTime } };
                break;
            }
            case "Is Empty": {
                // Handle "IS" condition (check if the field is NULL)
                query = `${key} IS NULL`;
                where = {};
                break;
            }
            case "IS NOT Empty": {
                // Handle "IS NOT" condition (check if the field is NOT NULL)
                query = `${key} IS NOT NULL`;
                where = {};
                break;
            }
            case "NOT BETWEEN DATE": {
                const start = dayjs(new Date(value)).format(enums.filterDateFormat)
                const end = dayjs(start).add(1, 's').format(enums.filterDateFormat)
                query = `${key} >= @${startKeyIndex} AND ${key} < @${endKeyIndex}`;
                if (operator === "!=" || operator === 'NOT BETWEEN' || operator === 'NOT BETWEEN DATE') {
                    query = `NOT (${query})`
                }
                where = { [startKeyIndex]: { value: start, operator: ">=", sqlType: mssql.DateTime }, [endKeyIndex]: { value: end, operator: "<", sqlType: mssql.DateTime } };
                break;
            }
        }
        return { query, where }
    },
    getSqlTypeBasedOnValue: function ({ value, type }) {
        const types = ['number', 'boolean', 'string', 'date', 'dateTime', 'decimal'];
        if (types.includes(type)) {
            return type;
        } else {
            const valType = typeof value;
            if (['number', 'boolean'].includes(valType)) {
                return valType;
            }
        }
    },
    columnsMappings: ['Creators.PrimaryEmail', 'groupTable.CreatedOn', 'groupTable.ModifiedOn', 'Users.PrimaryEmail'],
    useOnlyNull: ["IsChestCooler"],
    CasePriceOption: { 5469: "Case", 5470: "Each" },
    isNumericWithDecimal(v) {
        if (typeof v === 'number') return true;
        if (typeof v === 'string' && v.trim() !== '') {
            if (v.startsWith('.')) v = '0' + v;
            return !isNaN(parseFloat(v)) && isFinite(v);
        }
        return false;
    },
    validatePlanogramItem(item) {
        return item.ProductId.value < 1 || 
               item.Shelf.value < 1 || 
               item.ReplenishModelId.value === 0 || 
               item.Stack.value < 0 || 
               item.Shelf.value > 99 || 
               item.Stack.value > 5 || 
               item.Stack.value - Math.floor(item.Stack.value) !== 0 || 
               item.Shelf.value - Math.floor(item.Shelf.value) !== 0 || 
               (!item.PlanogramName.originalValue && !item.AssetId.originalValue);
    },
    getFilters: function ({ filters: where, action = '', aliasTableName = '', prefix = '@', custom = false, useUpperFunction = false }) {
        const whereQStatement = [];
        let whereQ = {}
        let queryException = false;
        const sqlDateTypes = ['date', 'dateTime'];
        for (let key in where) {
            if (["OR", "AND"].includes(key.toUpperCase())) {
                if (!Object.keys(where[key]).length) continue;
                const { where: innerWhere, whereQStatement: innerStatement } = this.getFilters({ filters: where[key], action });
                whereQ = { ...whereQ, ...innerWhere }

                whereQStatement.push(`(${innerStatement.join(` ${key} `)})`)
                continue;
            }
            const fields = [...where[key]];
            for (const [index, value] of fields.entries()) {
                const { value: val, operator = "=", type = mssql.VarChar } = value;
                if (Array.isArray(val) && val?.length === 0 || (!val && type != "boolean")) {
                    continue;
                }
                let sqlType = value.sqlType;
                const isNumericValue = Array.isArray(val) ? (val.length === 0 ? false : val.every(v => this.isNumericWithDecimal(v))) : this.isNumericWithDecimal(val);
                if (isNumericValue && type === 'decimal') {
                    sqlType = this.getSqlType(type, prefix);
                } else {
                    sqlType = sqlType ? this.getSqlType(sqlType, prefix) : this.getSqlType(this.getSqlTypeBasedOnValue(value), prefix);
                }
                const maps = this.mappings?.[action?.toLowerCase()] || {};
                const originalKey = key;
                key = maps[key] || key
                if (this.columnsMappings.includes(key)) {
                    queryException = true;
                }
                const ops = operator.toUpperCase();
                let aliasKey = key;
                if (["IS", "IS NOT"].includes(ops)) {
                    const fieldCondition = (ops == "IS" ? "OR" : "AND");
                    const fieldOperator = (ops == "IS" ? "=" : "!=");
                    if (aliasTableName && !queryException) {
                        aliasKey = aliasTableName + '.' + key;
                    }
                    if (util.useOnlyNull.includes(key)) {
                        whereQStatement.push(`${aliasKey} ${operator} null`);
                    } else {
                        whereQStatement.push(`(${aliasKey} ${operator} null   ${fieldCondition}  ${aliasKey} ${fieldOperator} ${!['number', 'int', 'decimal'].includes(value.sqlType || type) ? "''" : 0})`);
                    }
                    continue;
                }
                if (sqlDateTypes.includes(value.sqlType || type)) {
                    let modifiedKey = key;
                    modifiedKey = modifiedKey + index;
                    const { query, where: whereF } = this.getDateFilter({ value: val, operator, key, modifiedKey });
                    whereQStatement.push(query);
                    whereQ = { ...whereQ, ...whereF }
                    continue;
                }
                let keyIndex = `${originalKey}_${index}`;
                if (keyIndex.indexOf('.') > -1) {
                    keyIndex = keyIndex.replace(/\./gi, '_');
                }
                // Modified part: Handle IN operator properly with STRING_SPLIT for array values
                if (operator == "IN" && Array.isArray(val) && custom) {
                    if (aliasTableName && !queryException) {
                        //{value: [], operator: IN, type}
                        whereQStatement.push(`${aliasTableName}.${key} IN (SELECT value FROM STRING_SPLIT(${prefix}${keyIndex}, ','))`);
                    } else {
                        if (type == "decimal" && !custom) {
                            whereQStatement.push(`CAST(${key} AS VARCHAR) IN (SELECT value FROM STRING_SPLIT(${prefix}${keyIndex}, ','))`);
                        } else {
                            whereQStatement.push(`${key} IN (SELECT value FROM STRING_SPLIT(${prefix}${keyIndex}, ','))`);
                        }
                    }
                } else {
                    const keyParams = operator == "IN" ? `(${prefix}{${keyIndex}})` : `${prefix}${keyIndex}`
                    let fieldName = aliasTableName && !queryException ? `${aliasTableName}.${key}` : key;

                    if (type == "decimal" && !custom) {
                        fieldName = `CAST(${fieldName} AS DECIMAL(18, 9))`;
                        whereQStatement.push(`${fieldName} ${operator} ${keyParams}`);
                    } else {
                        fieldName = useUpperFunction ? `UPPER(${fieldName})` : fieldName;
                        whereQStatement.push(`${fieldName} ${operator} ${keyParams}`);
                    }

                }
                whereQ[keyIndex] = { value: Array.isArray(val) ? val.join(',') : val, operator, sqlType: sqlType };
            }
        }
        return { where: whereQ, whereQStatement }
    },
    sqlTypeMappings: {
        string: mssql.VarChar,
        integer: mssql.Int,
        boolean: mssql.Bit,
        float: mssql.Float,
        "int": mssql.Int,
        "number": mssql.Int,
        "date": mssql.DateTime,
        "dateTime": mssql.DateTime,
        "nvarChar": mssql.NVarChar,
        "decimal": mssql.Decimal(18, 9)

    },
    mysqlTypeMappings: {
        string: mysql.VARCHAR,
        date: mysql.DATETIME,
        integer: mysql.INT24,
        boolean: mysql.BIT,
        decimal: mysql.DECIMAL,
        float: mysql.FLOAT,
        "int": mysql.Types.INT24,
        "number": mysql.Types.INT24,
        "dateTime": mysql.Types.DATETIME,
        "nvarChar": mysql.Types.STRING,
    },
    getSqlType: function (sqlType, prefix) {
        if (prefix === '@') {
            return this.sqlTypeMappings[sqlType] ?? mssql.NVarChar
        }
        return this.mysqlTypeMappings[sqlType] ?? mysql.Types.STRING;
    },
    canAdd: (module) => {
        const permission = module.Permissions.toString().split('').map(Number);
        return Boolean(permission[enums.PermissionType.Add]);
    },
    canDelete: (module) => {
        const permission = module.Permissions.toString().split('').map(Number);
        return Boolean(permission[enums.PermissionType.Delete]);
    },
    canEdit: (module) => {
        const permission = module.Permissions.toString().split('').map(Number);
        return Boolean(permission[enums.PermissionType.Edit]);
    },
    canExport: (module) => {
        const permission = module.Permissions.toString().split('').map(Number);
        return Boolean(permission[enums.PermissionType.Export]);
    },
    isFromDemo: function (req) {
        const referer = req?.get("Referer") || ""; // If undefined, default to an empty string
        return referer.includes("demo");
    }
};