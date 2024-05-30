import mssql from 'mssql';
import fs from 'fs-extra';
import logger from './logger.js';

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
        date: mssql.DateTime,
        integer: mssql.Int,
        boolean: mssql.Bit,
        withDecimals: [mssql.Decimal, mssql.Float, mssql.Money, mssql.SmallMoney],
        numeric: [mssql.TinyInt, mssql.SmallInt, mssql.Int, mssql.BigInt, mssql.Decimal, mssql.Float, mssql.Money, mssql.SmallMoney]
    };

    parameterPrefix = "@";

    insertedIdStatement = "SELECT SCOPE_IDENTITY() AS Id;";

    async setConfig({ logger, timeoutLogLevel = "info", queryLogThreshold = 1000, ...config } = {}) {
        if (logger) {
            this.logger = logger;
        }
        this.queryLogThreshold = queryLogThreshold;
        this.timeoutLogLevel = timeoutLogLevel;
        if (config) {
            this.pool = await new mssql.ConnectionPool(config).connect();
        } else if (this.pool) {
            this.pool = null;
        }
    }

    allowTvp = true;

    buildParameterName(paramName) {
        return '@' + paramName;
    }

    async runQuery({ request, type = "query", query, data = null }) {
        try {
            const result = await request[type](query);
            return { sucess: true, data: result.recordset, ...result }
        }
        catch(err) {
            return { success: false, err, data: {} };
        }
    }

    async getQuery(query) {
        if (query.endsWith(".sql")) {
            query = await (await fs.readFile(query)).toString();
        }
        return query;
    }

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
     * @param {String} config.sqlType - sql type - defaults to mssql.Int. Use something like mssql.VarChar for string
     * @param {Array} config.values - array of values - if passed as a string, values are split based on ","
     * @returns 
     */
    in({ request, fieldName, paramName, values, ignoreZero = false, sqlType = this.dataTypes.integer, operator = "=", useTvp = false, tvpType, tvpColumnName }) {
        if (typeof values === 'string') {
            values = values.split(',');
        }
        fieldName = fieldName || paramName;
        const paramNames = [];
        const { buildParameterName} = this;
        let tvp;
        if (useTvp) {
            if(!this.allowTvp) {
                throw new Error('TVP not allowed');
            }
            if (!tvpType) {
                if (isNumeric && !hasDecimals) {
                    tvpType = "dbo.IntList";
                    tvpColumnName = "IntValue";
                } else if (!isNumeric) {
                    tvpType = "dbo.StringList";
                    tvpColumnName = "StringValue";
                } else {
                    throw new Error(`tvpType is required`);
                }
            }
            if (!tvpColumnName) {
                throw new Error(`tvpColumnName is required`);
            }
            tvp = new mssql.Table(tvpType);
        }
        for (var i = 0; i < values.length; i++) {
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
                tvp.rows.add(value);
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
        for (var i = 0; i < values.length; i++) {
            const value = values[i];
            const entryParamName = `${paramName}_${i}`;
            request.input(entryParamName, sqlType, value);
            paramNames.push(buildParameterName(paramName));
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
     * @returns {sql.Table} Table Value Parameter
     */
    createTVP({ values, request, paramName, columnTypes }) {
        const returnValue = new mssql.Table();
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
        for (let i = 0; i < values.length; i++) {
            const row = values[i];
            const rowValues = [];
            for (const columnName in columnTypes) {
                rowValues.push(row[columnName]);
            }
            returnValue.rows.add(...rowValues);
        }

        if (request && paramName) {
            request.input(paramName, returnValue);
        }

        return returnValue;
    }

    /**
     * Creates Table Value Parameter for list of values
     * @param {*} config Configuration
     * @param {Array} config.values - array of values
     * @param {Object} config.request - sql request (optional)
     * @param {String} config.paramName - parameter name (optional)
     * @param {String} config.tvpType - table variable parameter type (optional)
     * @param {String} config.columnName - column name (optional) - default IntValue
     * @param {Object} config.sqlType - sql type (optional) - default mssql.Int
     * @returns {sql.Table} Table Value Parameter
     */
    createValueListTVP({ values, request, paramName, tvpType, columnName = "IntValue", sqlType = this.dataTypes.numeric }) {
        const returnValue = new mssql.Table(tvpType);
        returnValue.columns.add(columnName, sqlType);
        for (let i = 0; i < values.length; i++) {
            returnValue.rows.add(values[i]);
        }

        if (request && paramName) {
            request.input(paramName, returnValue);
        }

        return returnValue;
    }

    /**
     * Creates Table Value Parameter for list of values (integers)
     * @param {*} config Configuration
     * @param {Array} config.values - array of values
     * @param {Object} config.request - sql request (optional)
     * @param {String} config.paramName - parameter name (optional)
     * @param {String} config.columnName - column name (optional) - default IntValue
     * @param {Object} config.sqlType - sql type (optional) - default mssql.Int
     * @param {String} config.tvpType - table variable parameter type (optional) - defaults to IntList
     * @returns {sql.Table} Table Value Parameter
     */
    createIntListTVP({ values, request, paramName, columnName = "IntValue", tvpType = "dbo.IntList" }) {
        return this.createValueListTVP({ values, request, paramName, tvpType, columnName, sqlType: this.dataTypes.numeric });
    }


    /**
     * Creates Table Value Parameter for list of values (strings)
     * @param {*} config Configuration
     * @param {Array} config.values - array of values
     * @param {Object} config.request - sql request (optional)
     * @param {String} config.paramName - parameter name (optional)
     * @param {String} config.columnName - column name (optional) - default IntValue
     * @param {Object} config.sqlType - sql type (optional) - default mssql.VarChar
     * @param {String} config.tvpType - table variable parameter type (optional) - defaults to StringList
     * @returns {sql.Table} Table Value Parameter
     */
    createStringListTVP({ values, request, paramName, columnName = "StringValue", tvpType = "StringList" }) {
        return this.createValueListTVP({ values, request, paramName, tvpType, columnName, sqlType: this.dataTypes.numeric });
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
     * param4: { value: "test", sqlType: mssql.VarChar },
     * param5: { value: "test", sqlType: mssql.VarChar, ignoreNull: false }
     * "SmartDevice.DeviceId": { value: "test", sqlType: mssql.VarChar, ignoreNull: false }
     * param10: { fieldName: "SmartDevice.DeviceId", value: "test", sqlType: mssql.VarChar, ignoreNull: false }
     * }
     * @returns {String} - updated sql query
     */
    addParameters({ query, request, parameters, forWhere = false }) {
        if (!parameters) {
            return query;
        }
        const { buildParameterName } = this;
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
            let sqlType;
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
            }

            if ((!isNullNotNullOperators.includes(operator)) && (value === undefined || (value === null && ignoreNull))) {
                continue;
            }

            if (paramName.indexOf('.') > -1) {
                const parts = paramName.split('.');
                paramName = parts[parts.length - 1];
            }
            let statement = `${fieldName} ${operator}${!isNullNotNullOperators.includes(operator) ? ` ${buildParameterName(paramName)}` : ''}`;
            const isBetweenOperator = operator.toLowerCase() === 'between' || operator.toLowerCase() === 'not between';

            if (Array.isArray(value) || ["in", "not in"].includes(operator.toLowerCase())) {
                const inResult = isBetweenOperator ? this.between({ request, fieldName, paramName, values: value, operator, sqlType: sqlType || mssql.VarChar }) : this.in({ request, fieldName, paramName, values: value, operator, sqlType: sqlType || mssql.Int });
                if (inResult.paramNames.length === 0) {
                    continue;
                }
                statement = inResult.statement;
                if (query && !isBetweenOperator) {
                    // ability to replace @{FieldName} if we have embedded parameter in inner query
                    query = query.replace(`@{${fieldName}}`, inResult.paramNames.join(', '));
                }
            } else {
                if (sqlType) {
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
     * @desc update the record
     * @param {Object} - sql query - Json Object
     * @param {Object} - parameters
     * @param {Object} - isStoredProcedure
     */
    async execute({ query, parameters, where, orderBy, isStoredProcedure }) {
        query = await this.getQuery(query);
        isStoredProcedure = isStoredProcedure === true || !query.match(/SELECT |INSERT |UPDATE |DELETE |SET |DECLARE /i);
            const request = this.createRequest();
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

    createRequest() {
        const request = this.pool.request(), queryLogger = createQueryLogger(this);
        request.query = this.createProxy(request.query, queryLogger);
        request.execute = this.createProxy(request.execute, queryLogger);

        return request;
    }

    async insertUpdate({ tableName, json, keyField, update = false }) {
        const { buildParameterName} = this;
        const request = await this.createRequest();
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
        return this.runQuery({request, type: "query", query: statement });
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

    async join({ query, matchColumn, matchValue, rows }) {
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
            request.input(paramName, mssql.Int, ids[id].key);
            paramNames.push(this.buildParameterName(paramName));
        }
        if (paramIndex > -1) {
            request.arrayRowMode = true;
            query = await this.getQuery(query);
            const statement = query + ` WHERE ${matchColumn} IN ( ${paramNames.join(',')} )`;
            const result = await this.runQuery({ request, type: "query", query: statement});
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