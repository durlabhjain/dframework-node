class ElasticSearchAdapter {
    sqlUrl = '_sql'
    columns = 'columns'
    rows = 'rows'

    escape(keyword) {
        return `"${keyword}"`;
    }

    buildWhereStatement(where) {
        const params = [];
        const whereParts = [];
        for (const whereClause in where) {
            whereParts.push(`${whereClause} = ?`);
            params.push(where[whereClause]);
        }
        return {
            statement: whereParts.length > 0 ? `WHERE ${whereParts.join(" AND ")}` : "",
            params
        };
    }
};

export default ElasticSearchAdapter;