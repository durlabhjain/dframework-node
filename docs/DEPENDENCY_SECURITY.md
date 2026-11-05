# Dependency security and Yarn 4 - 2026-11-05

The exported adapters entrypoint imports semver unconditionally through GotAdapter.
It is a required peer, with a separate development provider for repository tests;
consumers must provide the declared range. The offline packed-consumer regression
supplies only declared required peers and verifies adapter imports and HTTP/2
defaults, without access to the checkout's development or optional peer packages.

Yarn 4.18.1 replaces Yarn Classic with a committed modern yarn.lock. The node-modules linker creates a local node_modules directory, which remains ignored by Git; dependency scripts are disabled and a one-day package-age gate applies. No Git repositories are approved because this source project has no Git dependencies. Scoped modern resolutions pin UUID 11.1.1 for ExcelJS/MSAL and tmp exactly 0.2.7 for ExcelJS; npm-only overrides and Classic glob resolution syntax are removed. The earlier compatible lock refresh also patches lodash, fast-xml-parser, jws, fast-copy, brace-expansion and minimatch.

objects-to-csv 3 removes the old parsing chain. Its asynchronous API is retained; formula-like strings receive an apostrophe, while numeric types remain numeric. Tests exercise the actual framework CSV response, XLSX comments/read-write and MSAL GUID creation. Review machine-only CSV consumers when adopting the updated peer. Runtime peers remain installed as development copies for tests, including explicit semver and Node type providers; their dev flag does not remove application runtime exposure.

Use `yarn install --immutable` for setup and CI, and `yarn install` only for intentional dependency updates committed with the manifest. Explicit tests and reviewed setup commands still run. Recursive Yarn 4 audit reports no advisory families; upstream LDAP/fstream deprecation notices remain and can give the audit CLI a nonzero exit. The complete sequential unit suite has 206 passes and the same two sql-log-format.test.js failures reproduced on unchanged main (undefined invalidLogLevelLogger and a Unicode SQL-literal expectation). All 47 export checks pass, and `yarn pack` produces the source package. No database, LDAP, Azure or real SMTP integration was run, and no package was published or tagged.

These source install controls and resolutions are not inherited by consumers. Applications must maintain their own locks, resolutions and reviewed framework releases. Oneleet reported 36 findings from the previous default-branch lock. Post-merge scanning must verify remediation; its two broader legacy-minimatch matches for GHSA-g3hv-75wg-m249 need reconciliation with npm's >=7 affected range. The patched 3.1.5/5.1.9 tree reports no advisory family locally; do not force incompatible replacements to silence a scanner discrepancy.
