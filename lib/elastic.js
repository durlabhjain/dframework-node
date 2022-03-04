import fs from 'fs-extra';
import path from 'path';
import got from 'got';

class Elastic {
    constructor({ environment }) {
        this.setEnvironment(environment);
        this.client = got.extend({});
    }

    setEnvironment(filename) {
        this.environment = filename;
        if (filename) {
            this.elasticEnv = fs.readJsonSync(path.resolve('environments', filename + '.esenv'));
        } else {
            this.elasticEnv = null;
        }
    }

    async aggregate({ query, mappings, method = 'POST', queryPath, customize }) {
        if (typeof query === 'string') {
            const fileData = await fs.readFile(path.resolve('queries', query + '.esquery'));
            query = fileData.toString();

            const index = query.indexOf("\n");
            queryPath = query.substr(0, index).replace("\r", "");
            const queryPathParts = /^(\w+) (.+)$/.exec(queryPath);
            //method = queryPathParts[1];
            queryPath = queryPathParts[2];

            query = query.substr(query.indexOf("{"));

            query = JSON.parse(query);
        }

        if (typeof customize === 'function') {
            const result = customize({ query, mappings, queryPath, method });
            if (result && result.then) {
                await result;
            }
        }

        const { statusCode, body } = await this.client({
            method,
            url: this.elasticEnv.host + "/" + queryPath,
            json: query
        });

        if (statusCode !== 200) {
            throw new Error("Error", body);
        }

        const rows = [];
        const data = JSON.parse(body);
        this.fillAggRow({ data: data.aggregations, mappings, row: {}, rows });
        return rows;
    }


    fillAggRow({ data, mappings, row, rows }) {
        for (const key in mappings) {
            const { root, items, map } = mappings[key];
            const buckets = data[root].buckets;
            if (buckets) {
                const isLast = !Array.isArray(items);
                for (const bucket of buckets) {
                    const currentRow = { ...row, [key]: bucket.key };
                    if (map) {
                        for (const mapKey in map) {
                            currentRow[mapKey] = bucket[map[mapKey]];
                        }
                    }
                    if (isLast) {
                        rows.push(currentRow);
                    } else {
                        for (const item of items) {
                            this.fillAggRow({ data: bucket, mappings: item, row: currentRow, rows })
                        }
                    }
                }
            } else {
                rows.push(row);
            }
        }
    }
}


export default Elastic;