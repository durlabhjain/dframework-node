class OpenSearchAdapter {
    sqlUrl = '_plugins/_sql'
    columns = 'schema'
    rows = 'datarows'

    escape(keyword) {
        return `[${keyword}]`;
    }

    buildWhereStatement(where) {
        const whereParts = [];
        for (const field in where) {
            let operatorField = where[field];

            for (const operator in operatorField) {
                let value = operatorField[operator];
                if (operator === 'between') {
                    whereParts.push(`${field} > '${value.startDate}T00:00:00.000' AND ${field} < '${value.endDate}T23:59:59.999'`);
                    continue;
                }
                
                if (typeof value === 'string') {
                    value = value.replace(/'/g, "''");
                    value = `'${value}'`;
                }
                if(Array.isArray(value)) {
                    value = value.map(v => typeof value === 'string' ? `\'${v.replace(/'/g, "''")}\'` : v).join(',');
                    value = `(${value})`;
                }


                whereParts.push(`${field} ${operator} ${value}`);
            }


        }
        return {
            statement: whereParts.length > 0 ? `WHERE ${whereParts.join(" AND ")}` : ""
        };
    }

};

export default OpenSearchAdapter;
