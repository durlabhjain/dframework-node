class ListParameters {
    start = 0
    limit = 50
    action = 'list'
    filters = []
    asArray = 0
    sort = null
    dir = "asc"
    constructor(options) {
        Object.assign(this, options);
    }
    toFormData() {
        const { filters, sort, dir, comboTypes, ...formData } = this;
        if (comboTypes) {
            const comboTypeQuery = []
            for (const comboType of comboTypes) {
                comboTypeQuery.push(typeof comboType === 'string' ? { type: comboType, loaded: false } : comboType)
            }
            formData.comboTypes = JSON.stringify(comboTypeQuery);
        }
        if (filters && filters.length > 0) {
            for (let i = 0, count = filters.length; i < count; i++) {
                const keyPrefix = `filter[${i}]`;
                const filterData = filters[i];
                let { value, comparison } = filterData;
                formData[keyPrefix + '[field]'] = filterData.field;
                formData[keyPrefix + '[data][type]'] = filterData.type;
                if (value instanceof Date) {
                    value = value.toISOString();
                }
                formData[keyPrefix + '[data][value]'] = value;
                if (comparison) {
                    formData[keyPrefix + '[data][comparison]'] = comparison;
                }
            }
        }
        if (typeof sort === "string") {
            formData.sort = sort;
            formData.dir = dir.match(/desc/i) ? "DESC" : "ASC";
        }
        return formData;
    }
};

export default ListParameters;