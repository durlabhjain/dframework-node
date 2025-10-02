# New Exports Available

The following packages from the lib directory are now exported and can be used by other applications:

## Main Import (from root)

All exports are available from the main package import:

```javascript
import { 
    Sql, 
    MySql, 
    SqlHelper, 
    ListParameters, 
    reports, 
    toExcel, 
    generateReport, 
    enums 
} from '@durlabh/dframework';
```

## Subpath Imports

You can also import specific modules directly using subpath imports:

### Sql Class
```javascript
import Sql from '@durlabh/dframework/sql';
```
The `Sql` class wraps common MSSQL database functionality, including query execution, connection pooling, and slow query logging.

### MySql Class
```javascript
import MySql from '@durlabh/dframework/mysql-class';
```
The `MySql` class wraps common MySQL database functionality, similar to the Sql class but for MySQL databases.

### SqlHelper
```javascript
import SqlHelper from '@durlabh/dframework/business/sql-helper';
```
The `SqlHelper` class provides SQL utility functions for field validation, sanitization, and pivot queries.

### ListParameters
```javascript
import ListParameters from '@durlabh/dframework/list-parameters';
```
The `ListParameters` class helps construct list request parameters with filtering, sorting, and pagination support.

**Example:**
```javascript
const params = new ListParameters({
    start: 0,
    limit: 50,
    sort: 'createdDate',
    dir: 'desc',
    filters: [{
        field: 'status',
        type: 'string',
        value: 'active',
        comparison: '='
    }]
});

const formData = params.toFormData();
```

### Reports
```javascript
import { reports, toExcel } from '@durlabh/dframework/reports';
```
The `reports` module provides report generation functionality for Excel, CSV, JSON, and text formats.

**Example:**
```javascript
await reports.execute({
    ReportType: MyReport,
    options: { /* report options */ }
});
```

### generateReport
```javascript
import generateReport from '@durlabh/dframework/business/query-base';
```
The `generateReport` function is a middleware for generating reports in Express applications.

### Enums
```javascript
import enums from '@durlabh/dframework/enums';
```
The `enums` module contains shared enums and constants used throughout the framework.

**Available enums:**
- `dateTimeFields` - Array of date/time field types
- `authMethods` - Authentication method constants
- `ENTRA_APP_STAGES` - Entra ID application stages
- `dateTimeExportFormat` - Date/time export formatting

**Example:**
```javascript
import enums from '@durlabh/dframework/enums';

console.log(enums.authMethods.basicAuth); // 'basicAuth'
console.log(enums.ENTRA_APP_STAGES.SIGN_IN); // 'sign_in'
```

## Testing

To verify all exports are working correctly, run the verification script:

```bash
node tests/verify-exports.mjs
```

This script tests all the newly added exports to ensure they work correctly both as main exports and as subpath imports.
