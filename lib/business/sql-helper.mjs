import logger from '../logger.js';

const fieldNameRegex = /^[a-zA-Z0-9_.]+$/;
const pivotFormula = {
    "ForeignPercentage": "100-PurityPercentage"
};
class SqlHelper {

    constructor({ DFramework }) {
        this.DFramework = DFramework;
    }

    static sanitizeField(fieldName) {
        return fieldName.replace(/[^a-zA-Z0-9_. ]/g, "_");
    }
    static getPivotFormula() {
        return pivotFormula;
    }

    static isValidFieldName(fieldName) {
        return fieldNameRegex.test(fieldName);
    }

    /**
     * Validates and sanitizes a field name for SQL safety
     * @param {string} fieldName - Field name to validate
     * @throws {Error} If field name contains invalid characters
     * @returns {string} The validated field name
     */
    static validateAndSanitizeFieldName(fieldName) {
        if (!SqlHelper.isValidFieldName(fieldName)) {
            throw new Error(`Invalid field name: ${fieldName}. Only alphanumeric characters, underscores, and dots are allowed.`);
        }
        return fieldName;
    }

    static validateWhere(where) {
        if (!where) {
            return;
        }
        for (const key in where) {
            if (!SqlHelper.isValidFieldName(key)) {
                return `Invalid where key ${key}`;
            }
            if (where[key].fieldName && !SqlHelper.isValidFieldName(where[key].fieldName)) {
                return `Invalid where fieldName ${where[key].fieldName}`;
            }
            if (/date/i.test(key)) {
                if (where[key].value) {
                    where[key].value = new Date(where[key].value);
                } else if (Array.isArray(where[key]) || where[key][0].value) {
                    where[key][0].sqlType = 'date';
                } else {
                    where[key] = { value: new Date(where[key]) };
                }
            }
        }
    }

    /**
     * Executes an Sql query and pivots the results in buckets
     * @param {Object} config Configuration object
     * @param {String} config.tableName Sql table
     * @param {Array} config.groupBy - Last groupBy is used to distribute the data across multiple buckets
     * @param {Array} config.measures - Expected in the format of { "measureName": { "calc": "Avg", "ranges": [40, 60] } }
     *                                  calc: "Avg", "Min", "Max", "Sum", "Count"
     *                                 ranges: [40, 60] where range includes all values < the value
     *                                          Last bucket of ">" is created for values greater than last range
     * @param {Object} config.where - Expected in the format of { "ClientId": 70 }
     * @param {Object} config.nameMapping - Expected in the format of { "ClassificationId": { "from": "LocationClassification", "lookupField": "LocationClassificationId", displayField: "Name" } }}
     * @returns Pivoted data
     */
    async pivot({
        groupBy,
        measures,
        where,
        tableName,
        nameMapping,
        pagination,
        sql
    }) {
        const aggregates = [];
        for (const measureName in measures) {
            const info = measures[measureName];
            const valueOfMeasure = pivotFormula[measureName] ? pivotFormula[measureName] : measureName;
            aggregates.push(`${info.calc}(${valueOfMeasure}) AS ${measureName}`);
        }

        const { DFramework } = this;
        const sqlInstance = sql ? sql : DFramework.sql;

        const selectFields = [...groupBy, ...aggregates];
        const groupByStatement = groupBy.length > 0 ? `GROUP BY ${groupBy.join(",")}` : "";
        let query = `SELECT 
        ${selectFields.join(', ')}
        FROM ${tableName}`;

        const request = sqlInstance.createRequest();
        query = sqlInstance.addParameters({ query, request, parameters: where, forWhere: true });
        query = `${query} ${groupByStatement}`;

        const measureColumns = [];
        for (const measureName in measures) {
            let min;
            for (const range of measures[measureName].ranges) {
                const columnName = `${measureName}:${range}`;
                if (min) {
                    measureColumns.push(`SUM(CASE WHEN ${measureName} >= ${min} AND ${measureName} < ${range} THEN 1 ELSE 0 END) AS [${columnName}]`)
                } else {
                    measureColumns.push(`SUM(CASE WHEN ${measureName} < ${range} THEN 1 ELSE 0 END) AS [${columnName}]`)
                }
                min = range;
            }
            measureColumns.push(`SUM(CASE WHEN ${measureName}>= ${min} THEN 1 ELSE 0 END) AS [${measureName}:>]`);
            measureColumns.push(`SUM(1) AS [${measureName}:Total]`);
        }

        // final group by should not have table prefix
        const summaryGroupBy = groupBy.map(field => {
            const parts = field.split('.');
            return parts[parts.length - 1];
        });
        summaryGroupBy.pop();           // as we summarize based on the last group by, it should be removed from the list

        let outerQuery = `SELECT 
        ${[...summaryGroupBy, ...measureColumns].join(', ')}
        FROM (${query}) AS t`

        if (summaryGroupBy.length > 0) {
            outerQuery += ` GROUP BY ${summaryGroupBy.join(",")}`;
        }

        if (nameMapping) {
            const columns = [];
            const joins = [];
            for (const field in nameMapping) {
                if (!summaryGroupBy.includes(field)) {
                    continue;
                }
                const withoutId = field.replace(/Id$/, "");
                const { from = withoutId, displayField = `${withoutId}Name`, lookupField = field } = nameMapping[field] || {};

                columns.push(`[${field}_join].[${displayField}] AS [${withoutId}Name]`);
                joins.push(`LEFT OUTER JOIN [${from}] AS [${field}_join] ON outerQuery.[${field}] = [${field}_join].[${lookupField}]`);
            }
            outerQuery = `SELECT outerQuery.*, ${columns.join(', ')} FROM (${outerQuery}) AS outerQuery ${joins.join(' ')}`;
        }

        let totalRecords = 0;
        if (pagination) {
            const countQuery = `Select count(*) as totalRecords from (${outerQuery}) as outerQuery`;
            const countResult = await request.query(countQuery);
            logger.debug({ countResult: countResult.recordset }, 'Pivot count query result');
            totalRecords = countResult.recordset[0].totalRecords;
            outerQuery = `${outerQuery} ORDER BY ${pagination.orderBy} OFFSET ${(pagination.page * pagination.rowsPerPage)} ROWS FETCH NEXT ${pagination.rowsPerPage} ROWS ONLY`;
        }
        logger.debug({ query: outerQuery }, 'Pivot outer query');

        const result = await request.query(outerQuery);
        return { records: result.recordset, totalRecords: totalRecords };
    }
}

export default SqlHelper;
