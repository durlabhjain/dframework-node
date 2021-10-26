import mssql from 'mssql';
import fs from 'fs-extra';

class Sql {
    constructor() {
    }

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

    async query(query, { orderBy } = {}) {
        query = await this.getQuery(query);
        if (orderBy) {
            query += " ORDER BY " + orderBy;
        }
        const result = await this.createRequest().query(query);
        return result.recordset;
    }

    createRequest() {
        return this.pool.request();
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
    async insertUpdate({ tableName, json, keyField, update = false }) {
        try {
            const request = await this.createRequest();
            const propNames = Object.keys(json);
            propNames.forEach(prop => { // add parameters to the statement 
                request.input(prop, json[prop]);
            });
            let statement;
            if (update) {
                statement = `UPDATE ${tableName} SET ${propNames.filter(propName => propName !== keyField).map(prop => `${prop} = @${prop}`).join(', ')} WHERE ${keyField} = @${keyField}`;
            } else {
                statement = `INSERT INTO ${tableName} (${propNames.join(', ')}) VALUES (${propNames.map(prop => '@' + prop).join(', ')});SELECT SCOPE_IDENTITY() AS Id;`;
            }
            const result = await request.query(statement);
            return { success: true, data: result.recordset };
        } catch (err) {
            return { success: false, queryException: err, data: {} };
        }
    }

    /**
     * @desc insert the record
     * @param {Object} - json - Json Object
     * @param {String} - tableName
     */
    async insert(json, tableName) {
        return await this.insertUpdate({ tableName, json, update: false });
    }
    /**
     * @desc update the record
     * @param {Object} - json - Json Object
     * @param {String} - tableName
     */
    async update(json, tableName, keyField) {
        return await this.insertUpdate({ tableName, json, keyField, update: true });
    }
    addParameters({ query, request, parameters, forWhere = false }) {
        if (!parameters) {
            return query;
        }
        const fieldNames = Object.keys(parameters);
        for (let index = 0, len = fieldNames.length; index < len; index++) {
            const fieldName = fieldNames[index];
            const props = parameters[fieldName];
            const operator = props.operator || "=";
            const value = props.operator ? props.value : props;
            if (forWhere) {
                query += `${index === 0 ? "" : " AND "} ${fieldName} ${operator} @${fieldName}`;
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
    async execute({ query, parameters, where, orderBy, isStoredProcedure, storedProc }) {
        query = await this.getQuery(query);
        isStoredProcedure = isStoredProcedure === true || storedProc === true || (storedProc !== false && !query.match(/^SELECT |INSERT |UPDATE |DELETE |SET |DECLARE /i));
        try {
            const request = await this.createRequest();
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
            return { success: false, queryException: err, data: {} };
        }
    }
}

export default Sql;

export { mssql };