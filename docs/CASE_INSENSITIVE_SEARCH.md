# Case-Insensitive Search & Sorting

This guide covers all the options DFramework provides for case-insensitive filtering and sorting. These options apply to both the `Sql` (MSSQL) and `MySql` (MySQL / StarRocks) classes and to any business object that inherits from `BusinessBase`.

---

## Table of Contents

1. [Overview](#overview)
2. [Quick Start](#quick-start)
3. [Master Switch — `forceCaseInsensitive`](#master-switch--forcecaseinsensitive)
4. [Comparison Modes — `caseInsensitiveMode`](#comparison-modes--caseinsensitivemode)
   - [Mode: `'upper'` (default, MSSQL)](#mode-upper-default-mssql)
   - [Mode: `'ilike'` (PostgreSQL-style infix)](#mode-ilike-postgresql-style-infix)
   - [Mode: `'ilike-fn'` (StarRocks / MySQL-compatible function)](#mode-ilike-fn-starrocks--mysql-compatible-function)
   - [Mode: Custom function](#mode-custom-function)
5. [ORDER BY — `caseInsensitiveOrderBy`](#order-by--caseinsensitiveorderby)
6. [Pre-computed Sort Columns — `shadowColumns`](#pre-computed-sort-columns--shadowcolumns)
7. [Full Configuration Examples](#full-configuration-examples)
   - [MSSQL](#mssql)
   - [MySQL (standard)](#mysql-standard)
   - [StarRocks (MySQL-compatible)](#starrocks-mysql-compatible)
   - [PostgreSQL-compatible](#postgresql-compatible)
8. [Using with `BusinessBase` / `BusinessBaseRouter`](#using-with-businessbase--businessbaserouter)
9. [Troubleshooting](#troubleshooting)

---

## Overview

By default DFramework passes filter values and sort fields to the database exactly as they are received. When you want case-insensitive comparisons you must tell DFramework two things:

| Setting | Purpose |
|---|---|
| `forceCaseInsensitive: true` | **Master switch.** Must be `true` for any transformation to take place. |
| `caseInsensitiveMode` | Which transformation to apply. Defaults to `'upper'`. |
| `caseInsensitiveOrderBy` | Whether (and how) to wrap ORDER BY fields. Defaults to `false` (no wrapping). |
| `shadowColumns` | Map column names to pre-computed sort columns (alternative to wrapping). |

---

## Quick Start

### MSSQL — `UPPER()` wrapping (default)

```js
import { Sql } from '@durlabh/dframework';

const sql = new Sql();
await sql.setConfig({
    user: process.env.SQL_USER,
    password: process.env.SQL_PASSWORD,
    server: process.env.SQL_SERVER,
    database: process.env.SQL_DATABASE,
    options: { trustServerCertificate: true },

    // ── Case-insensitive search ──────────────────────────────────────────
    forceCaseInsensitive: true,   // Enable the feature
    // caseInsensitiveMode defaults to 'upper' — no need to set it explicitly
});
```

Generated WHERE clause for a "contains" filter on `Name`:

```sql
WHERE UPPER(Main.Name) LIKE :Name   -- value is '%SEARCHTERM%' (uppercased)
```

### StarRocks — `ILIKE()` function syntax

```js
const mysql = new MySql();
await mysql.setConfig({
    host: process.env.SR_HOST,
    user: process.env.SR_USER,
    password: process.env.SR_PASSWORD,
    database: process.env.SR_DATABASE,
    namedPlaceholders: true,

    // ── Case-insensitive search ──────────────────────────────────────────
    forceCaseInsensitive: true,
    caseInsensitiveMode: 'ilike-fn',   // Use ILIKE(field, value) = 1 syntax
});
```

Generated WHERE clause for the same "contains" filter:

```sql
WHERE ILIKE(Main.Name, :Name) = 1   -- value is '%searchterm%' (unchanged)
```

---

## Master Switch — `forceCaseInsensitive`

```
forceCaseInsensitive: false  (default)
forceCaseInsensitive: true
```

When `false` (the default), DFramework passes all filter values to the database as-is. The database engine decides whether comparisons are case-sensitive.

When `true`, DFramework transforms **every non-date string filter** according to `caseInsensitiveMode` before the SQL is executed.

> **Important:** Setting `caseInsensitiveMode` alone has no effect. You **must** also set `forceCaseInsensitive: true`.

Date/datetime fields are always excluded from transformation regardless of this flag.

---

## Comparison Modes — `caseInsensitiveMode`

### Mode: `'upper'` (default, MSSQL)

Wraps the column in `UPPER()` and uppercases the filter value. Works with MSSQL and any database that supports `UPPER()`.

```js
await sql.setConfig({
    // ...connection params...
    forceCaseInsensitive: true,
    caseInsensitiveMode: 'upper',   // default — can be omitted
});
```

| Filter type | Input | Generated SQL |
|---|---|---|
| equals | `John` | `UPPER(Name) = :Name` (value: `JOHN`) |
| contains | `john` | `UPPER(Name) LIKE :Name` (value: `%JOHN%`) |
| starts with | `jo` | `UPPER(Name) LIKE :Name` (value: `JO%`) |
| not equals | `John` | `UPPER(Name) != :Name` (value: `JOHN`) |

### Mode: `'ilike'` (PostgreSQL-style infix)

Replaces `=` / `LIKE` with the `ILIKE` infix operator. The value is **not** modified. Use for PostgreSQL or databases that support the `ILIKE` keyword.

```js
await sql.setConfig({
    // ...connection params...
    forceCaseInsensitive: true,
    caseInsensitiveMode: 'ilike',
});
```

| Filter type | Input | Generated SQL |
|---|---|---|
| equals | `John` | `Name ILIKE :Name` (value: `John`) |
| contains | `john` | `Name ILIKE :Name` (value: `%john%`) |
| not equals | `John` | `Name NOT ILIKE :Name` (value: `John`) |
| not contains | `john` | `Name NOT ILIKE :Name` (value: `%john%`) |

### Mode: `'ilike-fn'` (StarRocks / MySQL-compatible function)

Generates `ILIKE(field, value) = 1` / `= 0` function-call syntax. The value is **not** modified. Use for **StarRocks** and other MySQL-compatible databases that implement `ILIKE` as a function.

```js
await mysql.setConfig({
    // ...connection params...
    forceCaseInsensitive: true,
    caseInsensitiveMode: 'ilike-fn',
});
```

| Filter type | Input | Generated SQL |
|---|---|---|
| equals | `John` | `ILIKE(Name, :Name) = 1` (value: `John`) |
| contains | `john` | `ILIKE(Name, :Name) = 1` (value: `%john%`) |
| starts with | `jo` | `ILIKE(Name, :Name) = 1` (value: `jo%`) |
| not equals | `John` | `ILIKE(Name, :Name) = 0` (value: `John`) |
| not contains | `john` | `ILIKE(Name, :Name) = 0` (value: `%john%`) |
| numeric / date | n/a | unchanged (no ILIKE applied) |

> **Note:** StarRocks' `ILIKE(haystack, pattern)` supports `%` and `_` wildcard characters — the same patterns used by `LIKE`.

### Mode: Custom function

For full control over any database dialect, provide a function. The function receives an options object and must return either `{ fieldName, value, operator }` or `{ statementTemplate, value }`.

```js
// Option A: return transformed field / value / operator
await sql.setConfig({
    forceCaseInsensitive: true,
    caseInsensitiveMode: ({ fieldName, value, operator }) => ({
        fieldName: `LOWER(${fieldName})`,
        value: typeof value === 'string' ? value.toLowerCase() : value,
        operator,
    }),
});

// Option B: return a complete SQL fragment using {param} as placeholder
await sql.setConfig({
    forceCaseInsensitive: true,
    caseInsensitiveMode: ({ fieldName, value, operator }) => {
        const upperOp = operator.toUpperCase();
        if (['=', 'LIKE'].includes(upperOp)) {
            return { statementTemplate: `SOUNDEX(${fieldName}) = SOUNDEX({param})`, value };
        }
        return { fieldName, value, operator }; // fallback
    },
});
```

The custom function receives:

| Parameter | Type | Description |
|---|---|---|
| `fieldName` | `string` | Column name (may include table alias, e.g. `Main.Name`) |
| `value` | `*` | Filter value |
| `operator` | `string` | SQL operator (`=`, `LIKE`, `!=`, `NOT LIKE`, …) |
| `type` | `string` | Semantic type (e.g. `'date'`, `'dateTime'`) |
| `sqlType` | `*` | mssql / mysql2 type constant |

---

## ORDER BY — `caseInsensitiveOrderBy`

By default (`false`) sort fields are passed to the database exactly as provided — **no wrapping**. Set this when you want the sort order to be case-insensitive.

```
caseInsensitiveOrderBy: false     (default — no wrapping)
caseInsensitiveOrderBy: true      → UPPER(fieldName)
caseInsensitiveOrderBy: 'upper'   → UPPER(fieldName)  (same as true)
caseInsensitiveOrderBy: (field) => `LOWER(${field})`   (custom)
```

> `caseInsensitiveOrderBy` is **independent** of `forceCaseInsensitive` and `caseInsensitiveMode`. You can have case-insensitive ORDER BY without case-insensitive WHERE filtering, and vice versa.

**Example — UPPER() in ORDER BY:**

```js
await sql.setConfig({
    // ...connection params...
    forceCaseInsensitive: true,       // WHERE: apply UPPER() to filters
    caseInsensitiveMode: 'upper',
    caseInsensitiveOrderBy: true,     // ORDER BY: also wrap sort fields
});
// ORDER BY Name ASC  →  ORDER BY UPPER(Name) ASC
```

**Example — StarRocks: ILIKE for WHERE, no wrapping for ORDER BY:**

```js
await mysql.setConfig({
    // ...connection params...
    forceCaseInsensitive: true,
    caseInsensitiveMode: 'ilike-fn',
    caseInsensitiveOrderBy: false,    // default — ORDER BY unchanged
});
// WHERE ILIKE(Name, :Name) = 1 ... ORDER BY Name ASC
```

**Example — Custom ORDER BY expression:**

```js
await sql.setConfig({
    // ...connection params...
    caseInsensitiveOrderBy: (field) => `COLLATE(${field}, 'en-US-nocase')`,
});
// ORDER BY Name ASC  →  ORDER BY COLLATE(Name, 'en-US-nocase') ASC
```

---

## Pre-computed Sort Columns — `shadowColumns`

`shadowColumns` provides an alternative to function-based ORDER BY. Instead of wrapping the column at query time, you maintain a separate pre-computed column (e.g. a lower-cased, indexed copy) and DFramework substitutes the column name in the ORDER BY clause.

```js
await sql.setConfig({
    // ...connection params...
    shadowColumns: {
        FullName: 'FullName_Lower',   // ORDER BY FullName → ORDER BY FullName_Lower
        Email:    'Email_Lower',
    },
});
```

This approach avoids function calls in the ORDER BY clause, which allows the database to use an index on the shadow column for efficient sorting.

`shadowColumns` and `caseInsensitiveOrderBy` can be combined: shadow column substitution happens first, then any `caseInsensitiveOrderBy` wrapping is applied (only to fields that did **not** get substituted by a shadow).

---

## Full Configuration Examples

### MSSQL

```js
import { Sql } from '@durlabh/dframework';

const sql = new Sql();
await sql.setConfig({
    user: process.env.SQL_USER,
    password: process.env.SQL_PASSWORD,
    server: process.env.SQL_SERVER,
    database: process.env.SQL_DATABASE,
    options: { trustServerCertificate: true },

    // Case-insensitive WHERE (UPPER mode — works on all MSSQL versions)
    forceCaseInsensitive: true,
    caseInsensitiveMode: 'upper',       // can be omitted — it's the default

    // Optional: also wrap ORDER BY fields
    caseInsensitiveOrderBy: true,

    // Optional: use pre-computed sort columns instead
    shadowColumns: {
        Name:  'Name_Upper',
        Email: 'Email_Upper',
    },
});
```

### MySQL (standard)

```js
import { MySql } from '@durlabh/dframework';

const mysql = new MySql();
await mysql.setConfig({
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    namedPlaceholders: true,

    // MySQL is case-insensitive by default for utf8_general_ci / utf8mb4_general_ci.
    // Enable this only if your columns use a case-sensitive collation.
    forceCaseInsensitive: true,
    caseInsensitiveMode: 'upper',
});
```

### StarRocks (MySQL-compatible)

```js
import { MySql } from '@durlabh/dframework';

const starRocks = new MySql();
await starRocks.setConfig({
    host: process.env.SR_HOST,
    port: process.env.SR_PORT || 9030,
    user: process.env.SR_USER,
    password: process.env.SR_PASSWORD,
    database: process.env.SR_DATABASE,
    namedPlaceholders: true,

    // StarRocks supports ILIKE(field, pattern) as a function returning 0/1
    forceCaseInsensitive: true,
    caseInsensitiveMode: 'ilike-fn',

    // ORDER BY is left unchanged (default) — StarRocks comparisons are already
    // case-insensitive for most VARCHAR columns when ILIKE is used for filtering.
    // Set caseInsensitiveOrderBy: true if you need case-insensitive sorting too.
    caseInsensitiveOrderBy: false,
});
```

### PostgreSQL-compatible

```js
import { MySql } from '@durlabh/dframework';  // use MySql for pg-compatible adapters

const pg = new MySql();
await pg.setConfig({
    // ...connection params...

    // PostgreSQL supports ILIKE as an infix operator
    forceCaseInsensitive: true,
    caseInsensitiveMode: 'ilike',

    caseInsensitiveOrderBy: false,   // pg ILIKE already handles case in WHERE
});
```

---

## Using with `BusinessBase` / `BusinessBaseRouter`

When you use `BusinessBase` (or any business object that extends it), set the case-insensitive options on the SQL/MySQL instance that is registered as `BusinessBase.businessObject.sql`. This is the instance used internally by all list and filter operations.

```js
import BusinessBase from '@durlabh/dframework/business/business-base';
import { MySql } from '@durlabh/dframework';

// 1. Create and configure the SQL instance
const sql = new MySql();
await sql.setConfig({
    host: process.env.SR_HOST,
    user: process.env.SR_USER,
    password: process.env.SR_PASSWORD,
    database: process.env.SR_DATABASE,
    namedPlaceholders: true,

    forceCaseInsensitive: true,
    caseInsensitiveMode: 'ilike-fn',
    caseInsensitiveOrderBy: false,
});

// 2. Register it on BusinessBase so all business objects pick it up
BusinessBase.businessObject = { sql };

// 3. Your business objects now automatically use ILIKE(field, value) = 1
//    for all list() filter operations.
class ProductsBO extends BusinessBase {
    constructor() {
        super({ tableName: 'Products', primaryKey: 'ProductId' });
    }
}

const products = new ProductsBO();
// Generates: WHERE ILIKE(Main.Name, :Name) = 1 ORDER BY Name ASC
const result = await products.list({
    filter: JSON.stringify([{ field: 'Name', operator: 'contains', value: 'widget' }]),
    sort: 'Name ASC',
});
```

### Using with `Framework`

```js
import { Framework } from '@durlabh/dframework';
import BusinessBase from '@durlabh/dframework/business/business-base';

const framework = new Framework({ logger });

// setMySql is shorthand — all setConfig options are passed through
await framework.setMySql({
    host: process.env.SR_HOST,
    user: process.env.SR_USER,
    password: process.env.SR_PASSWORD,
    database: process.env.SR_DATABASE,
    namedPlaceholders: true,

    forceCaseInsensitive: true,
    caseInsensitiveMode: 'ilike-fn',
});

// Register the configured instance
BusinessBase.businessObject = { sql: framework.mysql };
```

---

## Troubleshooting

### Filters still use `UPPER(Name) LIKE` instead of `ILIKE(Name, ...) = 1`

**Cause:** `caseInsensitiveMode: 'ilike-fn'` is set but `forceCaseInsensitive: true` is missing.

`caseInsensitiveMode` is only applied when `forceCaseInsensitive` is `true`. Without it, the transformation is never triggered.

**Fix:** Pass both in the same `setConfig` call:

```js
await sql.setConfig({
    // ...connection params...
    forceCaseInsensitive: true,       // ← required
    caseInsensitiveMode: 'ilike-fn',  // ← selects the mode
});
```

### Filters return no records

**Possible causes:**

1. **Missing `forceCaseInsensitive: true`** — the mode is not activated (see above).
2. **Wrong SQL instance** — the `setConfig` was called on a different `Sql`/`MySql` instance than the one used by `BusinessBase.businessObject.sql`.
3. **StarRocks ILIKE with no wildcards** — if you use an "equals" filter (`operator: '='`), the value is not wrapped in `%…%`. `ILIKE(Name, :Name) = 1` with value `'Widget'` matches only the exact string (case-insensitively). If you want substring matching, use `operator: 'contains'`.

To verify which instance is being used:

```js
console.log('forceCaseInsensitive:', BusinessBase.businessObject.sql.forceCaseInsensitive);
console.log('caseInsensitiveMode:',  BusinessBase.businessObject.sql.caseInsensitiveMode);
```

### ORDER BY still wraps with `UPPER()` when I don't want it to

**Cause:** `caseInsensitiveOrderBy` was set to `true` or `'upper'`.

**Fix:** Set it to `false` (the default):

```js
await sql.setConfig({
    // ...
    caseInsensitiveOrderBy: false,   // default — no wrapping in ORDER BY
});
```

### ILIKE is not recognised by my database

Not all databases implement `ILIKE`. Use the table below to choose the right mode:

| Database | Recommended `caseInsensitiveMode` |
|---|---|
| MSSQL | `'upper'` (default) |
| MySQL (utf8_general_ci) | typically not needed — collation handles it |
| MySQL (utf8_bin) | `'upper'` |
| StarRocks | `'ilike-fn'` |
| PostgreSQL | `'ilike'` |
| Other | custom function |
