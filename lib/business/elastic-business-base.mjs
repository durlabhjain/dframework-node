import BusinessBase from './business-base.mjs';
import { enums, util } from '../../index.js';
import fs from 'fs/promises';

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

    async getBaseQuery() {
        let baseQuery = this.baseQuery;
        if (baseQuery === undefined || baseQuery === null) {
            baseQuery = await ElasticBusinessBase.getBaseQuery();
            this.baseQuery = JSON.stringify(baseQuery);
            return baseQuery;
        }
        if (typeof baseQuery === 'object') {
            baseQuery = JSON.stringify(baseQuery);
            // not storing/ overriding in class - so that if the developer manipulated baseQuery for some reason, they will always have original object
        } else if (baseQuery.endsWith(".esquery")) {
            // Resolve the correct path based on the current script's directory
            baseQuery = await fs.readFile(`./queries/${baseQuery}`, 'utf-8');
            this.baseQuery = baseQuery;
        }
        return JSON.parse(baseQuery);
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

    elasticLimit = 10000;

    async response({ query, indexName, useScroll = false, isElastic }) {
        useScroll = isElastic || useScroll;
        const records = [];
        const { from, size } = query;
        let limit = Number.MAX_VALUE;
        const partialRecords = typeof (from) === 'number' && typeof (size) === 'number';

        if (partialRecords && (from + size) > this.elasticLimit) {
            useScroll = true;
            query = { ...query, size: this.elasticLimit, from: undefined };
            limit = from + size;
        }

        let url = `${BusinessBase.businessObject.elastic.baseUrl}/${indexName}/_search${useScroll ? '?scroll=1m' : ''}`, currentHits, totalRecords, aggs = {};
        let scrollId;
        let startIndex = 0;
        do {
            const { hits, _scroll_id, aggregations = {} } = await BusinessBase.businessObject.elastic.requestAdapter.getJson({
                url,
                body: query
            });
            scrollId = _scroll_id;
            if (Object.keys(aggregations).length) {
                aggs = aggregations;
            }
            if (useScroll && !Object.prototype.hasOwnProperty.call(query, 'scroll_id')) {
                query = { "scroll_id": _scroll_id };
                url = `${BusinessBase.businessObject.elastic.baseUrl}/_search/scroll`;
            }

            if (!totalRecords) {
                totalRecords = hits.total.value;
            }

            currentHits = hits.hits;
            if (!useScroll || !partialRecords) {
                records.push(...currentHits);
            } else {
                const endIndex = startIndex + hits.hits.length;
                if (endIndex >= from) {
                    const toRemove = Math.max(from - startIndex, 0);
                    const toRemoveFromEnd = Math.min(endIndex, limit) - startIndex;
                    const extractedHits = currentHits.splice(toRemove, toRemoveFromEnd - toRemove);
                    records.push(...extractedHits);
                }
            }
            startIndex += hits.hits.length;
        } while (useScroll && currentHits.length && startIndex < limit);

        if (scrollId) {
            await BusinessBase.businessObject.elastic.requestAdapter.getJson({
                method: 'DELETE',
                url: `${BusinessBase.businessObject.elastic.baseUrl}/_search/scroll`,
                body: { "scroll_id": query.scroll_id }
            });
        }

        return { records, totalRecords, aggregations: aggs };
    }

    async fetchElasticRelations({ config, data, responseType }) {
        const { relation, relationKey, include } = config;
        const relationValues = [...new Set(data.map(ele => { return ele._source[relationKey] }))];
        if (!relationValues?.length) {
            return;
        }
        const baseQuery = await this.getBaseQuery();
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

    async getRecords({ query, responseType, filter, sort, isElastic }) {
        const { relations, indexName } = this;

        const { records, totalRecords, aggregations } = await this.response({ query, responseType, indexName, filter, sort, isElastic });

        if (relations?.length && records?.length) {
            await this.fetchRelations({ records, filter, sort, responseType });
        }

        return { records, totalRecords, aggregations };
    }

    async fetch({ start = 0, limit = 10, sort, filter, include, returnCount = true, responseType, isElastic }) {
        sort = sort || this.defaultSortOrder;
        include = include || this.include;
        filter = this.parseJson(filter, []);

        const baseQuery = await this.getBaseQuery();
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

        const response = await this.getRecords({ query: baseQuery, responseType, filter, sort, isElastic });
        const { aggregations, records } = response;

        if (returnCount) {
            const recordCount = response.totalRecords;
            return { records, recordCount, aggregations }
        } else {
            return { records, aggregations }
        }
    }

    async fetchRecords({ start = 0, limit = 10, sort, filter, include, returnCount = true, responseType, isElastic, ...rest }) {
        const { scopeId } = this.user;
        filter = this.parseJson(filter, []);
        limit = responseType ? enums.elasticHitsMaxSize : limit;
        if (scopeId) {
            filter.push({ field: 'ClientId', operator: '=', value: scopeId, type: 'integer' });
        }

        if (this.additionalFilters) {
            filter = [...filter, ...this.additionalFilters];
        }

        const { aggregations, recordCount, records } = await this.fetch({ start, limit, sort, filter, include, returnCount, responseType, isElastic });
        let aggs = aggregations;

        let data = records.map(({ _source, _id }) => {
            const processedSource = Object.entries(_source).reduce((acc, [key, value]) => {
                acc[key] = value ?? 0;
                return acc;
            }, {});
            // #60444 - Handle demo-client logic
            if (this.isFromDemo && processedSource.DemoClientName) {
                const clientKey = processedSource.ClientName !== undefined ? 'ClientName' : 'Client';
                processedSource[clientKey] = processedSource.DemoClientName;
                delete processedSource.DemoClientName;
            }

            return { ...processedSource, id: _id };
        });

        if (Object.keys(aggregations).length) {
            if (this.aggregationFnc) {
                aggs = this.aggregationFnc(aggregations);
            }
        }

        if (this.reArrangeRecords) {
            if (data.length >= 2) {
                data = this.reArrangeRecords(data);
            }
        }
        let result = { aggregations: aggs, recordCount, records: data }
        if (this.customizeList && typeof this.customizeList === 'function') {
            result = await this.customizeList({ result, ...rest });
        }
        return result;
    }
}

export { ElasticBusinessBase };

export default ElasticBusinessBase;