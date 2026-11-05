---
applyTo: "lib/**"
---

<!-- Generated from lib/AGENTS.md; edit the source and run yarn instructions:sync. -->

# Library implementation guidance

These rules supplement the root `AGENTS.md` for `lib/**`.

## Architecture and behavior

- `lib/index.js` implements Framework; root `index.js` and `package.json` expose
  the public API. Keep root exports, subpath exports and documentation consistent.
- `lib/business/` contains business objects, authentication, query helpers and
  SQL error mapping. Preserve CRUD, multi-select, soft-delete and relationship
  behavior when changing `BusinessBase` or routing.
- `lib/sql.js` and `lib/mysql.js` implement the database adapters;
  `lib/wrappers/` exposes driver types. `lib/adapters/` contains HTTP/search
  adapters, not the SQL pagination implementation.
- Use parameterized SQL and the adapter's documented parameter-binding API.
  Preserve MSSQL/MySQL types and SQL error mapping (including codes 2627/2601).
- Configuration comes from `lib/appConfig.mjs`, `config.json` and
  `config.local.json`; never introduce production credentials into a test run.
- Authentication implementations cover Basic, Entra ID, LDAP and ASPX Forms.
  Preserve their security boundaries and optional integration contracts.
- Preserve report formats (Excel, CSV, JSON, text), spreadsheet formatting,
  comments/formulas and CSV formula escaping. See existing report APIs and tests
  before adding handlers; `TODO.md` records remaining report improvements.
- Use Pino's configured levels, request context and transport contracts. Use
  dayjs and the formats in `lib/util.js` (`M-D-Y`, `M-D-Y HH:mm:ss`, and report
  date formats) for existing date behavior.

## Pagination contract

- `BusinessBase.list()` is shared by MSSQL and MySQL. With `returnCount` and a
  positive limit, count first; confirmed zero totals skip the data and
  supplemental row-group queries. Keep list hooks and response shape.
- Preserve count value types, nonzero paging, parameter bindings, CTEs and
  first-group count semantics. Empty grouped counts mean zero matching groups.
- Expand hook IN-list placeholders before deriving count/data statements; bind
  each parameter once on the shared request. Without a count, still execute data.
- ElasticSearch returns totals and hits together; it has no separate
  count-followed-by-data query to short-circuit.

For SQL/query changes, run the relevant pagination, filter, order, type and
parameter tests described in `tests/AGENTS.md`. For logging/report/auth changes,
select their offline tests and report any live-service coverage still needed.
