# Test guidance

These rules supplement the root `AGENTS.md` for `tests/**` and for selecting
validation when implementation changes affect these tests.

- Run commands from the repository root. Tests read `config.json` and
  `config.local.json` from the current directory; use safe local configuration.
- Mock external database, HTTP and authentication integrations. Do not connect
  to shared/production databases or services to validate an offline change.
- Run test processes sequentially (`--test-concurrency=1`): Pino rotating-log
  symlinks can race on Windows, and parallel suites can exhaust available memory.
- There is no generic `test` script. Some files are standalone assertions rather
  than `node:test` suites; run those directly with `node` when relevant.
- `auth.test.js` needs external endpoint credentials; `min-max.test.js` uses
  Jest-style globals. Do not include either in the offline `node:test` selection.
- Test success and failure behavior. Use descriptive names; test the public
  contract rather than copying implementation logic.

## Targeted commands

```text
node --test --test-concurrency=1 tests/business-base-pagination.test.js tests/business-base-list-filters.test.js tests/business-base-orderby.test.js
node --test --test-concurrency=1 tests/dependency-security.test.mjs
node tests/verify-exports.mjs
```

For justified broader coverage, select only files that use `node:test`. On Windows:

```powershell
$unitTests = Get-ChildItem tests -File | Where-Object {
    $_.Name -match '\.test\.(js|mjs)$' -and
    (Select-String -LiteralPath $_.FullName -Pattern 'node:test' -Quiet)
} | ForEach-Object { $_.FullName }
node --test --test-concurrency=1 @unitTests
```

Pagination tests use real MSSQL/MySQL query builders and `runQuery` with mocked
drivers; they do not demonstrate live database integration.

## Known baseline failures

Previously reproduced on unchanged `main` at `d864e45` (and during dependency
validation): `sql-log-format.test.js` has an undefined `invalidLogLevelLogger`
and a Unicode string-literal expectation failure. Standalone `where-type.test.js`
has a type-inference expectation failure. Reproduce these on the relevant base
before attributing failures to new changes; report failures, do not hide them.
