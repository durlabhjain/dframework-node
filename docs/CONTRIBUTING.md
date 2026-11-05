# Contributing and agent instructions

`AGENTS.md` is the authored repository-wide source for working rules and current
validation commands. `lib/AGENTS.md` owns implementation contracts and
`tests/AGENTS.md` owns test selection and known baseline failures. Their regular
`CLAUDE.md` bridges import the matching source; regular Copilot repository/path
instructions are generated copies, so Windows does not need symlink privileges.

After editing a source, run `yarn instructions:sync`, then
`yarn instructions:check`, and commit both source and generated output. CI checks
drift without rewriting files. Add scopes to `scripts/sync-agent-instructions.mjs`.
Keep longer examples here or in existing API documentation, rather than copying
them into every tool's instructions. Client support varies, so check the loaded
instruction list/context in the coding client when setting up a new environment.

## Project map

This ES module library provides Portal API access, MSSQL/MySQL operations,
ElasticSearch, Pino logging, Basic/Entra/LDAP/ASPX authentication, business objects,
reports and Azure integration. The manifest is authoritative for dependencies,
optional peers, versions and export paths.

| Area | Location |
| --- | --- |
| Package entry point and public exports | `index.js`, `package.json` |
| Framework and configuration | `lib/index.js`, `lib/appConfig.mjs` |
| Business objects, query helpers, error mapping | `lib/business/` |
| Database implementations and driver wrappers | `lib/sql.js`, `lib/mysql.js`, `lib/wrappers/` |
| HTTP/search adapters and authentication | `lib/adapters/`, `lib/http-auth/`, `lib/business/auth/` |
| Express middleware | `lib/middleware/` |
| Logging, dates, Azure, ElasticSearch, reports | `lib/logger.js`, `lib/util.js`, `lib/azure.js`, `lib/elastic.js`, `lib/reports.mjs` |
| Tests and examples | `tests/`, `docs/examples/` |

Use parameterized queries through the documented adapter API. Business objects
extend `BusinessBase`; preserve its constructor and CRUD/filter/hook contracts.
Avoid copying unverified query or report snippets into agent rules.

## Reference documentation

- [README](../README.md): setup, API overview and exports.
- [API reference](API_REFERENCE.md) and [usage patterns](USAGE_PATTERNS.md):
  business objects, filtering, joins, queries and usage examples.
- [Database configuration](DATABASE_CONFIGURATION.md): configuration and pooling;
  local overrides use `config.local.json`, with `.esenv` examples under
  `environments/` where applicable.
- [SQL logging](SQL_LOGGING.md) and [logger migration](LOGGER_MIGRATION.md):
  request context, log levels and modern transport configuration.
- [New exports](NEW_EXPORTS.md) and [examples](examples/): subpath imports and
  working usage.
- [TODO](../TODO.md): outstanding review items, including report handlers.

## CI foundation

The dependency workflow checks instructions, immutable installation, offline
dependency behavior and exports. Its local composite setup action accepts Node
and Vite+ versions, verifies Yarn against `packageManager` and installs the
committed lockfile. It is a reusable foundation for this repository; callers own
test selection, permissions, runner choice and release behavior. No external
shared-workflow repository, cross-owner access, release permission or secret is
introduced. Changes to this library do not require blanket builds of Playbook
or its other projects.
