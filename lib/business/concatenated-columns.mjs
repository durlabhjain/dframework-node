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
            const displayColumn = colConfig.DisplayColumn;
            if (!keys[parentKeyColumn]) {
                keys[parentKeyColumn] = records.reduce((ids, dr) => {
                    if (dr[parentKeyColumn] !== null) {
                        ids.push(dr[parentKeyColumn]);
                    }
                    return ids;
                }, []);
            }
            const ids = keys[parentKeyColumn];
            if (records && records.length && !records[0].hasOwnProperty(colName)) {
                records.forEach(dr => dr[colName] = null);
            }
            if (ids.length > 0) {
                let results = [];
                if (colConfig.listMethod) {
                    results = await colConfig.listMethod(ids);
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
                        const { data: tempDt } = await sql.execute({ query, request });
                        results = results.concat(tempDt);
                    }
                }
                const infoParser = colConfig.infoParser || ConcatenatedColumns.defaultInfoParser;
                const resultsByParentId = results.reduce((lookup, row) => {
                    const parentId = row[joinColumn];
                    if (!lookup.has(parentId)) {
                        lookup.set(parentId, []);
                    }
                    lookup.get(parentId).push(row);
                    return lookup;
                }, new Map());
                records.forEach(dr => {
                    if (dr[parentKeyColumn] !== null) {
                        const parentId = dr[parentKeyColumn];
                        const childRows = resultsByParentId.get(parentId) || [];
                        const rowInfo = childRows.reduce((infot, childRow) => {
                            const infoToAppend = infoParser({ row: childRow, displayColumn });
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