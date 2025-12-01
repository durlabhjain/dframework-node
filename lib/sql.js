import mssql from 'mssql';
import fs from 'fs-extra';
import logger from './logger.js';
import util from './util.js';
import config from './appConfig.mjs';
const { maxQueryTime = 500 } = config || {};

const isNullNotNullOperators = ['IS NOT NULL', 'IS NULL'];

const createQueryLogger = function ({ queryLogThreshold, timeoutLogLevel, logger }) {
    return async function ({ query, start, end = Date.now(), parameters }) {
        const queryDurationInMs = (end - start);
        if (queryDurationInMs > queryLogThreshold) {
            logger[timeoutLogLevel]({
                query: query,
                duration: `${queryDurationInMs}ms`,
                parameters: parameters
            });
        }
    };
}

class Sql {

    logger = logger;

    dataTypes = {
        string: mssql.VarChar,
        date: mssql.DateTime2,
        integer: mssql.Int,
        boolean: mssql.Bit,
        withDecimals: [mssql.Decimal, mssql.Float, mssql.Money, mssql.SmallMoney],
        numeric: [mssql.TinyInt, mssql.SmallInt, mssql.Int, mssql.BigInt, mssql.Decimal, mssql.Float, mssql.Money, mssql.SmallMoney]
    };

    parameterPrefix = "@";
    forceCaseInsensitive = false;
    insertedIdStatement = "SELECT SCOPE_IDENTITY() AS Id;";

    async setConfig({ logger, timeoutLogLevel = "info", queryLogThreshold = 1000, forceCaseInsensitive, ...config } = {}) {
        if (logger) {
            this.logger = logger;
        }
        this.queryLogThreshold = queryLogThreshold;
        this.timeoutLogLevel = timeoutLogLevel;
        this.forceCaseInsensitive = forceCaseInsensitive;
        this.pool = await this.createPoolConnection(config);
    }

    async createPoolConnection(config) {
        if (config) {
            return await new mssql.ConnectionPool(config).connect();
        }
        else {
            return null;
        }
    }

    allowTvp = true;

    buildParameterName(paramName) {
        return "@" + paramName;
    }

    /**
     * Runs a SQL query and returns the result
     * @param {Object} config - Configuration object
     * @param {Object} config.request - SQL request object with parameters
     * @param {string} config.type - Query type: "query" or "execute"
     * @param {string} config.query - SQL query string
     * @returns {Promise<{success: boolean, data?: any, err?: Error}>} Result object
     * @important Always check the `success` flag before using the result data.
     * When success is false, the `err` property contains the error details.
     */
    async runQuery({ request, type = "query", query }) {
        try {
            if (util.useSqlParameterLength) {
                const { sqlParameterLength } = util;
                for (const parameter of Object.values(request.parameters)) {
                    switch (parameter.type) {
                        case mssql.VarChar:
                            if (isNaN(parameter.length)) {
                                parameter.length = parameter.value?.length <= sqlParameterLength.varchar ? sqlParameterLength.varchar : mssql.MAX;
                            }
                            break;
                        case mssql.NVarChar:
                            if (isNaN(parameter.length)) {
                                parameter.length = parameter.value?.length <= sqlParameterLength.nvarchar ? sqlParameterLength.nvarchar : mssql.MAX;
                            }
                            break;
                        case mssql.Decimal:
                            if (isNaN(parameter.scale)) {
                                parameter.scale = sqlParameterLength.decimal_scale;
                            }
                            if (isNaN(parameter.precision)) {
                                parameter.precision = sqlParameterLength.decimal_precision;
                            }
                            break;
                    }
                }
            }

            const startTime = Date.now();
            const result = await request[type](query);
            this.logSlowQuery({ startTime, query, type, request });
            return { success: true, data: result.recordset, ...result };
        } catch (err) {
            const loggerToUse = request._logger || this.logger;
            loggerToUse.error({ err, query, parameters: request.parameters, type });
        return { success: false, err, data: {} };
        }
    }

    logSlowQuery({ startTime, query, type, request }) {
        const executionTime = Date.now() - startTime;
        if (executionTime > maxQueryTime) { // 500 milliseconds
            const loggerToUse = request._logger || this.logger;
            loggerToUse.warn({
                message: `Query execution exceeded ${maxQueryTime} milliseconds`,
                query,
                executionTime: `${executionTime}ms`,
                type,
                parameters: request.parameters || request.params
            });
        }
    }

    async getQuery(query) {
        if (query.endsWith(".sql")) {
            query = (await fs.readFile(query)).toString();
        }
        return query;
    }

    /**
     * Executes a SQL query from a file or inline query string
     * @param {string} query - Query file path (ending in .sql) or query string
     * @param {Object} options - Query parameters
     * @returns {Promise<{success: boolean, data?: any, err?: Error}>} Result object
     * @important Always check the `success` flag before using the result data.
     * When success is false, the `err` property contains the error details.
     * @example
     * const result = await sql.query('SELECT * FROM Users WHERE Id = @Id', { Id: 1 });
     * if (result.success) {
     *   console.log(result.data);
     * } else {
     *   console.error('Query failed:', result.err);
     * }
     */
    async query(query, options) {
        const result = await this.execute({ query, ...options });
        if (result.err) {
            throw result.err;
        }
        return result.data;
    }

    /**
     *
     * @param {Object} config
     * @param {Object} config.request - sql request
     * @param {String} config.fieldName - field name - defaults to paramName
     * @param {String} config.paramName - parameter name - used as prefix
     * @param {String} config.operator - operator - defaults to "=" ("=" or "!=" or "in" or "not in")
     * @param {String} config.sqlType - sql type - defaults to this.dataTypes.integer. Use something like this.dataTypes.string for string
     * @param {Array} config.values - array of values - if passed as a string, values are split based on ","
     * @returns
     */
    in({ request, fieldName, paramName, values, ignoreZero = false, sqlType = this.dataTypes.integer, operator = "=", useTvp = false, tvpType, tvpColumnName, useSequence = true }) {
        if (typeof values === 'string') {
            values = values.split(',');
        }
        fieldName = fieldName || paramName;
        const paramNames = [];
        const { buildParameterName, dataTypes, allowTvp } = this;
        const isNumeric = dataTypes.numeric.includes(sqlType);
        const hasDecimals = dataTypes.withDecimals.includes(sqlType);
        let tvp, tvpColumnType = mssql.Int;
        if (useTvp) {
            if (!allowTvp) {
                throw new Error("TVP not allowed");
            }
            if (!tvpType) {
                if (isNumeric && !hasDecimals) {
                    tvpType = "dbo.IntList";
                    tvpColumnName = "Value";
                    tvpColumnType = mssql.Int;
                } else if (!isNumeric) {
                    tvpType = "dbo.StringList";
                    tvpColumnName = "Value";
                    tvpColumnType = mssql.VarChar(500);
                    useSequence = false;
                } else {
                    throw new Error(`tvpType is required`);
                }
            }
            if (!tvpColumnName) {
                throw new Error(`tvpColumnName is required`);
            }
            tvp = new mssql.Table(tvpType);
            tvp.columns.add(tvpColumnName, tvpColumnType, { nullable: false });
            if (useSequence) {
                tvp.columns.add('Sequence', mssql.Int, { nullable: false });
            }
        }
        for (let i = 0; i < values.length; i++) {
            let value = values[i];
            if (isNumeric) {
                if (typeof value === 'string') {
                    value = value.trim();
                    if (value.length > 0) {
                        if (Number.isNaN(value)) {
                            throw new Error(`Invalid value ${value} for ${paramName}`);
                        }
                        value = Number(value);
                    } else {
                        continue;
                    }
                } else if (typeof value !== 'number') {
                    throw new Error(`Invalid value type: ${typeof value} `);
                }
                if (ignoreZero && value === 0) {
                    continue;
                }
            }
            if (useTvp) {
                const row = useSequence ? [value, i] : [value];
                tvp.rows.add(...row);
            } else {
                const entryParamName = `${paramName}_${i}`;
                request.input(entryParamName, sqlType, value);
                paramNames.push(buildParameterName(entryParamName));
            }
        }

        if (operator === '=') {
            operator = "IN";
        } else if (operator === '!=') {
            operator = "NOT IN";
        }

        if (useTvp) {
            request.input(paramName, tvp);
            return { paramNames: [paramName], values: [tvp], statement: `${fieldName} ${operator} (SELECT ${tvpColumnName} FROM ${buildParameterName(paramName)})` };
        }

        const statement = `${fieldName} ${operator} (${paramNames.join(', ')})`;
        return { paramNames, values, statement }
    }

    /**
     *
     * @param {Object} config
     * @param {Object} config.request - sql request
     * @param {String} config.fieldName - field name - defaults to paramName
     * @param {String} config.paramName - parameter name - used as prefix
     * @param {String} config.operator - operator - defaults to "=" ("=" or "!=" or "in" or "not in")
     * @param {String} config.sqlType - sql type - determines based on values if not specified
     * @param {Array} config.values - array of values - if passed as a string, values are split based on ","
     * @returns
     */
    between({ request, fieldName, paramName, values, ignoreZero = false, sqlType, operator = "between", useTvp = false, tvpType, tvpColumnName }) {
        const { dataTypes, buildParameterName } = this;
        if (typeof values === 'string') {
            values = values.split(',');
        }
        if (sqlType === undefined || sqlType === null) {
            if (values[0] instanceof Date) {
                sqlType = dataTypes.date;
            } else if (typeof values[0] === 'number') {
                sqlType = dataTypes.integer;
            } else {
                sqlType = dataTypes.string;
            }
        }
        fieldName = fieldName || paramName;
        const paramNames = [];
        if (values.length !== 2) {
            throw new Error(`Between operator supports only 2 values, found ${values.length}`);
        }
        for (let i = 0; i < values.length; i++) {
            const value = values[i];
            const entryParamName = `${paramName}_${i}`;
            request.input(entryParamName, sqlType, value);
            paramNames.push(buildParameterName(entryParamName));
        }

        const statement = `${fieldName} ${operator} ${paramNames[0]} AND ${paramNames[1]}`;
        return { paramNames, values, statement }
    }

    /**
     * Creates Table Value Parameter
     * @param {*} config Configuration
     * @param {Array} config.values - array of values
     * @param {Object} config.request - sql request (optional)
     * @param {String} config.paramName - parameter name (optional)
     * @param {Object} config.columnTypes - column types
     * @param {String} config.tableType - table type (optional)
     * @returns {sql.Table} Table Value Parameter
     */
    createTVP({ values, request, paramName, columnTypes, tableType }) {
        const returnValue = tableType ? new mssql.Table(tableType) : new mssql.Table();
        if (!values?.length) {
            return returnValue;
        }
        const { dataTypes } = this;
        const keys = Object.keys(values[0]);
        if (!columnTypes) {
            const firstRow = values[0];
            // try to inference types from firstRow
            columnTypes = keys.reduce((acc, key) => {
                const value = firstRow[key];
                if (typeof value === 'number') {
                    acc[key] = dataTypes.integer;
                } else if (typeof value === 'string') {
                    acc[key] = dataTypes.string;
                } else if (typeof value === 'boolean') {
                    acc[key] = dataTypes.boolean;
                } else if (value instanceof Date) {
                    acc[key] = dataTypes.date;
                } else {
                    throw new Error(`Invalid type for ${key}: ${typeof value}`);
                }
                return acc;
            }, {});
        }
        for (const columnName in columnTypes) {
            returnValue.columns.add(columnName, columnTypes[columnName]);
        }
        for (const value of values) {
            const rowValues = [];
            for (const columnName in columnTypes) {
                rowValues.push(value[columnName]);
            }
            returnValue.rows.add(...rowValues);
        }

        if (request && paramName) {
            request.input(paramName, returnValue);
        }

        return returnValue;
    }

    /**
     * Creates an IntList Table-Valued Parameter (TVP) and optionally binds it to a request
     * 
     * @function createIntListTVP
     * @param {Object} params - Configuration object
     * @param {number[]} params.values - Array of integer values to populate the TVP
     * @param {mssql.Request} [params.request] - Optional mssql Request object to bind the TVP to
     * @param {string} [params.paramName] - Optional parameter name for binding to the request (required if request is provided)
     * 
     * @returns {mssql.Table} The configured TVP table with columns [Value: int, Sequence: int]
     * 
     * @description
     * Creates a Table-Valued Parameter matching the SQL Server type 'dbo.IntList'.
     * Each value is assigned an auto-incrementing sequence number starting from 1.
     * If both request and paramName are provided, the TVP is automatically bound to the request as an input parameter.
     * 
     * @example
     * // Create TVP without binding
     * const tvp = createIntListTVP({ values: [10, 20, 30] });
     * 
     * @example
     * // Create and bind TVP to request
     * const request = DFramework.sql.createRequest();
     * createIntListTVP({ 
     *   values: [100, 200, 300], 
     *   request: request, 
     *   paramName: 'IntListParam' 
     * });
     * SELECT 1 FROM @IntListParam;
     * await DFramework.sql.runQuery({ request, type: "query", query });
     * 
     * @throws {Error} May throw if values array contains non-integer values
     * 
     * @sqltype Matches SQL Server type: CREATE TYPE [dbo].[IntList] AS TABLE([Value] [int] NOT NULL, [Sequence] [int] NOT NULL)
     */
    createIntListTVP({ values, request, paramName }) {
        const table = new mssql.Table('dbo.IntList');
        table.columns.add('Value', mssql.Int, { nullable: false });
        table.columns.add('Sequence', mssql.Int, { nullable: false });
        // Add rows with auto-incrementing sequence
        values.forEach((value, index) => {
            table.rows.add(value, index + 1);
        });
        if (request && paramName) {
            request.input(paramName, table);
        }
        return table;
    }

    /**
     * Creates a StringList Table-Valued Parameter (TVP) and optionally binds it to a request
     * 
     * @function createStringListTVP
     * @param {Object} params - Configuration object
     * @param {string[]} params.values - Array of string values to populate the TVP (max length 500 characters each)
     * @param {mssql.Request} [params.request] - Optional mssql Request object to bind the TVP to
     * @param {string} [params.paramName] - Optional parameter name for binding to the request (required if request is provided)
     * 
     * @returns {mssql.Table} The configured TVP table with column [Value: varchar(500)]
     * 
     * @description
     * Creates a Table-Valued Parameter matching the SQL Server type 'dbo.StringList'.
     * Each string value is added as a separate row in the TVP with a maximum length of 500 characters.
     * If both request and paramName are provided, the TVP is automatically bound to the request as an input parameter.
     * 
     * @example
     * // Create TVP without binding
     * const tvp = createStringListTVP({ values: ['Item 1', 'Item 2', 'Item 3'] });
     * 
     * @example
     * // Create and bind TVP to request
     * const request = DFramework.sql.createRequest();
     * createStringListTVP({ 
     *   values: ['Product A', 'Product B', 'Product C'], 
     *   request: request, 
     *   paramName: 'StringListParam' 
     * });
     * SELECT 1 FROM @StringListParam
     * await DFramework.sql.runQuery({ request, type: "query", query });
     * 
     * @throws {Error} May throw if values exceed 500 characters or contain invalid data types
     * 
     * @sqltype Matches SQL Server type: CREATE TYPE [dbo].[StringList] AS TABLE([Value] [varchar](500) NOT NULL)
     */
    createStringListTVP({ values, request, paramName }) {
        const table = new mssql.Table('dbo.StringList');
        table.columns.add('Value', mssql.VarChar(500), { nullable: false });
        table.rows.add(values);
        if (request && paramName) {
            request.input(paramName, table);
        }
        return table;
    }

    /**
     *
     * @param {Object} options
     * @param {String} options.query - sql query
     * @param {Object} options.request - sql request
     * @param {Object} options.parameters - parameters. Example:
     * {
     * param1: value1,
     * param2: { value: "test" },
     * param3: [1, 2, 3]
     * param4: { value: "test", sqlType: this.dataTypes.string },
     * param5: { value: "test", sqlType: this.dataTypes.string, ignoreNull: false }
     * "SmartDevice.DeviceId": { value: "test", sqlType: this.dataTypes.string, ignoreNull: false }
     * param10: { fieldName: "SmartDevice.DeviceId", value: "test", sqlType: this.dataTypes.string, ignoreNull: false }
     * }
     * @returns {String} - updated sql query
     */
    addParameters({ query, request, parameters, forWhere = false }) {
        if (!parameters) {
            return query;
        }
        const { buildParameterName, dataTypes, forceCaseInsensitive } = this;
        const paramNames = Object.keys(parameters);
        const whereClauses = [];
        for (let index = 0, len = paramNames.length; index < len; index++) {
            let paramName = paramNames[index];
            const props = parameters[paramName];
            if (props === undefined || (typeof props === 'number' && isNaN(props))) {
                continue;
            }
            let operator = "=";
            let value = props;
            let ignoreNull = true;
            let fieldName = paramName;
            let sqlType, useTvp, tvpType, tvpColumnName, useSequence;
            if (props !== undefined && props !== null && typeof props === 'object') {
                if (props.statement) {
                    whereClauses.push(props.statement);
                    continue;
                }
                operator = props.operator || operator;
                value = props.value;
                ignoreNull = props.ignoreNull !== false;
                fieldName = props.fieldName || fieldName;
                sqlType = props.sqlType;
                useTvp = request.dbType === "sql" && (props.useTvp !== false);
                tvpType = props.tvpType;
                tvpColumnName = props.tvpColumnName;
                useSequence = props.useSequence;
            }

            if ((!isNullNotNullOperators.includes(operator)) && (value === undefined || (value === null && ignoreNull))) {
                continue;
            }

            if (forceCaseInsensitive) {
                if (typeof value === 'string' || sqlType === dataTypes.string) {
                    value = value.toUpperCase();
                    fieldName = `UPPER(${fieldName})`;
                }
                if (Array.isArray(value)) {
                    value = value.map(val => typeof val === 'string' ? val.toUpperCase() : val);
                    // Only apply UPPER() to fieldName if the array contains at least one string
                    const hasString = value.some(val => typeof val === 'string');
                    if(hasString) {
                        fieldName = `UPPER(${fieldName})`;
                    }
                }
            }

            if (paramName.indexOf('.') > -1) {
                const parts = paramName.split('.');
                paramName = parts[parts.length - 1];
            }
            let statement = `${fieldName} ${operator}${!isNullNotNullOperators.includes(operator) ? ` ${buildParameterName(paramName)}` : ''}`;
            const isBetweenOperator = operator.toLowerCase() === 'between' || operator.toLowerCase() === 'not between';

            if (Array.isArray(value) || ["in", "not in"].includes(operator.toLowerCase())) {
                const inResult = isBetweenOperator ? this.between({ request, fieldName, paramName, values: value, operator, sqlType: sqlType || dataTypes.integer }) : this.in({ request, fieldName, paramName, values: value, operator, sqlType: sqlType || dataTypes.integer, useTvp, tvpType, tvpColumnName, useSequence });
                if (inResult.paramNames.length === 0) {
                    continue;
                }
                statement = inResult.statement;
                if (query && !isBetweenOperator) {
                    // ability to replace @{FieldName} if we have embedded parameter in inner query
                    query = query.replaceAll(`${this.parameterPrefix}{${paramName}}`, inResult.paramNames.join(', '));
                }
            } else {
                if (sqlType !== undefined && sqlType !== null) {
                    request.input(paramName, sqlType, value);
                } else {
                    request.input(paramName, value);
                }
            }

            if (forWhere) {
                whereClauses.push(statement);
            }
        }
        if (whereClauses.length > 0) {
            query += " WHERE " + whereClauses.join(' AND ');
        }
        return query;
    }

    /**
     * Executes a stored procedure or query with parameters
     * @param {Object} config - Configuration object
     * @param {string} config.query - Stored procedure name or query string
     * @param {Object} config.parameters - Procedure/query parameters
     * @param {Object} config.where - WHERE clause parameters (optional)
     * @param {string} config.orderBy - ORDER BY clause (optional)
     * @param {boolean} config.isStoredProcedure - Whether query is a stored procedure
     * @param {Object} config.request - Existing request object (optional)
     * @param {Object} config.logger - Logger instance for request context (optional)
     * @returns {Promise<{success: boolean, data?: any, err?: Error}>} Result object
     * @important Always check the `success` flag before using the result data.
     * When success is false, the `err` property contains the error details.
     */
    async execute({ query, parameters, where, orderBy, isStoredProcedure, request, logger }) {
        query = await this.getQuery(query);
        isStoredProcedure = isStoredProcedure === true || !query.match(/SELECT |INSERT |UPDATE |DELETE |SET |DECLARE /i);
        request = request || this.createRequest(logger);
        query = this.addParameters({ query, request, parameters, forWhere: false });
        query = this.addParameters({ query, request, parameters: where, forWhere: true });

        if (orderBy) {
            query += " ORDER BY " + orderBy;
        }
        const type = isStoredProcedure ? "execute" : "query";
        return this.runQuery({ request, type, query });
    }

    createProxy = (originalFunction, queryLogger) => {
        return new Proxy(originalFunction, {
            apply: async function (target, thisArg, args) {
                const queryStartTime = Date.now();
                const returnValue = await Reflect.apply(target, thisArg, args);
                const [query] = args;
                queryLogger({ query, start: queryStartTime, end: Date.now(), parameters: thisArg.parameters });
                return returnValue;
            }
        });
    };

    createRequest(logger) {
        const loggerToUse = logger || this.logger;
        const queryLogger = createQueryLogger({ 
            queryLogThreshold: this.queryLogThreshold, 
            timeoutLogLevel: this.timeoutLogLevel, 
            logger: loggerToUse 
        });
        const request = this.pool.request();
        request.query = this.createProxy(request.query, queryLogger);
        request.execute = this.createProxy(request.execute, queryLogger);
        request._logger = loggerToUse;
        request.dbType = "sql";

        return request;
    }

    async insertUpdate({ tableName, json, keyField, update = false, logger }) {
        const { buildParameterName, insertedIdStatement } = this;
        const request = this.createRequest(logger);
        const propNames = Object.keys(json);
        propNames.forEach(prop => { // add parameters to the statement 
            request.input(prop, json[prop]);
        });
        let statement;
        if (update) {
            statement = `UPDATE ${tableName} SET ${propNames.filter(propName => propName !== keyField).map(prop => `${prop} = ${buildParameterName(prop)}`).join(', ')} WHERE ${keyField} = ${buildParameterName(keyField)} `;
        } else {
            statement = `INSERT INTO ${tableName} (${propNames.join(', ')}) VALUES(${propNames.map(prop => buildParameterName(prop)).join(', ')});${insertedIdStatement}`;
        }
        return this.runQuery({ request, type: "query", query: statement });
    }

    /**
     * @desc insert the record
     * @param {Object} - json - Json Object
     * @param {String} - tableName
     */
    async insert(json, tableName) {
        return this.insertUpdate({ tableName, json, update: false });
    }
    /**
     * @desc update the record
     * @param {Object} - json - Json Object
     * @param {String} - tableName
     */
    async update(json, tableName, keyField) {
        return this.insertUpdate({ tableName, json, keyField, update: true });
    }

    async join({ query, matchColumn, matchValue, rows, matchColumnTableName }) {
        const { buildParameterName, dataTypes, runQuery } = this;
        const ids = {};
        for (let rowIndex = 0, rowCount = rows.length; rowIndex < rowCount; rowIndex++) {
            const row = rows[rowIndex];
            const value = row[matchValue];
            if (typeof (value) === 'number') {
                let idInfo = ids[value];
                if (idInfo === undefined) {
                    idInfo = { key: value, rows: [] };
                    ids[value] = idInfo;
                }
                idInfo.rows = [...idInfo.rows, rowIndex];
            }
        }

        const request = this.createRequest();
        let paramIndex = -1;
        const paramNames = [];
        for (const id in ids) {
            const paramName = matchColumn + (++paramIndex);
            request.input(paramName, dataTypes.integer, ids[id].key);
            paramNames.push(buildParameterName(paramName));
        }
        if (paramIndex > -1) {
            request.arrayRowMode = true;
            const matchColumnToUse = matchColumnTableName ? `${matchColumnTableName}.${matchColumn}` : `${matchColumn}`
            query = await this.getQuery(query);
            const statement = query + ` WHERE ${matchColumnToUse} IN ( ${paramNames.join(',')} )`;
            const result = await runQuery({ request, type: "query", query: statement });
            const { columns } = result.data;
            const colCount = columns.length;
            const keyColumnIndex = columns.find(columnInfo => columnInfo.name === matchColumn).index;
            for (const row of result.data) {
                const key = row[keyColumnIndex];
                const rowIndexes = ids[key].rows;
                const valuesToAssign = {}
                for (let colIndex = 0; colIndex < colCount; colIndex++) {
                    if (colIndex !== keyColumnIndex) {
                        valuesToAssign[columns[colIndex].name] = row[colIndex];
                    }
                }
                for (const rowIndex of rowIndexes) {
                    Object.assign(rows[rowIndex], valuesToAssign);
                }
            }
        }
    }
}

export default Sql;

export { mssql, createQueryLogger };