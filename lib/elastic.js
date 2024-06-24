import fs from 'fs-extra';
import path from 'path';
import AxiosAdapter from './adapters/axios-adapter.js';
import GotAdapter from './adapters/got-adapter.js';
import OpenSearchAdapter from './adapters/opensearch-adapter.js';
import ElasticSearchAdapter from './adapters/elasticsearch-adapter.js';
import RequestAdapter from './adapters/request-adapter.js';

class Elastic {
    /**
     * 
     * @param {Object} config Configuration object
     * @param {Object} config.requestAdapter Either AxiosAdapter or GotAdapter to be used to make requests
     * @param {String} config.baseUrl Base url of the Elastic instance
     * @param {Boolean} config.openSearch Whether assume openSearch. Defaults to ElasticSearch (false)
     */

    constructor({ requestAdapter, baseUrl, openSearch = false }) {
        this.baseUrl = baseUrl;
        if (!(requestAdapter instanceof RequestAdapter)) {
            throw new Error("requestAdapter must be an instance of RequestAdapter");
        }
        this.requestAdapter = requestAdapter;
        this.searchAdapter = openSearch ? new OpenSearchAdapter() : new ElasticSearchAdapter();

    }

    get baseUrl() {
        return this._baseUrl;
    }

    set baseUrl(url) {
        if (url && url.endsWith("/")) {
            url = url.substring(0, url.length - 1);
        }

        this._baseUrl = url;
    }

    /**
     * Returns records from Elastic index using Elastic Sql
     * @param {Object} config Configuration object
     * @param {String} config.indexName Elastic index name
     * @param {Array} config.aggregates - Expected in the format of ["Avg(PurityPercentage) AS PurityPercentage", "Min(PlanogramCompliance) AS PlanogramCompliance"]
     * @param {Array} config.groupBy - Last groupBy is used to distribute the data across multiple buckets
     * @param {Object} config.where - Expected in the format of { "ClientId": 70 }
     * @param {Number} config.limit - Number of records to return
     * @param {Number} config.offset - Starting record number (0-based)
     * @param {Boolean} config.returnAll - If true (default), all records are returned else callback is supposed to process records
     * @param {Function} config.callback - Callback function to process records
     * @param {Boolean} config.translateSqlRows - If true (default), rows are translated to key, value format
     * @returns 
     */
    async sqlQuery({
        indexName,
        select = [],
        aggregates = [],
        groupBy = [],
        where = [],
        limit = undefined,
        offset = undefined,
        returnAll = true,
        callback = undefined,
        translateSqlRows = true,
        sort = []
    }) {
        const { requestAdapter, baseUrl, searchAdapter } = this;
        const allResults = [];
        const { statement: whereStatement, params } = searchAdapter.buildWhereStatement(where);
        const selectFields = [...select, ...groupBy, ...aggregates];
        const groupByStatement = groupBy.length > 0 ? `GROUP BY ${groupBy.join(",")}` : "";
        const limitStatement = limit ? `LIMIT ${limit}` : "";
        const offsetStatement = offset ? `OFFSET ${offset}` : "";
        const sortStatement = sort.length > 0 ? `ORDER BY ${sort.reduce((curr, value, index, originalArr) => { return curr + value.join(' ') + (index != originalArr.length - 1 ? ', ' : '') }, '')}` : "";

        const sql = `SELECT
        ${selectFields.join(', ')}
        FROM ${searchAdapter.escape(indexName)}
        ${whereStatement}
        ${groupByStatement}
        ${sortStatement}
        ${limitStatement}
        ${offsetStatement}`;

        let columns;
        let json = { "query": sql, "fetch_size": 500, params };
        let cursor;
        let first = true;
        const columnIndexLookup = {};

        do {
            const result = await requestAdapter.getJson({
                method: 'POST',
                url: `${baseUrl}/${searchAdapter.sqlUrl}`,
                body: json
            });
            if (first) {
                columns = result[searchAdapter.columns];
                let colIndex = 0;
                if (columns) {
                    for (const column of columns) {
                        columnIndexLookup[column.name] = colIndex++;
                    }
                }
                first = false;
            }
            let rows = result[searchAdapter.rows];
            if (rows) {
                if (translateSqlRows) {
                    rows = this.translateSqlRows({ rows, columnIndexLookup });
                }
                if (typeof callback === 'function') {
                    rows = await Promise.resolve(callback({ rows: rows, columns, result, first, columnIndexLookup })) || rows;
                }
                if (returnAll) {
                    allResults.push(...rows);
                }
            }
            cursor = result.cursor;
            json = { "cursor": cursor };
        } while (cursor);
        return { columns, rows: allResults };
    }

    /**
     * Converts rows from Elastic Sql to key, value format
     * @param {Object} Configuration object 
     * @param {Array} config.rows - Rows from Elastic Sql
     * @param {Object} config.columnIndexLookup - Lookup table for column index
     * @returns 
     */
    translateSqlRows({ rows, columnIndexLookup }) {
        const result = [];
        let rowNumber = 0;
        for (const row of rows) {
            rowNumber++;
            const rowResult = {
                id: rowNumber
            };
            for (const column in columnIndexLookup) {
                rowResult[column] = row[columnIndexLookup[column]];
            }
            result.push(rowResult);
        }
        return result;
    }

    /**
     * Executes an Elastic Sql query and pivots the results in buckets
     * @param {Object} config Configuration object
     * @param {String} config.indexName Elastic index name
     * @param {Array} config.groupBy - Last groupBy is used to distribute the data across multiple buckets
     * @param {Array} config.measures - Expected in the format of { "measureName": { "calc": "Avg", "ranges": [40, 60] } }
     *                                  calc: "Avg", "Min", "Max", "Sum", "Count"
     *                                 ranges: [40, 60] where range includes all values < the value
     *                                          Last bucket of ">" is created for values greater than last range
     * @param {Object} config.where - Expected in the format of { "ClientId": 70 }
     * @returns Pivoted data
     */
    async pivot({
        groupBy,
        measures,
        where,
        indexName
    }) {
        const aggregates = [];
        for (const measureName in measures) {
            const info = measures[measureName];
            aggregates.push(`${info.calc}(${measureName}) AS ${measureName}`);
        }


        const resultTable = [];
        const summaryGroupBy = [...groupBy];
        summaryGroupBy.pop();

        await this.sqlQuery({
            indexName,
            aggregates,
            groupBy,
            where,
            returnAll: false,
            callback: function ({ rows }) {
                for (const row of rows) {
                    let summaryRow = resultTable.find((r) => {
                        for (const groupByField of summaryGroupBy) {
                            if (r[groupByField] !== row[groupByField]) {
                                return false;
                            }
                        }
                        return true;
                    });
                    if (!summaryRow) {
                        summaryRow = {};
                        for (const groupByField of summaryGroupBy) {
                            summaryRow[groupByField] = row[groupByField];
                        }
                        resultTable.push(summaryRow);
                        for (const measureName in measures) {
                            for (const range of measures[measureName].ranges) {
                                summaryRow[`${measureName}:${range}`] = 0;
                            }
                            summaryRow[`${measureName}:>`] = 0;
                            summaryRow[`${measureName}:Total`] = 0;
                        }
                    }
                    for (const measureName in measures) {
                        const value = row[measureName];
                        let match = false;
                        for (const range of measures[measureName].ranges) {
                            if (value < range) {
                                summaryRow[`${measureName}:${range}`] += 1;
                                match = true;
                                break;
                            }
                        }
                        if (!match) {
                            summaryRow[`${measureName}:>`] += 1;
                        }
                        summaryRow[`${measureName}:Total`] += 1;
                    }
                }
            }
        });
        return resultTable;
    }

    async aggregate({ query, mappings, method = 'POST', queryPath, customize }) {
        const { requestAdapter, baseUrl, searchAdapter } = this;
        if (typeof query === 'string') {
            const fileData = await fs.readFile(path.resolve('queries', query + '.esquery'));
            query = fileData.toString();

            const index = query.indexOf("\n");
            queryPath = query.substr(0, index).replace("\r", "");
            const queryPathParts = /^(\w+) (.+)$/.exec(queryPath);
            //method = queryPathParts[1];
            queryPath = queryPathParts[2];

            query = query.substr(query.indexOf("{"));

            query = JSON.parse(query);
        }

        if (typeof customize === 'function') {
            const result = customize({ query, mappings, queryPath, method });
            if (result && result.then) {
                await result;
            }
        }

        const data = await requestAdapter.getJson({
            method: 'POST',
            url: `${baseUrl}/${queryPath}`,
            body: query
        });

        const rows = [];

        this.convertMapToArray(mappings);

        this.fillAggRow({ data: data.aggregations, mappings, row: {}, rows });
        return rows;
    }

    convertMapToArray(mappings) {
        for (const key in mappings) {
            const { map, items } = mappings[key];
            if (map) {
                for (const mapKey in map) {
                    const mapValue = map[mapKey];
                    if (typeof mapValue === 'string') {
                        map[mapKey] = mapValue.split(".");
                    }

                }
            }
            if (items) {
                for (const item of items) {
                    this.convertMapToArray(item);
                }
            }
        }
    }

    fillAggRow({ data, mappings, row, rows }) {
        for (const key in mappings) {
            const { root, items, map, value = "key" } = mappings[key];
            const buckets = data[root].buckets;
            if (buckets) {
                const isLast = !Array.isArray(items);
                for (const bucket of buckets) {
                    const currentRow = { ...row, [key]: bucket[value] };
                    if (map) {
                        for (const mapKey in map) {
                            let source = bucket;
                            for (const key of map[mapKey]) {
                                source = source[key];
                            }
                            currentRow[mapKey] = source;
                        }
                    }
                    if (isLast) {
                        rows.push(currentRow);
                    } else {
                        for (const item of items) {
                            this.fillAggRow({ data: bucket, mappings: item, row: currentRow, rows })
                        }
                    }
                }
            } else {
                rows.push(row);
            }
        }
    }
}

export {
    AxiosAdapter,
    GotAdapter
};

export default Elastic;
