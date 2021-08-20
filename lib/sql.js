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
}

export default Sql;

export { mssql };