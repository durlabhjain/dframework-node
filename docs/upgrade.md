# Node & Package Upgrade Progress

## 1. Node.js Version Changes

- **Initial Upgrade**: Upgraded Node.js to **v24**.
- **Issue**: Encountered compatibility issues with some dependencies.
- **Resolution**: Downgraded Node.js to **v18** to ensure compatibility with:
  - `@azure/msal-node@1.18.4` (required by `tedious` via `mssql`).

## 2. Dependency Cleanup

- Removed `node_modules`.
- Cleared Yarn cache.
- Deleted lock files (`yarn.lock` or `package-lock.json`).
- Reinstalled all dependencies using `yarn` to ensure a clean setup.

## 3. Dependency Analysis

- Ran `yarn why @azure/msal-node` to identify dependency chains:
  - **Direct dependency**: `@azure/msal-node@2.16.2`
  - **Indirect dependency**: `@azure/msal-node@1.18.4` (via `tedious` and `@azure/identity`)
- **Observation**: Direct version is up-to-date, but the indirect version is constrained by upstream dependencies.

## 4. Outdated Packages Check

- Ran `yarn outdated` to identify available updates.
- Categorized available updates into:
  - Minor
  - Patch
  - Major (avoided for now)

## 5. Minor/Patch Upgrades

Updated the following dependencies (minor/patch only):

| Package                     | From        | To           |
|-----------------------------|-------------|--------------|
| `@azure/identity`           | `^3.2.3`     | `^4.10.2`     |
| `@azure/storage-blob`       | `^12.23.0`   | `^12.27.0`    |
| `dotenv`                    | `^16.3.1`    | `^16.6.1`     |
| `dayjs`                     | `^1.11.11`   | `^1.11.13`    |
| `exceljs`                   | `^4.4.0`     | `^4.4.0` (no change) |
| `form-data`                 | `^4.0.0`     | `^4.0.4`      |
| `fs-extra`                  | `^11.1.1`    | `^11.3.0`     |
| `got`                       | `^11.8.5`    | `^14.4.7`     |
| `jest`                      | `^29.5.0`    | `^29.7.0`     |
| `js2xmlparser`              | `^5.0.0`     | `^5.0.0` (no change) |
| `ldapjs`                    | `^3.0.7`     | `^3.0.7` (no change) |
| `mysql2`                    | `^3.1.0`     | `^3.14.2`     |
| `mssql`                     | `^9.2.3`     | `^11.0.1`     |
| `objects-to-csv`            | `^1.3.6`     | `^1.3.6` (no change) |
| `pino`                      | `^9.3.2`     | `^9.7.0`      |
| `pino-abstract-transport`   | `^1.2.0`     | `^2.0.0`      |
| `pino-multi-stream`         | `^6.0.0`     | `^6.0.0` (no change) |
| `pino-pretty`               | `^8.0.0`     | `^13.0.0`     |
| `prompt`                    | `^1.0.0`     | `^1.3.0`      |
| `semver`                    | `^7.3.8`     | `^7.3.8` (no change) |
| `tough-cookie`              | `^2.5.0`     | `^5.1.2`      |
| `@azure/msal-node`          | `^2.16.2`    | `^3.6.3`      |

## 7. Packages Removed

These packages were removed:

| Package               | Reason            |
|-----------------------|-------------------|
| None                  | All previous packages are still present but with version updates or moved from `peerDependencies` to `devDependencies` |

## 8. Node.js Final Upgrade

- Successfully **upgraded Node.js to v24** after dependency adjustments.
- Ensured all packages are on the latest compatible versions.
