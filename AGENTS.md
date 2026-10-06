# DFramework-Node working notes

Follow [.github/copilot-instructions.md](.github/copilot-instructions.md) for project conventions.

## Checkout and setup

- The Windows project checkout is `D:\durlabh\dframework-node`, remote
  `https://github.com/durlabhjain/dframework-node`. Remote default is `main`;
  a plain `dev` branch was absent when verified for #68667. Confirm the requested
  base with the user if it differs; never substitute a base silently.
- Check status and existing branches/PRs before work. Update the approved base
  with `git pull --ff-only`, then use a dedicated branch/worktree. Preserve dirty work.
- This is an ES module package (`@durlabh/dframework`) with `yarn.lock`, no npm
  test script, and no root `.agents/skills` directory at the time of verification.
- Verified runtime: Node v24.21.0. The project already has installed dependencies.
  An isolated Windows worktree can use a local `node_modules` junction to the
  checkout's installed dependencies; keep the junction untracked and avoid
  running package installation through it.

## Tests

Run from the worktree root. Tests read `config.json` / `config.local.json` from
the current directory, so avoid bringing production configuration into a test run.

```powershell
node --test --test-concurrency=1 tests/business-base-pagination.test.js tests/business-base-list-filters.test.js tests/business-base-orderby.test.js

$unitTests = Get-ChildItem tests -File | Where-Object {
    $_.Name -match '\.test\.(js|mjs)$' -and
    (Select-String -LiteralPath $_.FullName -Pattern 'node:test' -Quiet)
} | ForEach-Object { $_.FullName }
node --test --test-concurrency=1 @unitTests
node tests/verify-exports.mjs
```

- Use sequential test processes: parallel runs can race on Pino's rotating-log
  symlinks on Windows and exceed available memory. Logs are ignored by Git.
- Some tests are standalone assertion scripts, not `node:test` files. Run them
  directly with `node`. `auth.test.js` requires external endpoint credentials;
  `min-max.test.js` uses Jest-style globals. Neither belongs in the command above.
- Baseline on `main` at `d864e45`: `node:test` had two failures in
  `sql-log-format.test.js` (undefined `invalidLogLevelLogger` and a Unicode
  string literal expectation). Standalone
  `where-type.test.js` had one type-inference expectation failure and
  `pino-http-send.test.mjs` had two provider-output expectation failures.
  Reproduce baseline failures before attributing them to a change.
- Pagination tests use actual MSSQL/MySQL query builders and `runQuery`, with
  mocked driver calls. They do **not** establish live database integration coverage.

## Pagination contract

- `BusinessBase.list()` is shared by the MSSQL `Sql` and `Mysql` database adapters.
  `lib/adapters/` contains HTTP/search adapters, not SQL pagination implementations.
- With `returnCount` and a positive limit, count first; confirmed zero totals skip
  the data and supplemental row-group queries. Keep list hooks and response shape.
- Preserve count value types, nonzero paging, parameter bindings, CTEs and existing
  first-group count semantics. Empty grouped counts represent zero matching groups.
- Expand hook IN-list placeholders before deriving count/data statements, and bind
  each parameter once on the shared request. Without a count, still execute data.
- Elastic search returns totals and hits in one response; it has no separate
  count-followed-by-data query to short-circuit.
