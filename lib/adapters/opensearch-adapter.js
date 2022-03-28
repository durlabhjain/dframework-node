class OpenSearchAdapter {
    sqlUrl = '_plugins/_sql'
    columns = 'schema'
    rows = 'datarows'

    escape(keyword) {
        return `[${keyword}]`;
    }

    buildWhereStatement(where) {
        const whereParts = [];
        for (const whereClause in where) {
            let value = where[whereClause];
            if (typeof value === 'string') {
                value = value.replace(/'/g, "''");
            }
            whereParts.push(`${whereClause} = '${value}'`);
        }
        return {
            statement: whereParts.length > 0 ? `WHERE ${whereParts.join(" AND ")}` : ""
        };
    }
};

export default OpenSearchAdapter;