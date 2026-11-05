import { z } from 'zod';
import { validateConfig } from './config.mjs';
import { createVaultResolver } from './vault.mjs';

const positive = z.number().int().min(1).max(2147483647);
const baseUrl = z.url().refine(value => {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash;
}, 'Expected an HTTP(S) URL without credentials, query or fragment');
export const openObserveConfigSchema = z.looseObject({
    url: baseUrl, organization: z.string().trim().min(1), streamName: z.string().trim().min(1),
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

/** Preserve legacy rotation keys while using pino-roll's options. */
export function normalizeFileConfig(file = {}) {
    const { max_logs, date_format, verbose: _verbose, ...options } = file;
    if (options.frequency === '24h') options.frequency = 'daily';
    if (max_logs && !options.limit) options.limit = { count: Number.parseInt(max_logs, 10) };
    if (date_format && !options.dateFormat) options.dateFormat = date_format.replaceAll('YYYY', 'yyyy').replaceAll('DD', 'dd');
    return options;
}

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
        options: { loggerName: serviceName, resourceAttributes: { 'service.name': env.OTEL_SERVICE_NAME || options?.serviceName || serviceName } },
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

/** Load a logging secret before workers start; failure leaves local logging available. */
export async function prepareLoggingConfig({ config, env = process.env, resolver = createVaultResolver({ config, env }), onWarning = () => {} }) {
    await resolver.resolveEnvironmentSecrets(Object.keys(env).filter(name => name.startsWith('OTEL_')));
    const other = config.logging?.otherConfig;
    if (!other?.otelConfigPath || env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT || env.OTEL_EXPORTER_OTLP_ENDPOINT) return;
    try {
        const value = other.otelConfigPath.startsWith('vault:')
            ? await resolver.resolveSecret(other.otelConfigPath) : await resolver.getSecret(other.otelConfigPath);
        createOtelTarget({ config: value, env });
        other.otelConfig = value;
    } catch {
        other.otelConfig = null;
        onWarning('OTLP logging disabled; could not load a valid logging secret');
    }
}
