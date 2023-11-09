import { classMap } from "./business-base.mjs";

const lookup = {
    lookupTypes: null,

    init: async function () {
        if (this.lookupTypes === null) {
            const LookupType = classMap.get('LookupType');
            const instance = new LookupType();
            const { records } = await instance.list({ limit: 0 });
            const lookupTypes = new Map();
            for (const record of records) {
                record.items = [];
                lookupTypes.set(record.LookupTypeID || record.LookupTypeId, record);
                lookupTypes.set(record.LookupType.toUpperCase(), record);
            }
            this.lookupTypes = lookupTypes;

            const Lookup = classMap.get('Lookup');
            const lookupInstance = new Lookup();
            const { records: lookupRecords } = await lookupInstance.list({ limit: 0 });
            for (const record of lookupRecords) {
                const { LookupTypeId: lookupTypeId } = record;
                if (!lookupTypes.has(lookupTypeId)) {
                    lookupTypes.set(lookupTypeId, { items: [] });
                }
                const lookupType = lookupTypes.get(lookupTypeId);
                lookupType.items.push({ label: record.DisplayValue, value: lookupType.UseCustomValue ? record.CustomValue || record.CustomStringValue : record.LookupId, ScopeId: record.ScopeId });
            }
        }
    },

    get: async function (user, nameOrId, scopeId = 0) {
        await this.init();
        nameOrId = nameOrId.toUpperCase();
        const businessObject = classMap.get(nameOrId);
        if (businessObject) {
            const instance = new businessObject();
            instance.user = user;
            return await instance.lookupList({ scopeId })
        }
        const lookup = this.lookupTypes.get(nameOrId);
        if (!lookup) {
            return [];
        }
        return lookup.items.filter((item) => item.ScopeId === scopeId);
    }
};

export default lookup;