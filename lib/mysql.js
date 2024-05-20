import mysql from "mysql2/promise";
import Sql from "./sql.js";


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
class MySql extends Sql {

    setConfig({ logger, timeoutLogLevel = "info", queryLogThreshold = 1000, ...config } = {}) {
        if (logger) {
            this.logger = logger;
        }
        this.queryLogThreshold = queryLogThreshold;
        this.timeoutLogLevel = timeoutLogLevel;
        if (config) {
            this.pool = mysql.createPool(config);
        } else if (this.pool) {
            this.pool = null;
        }
    }

    in({ request, fieldName, paramName, values, ignoreZero = false, sqlType = mssql.Int, operator = "=" }) {
        if (typeof values === 'string') {
            values = values.split(',');
        }
        fieldName = fieldName || paramName;
        const paramNames = [];
        const isNumeric = [mssql.TinyInt, mssql.SmallInt, mssql.Int, mssql.BigInt, mssql.Decimal, mssql.Float, mssql.Money, mssql.SmallMoney].includes(sqlType);
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
            const entryParamName = `${paramName}_${i}`;
            request.input(entryParamName, value);
            paramNames.push(':' + entryParamName);            
        }

        if (operator === '=') {
            operator = "IN";
        } else if (operator === '!=') {
            operator = "NOT IN";
        }
        const statement = `${fieldName} ${operator} (${paramNames.join(', ')})`;
        return { paramNames, values, statement }
    }

    between({ request, fieldName, paramName, values, ignoreZero = false, sqlType, operator = "between" }) {
        if (typeof values === 'string') {
            values = values.split(',');
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
            paramNames.push(':' + entryParamName);
        }

        const statement = `${fieldName} ${operator} ${paramNames[0]} AND ${paramNames[1]}`;
        return { paramNames, values, statement }
    }

    addParameters({ query, request, parameters, forWhere = false }) {
        if (!parameters) {
            return query;
        }
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

            if (value === undefined || (value === null && ignoreNull)) {
                continue;
            }

            if (paramName.indexOf('.') > -1) {
                const parts = paramName.split('.');
                paramName = parts[parts.length - 1];
            }
            let statement = `${fieldName} ${operator} :${paramName}`;
            const isBetweenOperator = operator.toLowerCase() === 'between' || operator.toLowerCase() === 'not between';

            if (Array.isArray(value) || ["in", "not in"].includes(operator.toLowerCase())) {
                const inResult = isBetweenOperator ? this.between({ request, fieldName, paramName, values: value, operator, sqlType: sqlType || mssql.VarChar }) : this.in({ request, fieldName, paramName, values: value, operator, sqlType: sqlType || mssql.Int });
                if (inResult.paramNames.length === 0) {
                    continue;
                }
                statement = inResult.statement;
                if (query && !isBetweenOperator) {
                    // ability to replace @{FieldName} if we have embedded parameter in inner query
                    query = query.replace(`:{${fieldName}}`, inResult.paramNames.join(', '));
                }
            } else {               
                request.input(paramName, value);              
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

    async execute({ query, parameters, where, orderBy, isStoredProcedure }) {
        query = await this.getQuery(query);
        try {
            const request = this.createRequest();
            query = this.addParameters({ query, request, parameters, forWhere: false });
            query = this.addParameters({ query, request, parameters: where, forWhere: true });

            if (orderBy) {
                query += " ORDER BY " + orderBy;
            }
            const [result, fields] = await request.query(query);
            return { success: true, data: result[0], ...result };
        } catch (err) {
            return { success: false, err, data: {} };
        }
    }

    createRequest() {
        const request = this.pool, queryLogger = createQueryLogger(this);
        request.query = this.createProxy(request.query, queryLogger);
        request.execute = this.createProxy(request.query, queryLogger);
        request.input = this.input;
        request.where = {};

        return request;
    }

    async insertUpdate({ tableName, json, keyField, update = false }) {
        const request = this.createRequest();
        const propNames = Object.keys(json);
        propNames.forEach(prop => { // add parameters to the statement 
            request.input(prop, json[prop]);
        });
        let statement;
        if (update) {
            statement = `UPDATE ${tableName} SET ${propNames.filter(propName => propName !== keyField).map(prop => `${prop} = :${prop}`).join(', ')} WHERE ${keyField} = :${keyField} `;
        } else {
            statement = `INSERT INTO ${tableName} (${propNames.join(', ')}) VALUES(${propNames.map(prop => ':' + prop).join(', ')});SELECT LAST_INSERT_ID() AS Id; `;
        }
        const [result, field] = await request.query(statement);
        return { success: true, data: result };
    }

    async insert(json, tableName) {
        return this.insertUpdate({ tableName, json });
    }

    async update(json, tableName, keyField) {
        return this.insertUpdate({ tableName, json, keyField, update: true });
    }

    input(key, value) {
        if(!this.where) this.where = {};
        this.where[key] = value;
    }
}


export default MySql;

export { mysql };