class ConcatenatedColumns {
    static async addColumns({ records, sql, maxVariables = 1500, columns }) {
        if (!records || !records.length || !columns || columns.length === 0) {
            return;
        }
        const keys = {};
        for (const colConfig of columns) {
            const parentKeyColumn = colConfig.ParentColumn;
            const joinColumn = colConfig.JoinColumn || parentKeyColumn;
            const colName = colConfig.ColumnName;
            if (!keys[parentKeyColumn]) {
                keys[parentKeyColumn] = records.recordset.reduce((ids, dr) => {
                    if (dr[parentKeyColumn] !== null) {
                        ids.push(dr[parentKeyColumn]);
                    }
                    return ids;
                }, []);
            }
            const ids = keys[parentKeyColumn];
            if (records && records.Columns && !records.Columns.find(c => c.ColumnName === colName)) {
                records.AddColumn({ DataColumn: { ColumnName: colName } });
            }
            if (ids.length > 0) {
                let results = null;
                if (colConfig.listMethod) {
                    results = colConfig.listMethod(ids);
                } else {
                    let startIndex = 0;
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
                        const request = sql.createRequest();
                        query = sql.addParameters({ request, query, parameters: where, forWhere: true });
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
                const infoParser = colConfig.infoParser || ConcatenatedColumns.defaultInfoParser;
                records.recordset.forEach(dr => {
                    if (dr[parentKeyColumn] !== null) {
                        const parentId = dr[parentKeyColumn];
                        const childRows = results.recordset.filter(row => row[joinColumn] === parentId);
                        const rowInfo = childRows.reduce((infot, childRow) => {
                            const infoToAppend = infoParser({ row: childRow, displayColumn: infoParser.displayColumn });
                            if (infoToAppend !== null && infoToAppend?.length > 0) {
                                infot.push(infoToAppend);
                            }
                            return infot;
                        }, [])
                        dr[colName] = rowInfo.join(', ');
                    }
                });
            }
        }
        return records;
    }

    static defaultInfoParser({ row, displayColumn }) {
        return row[displayColumn] !== null ? row[displayColumn] : null;
    }

    static applyStringFilter({ sql, value, concatenatedColumn, request, paramName = null, operator = 'LIKE' }) {
        let childQuery = concatenatedColumn.Query;
        const fieldName = concatenatedColumn.FilterColumn || concatenatedColumn.DisplayColumn;
        const parentColumn = concatenatedColumn.ParentColumn;
        const joinColumn = concatenatedColumn.JoinColumn || parentColumn;
        // Use caller-supplied paramName (unique per filter index) to avoid collisions;
        // fall back to fieldName only when called outside the standard filter pipeline.
        const uniqueParam = paramName || fieldName;
        childQuery = sql.addParameters({
            query: childQuery,
            request,
            parameters: { [uniqueParam]: { fieldName, operator, value } },
            forWhere: true,
        });
        const subQuery = `SELECT ${joinColumn} FROM (${childQuery}) ConcatenatedSubQuery`;
        return `${parentColumn} IN (${subQuery})`;
    }
}

export default ConcatenatedColumns;