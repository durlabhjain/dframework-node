import BusinessBase from './business-base.mjs';
import { util } from '../../index.js';

const mustNotOperators = ["!=", "not", "notEquals", "isEmpty"];

const compareLookups = {
    "is": function ({ v, field }) {
        return { "term": { [field]: v } };
    },
    "startsWith": function ({ v, field }) {
        return { "wildcard": { [field]: `${v}*` } };
    },
    "endsWith": function ({ v, field }) {
        return { "wildcard": { [field]: `*${v}` } };
    },
    "contains": function ({ v, field }) {
        return { "wildcard": { [field]: `*${v}*` } };
    },
    ">": function ({ v, field }) {
        return { "range": { [field]: { "gt": v } } };
    },
    ">=": function ({ v, field }) {
        return { "range": { [field]: { "gte": v } } };
    },
    "<": function ({ v, field }) {
        return { "range": { [field]: { "lt": v } } };
    },
    "<=": function ({ v, field }) {
        return { "range": { [field]: { "lte": v } } };
    },
    "isAnyOf": function ({ v, field }) {
        return { "terms": { [field]: v } };
    },
    "isEmpty": function ({ field }) {
        return { "exists": { "field": field } };
    },
    "isBetween": function ({ field, v }) {
        return { "range": { [field]: { "gt": v.start, "lt": v.end } } };
    }
};

compareLookups.isBlank = compareLookups.isEmpty;
compareLookups.isNotBlank = compareLookups.isEmpty;
compareLookups.isNotEmpty = compareLookups.isEmpty;
compareLookups['='] = compareLookups.is;
compareLookups['!='] = compareLookups.is;
compareLookups.equals = compareLookups.is;
compareLookups.notEquals = compareLookups.is;
compareLookups.not = compareLookups.is;
compareLookups.onOrAfter = compareLookups['>='];
compareLookups.onOrAfter = compareLookups['>='];
compareLookups.onOrBefore = compareLookups['<='];
compareLookups.after = compareLookups['>'];
compareLookups.before = compareLookups['<'];

class ElasticBusinessBase extends BusinessBase {

    static baseQueryJson = null;

    static async getBaseQuery() {
        if (ElasticBusinessBase.baseQueryJson === null) {
            ElasticBusinessBase.baseQueryJson = JSON.stringify(util.elasticBaseQuery);
        }
        return JSON.parse(ElasticBusinessBase.baseQueryJson);
    }

    applySort(sort, baseQuery) {
        if (sort) {
            const sortData = sort.split(",");
            baseQuery.sort = sortData.map((entry) => {
                const parts = entry.split(" ");
                return { [parts[0]]: { order: parts[1] || "asc " } };
            });
        }
    }

    applyFilters(filter, queryFilter) {
        if (filter?.length) {
            filter.forEach((element) => {
                const { field, operator, type, value } = element;
                const filterValue = compareLookups[operator]({ v: value, field, type });
                if (mustNotOperators.includes(operator)) {
                    queryFilter.must_not.push(filterValue);
                } else {
                    queryFilter.must.push(filterValue);
                }
            });
        }
    }

    async getQueryResponse(scrollId, query, url) {
        const payload = { url: url || `${BusinessBase.businessObject.elastic.baseUrl}/_search/scroll` };
        if (scrollId) {
            payload.body = { scroll: '10s', scroll_id: scrollId };
        }
        if (query) {
            payload.body = query;
        }
        return await BusinessBase.businessObject.elastic.requestAdapter.getJson(payload);
    }

    async response({ query, indexName, isForExport, start = 0, limit = 10 }) {
        let useScroll = isForExport || ((start + limit) > 10000);
        let records = [];
        let url = `${BusinessBase.businessObject.elastic.baseUrl}/${indexName}/_search${useScroll ? '?scroll=10s' : ''}`, totalRecords, aggs = {}, scrollId, currentHits = [];
        let fetchLimit = 10000;

        if (useScroll) {
            query.size = fetchLimit;
            delete query.from;
        }

        const { hits, _scroll_id, aggregations = {} } = await this.getQueryResponse(scrollId, query, url);

        if (Object.keys(aggregations).length) {
            aggs = aggregations;
        }
        if (!totalRecords) {
            totalRecords = hits.total.value;
        }
        let currentCount = 0;
        let skipCount = start;
        currentHits = hits.hits;
        scrollId = _scroll_id;

        if (useScroll) {
            while (currentCount < totalRecords) {
                if (currentHits.length === 0) {
                    const nextResults = await this.getQueryResponse(scrollId);
                    scrollId = nextResults._scroll_id;
                    currentHits = nextResults.hits.hits;

                    if (currentHits.length === 0) {
                        break; // No more records to fetch
                    }
                }

                if (skipCount > 0 && (currentCount + currentHits.length) <= skipCount) {
                    currentCount += currentHits.length;
                    currentHits = [];
                    continue;
                }

                for (let hit of currentHits) {
                    currentCount++;
                    if ((currentCount > skipCount)) {
                        records.push(hit);
                    }

                    if (records.length >= limit && !isForExport) {
                        break;
                    }
                }

                currentHits = [];
                if (records.length >= limit && !isForExport) {
                    break;
                }
            }

            // Delete scroll after fetching is complete
            await BusinessBase.businessObject.elastic.requestAdapter.getJson({
                url: `${BusinessBase.businessObject.elastic.baseUrl}/_search/scroll`,
                body: { scroll_id: scrollId, scroll: '10s' }
            });
        } else {
            records.push(...hits.hits);
        }
        return { records, totalRecords, aggregations: aggs };
    }

    async fetchElasticRelations({ config, data, responseType }) {
        const { relation, relationKey, include } = config;
        const relationValues = [...new Set(data.map(ele => { return ele._source[relationKey] }))];
        if (!relationValues?.length) {
            return;
        }
        const baseQuery = await ElasticBusinessBase.getBaseQuery();
        baseQuery.size = util.elasticQueryMaxSize;
        if (include?.length) {
            baseQuery._source.includes = include;
        }
        const childQueryFilter = [{ field: [relationKey], operator: "isAnyOf", value: relationValues }];

        const queryFilter = baseQuery.query.bool.filter.bool;

        this.applyFilters(childQueryFilter, queryFilter);

        const { records } = await this.response({ query: baseQuery, responseType, indexName: relation });
        if (records?.length) {
            data.forEach(ele => {
                const indexValue = records.findIndex(e => e._source[relationKey] === ele._source[relationKey]);
                if (indexValue > -1) {
                    ele._source = Object.assign({}, ele._source, records[indexValue]._source);
                }
            })
        }
    }

    async fetchSqlRelations({ config, records, filter }) {
        const { relation, columns, relationKey, sqlRelationKey = '', relationCondition = '', useView = true } = config;
        const { primaryFilterField } = this;
        const parameters = [];
        const primaryFilter = filter.filter(ele => ele.field === primaryFilterField);
        if (primaryFilter) {
            parameters.push(primaryFilter)
        }
        const relationValues = [...new Set(records.map(ele => { return ele._source[relationKey] }))];
        if (!relationValues?.length) {
            return;
        }
        let query = `SELECT ${columns} FROM ${useView ? `vw${relation}List` : relation} INNER JOIN (SELECT IntValue FROM dbo.CsvToInt('${relationValues.join(',')}')) F ON ${[sqlRelationKey || relationKey]} = F.IntValue`;
        if (relationCondition) {
            const { relationWhereKey, relationWhereValue, relationWhereOperator } = relationCondition;
            parameters.push({ [relationWhereKey]: { value: relationWhereValue, operator: relationWhereOperator } });
        }
        const sql = BusinessBase.businessObject.sql;
        const request = sql.createRequest();
        query = sql.addParameters({ query, request, parameters, forWhere: true });
        const res = await request.query(query)
        const { recordset = [] } = res;
        if (recordset?.length) {
            records.forEach(ele => {
                const indexValue = recordset.findIndex(e => e[sqlRelationKey || relationKey] === ele._source[relationKey]);
                if (indexValue > -1) {
                    ele._source = Object.assign({}, ele._source, recordset[indexValue]);
                }
            })
        }
    }

    async fetchRelations({ records, filter, sort, responseType }) {
        const { relations } = this;
        for (const config of relations) {
            const { relationType = util.RelationTypes.SQL } = config;
            switch (relationType) {
                case util.RelationTypes.Elastic:
                    await this.fetchElasticRelations({ config, data: records, filter, sort, responseType });
                    break;
                case util.RelationTypes.SQL:
                default:
                    await this.fetchSqlRelations({ config, records, filter, sort, responseType });
            }
        }
    }

    async getRecords({ query, responseType, filter, sort, isForExport, start, limit }) {
        const { relations, indexName } = this;

        const { records, totalRecords, aggregations } = await this.response({ query, responseType, indexName, filter, sort, isForExport, start, limit });

        if (relations?.length && records?.length) {
            await this.fetchRelations({ records, filter, sort, responseType });
        }

        return { records, totalRecords, aggregations };
    }

    async fetch({ start = 0, limit = 10, sort, filter, include, returnCount = true, responseType, isElastic }) {
        sort = sort || this.defaultSortOrder;
        include = include || this.include;
        filter = this.parseJson(filter, []);

        const baseQuery = await ElasticBusinessBase.getBaseQuery();
        baseQuery.from = start;
        baseQuery.size = limit;

        if (!returnCount) {
            baseQuery.track_total_hits = false;
        }

        if (include?.length) {
            baseQuery._source.includes = include;
        }

        const queryFilter = baseQuery.query.bool.filter.bool;

        this.applySort(sort, baseQuery);

        this.applyFilters(filter, queryFilter);

        if (this.aggregation) {
            baseQuery.aggs = this.aggregation;
        }

        const response = await this.getRecords({ query: baseQuery, responseType, filter, sort, isForExport: isElastic, start, limit });
        const { aggregations, records } = response;

        if (returnCount) {
            const recordCount = response.totalRecords;
            return { records, recordCount, aggregations }
        } else {
            return { records, aggregations }
        }
    }
}

export { ElasticBusinessBase };

export default ElasticBusinessBase;