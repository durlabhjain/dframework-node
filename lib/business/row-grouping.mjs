import SqlHelper from './sql-helper.mjs';

/**
 * Server-side row grouping for BusinessBase.list().
 *
 * Contract shared with dframework-ui's Grid component (`isServerGrouping` / `groupAggregations`):
 * a `list()` call carrying `rowGroupField` (a single field name) and, optionally,
 * `rowGroupAggregations` (`{ field: 'sum' | 'avg' | 'min' | 'max' | 'count' }`) returns its normal
 * leaf `records`, plus one group-summary row spliced in ahead of the first leaf row of each group
 * value present on the page. A summary row carries the group field's value, `childrenCount` (the
 * group's total leaf count, not just what's on this page), and one field per
 * `rowGroupAggregations` entry holding that aggregate over the group's full (filtered) row set.
 *
 * The row shape itself is backend-agnostic - any adapter could produce it. On a SQL-backed
 * BusinessBase, `applyServerRowGrouping()` wraps list()'s own fully-filtered (WHERE applied, but not
 * yet ORDER BY/paged) query as a derived table and runs a GROUP BY over it, via the same
 * adapter-abstracted sql.runQuery call list() itself already uses, then splices the results into
 * the page's leaf records.
 *
 * Deliberately reuses list()'s already-built `query` string (rather than re-deriving scoping/filter
 * conditions from scratch) so the group summary is guaranteed to be scoped identically to the leaf
 * rows - same client scoping, same global/location filters, same user filter items - and so any
 * request parameters those conditions bind stay declared exactly once on the shared `request`.
 */

const ALLOWED_AGGREGATE_FUNCTIONS = ['sum', 'avg', 'min', 'max', 'count'];

/**
 * Builds validated `<FN>(<field>) AS <field>` SELECT fragments from a rowGroupAggregations map.
 *
 * @param {Object<string, string>} [rowGroupAggregations] - Field name -> aggregate function
 *   (one of ALLOWED_AGGREGATE_FUNCTIONS, case-insensitive), e.g. `{ Amount: 'sum', Score: 'avg' }`.
 * @returns {string[]} SELECT fragments, e.g. `['SUM(Amount) AS Amount', 'AVG(Score) AS Score']`.
 * @throws {Error} If a field name or aggregate function is invalid - both come from the request,
 *   so both are validated here before touching SQL.
 */
function buildGroupAggregationSelectFragments(rowGroupAggregations) {
    if (!rowGroupAggregations) return [];
    return Object.entries(rowGroupAggregations).map(([field, fn]) => {
        const normalizedFn = String(fn).toLowerCase();
        if (!ALLOWED_AGGREGATE_FUNCTIONS.includes(normalizedFn)) {
            throw new Error(`Invalid rowGroupAggregations function "${fn}" for field "${field}". Allowed: ${ALLOWED_AGGREGATE_FUNCTIONS.join(', ')}`);
        }
        if (!SqlHelper.isValidFieldName(field)) {
            throw new Error(`Invalid rowGroupAggregations field name "${field}"`);
        }
        return `${normalizedFn.toUpperCase()}(${field}) AS ${field}`;
    });
}

/**
 * Splices one group-summary row ahead of the first leaf row for each group value that appears in
 * `records`, in the order groups are first encountered. A summary row whose group value has no
 * matching leaf rows on this page is dropped - pagination is defined in terms of leaf rows, so a
 * group is only shown once its own rows are on the page (see dframework-ui's Grid for the
 * getTreeDataPath side of this contract).
 *
 * @param {Object} params
 * @param {Object[]} params.records - The page's leaf rows, as returned by the leaf query.
 * @param {Object[]} params.groupSummaryRows - One row per group value (any group, not just those
 *   on this page), each carrying `rowGroupField`'s value, `childrenCount`, and any aggregations.
 * @param {string} params.rowGroupField - The field both `records` and `groupSummaryRows` are
 *   grouped by.
 * @returns {Object[]} `records` with a summary row spliced in ahead of each group's leaf rows.
 */
function spliceGroupSummaryRows({ records, groupSummaryRows, rowGroupField }) {
    if (!groupSummaryRows?.length || !records?.length) return records;
    // null/undefined coalesce to the same key so a NULL group value only matches once.
    const groupKey = (row) => row[rowGroupField] ?? null;
    const summaryByKey = new Map(groupSummaryRows.map(row => [groupKey(row), row]));
    const seenKeys = new Set();
    const output = [];
    for (const record of records) {
        const key = groupKey(record);
        if (!seenKeys.has(key)) {
            seenKeys.add(key);
            const summary = summaryByKey.get(key);
            if (summary) output.push(summary);
        }
        output.push(record);
    }
    return output;
}

/**
 * Computes the group-summary rows for `rowGroupField` and splices them into `records`. Runs on the
 * leaf query's own `request` object, not a fresh one, and against `query` - list()'s own
 * fully-filtered (system scoping + global filters + user filter items all applied), not-yet-paged
 * SELECT - wrapped as a derived table, so the aggregate is scoped identically to the leaf rows
 * without re-declaring or re-binding any request parameter.
 *
 * The Group By field isn't guaranteed to be a real output column for every BusinessObject's query
 * (e.g. a field the leaf query doesn't select), so any failure here is logged and degrades to
 * `records` unchanged rather than failing the whole `list()` call.
 *
 * @param {Object} params
 * @param {Object} params.sql - The adapter-abstracted sql instance (this.getDatabaseAdapter()).
 * @param {Object} params.request - The leaf query's own request object (reused, not recreated).
 * @param {string} params.query - list()'s fully-filtered query text (joins, WHERE, all scoping and
 *   user filters applied) - before ORDER BY/paging/GROUP BY are appended for the leaf fetch itself.
 * @param {Object[]} params.records - The leaf rows to splice group-summary rows into.
 * @param {string} params.rowGroupField - The field to group by. Callers should only invoke this
 *   when rowGroupField is set - it's required here, not a no-op guard.
 * @param {Object<string, string>} [params.rowGroupAggregations] - See buildGroupAggregationSelectFragments.
 * @param {Object} [params.logger] - this.logger, used to warn on failure.
 * @returns {Promise<Object[]>} `records`, with group-summary rows spliced in, or unchanged on failure.
 */
async function applyServerRowGrouping({ sql, request, query, records, rowGroupField, rowGroupAggregations, logger }) {
    try {
        if (!SqlHelper.isValidFieldName(rowGroupField)) {
            throw new Error(`Invalid rowGroupField "${rowGroupField}"`);
        }

        const aggregationSelect = buildGroupAggregationSelectFragments(rowGroupAggregations);
        const groupQuery = `SELECT ${rowGroupField} AS ${rowGroupField}, COUNT(1) AS childrenCount${aggregationSelect.length ? ', ' + aggregationSelect.join(', ') : ''} FROM (${query}) AS PivotSource GROUP BY ${rowGroupField}`;

        const groupResult = await sql.runQuery({ request, type: "query", query: groupQuery });
        if (groupResult.err) throw groupResult.err;

        return spliceGroupSummaryRows({ records, groupSummaryRows: groupResult.recordset || [], rowGroupField });
    } catch (err) {
        logger?.warn?.({ err, rowGroupField, rowGroupAggregations }, `Server-side row grouping failed for "${rowGroupField}" - returning ungrouped rows.`);
        return records;
    }
}

export { applyServerRowGrouping };
