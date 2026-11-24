import { hostname } from 'node:os';
import { z } from 'zod';
import { validateConfig } from './config.mjs';
import { createVaultResolver } from './vault.mjs';

const positive = z.number().int().min(1).max(2147483647);
const identifier = z.string().trim().min(1).refine(value => { try { encodeURIComponent(value); return true; } catch { return false; } }, 'Expected valid Unicode');
const baseUrl = z.url().refine(value => {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash;
}, 'Expected an HTTP(S) URL without credentials, query or fragment');
export const openObserveConfigSchema = z.looseObject({
    url: baseUrl, organization: identifier, streamName: identifier,
    auth: z.object({ username: z.string().trim().min(1), password: z.string().min(1).refine(value => value.trim().length > 0) }),
    batchSize: positive.default(1), timeThreshold: positive.default(300000),
    timeoutMs: positive.default(10000), maxQueueSize: positive.default(1000),
}).refine(value => value.maxQueueSize >= value.batchSize, { path: ['maxQueueSize'], message: 'Must be at least batchSize' });
export const otelConfigSchema = z.looseObject({
    endpoint: baseUrl,
    protocol: z.enum(['http/json', 'http/protobuf', 'grpc']).default('http/protobuf'),
    headers: z.record(z.string(), z.string()).default({}),
    serviceName: z.string().min(1).optional(),
});

// Shared across module copies, and invisible to JSON/pino serialization.
const errorLogged = Symbol.for('dframework.errorLogged');

/** Marks an error as already reported, so a top-level handler does not log it a second time. */
export function markErrorLogged(error) {
    if (error && typeof error === 'object') error[errorLogged] = true;
    return error;
}

/** True when a lower layer already logged this error with its own context. */
export const isErrorLogged = error => Boolean(error?.[errorLogged]);

// OTLP sends the message as the record body, so a caller that logs only an object
// ships an empty body. Derive a title from the error when the call supplies none.
export const deriveLogMessage = payload => {
    const error = payload.err ?? payload.error;
    const stack = typeof error?.stack === 'string' ? error.stack.split('\n', 1)[0] : '';
    return String(error?.message || stack || payload.message || '').trim();
};

export const logMethod = function (args, method) {
    const [payload] = args;
    if (args.length === 1 && payload && typeof payload === 'object' && !(payload instanceof Error) && !payload.msg) {
        const message = deriveLogMessage(payload);
        if (message) return method.call(this, payload, message);
    }
    return method.apply(this, args);
};

/** Preserve legacy rotation keys while using pino-roll's options. */
export function normalizeFileConfig(file = {}) {
    const { max_logs, date_format, verbose: _verbose, ...options } = file;
    if (options.frequency === '24h') options.frequency = 'daily';
    if (max_logs && !options.limit) options.limit = { count: Number.parseInt(max_logs, 10) };
    if (date_format && !options.dateFormat) options.dateFormat = date_format.replaceAll('YYYY', 'yyyy').replaceAll('DD', 'dd');
    return options;
}

// A collector copies resource attributes onto every record, and the process detector runs
// in the Pino worker, so process.command names that worker. 'all' restores full detection.
export const applyResourceDetectors = ({ env = process.env, detectors = 'env,serviceinstance' } = {}) => {
    env.OTEL_NODE_RESOURCE_DETECTORS ||= [detectors].flat().join(',');
    return env.OTEL_NODE_RESOURCE_DETECTORS;
};

/** Field paths to drop from every destination, as Pino removing redaction. */
export const createRedactOptions = (ignoreFields = []) => {
    const paths = [ignoreFields].flat().filter(Boolean);
    return paths.length ? { paths, remove: true } : undefined;
};

/** Opt-in OTLP destination. Does not import Pino, create workers or register exit handlers. */
export function createOtelTarget({ env = process.env, config, serviceName = 'dframework', level = 'info' } = {}) {
    const standardEndpoint = env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT || env.OTEL_EXPORTER_OTLP_ENDPOINT;
    if (!standardEndpoint && !config) return null;
    let options;
    if (!standardEndpoint) {
        if (config.organization !== undefined || config.streamName !== undefined) {
            const legacy = validateConfig(openObserveConfigSchema, config, 'OpenObserve logging');
            options = {
                endpoint: `${legacy.url.replace(/\/+$/, '')}/api/${encodeURIComponent(legacy.organization)}/v1/logs`,
                protocol: 'http/json',
                headers: { Authorization: `Basic ${Buffer.from(`${legacy.auth.username}:${legacy.auth.password}`).toString('base64')}`, 'stream-name': legacy.streamName },
                serviceName: legacy.app || serviceName,
            };
        } else options = validateConfig(otelConfigSchema, config, 'OTLP logging');
    }
    const target = {
        target: 'pino-opentelemetry-transport', level,
        options: { loggerName: serviceName, resourceAttributes: { 'host.name': hostname(), 'process.pid': process.pid, 'service.name': env.OTEL_SERVICE_NAME || options?.serviceName || serviceName } },
    };
    if (options) {
        const protocol = options.protocol === 'http/json' ? 'http' : options.protocol;
        const field = protocol === 'grpc' ? 'grpcExporterOptions' : protocol === 'http' ? 'httpExporterOptions' : 'protobufExporterOptions';
        target.options.logRecordProcessorOptions = {
            recordProcessorType: 'batch',
            exporterOptions: { protocol, [field]: { url: options.endpoint, headers: options.headers } },
        };
    }
    return target;
}

/** Load logging secrets before workers start. False means callers must skip remote transports. */
export async function prepareLoggingConfig({ config, env = process.env, resolver = createVaultResolver({ config, env }), onWarning = () => {} }) {
    const other = config.logging?.otherConfig;
    try {
        await resolver.resolveEnvironmentSecrets(Object.keys(env).filter(name => name.startsWith('OTEL_')));
        const secretPath = other?.otelConfigPath || other?.httpConfigPath;
        if (!secretPath || env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT || env.OTEL_EXPORTER_OTLP_ENDPOINT) return true;
        const value = typeof secretPath !== 'string' ? secretPath : secretPath.startsWith('vault:')
            ? await resolver.resolveSecret(secretPath) : await resolver.getSecret(secretPath);
        createOtelTarget({ config: value, env });
        other.otelConfig = value;
        return true;
    } catch {
        if (other) other.otelConfig = null;
        onWarning('OTLP logging disabled; could not load a valid logging secret');
        return false;
    }
}
