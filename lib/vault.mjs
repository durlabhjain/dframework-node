import { z } from 'zod';
import { validateConfig } from './config.mjs';

const settingsSchema = z.object({
    addr: z.url().refine(value => { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash; }, 'Expected an HTTP(S) base URL without credentials, query or fragment'),
    token: z.string().min(1),
    engine: z.string().min(1).default('kv'),
    version: z.enum(['1', '2', 'v1', 'v2']).default('2'),
    namespace: z.string().optional(),
});
const encodePath = value => value.replace(/^\/+|\/+$/g, '').split('/').map(part => {
    if (!part || part === '.' || part === '..') throw new Error('Invalid Vault path');
    return encodeURIComponent(part);
}).join('/');
const parseValue = value => {
    if (typeof value === 'string' && /^[\[{]/.test(value.trim())) {
        try { return JSON.parse(value); } catch { /* Keep non-JSON strings. */ }
    }
    return value;
};

/** OpenBao/Vault KV references, scoped cache, TTL and optional stale fallback. No process or logging side effects. */
export function createVaultResolver({ config = {}, env = process.env, fetchImpl = fetch,
    cacheTtlMs = 300000, allowStale = true, timeoutMs = 5000, now = Date.now,
    onWarning = () => {} } = {}) {
    const cache = new Map();
    const pending = new Map();
    const getConfig = () => typeof config === 'function' ? config() : config;
    const getMappedEnvironment = () => {
        const value = getConfig();
        return String(value.vault?.environment || value.environment || value.Environment || env.NODE_ENV || 'testing').trim().toLowerCase();
    };
    const interpolateEnvironment = value => typeof value === 'string' ? value.replace(/\$\{environment\}/gi, getMappedEnvironment()) : value;
    const settings = () => {
        const vault = getConfig().vault ?? {};
        return validateConfig(settingsSchema, {
            addr: env.VAULT_ADDR || vault.addr,
            token: env.VAULT_TOKEN || vault.token,
            engine: vault.engine,
            version: String(vault.kvVersion || vault.version || env.VAULT_KV_VERSION || env.Vault_KvVersion || '2').trim().toLowerCase(),
            namespace: env.VAULT_NAMESPACE || vault.namespace,
        }, 'Vault settings');
    };
    const dictionary = async path => {
        const opts = settings();
        const identity = JSON.stringify([opts.addr, opts.engine, opts.version, opts.namespace, opts.token, path]);
        const cached = cache.get(identity);
        if (cached && now() - cached.cachedAt < cacheTtlMs) return structuredClone(cached.value);
        if (!pending.has(identity)) pending.set(identity, (async () => {
            try {
                const url = `${opts.addr.replace(/\/+$/, '')}/v1/${encodePath(opts.engine)}/${['1', 'v1'].includes(opts.version) ? '' : 'data/'}${encodePath(path)}`;
                const response = await fetchImpl(url, {
                    headers: { 'X-Vault-Token': opts.token, ...(opts.namespace ? { 'X-Vault-Namespace': opts.namespace } : {}) },
                    signal: AbortSignal.timeout(timeoutMs), redirect: 'error',
                });
                if (!response.ok) { await response.body?.cancel(); throw new Error(); }
                const body = await response.json();
                const data = ['1', 'v1'].includes(opts.version) ? body?.data : body?.data?.data ?? body?.data;
                if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error();
                cache.set(identity, { value: data, cachedAt: now(), path });
                return data;
            } catch {
                if (cached && allowStale) { onWarning('Vault request failed; using a cached credential'); return cached.value; }
                throw new Error('Vault secret request failed; check authentication, path and KV version');
            } finally { pending.delete(identity); }
        })());
        return structuredClone(await pending.get(identity));
    };
    const getSecret = async (path, key) => {
        const data = await dictionary(interpolateEnvironment(path));
        if (key && !Object.hasOwn(data, key)) throw new Error('Vault secret key is missing');
        return key ? parseValue(data[key]) : data;
    };
    const resolve = async (value, ancestors = []) => {
        if (typeof value === 'string' && value.startsWith('vault:')) {
            const ref = interpolateEnvironment(value.slice(6));
            if (!ref || ancestors.includes(ref) || ancestors.length >= 20) throw new Error('Invalid or circular Vault reference');
            const separator = ref.indexOf(':');
            const path = separator < 0 ? ref : ref.slice(0, separator);
            const key = separator < 0 ? undefined : ref.slice(separator + 1);
            if (!path || key === '') throw new Error('Expected vault:path or vault:path:key');
            return resolve(await getSecret(path, key), [...ancestors, ref]);
        }
        if (Array.isArray(value)) return Promise.all(value.map(item => resolve(item, ancestors)));
        if (value && typeof value === 'object') return Object.fromEntries(await Promise.all(Object.entries(value).map(async ([key, item]) => [key, await resolve(item, ancestors)])));
        return value;
    };
    return {
        getMappedEnvironment, interpolateEnvironment, getSecret, resolveSecret: value => resolve(value),
        async resolveConfigSecrets(value) {
            const resolved = await resolve(value);
            if (value && typeof value === 'object') Object.assign(value, resolved);
            return resolved;
        },
        async resolveEnvironmentSecrets(names = Object.keys(env).filter(name => !name.startsWith('VAULT_'))) {
            const values = {};
            for (const name of names) {
                if (!env[name]?.startsWith('vault:')) continue;
                const value = await resolve(env[name]);
                if (typeof value !== 'string') throw new Error('Environment secrets must resolve to strings');
                values[name] = value;
            }
            Object.assign(env, values);
            return env;
        },
        clearSecretCache(path) {
            if (!path) return cache.clear();
            const match = interpolateEnvironment(path);
            for (const [key, item] of cache) if (item.path === match) cache.delete(key);
        },
    };
}
