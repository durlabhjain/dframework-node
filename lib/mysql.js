import mysql from 'mysql2/promise.js';
import fs from 'fs-extra';
import logger from './logger.js';




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

class MySql {
	logger = logger;

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

    enums = {
        startDateTime: '00:00:00',
        endDateTime: '23:59:59',
    };
    dateTimeEnum = {
        DateTime: 'dateTime',
        DateTimeLocal: 'dateTimeLocal'
    };
    dateTypeFields = ["date", "dateTime"];
    RelationshipTypes = {
        OneToMany: "OneToMany",
        OneToOne: "OneToOne"
    };
    filterFields = {
        CreatedByUser: "Created_",
        ModifiedByUser: "Modified_"
    }
    compareLookups = {
        "contains": function ({ v, type }) {
            return { operator: 'LIKE', value: `%${v}%`, type: type };
        },
        "startsWith": function ({ v, type }) {
            return { operator: 'LIKE', value: `${v}%`, type: type };
        },
        "endsWith": function ({ v, type }) {
            return { operator: 'LIKE', value: `%${v}`, type: type };
        },
        "notContains": function ({ v, type }) {
            return { operator: 'NOT LIKE', value: `%${v}%`, type: type };
        },
        "=": function ({ v, type }) {
            return { operator: '=', value: v === '' ? null : v, type: type };
        },
        "!=": function ({ v, type }) {
            return { operator: '!=', value: v === '' ? null : v, type: type };
        },
        "isEmpty": function ({ type }) {
            return { operator: 'IS', value: "IsEmpty", type: type };
        },
        "isNotEmpty": function ({ type }) {
            return { operator: 'IS NOT', value: "IsEmpty", type: type };
        },
        ">": function ({ v, type }) {
            return { operator: '>', value: v, type: type };
        },
        "<": function ({ v, type }) {
            return { operator: '<', value: v, type: type };
        },
        ">=": function ({ v, type }) {
            return { operator: '>=', value: v, type: type };
        },
        "<=": function ({ v, type }) {
            return { operator: '<=', value: v, type: type };
        },
        "is": function ({ v, type }) {
            let toReturn = {};
            if (dateTypeFields.includes(type)) {
                let values = [];
                if (typeof v === 'object') {
                    values = v;
                } else {
                    for (let index = 0; index < 2; index++) {
                        const isFirstIndex = index === 0;
                        values.push(isFirstIndex ? `${v} ${enums.startDateTime}` : `${v} ${enums.endDateTime}`);
                    }
                }
                if (type === dateTimeEnum.DateTimeLocal) {
                    toReturn = { operator: 'DATETIME', value: v, sqlType: mysql.Types.DATETIME }
                } else {
                    toReturn = { operator: 'BETWEEN', value: values, sqlType: mysql.Types.VARCHAR, type: type };
                }
            } else {
                toReturn = { operator: '=', value: v, type: type };
            }
            return toReturn;
        },
        "not": function ({ v, type }) {
            if (dateTypeFields.includes(type)) {
                const values = [];
                for (let index = 0; index < 2; index++) {
                    const isFirstIndex = index === 0;
                    values.push(isFirstIndex ? `${v} ${enums.startDateTime}` : `${v} ${enums.endDateTime}`);
                }
                if (type === dateTimeEnum.DateTimeLocal) {
                    return { operator: 'NOT BETWEEN DATE', value: v, sqlType: mysql.Types.DATETIME, type: type };
                }
                return { operator: 'NOT BETWEEN', value: values, sqlType: mysql.Types.VARCHAR, type: type };
            } else {
                return { operator: '!=', value: v, sqlType: mysql.Types.VARCHAR, type: type };
            }
        },
        "onOrAfter": function ({ v, type }) {
            if (type === dateTimeEnum.DateTimeLocal) {
                return { operator: '>=', value: `${v}`, type: type };
            }
            return { operator: '>=', value: `${v} ${enums.startDateTime}`, type: type };
        },
        "onOrBefore": function ({ v, type }) {
            if (type === dateTimeEnum.DateTimeLocal) {
                return { operator: '<=', value: `${v}`, type: type };
            }
            return { operator: '<=', value: `${v} ${enums.endDateTime}`, type: type };
        },
        "after": function ({ v, type }) {
            if (type === dateTimeEnum.DateTimeLocal) {
                return { operator: '>', value: `${v}`, type: type };
            }
            return { operator: '>', value: `${v} ${enums.endDateTime}`, type: type };
        },
        "before": function ({ v, type }) {
            if (type === dateTimeEnum.DateTimeLocal) {
                return { operator: '<', value: `${v}`, type: type };
            }
            return { operator: '<', value: `${v} ${enums.startDateTime}`, type: type };
        },
        "isAnyOf": function ({ v, type }) {
            return { operator: 'IN', value: v, sqlType: mysql.Types.VARCHAR, type: type };
        },
        "isTrue": function () {
            return { operator: '=', value: true };
        },
        "isFalse": function () {
            return { operator: '=', value: false };
        },
        "isOnOrAfter": function ({ v, type }) {
            return { operator: '>=', value: v, type: type };
        },
        "isToday": function () {
            return { operator: '=', value: new Date() };
        },
        "isYesterday": function () {
            return { operator: '=', value: new Date(Date.now() - 86400000) };
        },
        "isTomorrow": function () {
            return { operator: '=', value: new Date(Date.now() + 86400000) };
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

    in({ request, fieldName, paramName, values, ignoreZero = false, sqlType = mysql.Types.INT24, operator = "=" }) {
        if (typeof values === 'string') {
            values = values.split(',');
        }
        if(values.length < 1) return '';
        fieldName = fieldName || paramName;
        const isNumeric = [mysql.Types.TINY, mysql.Types.INT24, mysql.Types.DECIMAL, mysql.Types.FLOAT, mysql.Types.LONG].includes(sqlType);
        
		
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
        }

        if (operator === '=') {
            operator = "IN";
        } else if (operator === '!=') {
            operator = "NOT IN";
        }
        request.whereValues.push(values);

        const statement = `${fieldName} ${operator} (?)`;
        return statement
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
    between({ request, fieldName, paramName, values, sqlType, operator = "between" }) {
        if (typeof values === 'string') {
            values = values.split(',');
        }
        if(values.length < 1) return '';        
        fieldName = fieldName || paramName;
        if (values.length !== 2) {
            throw new Error(`Between operator supports only 2 values, found ${values.length}`);
        }
		values.forEach(value => request.whereValues.push(value));

        const statement = `${fieldName} ${operator} ? AND ?`;
        return statement;
    }

	addParameters({ query, request, parameters }) {
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
            let statement = `${fieldName} ${operator} ?`;
            const isBetweenOperator = operator.toLowerCase() === 'between' || operator.toLowerCase() === 'not between';

            if (Array.isArray(value) || ["in", "not in"].includes(operator.toLowerCase())) {
                const inResult = isBetweenOperator ? this.between({ request, fieldName, paramName, values: value, operator, sqlType: sqlType || mysql.Types.VARCHAR }) : this.in({ request, fieldName, paramName, values: value, operator, sqlType: sqlType || mysql.Types.INT24 });
                statement = inResult;
            } 
            else if (["is", "is not"].includes(operator.toLowerCase())) {               
                    if (["IsChestCooler"].includes(fieldName)) {
                        statement = `${fieldName} ${operator} null`;                       
                    }
                    else statement = `(${fieldName} ${operator} null   ${operator == "IS" ? "OR" : "AND"}  ${fieldName} ${operator == "IS" ? "=" : "!="} ${!['number', 'int'].includes(sqlType) ? "''" : 0})`;
                }
            else {               
				request.whereValues.push(value);                
            }

            if(statement.length > 0)
                whereClauses.push(statement);
            
        }
        if (whereClauses.length > 0) {
            query += " WHERE " + whereClauses.join(' AND ');
        }
        return query;
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
        const request = this.pool, queryLogger = createQueryLogger(this);
        request.query = this.createProxy(request.query, queryLogger);
		request.whereValues = [];
        return request;
    }


	
}

export default MySql;

export { mysql };