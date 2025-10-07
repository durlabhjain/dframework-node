import BusinessBase from './business/business-base.mjs';
class ConcatenatedColumn {
    constructor(columnsConfigurations) {
        this.columnsConfigurations = columnsConfigurations;
    }
    createRequest() {
        return BusinessBase.businessObject.sql.createRequest();
    }
    async AddColumns(dt) {
        if (!dt || !this.columnsConfigurations || this.columnsConfigurations.length === 0) {
            return;
        }
        const keys = {};
        for (const colConfig of this.columnsConfigurations) {
            // Use colConfig instead of this
            const parentKeyColumn = colConfig.ParentColumn;
            const joinColumn = colConfig.JoinColumn || parentKeyColumn;
            const colName = colConfig.ColumnName;
            if (!keys[parentKeyColumn]) {
                keys[parentKeyColumn] = dt.recordset.reduce((ids, dr) => {
                    if (dr[parentKeyColumn] !== null) {
                        ids.push(dr[parentKeyColumn]);
                    }
                    return ids;
                }, []);
            }
            const ids = keys[parentKeyColumn];
            if (dt && dt.Columns && !dt.Columns.find(c => c.ColumnName === colName)) {
                dt.AddColumn({ DataColumn: { ColumnName: colName } });
            }
            if (ids.length > 0) {
                let results = null;
                if (colConfig.listMethod) {
                    results = colConfig.listMethod(ids);
                } else {
                    let startIndex = 0;
                    const maxVariables = 1500;

                    while (startIndex < ids.length) {
                        let idsForQuery;

                        if (startIndex === 0 && ids.length < maxVariables) {
                            idsForQuery = ids;
                            startIndex = ids.length;
                        } else {
                            let count = ids.length - startIndex;

                            if (count > maxVariables) {
                                count = maxVariables;
                            }
                            const idArray = ids.slice(startIndex, startIndex + count);
                            idsForQuery = idArray;
                            startIndex += count;
                        }
                        let query = colConfig.Query;
                        const where = { [joinColumn]: { value: idsForQuery, operator: 'in' } };
                        const request = this.createRequest();
                        query = BusinessBase.businessObject.sql.addParameters({ request, query, parameters: where, forWhere: true });
                        if (!results) {
                            results = await request.query(query);
                        } else {
                            const tempDt = await request.query(query);
                            tempDt.recordset.forEach(dr => {
                                results.recordset.push(dr);
                            });
                        }
                    }
                }
                const infoParser = colConfig.infoParser || ((row) => (row[colConfig.DisplayColumn] !== null ? row[colConfig.DisplayColumn] : null));
                dt.recordset.forEach(dr => {
                    if (dr[parentKeyColumn] !== null) {
                        const parentId = dr[parentKeyColumn];
                        const childRows = results.recordset.filter(row => row[joinColumn] === parentId);
                        dr[colName] = this.ListParser(colConfig, infoParser, childRows);
                    }
                });
            }
        }
        return dt;
    }

    ListParser(column, infoParser, rows) {
        const info = rows.reduce((infot, childRow) => {
            const infoToAppend = infoParser(childRow);
            if (infoToAppend !== null && infoToAppend?.length > 0) {
                infot.push(infoToAppend);
            }
            return infot;
        }, []);

        return info.join(', ');
    }

    addParametersForLike(query, request, fieldName, operator, value, forWhere) {
        if (!fieldName || !operator) {
            return query;
        }
        const whereClauses = [];
        const statement = `${fieldName} ${operator} @${fieldName}`;
        request.input(fieldName, value);
        if (forWhere) {
            whereClauses.push(statement);
        }
        if (whereClauses.length > 0) {
            query += " WHERE " + whereClauses.join(' AND ');
        }
        return query;
    }
    applyStringFilter(value, concatenatedColumn, request) {
        const subQueries = [];
        let childQuery = concatenatedColumn.Query;
        const fieldName = concatenatedColumn.FilterColumn || concatenatedColumn.DisplayColumn;
        const parentColumn = concatenatedColumn.ParentColumn;
        const joinColumn = concatenatedColumn.JoinColumn || parentColumn;
        childQuery = this.addParametersForLike(childQuery, request, fieldName, 'LIKE', value, true);
        let subQuery = `SELECT ${joinColumn} FROM (${childQuery.toString()}) ConcatenatedSubQuery`;
        subQuery = `${joinColumn} IN (${subQuery})`
        subQueries.push(subQuery);
        return subQueries[0];
    }
}

export default ConcatenatedColumn ;