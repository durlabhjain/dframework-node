import mssql from 'mssql';
import fs from 'fs-extra';

class Sql {
    async setConfig(config) {
        if (config) {
            this.pool = await mssql.connect(config);
        } else if (this.pool) {
            this.pool = null;
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

    in({ request, field, prefix, values, ignoreZero = false, sqlType = mssql.Int, operator = "=" }) {
        if (typeof values === 'string') {
            values = values.split(',');
        }
        prefix = prefix || field;
        const paramNames = [];
        for (var i = 0; i < values.length; i++) {
            let value = values[i];
            let n;
            if ([mssql.TinyInt, mssql.SmallInt, mssql.Int, mssql.BigInt, mssql.Decimal, mssql.Float, mssql.Money, mssql.SmallMoney].includes(sqlType)) {
                if (typeof value === 'string') {
                    value = value.trim();
                    if (value.length > 0) {
                        if (Number.isNaN(value)) {
                            throw new Error(`Invalid value ${value} for ${field}`);
                        }
                        n = Number(value);
                    } else {
                        continue;
                    }
                } else if (typeof value === 'number') {
                    n = value;
                } else {
                    throw new Error(`Invalid value type: ${typeof value} `);
                }
                if (ignoreZero && n === 0) {
                    continue;
                }
            }
            const paramName = `${prefix}_${i}`;
            request.input(paramName, sqlType, n);
            paramNames.push('@' + paramName);
        }

        if (operator === '=') {
            operator = "IN";
        } else if (operator === '!=') {
            operator = "NOT IN";
        }

        const statement = `${field} ${operator} (${paramNames.join(', ')})`;
        return { paramNames, values, statement }
    }

    addParameters({ query, request, parameters, forWhere = false }) {
        if (!parameters) {
            return query;
        }
        const fieldNames = Object.keys(parameters);
        for (let index = 0, len = fieldNames.length; index < len; index++) {
            const fieldName = fieldNames[index];
            const props = parameters[fieldName];
            let operator = props.operator || "=";
            const value = props.operator ? props.value : props;
            let paramName = `@${fieldName}`;
            let statement = `${fieldName} ${operator} ${paramName}`;

            if (Array.isArray(value) || ["in", "not in"].includes(operator.toLowerCase())) {
                const inResult = this.in({ request, field: fieldName, values: value, operator });
                if (inResult.paramNames.length === 0) {
                    continue;
                }
                statement = inResult.statement;
                if (query) {
                    query = query.replace(`@{${fieldName}}`, inResult.paramNames.join(', '));
                }
            }

            if (forWhere) {
                query += `${index === 0 ? "" : " AND "} ${statement}`;
            }
            request.input(fieldName, value);
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
        try {
            const request = this.createRequest();
            query = this.addParameters({ query, request, parameters, forWhere: false });
            if (where) {
                query += " WHERE ";
            }
            query = this.addParameters({ query, request, parameters: where, forWhere: true });

            if (orderBy) {
                query += " ORDER BY " + orderBy;
            }

            const result = isStoredProcedure ? await request.execute(query) : await request.query(query);
            return { success: true, data: result.recordset };
        } catch (err) {
            return { success: false, err, data: {} };
        }
    }

    createRequest() {
        return this.pool.request();
    }

    async insertUpdate({ tableName, json, keyField, update = false }) {
        try {
            const request = await this.createRequest();
            const propNames = Object.keys(json);
            propNames.forEach(prop => { // add parameters to the statement 
                request.input(prop, json[prop]);
            });
            let statement;
            if (update) {
                statement = `UPDATE ${tableName} SET ${propNames.filter(propName => propName !== keyField).map(prop => `${prop} = @${prop}`).join(', ')} WHERE ${keyField} = @${keyField} `;
            } else {
                statement = `INSERT INTO ${tableName} (${propNames.join(', ')}) VALUES(${propNames.map(prop => '@' + prop).join(', ')});SELECT SCOPE_IDENTITY() AS Id; `;
            }
            const result = await request.query(statement);
            return { success: true, data: result.recordset };
        } catch (err) {
            return { success: false, err, data: {} };
        }
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
    static async update(json, tableName, keyField) {
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
            paramNames.push("@" + paramName);
        }
        if (paramIndex > -1) {
            request.arrayRowMode = true;
            query = await this.getQuery(query);
            const result = await request.query(query + ` WHERE ${matchColumn} IN ( ${paramNames.join(',')} )`);
            const { columns } = result.recordset;
            const colCount = columns.length;
            const keyColumnIndex = columns.find(columnInfo => columnInfo.name === matchColumn).index;
            for (const row of result.recordset) {
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

export { mssql };