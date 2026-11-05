# Shared configuration, Vault and logging

Use the subpath exports to avoid loading SQL drivers or creating a logger:

```js
import { readConfig, validateConfig } from '@durlabh/dframework/config';
import { createVaultResolver } from '@durlabh/dframework/vault';
import { createOtelTarget } from '@durlabh/dframework/logging';
import { z } from 'zod';

const config = readConfig(); // config.json, then config.local.json; shallow merge
const secrets = createVaultResolver({ config });
await secrets.resolveConfigSecrets(config);
await secrets.resolveEnvironmentSecrets();
const settings = validateConfig(z.object({ port: z.number().int().min(1) }), config);
```

Applications own their schemas. Keep deployment values in JSON/environment variables;
keep field types, defaults and cross-field checks in a Zod schema. Validation errors
include paths and messages, never a serialized copy of the configuration.

## Vault / OpenBao

`vault:path:key` reads one key; `vault:path` reads a dictionary. References expand
recursively in objects and arrays. JSON object/array strings are parsed.
`${environment}` uses `vault.environment`, `environment`, `Environment`, then
`NODE_ENV`, defaulting to `testing`. Plain values are unchanged.

Set `VAULT_ADDR`, `VAULT_TOKEN` and optionally `VAULT_NAMESPACE` in the deployment
environment. Existing `vault.addr/token/namespace`, `vault.engine` (default `kv`),
and `vault.kvVersion/version` (default `2`) remain supported. KV v1 and v2 work;
`VAULT_KV_VERSION` / `Vault_KvVersion` are fallbacks when config has no version.

The resolver caches each secret for five minutes and coalesces concurrent reads.
An expired cached value remains available during an outage; set `allowStale: false`
to require fresh credentials. The first failed lookup always fails. Requests have
a five-second deadline and follow no redirects. Errors omit tokens and response
bodies. No credentials are written to disk.

`clearSecretCache(path?)` invalidates a path or the whole instance. Each app owns
its resolver, logger callback and lifecycle; imports do not contact Vault.
Configuration and environment expansion commit only after successful resolution.

## OTLP logs

Install the optional `pino-opentelemetry-transport` peer with Pino 10.4+.
`createOtelTarget({ serviceName, level, env, config })` returns a Pino target, or
`null` when no destination is configured. It creates no workers or signal handlers.
Use it alongside the app's file/stdout targets and end the transport at shutdown.

Standard settings take precedence:

```text
OTEL_EXPORTER_OTLP_LOGS_ENDPOINT=https://collector.example/v1/logs
OTEL_EXPORTER_OTLP_LOGS_PROTOCOL=http/protobuf
OTEL_EXPORTER_OTLP_LOGS_HEADERS=Authorization=Basic%20VALUE
OTEL_SERVICE_NAME=my-app
```

The general `OTEL_EXPORTER_OTLP_ENDPOINT` is also supported. Protocols are
HTTP/JSON, HTTP/protobuf and gRPC. Queueing and batching use the SDK's `OTEL_BLRP_*`
settings. Headers may themselves be `vault:path:key` references; resolve them
before Pino starts workers.

An explicit config accepts `{ endpoint, protocol, headers, serviceName }`.
Existing OpenObserve secrets (`url`, `organization`, `streamName`, `auth`) also
work: they become standard OTLP requests to `/api/<organization>/v1/logs` with
the existing Basic auth and `stream-name` header. No secret rewrite is needed.

The framework logger supports `logging.otherConfig.otelConfig` or
`otelConfigPath` (a Vault path/reference). It awaits that lookup before creating
workers. A failed logging-secret lookup (including `OTEL_*` Vault references)
disables remote logging and keeps local logging. Custom logger integrations must
check the boolean returned by `prepareLoggingConfig()` and skip remote transports
when it is false. Environment values are left unchanged on a failed expansion;
unresolved references must never be passed to a transport worker.
Existing `httpConfig` integrations remain available when OTLP is absent;
OTLP takes precedence to avoid duplicate exports.

Day.js and ExcelJS are optional peers for selective subpath consumers. Apps using
only `appConfig`, `config`, `vault`, `logging` and `list-parameters` need neither.
The root entrypoint eagerly imports utilities and reports: root/report consumers
must still provide their integration peers, including Day.js, ExcelJS and fs-extra.
Optional peer metadata does not make these imports lazy. Existing public APIs
remain unchanged.
