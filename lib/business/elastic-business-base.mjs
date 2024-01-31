import dayjs from 'dayjs';
import BusinessBase from './business-base.mjs';
import { util } from '../../index.js';

const mustNotOperators = ["!=", "not", "notEquals", "isEmpty"];

const compareLookups = {
    "onOrAfter": function ({ v, field }) {
        return { "range": { [field]: { "gte": v } } };
    },
    "onOrBefore": function ({ v, field }) {
        return { "range": { [field]: { "lte": v } } };
    },
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
    "=": function ({ v, field }) {
        return { "term": { [field]: v } };
    },
    "equals": function ({ v, field }) {
        return { "term": { [field]: v } };
    },
    "!=": function ({ v, field }) {
        return { "term": { [field]: v } };
    },
    "notEquals": function ({ v, field }) {
        return { "term": { [field]: v } };
    },
    "not": function ({ v, field }) {
        return { "term": { [field]: v } };
    },
    ">": function ({ v, field }) {
        return { "range": { [field]: { "gt": v } } };
    },
    "after": function ({ v, field }) {
        return { "range": { [field]: { "gt": v } } };
    },
    ">=": function ({ v, field }) {
        return { "range": { [field]: { "gte": v } } };
    },
    "<": function ({ v, field }) {
        return { "range": { [field]: { "lt": v } } };
    },
    "before": function ({ v, field }) {
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
    "isNotEmpty": function ({ field }) {
        return { "exists": { "field": field } };
    }
}

compareLookups.isBlank = compareLookups.isEmpty;
compareLookups.isNotBlank = compareLookups.isNotEmpty;

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

    async response({ query, indexName, useScroll = false, isElastic }) {
        useScroll = isElastic ? isElastic : useScroll;
        let records = [], url = `${BusinessBase.businessObject.elastic.baseUrl}/${indexName}/_search${useScroll ? '?scroll=1m' : ''}`, currentHits, totalRecords, aggs = {};
        const aggregationValue = [];
        do {
            const { hits, _scroll_id, aggregations = {} } = await BusinessBase.businessObject.elastic.requestAdapter.getJson({
                url,
                body: query
            });
            if (Object.keys(aggregations).length) {
                aggs = aggregations;
            }
            if (useScroll) {
                if (!Object.prototype.hasOwnProperty.call(query, 'scroll_id')) {
                    query = { "scroll_id": _scroll_id };
                    url = `${BusinessBase.businessObject.elastic.baseUrl}/_search/scroll`;
                }
                if (!totalRecords) {
                    totalRecords = hits.total.value;
                }
                currentHits = hits?.hits;
            } else {
                currentHits = [];
            }
            if (!totalRecords) {
                totalRecords = hits.total.value;
            }
            records = [...records, ...hits.hits];
        } while (currentHits?.length);

        if (Object.keys(aggs).length) {
            Object.keys(aggs).forEach(ele => {
                const buckets = aggs[ele].buckets
                buckets.map((e) => {
                    const value = { key: e.key_as_string, value: e.aggs.value };
                    if (this.isDateAggregation) {
                        value.startDate = dayjs(e.key).startOf('month').format(util.elasticDateFormat.YYYYMMDD);
                        value.endDate = dayjs(e.key).endOf('month').format(util.elasticDateFormat.YYYYMMDD);
                    }
                    aggregationValue.push(value)
                })
            })
        }

        return { records, totalRecords, aggregationValue };
    }

    async fetchElasticRelations({ config, data, responseType }) {
        const { relation, relationKey, include } = config;
        const relationValues = [...new Set(data.map(ele => { return ele._source[relationKey] }))];
        if (!relationValues?.length) {
            return;
        }
        const baseQuery = await ElasticBusinessBase.getBaseQuery();
        baseQuery.size = 10000;
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
                    ele._source = { ...ele._source, ...records[indexValue]._source };
                }
            })
        }
    }

    async fetchSqlRelations({ config, records }) {
        const { relation, columns, relationKey, sqlRelationKey = '', relationCondition = '', useView = true } = config;
        const parameters = [{ ClientId: { value: this.user.scopeId, operator: "=" } }];
        const relationValues = [...new Set(records.map(ele => { return ele._source[relationKey] }))];
        if (!relationValues?.length) {
            return;
        }
        let query = `SELECT ${columns} from ${useView ? `vw${relation}List` : relation} INNER JOIN (SELECT IntValue FROM dbo.CsvToInt('${relationValues.join(',')}')) F ON ${[sqlRelationKey || relationKey]} = F.IntValue`;
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
                    ele._source = { ...ele._source, ...recordset[indexValue] };
                }
            })
        }
    }

    async fetchRelations({ records, filter, sort, responseType }) {
        const { relations } = this;
        for (const config of relations) {
            const { relationType = util.RelationTypes.SQL } = config;
            switch (relationType) {
                case util.RelationTypes.SQL:
                    await this.fetchSqlRelations({ config, records, filter, sort, responseType });
                    break;
                case util.RelationTypes.Elastic:
                    await this.fetchElasticRelations({ config, data: records, filter, sort, responseType });
                    break;
                default:
                    await this.fetchSqlRelations({ config, records, filter, sort, responseType });
            }
        }
    }

    async getRecords({ query, responseType, filter, sort, isElastic }) {
        const { relations, indexName } = this;

        const { records, totalRecords, aggregationValue } = await this.response({ query, responseType, indexName, filter, sort, isElastic });

        if (relations?.length && records?.length) {
            await this.fetchRelations({ records, filter, sort, responseType });
        }

        return { records, totalRecords, aggregationValue };
    }

    async list({ start = 0, limit = 10, sort, filter, include, returnCount = true, responseType, isElastic }) {
        sort = sort || this.defaultSortOrder;
        include = include || this.include;
        filter = this.parseJson(filter, []);

        const baseQuery = await ElasticBusinessBase.getBaseQuery();
        baseQuery.from = start;
        baseQuery.size = limit;
        const { scopeId } = this.user;

        if (include?.length) {
            baseQuery._source.includes = include;
        }

        const queryFilter = baseQuery.query.bool.filter.bool;

        if (scopeId) {
            queryFilter.must.push({ "term": { "ClientId": scopeId } });
        }

        this.applySort(sort, baseQuery);

        this.applyFilters(filter, queryFilter);

        if (this.aggregation) {
            baseQuery.aggs = this.aggregation;
        }

        if (this.aggregation) {
            baseQuery.aggs = this.aggregation;
        }

        const response = await this.getRecords({ query: baseQuery, responseType, filter, sort, isElastic });

        const records = response.records.map(({ _source, _id }) => {
            const id = _id;
            for (const key in _source) {
                if (_source[key] === null) {
                    _source[key] = 0;
                }
            }
            return { ..._source, id };
        });

        if (this.reArrangeRecords) {
            if (records.length >= 2) {
                [records[records.length - 1], records[records.length - 2]] = [records[records.length - 2], records[records.length - 1]];
            }
        }

        const aggregations = response.aggregationValue;

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