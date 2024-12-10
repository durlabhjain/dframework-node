import fs from 'fs';

class ErrorMapper {

    file = "./sql-error-mappings.json"

    mappings = null;

    constructor({ file }) {
        this.file = file;
    }

    getMappings() {
        if (!this.mappings) {
            const mappingData = JSON.parse(fs.readFileSync(this.file));
            for (const entry of mappingData) {
                entry.pattern = new RegExp(entry.pattern);
            }
            this.mappings = mappingData;
        }
        return this.mappings;
    }

    map(error) {
        const mappings = this.getMappings();
        const mappingEntry = mappings.find(m => m.pattern.test(error));
        if (mappingEntry) {
            // const exResult = mappingEntry.pattern.exec(error);
            // const replacement = mappingEntry.mappings[exResult[1]] || exResult[1];
            const replacementKey = Object.keys(mappingEntry.mappings).find(key => error.includes(key));
            if (replacementKey) {
                const replacement = mappingEntry.mappings[replacementKey];
                return mappingEntry.description.replace(/\$\{(\d+)\}/g, () => replacement);
            }
            // const replacement = mappingEntry.mappings[exResult[1]] || exResult[1];
            return error;
            // return mappingEntry.description.replace(/\$\{(\d+)\}/g, () => replacement);
        }
        return error;
    }
}

const sqlErrorMapper = new ErrorMapper({ file: "./sql-error-mappings.json" });

export {
    sqlErrorMapper
}