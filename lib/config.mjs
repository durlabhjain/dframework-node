import { readFileSync } from 'node:fs';

/** Shallow, left-to-right JSON overrides, matching appConfig's existing contract. */
export function readConfig(files = ['config.json', 'config.local.json']) {
    const config = {};
    for (const file of files) {
        try { Object.assign(config, JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    return config;
}

/** Zod-compatible validation with field errors, without serializing config values. */
export function validateConfig(schema, config, label = 'Configuration') {
    const result = schema.safeParse(config);
    if (!result.success) {
        throw new Error(`${label}: ${result.error.issues.map(issue => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; ')}`);
    }
    return result.data;
}
