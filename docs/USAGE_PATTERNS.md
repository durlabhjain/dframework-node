# DFramework Usage Patterns

This document provides comprehensive usage patterns and best practices for common scenarios when using the @durlabh/dframework library.

## Table of Contents

1. [Database Operations](#database-operations)
2. [Business Objects](#business-objects)
3. [Authentication](#authentication)
4. [Report Generation](#report-generation)
5. [ElasticSearch Integration](#elasticsearch-integration)
6. [Logging](#logging)
7. [Azure Integration](#azure-integration)
8. [Common Patterns](#common-patterns)

## Database Operations

### Pattern 1: Simple CRUD Operations

```javascript
import { Framework, mssql } from '@durlabh/dframework';

const framework = new Framework({ logger });

// Initialize SQL connection
await framework.setSql({
    user: process.env.SQL_USER,
    password: process.env.SQL_PASSWORD,
    server: process.env.SQL_SERVER,
    database: process.env.SQL_DATABASE,
    options: {
        trustServerCertificate: true
    }
});

// Create
const request = framework.sql.createRequest();
request.input('Name', mssql.VarChar, 'John Doe');
request.input('Email', mssql.VarChar, 'john@example.com');
const result = await framework.sql.execute({
    query: 'Users_Insert',
    parameters: { Name: 'John Doe', Email: 'john@example.com' }
});

// Read
const users = await framework.sql.query(`
    SELECT * FROM Users WHERE IsActive = @IsActive
`, { IsActive: true });

// Update
await framework.sql.execute({
    query: 'Users_Update',
    parameters: { 
        UserId: 1, 
        Name: 'Jane Doe' 
    }
});

// Delete
await framework.sql.execute({
    query: 'Users_Delete',
    parameters: { UserId: 1 }
});
```

### Pattern 2: Transaction Management

```javascript
// Start a transaction
const transaction = framework.sql.pool.transaction();
await transaction.begin();

try {
    const request = new mssql.Request(transaction);
    
    // Multiple operations in transaction
    await request.query('INSERT INTO Orders ...');
    await request.query('UPDATE Inventory ...');
    await request.query('INSERT INTO OrderItems ...');
    
    // Commit if all succeed
    await transaction.commit();
} catch (err) {
    // Rollback on error
    await transaction.rollback();
    throw err;
}
```

### Pattern 3: Bulk Operations

```javascript
import { mssql } from '@durlabh/dframework';

// Create table type for bulk insert
const table = new mssql.Table('BulkUsers');
table.create = true;
table.columns.add('Name', mssql.VarChar(100));
table.columns.add('Email', mssql.VarChar(255));

// Add rows
users.forEach(user => {
    table.rows.add(user.name, user.email);
});

// Execute bulk insert
const request = framework.sql.createRequest();
request.bulk(table);
```

### Pattern 4: Dynamic Query Building

```javascript
import { Sql, mssql } from '@durlabh/dframework';

const sql = new Sql();
await sql.setConfig({ /* config */ });

// Build query dynamically
let query = 'SELECT * FROM Users WHERE 1=1';
const request = sql.createRequest();

if (filters.name) {
    query += ' AND Name LIKE @Name';
    request.input('Name', mssql.VarChar, `%${filters.name}%`);
}

if (filters.isActive !== undefined) {
    query += ' AND IsActive = @IsActive';
    request.input('IsActive', mssql.Bit, filters.isActive);
}

const result = await request.query(query);
```

## Business Objects

### Pattern 5: Basic Business Object

```javascript
import { BusinessBase } from '@durlabh/dframework';

class UserBusiness extends BusinessBase {
    tableName = 'Users';
    keyField = 'UserId';
    clientBased = true;      // Filter by ClientId
    softDelete = true;        // Use IsDeleted column
    standardTable = true;     // Uses standard conventions
    
    // Define read-only columns
    readOnlyColumns = ['CreatedDate', 'CreatedBy'];
    
    // Define relationships
    relations = [
        {
            relation: 'Role',
            type: 'OneToMany',
            foreignTable: 'UserRoles',
            field: 'RoleId'
        }
    ];
}

// Usage
const userBusiness = new UserBusiness();
userBusiness.user = { scopeId: 123 }; // Set client context

// Load user
const user = await userBusiness.load({ id: 1 });

// Save user
const result = await userBusiness.save({
    id: 1,
    firstName: 'John',
    lastName: 'Doe',
    email: 'john@example.com'
});

// Delete (soft delete if enabled)
await userBusiness.delete({ id: 1 });

// List with filters
const users = await userBusiness.list({
    start: 0,
    limit: 50,
    filters: [
        { field: 'firstName', value: 'John', comparison: 'contains' },
        { field: 'isActive', value: true, comparison: '=' }
    ],
    sort: 'lastName',
    dir: 'asc'
});
```

### Pattern 6: Advanced Filtering

```javascript
import { ListParameters } from '@durlabh/dframework';

// Create complex filter
const params = new ListParameters({
    start: 0,
    limit: 50,
    sort: 'createdDate',
    dir: 'desc',
    filters: [
        // String filters
        { field: 'name', value: 'John', comparison: 'contains' },
        { field: 'email', value: '@company.com', comparison: 'endsWith' },
        { field: 'status', value: 'active', comparison: '=' },
        
        // Date filters
        { field: 'createdDate', value: '2024-01-01', comparison: 'onOrAfter' },
        { field: 'lastLogin', value: '2024-03-01', comparison: 'before' },
        
        // Numeric filters
        { field: 'age', value: 18, comparison: '>=' },
        { field: 'score', value: 100, comparison: '<' },
        
        // Multi-value filters
        { field: 'department', value: ['Sales', 'Marketing'], comparison: 'isAnyOf' },
        
        // Boolean filters
        { field: 'isActive', value: true, comparison: 'isTrue' },
        
        // Null checks
        { field: 'deletedDate', value: null, comparison: 'isEmpty' },
        { field: 'email', value: null, comparison: 'isNotEmpty' }
    ]
});

const users = await userBusiness.list(params);
```

### Pattern 7: Multi-Select Columns

```javascript
class ManufacturerBusiness extends BusinessBase {
    tableName = 'Manufacturer';
    keyField = 'ManufacturerId';
    
    // Define multi-select columns
    multiSelectColumns = {
        // Uses defaults: table="ManufacturerAlias", column="Alias", type="string"
        "Alias": {},
        
        // Custom configuration
        "Tags": {
            table: 'ManufacturerTags',
            column: 'TagName',
            type: 'string'
        },
        
        // Numeric multi-select
        "Categories": {
            table: 'ManufacturerCategories',
            column: 'CategoryId',
            type: 'number'
        }
    };
}

// Load returns comma-separated values
const manufacturer = await manufacturerBusiness.load({ id: 1 });
console.log(manufacturer.Alias); // "Alias1, Alias2, Alias3"

// Save accepts comma-separated values
await manufacturerBusiness.save({
    id: 1,
    Name: 'ACME Corp',
    Alias: 'ACME, ACMECorp, ACME Inc'
});
```

### Pattern 8: Custom Business Logic

```javascript
class OrderBusiness extends BusinessBase {
    tableName = 'Orders';
    keyField = 'OrderId';
    
    // Override save to add custom logic
    async save(data) {
        // Validate before save
        if (data.total < 0) {
            throw new Error('Order total cannot be negative');
        }
        
        // Calculate fields
        data.tax = data.subtotal * 0.1;
        data.total = data.subtotal + data.tax;
        
        // Call parent save
        const result = await super.save(data);
        
        // Post-save logic
        if (result.success) {
            await this.sendOrderConfirmation(result.id);
        }
        
        return result;
    }
    
    async sendOrderConfirmation(orderId) {
        // Send email notification
    }
    
    // Custom method
    async getOrdersByStatus(status) {
        const request = this.createRequest();
        const query = `
            SELECT * FROM Orders 
            WHERE Status = @Status 
            AND IsDeleted = 0
            ORDER BY OrderDate DESC
        `;
        request.input('Status', mssql.VarChar, status);
        return await request.query(query);
    }
}
```

## Authentication

### Pattern 9: Basic Authentication

```javascript
import { Auth } from '@durlabh/dframework';
import { basicAuthMethods } from '@durlabh/dframework/enums';

// Initialize framework with SQL
const framework = new Framework({ logger });
await framework.setSql({ /* config */ });

// Create auth instance
const auth = new Auth({ sql: framework.sql });

// Authenticate user
const result = await auth.authenticate({
    username: 'john.doe',
    password: 'password123',
    authMethod: basicAuthMethods.basicAuth
});

if (result.success) {
    console.log('User authenticated:', result.userDetails);
    console.log('Permissions:', result.permissions);
} else {
    console.log('Authentication failed');
}
```

### Pattern 10: Entra ID (Azure AD) Authentication

```javascript
import { Auth, enums } from '@durlabh/dframework';

const auth = new Auth({ 
    sql: framework.sql,
    entraConfig: {
        clientId: process.env.ENTRA_CLIENT_ID,
        tenantId: process.env.ENTRA_TENANT_ID,
        clientSecret: process.env.ENTRA_CLIENT_SECRET,
        redirectUri: 'http://localhost:3000/auth/callback'
    }
});

// Get authorization URL
const authUrl = await auth.getAuthUrl({
    authMethod: enums.authMethods.entraIdAuth
});

// Redirect user to authUrl...

// Handle callback
const result = await auth.authenticate({
    authMethod: enums.authMethods.entraIdAuth,
    code: req.query.code, // Authorization code from callback
    state: req.query.state
});
```

### Pattern 11: LDAP Authentication

```javascript
import { Auth, enums } from '@durlabh/dframework';

const auth = new Auth({
    sql: framework.sql,
    ldapConfig: {
        url: 'ldap://ldap.company.com',
        baseDN: 'dc=company,dc=com',
        bindDN: 'cn=admin,dc=company,dc=com',
        bindPassword: 'admin_password'
    }
});

const result = await auth.authenticate({
    username: 'john.doe',
    password: 'password123',
    authMethod: enums.authMethods.ldapAuth
});
```

### Pattern 12: Custom Authentication in Express

```javascript
import express from 'express';
import { Auth } from '@durlabh/dframework';

const app = express();
const auth = new Auth({ sql: framework.sql });

// Login endpoint
app.post('/api/login', async (req, res) => {
    const { username, password, authMethod } = req.body;
    
    const result = await auth.authenticate({
        username,
        password,
        authMethod
    });
    
    if (result.success) {
        // Create session or JWT token
        req.session.user = result.userDetails;
        req.session.permissions = result.permissions;
        
        res.json({ 
            success: true, 
            user: result.userDetails 
        });
    } else {
        res.status(401).json({ 
            success: false, 
            message: 'Invalid credentials' 
        });
    }
});

// Auth middleware
function requireAuth(req, res, next) {
    if (!req.session.user) {
        return res.status(401).json({ 
            error: 'Authentication required' 
        });
    }
    next();
}

// Protected route
app.get('/api/profile', requireAuth, (req, res) => {
    res.json(req.session.user);
});
```

## Report Generation

### Pattern 13: Excel Report

```javascript
import { reports } from '@durlabh/dframework/reports';

class SalesReport {
    async generate() {
        // Get data from database
        const sales = await framework.sql.query('SELECT * FROM Sales');
        
        return {
            title: 'Sales Report',
            rows: sales.recordset,
            columns: {
                OrderId: { header: 'Order #', width: 15 },
                CustomerName: { header: 'Customer', width: 30 },
                OrderDate: { header: 'Date', width: 20, type: 'date' },
                Total: { header: 'Total', width: 15, type: 'currency' }
            }
        };
    }
}

// Generate report
await reports.execute({
    ReportType: SalesReport,
    options: {
        reportType: 'xlsx',
        toFile: true
    }
});
```

### Pattern 14: Multi-Sheet Excel Report

```javascript
import { toExcel } from '@durlabh/dframework/reports';

const workbookData = {
    sheets: [
        {
            title: 'Summary',
            rows: summaryData,
            columns: summaryColumns
        },
        {
            title: 'Details',
            rows: detailData,
            columns: detailColumns
        },
        {
            title: 'Charts',
            rows: chartData,
            columns: chartColumns
        }
    ],
    fileName: 'Annual_Report_2024.xlsx'
};

await toExcel(workbookData);
```

### Pattern 15: CSV Report

```javascript
import { reports } from '@durlabh/dframework/reports';

class UserExport {
    async generate() {
        const users = await framework.sql.query('SELECT * FROM Users');
        
        return {
            title: 'Users',
            rows: users.recordset,
            settings: {
                useHeader: true,
                delimiter: ',',
                columns: {
                    UserId: {},
                    Username: {},
                    Email: {},
                    CreatedDate: {}
                }
            }
        };
    }
}

await reports.execute({
    ReportType: UserExport,
    options: {
        reportType: 'csv',
        toFile: true
    }
});
```

### Pattern 16: Streaming Reports

```javascript
import { toExcel } from '@durlabh/dframework/reports';
import express from 'express';

const app = express();

app.get('/api/reports/sales', async (req, res) => {
    // Set headers for download
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=sales_report.xlsx');
    
    // Get data
    const sales = await framework.sql.query('SELECT * FROM Sales');
    
    // Stream to response
    await toExcel({
        title: 'Sales',
        rows: sales.recordset,
        columns: salesColumns,
        stream: res
    });
});
```

## ElasticSearch Integration

### Pattern 17: Basic ElasticSearch Query

```javascript
import { Framework } from '@durlabh/dframework';

const framework = new Framework({ logger });

// Initialize ElasticSearch
await framework.setElastic({
    environment: 'Production'  // Reads from environments/Production.esenv
});

// Simple query
const results = await framework.elastic.sqlQuery({
    indexName: 'products',
    select: ['name', 'category', 'price'],
    where: [
        { field: 'status', value: 'active', operator: '=' },
        { field: 'price', value: 100, operator: '>' }
    ],
    limit: 100
});
```

### Pattern 18: ElasticSearch Aggregations

```javascript
const results = await framework.elastic.aggregate({
    query: {
        index: 'sales',
        body: {
            aggs: {
                by_region: {
                    terms: { field: 'region.keyword', size: 50 },
                    aggs: {
                        total_sales: { sum: { field: 'amount' } },
                        avg_order: { avg: { field: 'amount' } }
                    }
                }
            }
        }
    },
    mappings: {
        "Regions": {
            root: "by_region.buckets",
            map: {
                "Region": "key",
                "TotalSales": "total_sales.value",
                "AverageOrder": "avg_order.value"
            }
        }
    }
});
```

### Pattern 19: ElasticSearch with Business Objects

```javascript
import { ElasticBusinessBase } from '@durlabh/dframework';

class ProductSearch extends ElasticBusinessBase {
    indexName = 'products';
    
    async searchProducts(query) {
        return await this.elastic.sqlQuery({
            indexName: this.indexName,
            select: ['*'],
            where: [
                { field: 'name', value: query, operator: 'LIKE' }
            ],
            limit: 50
        });
    }
}
```

## Logging

### Pattern 20: Request Context Logging

```javascript
import express from 'express';
import pinoHttp from 'pino-http';
import { logger } from '@durlabh/dframework';

const app = express();

// Add request logging
app.use(pinoHttp({
    logger: logger,
    genReqId: (req) => req.headers['x-request-id'] || crypto.randomUUID()
}));

// Use in routes
app.post('/api/users', async (req, res) => {
    req.log.info('Creating user');
    
    const userBusiness = new UserBusiness();
    userBusiness.logger = req.log; // Pass request logger
    
    const result = await userBusiness.save(req.body);
    
    req.log.info({ userId: result.id }, 'User created');
    res.json(result);
});
```

### Pattern 21: Custom Log Levels

```javascript
import { logger } from '@durlabh/dframework';

// Use built-in levels
logger.trace('Very detailed info');
logger.debug('Debug information');
logger.info('Informational message');
logger.warn('Warning message');
logger.error({ err: error }, 'Error occurred');

// Custom levels (defined in config)
logger.custom('Custom log level message');
```

### Pattern 22: Structured Logging

```javascript
import { logger } from '@durlabh/dframework';

// Log with context
logger.info({
    userId: 123,
    action: 'login',
    ip: req.ip
}, 'User logged in');

// Log errors with context
try {
    await doSomething();
} catch (err) {
    logger.error({
        err,
        userId: user.id,
        operation: 'updateProfile'
    }, 'Failed to update profile');
}
```

## Azure Integration

### Pattern 23: Azure Blob Storage

```javascript
import { Azure } from '@durlabh/dframework';

const azure = new Azure({
    connectionString: process.env.AZURE_STORAGE_CONNECTION_STRING
});

// Upload file
await azure.uploadBlob({
    containerName: 'documents',
    blobName: 'report.pdf',
    filePath: './reports/report.pdf'
});

// Download file
await azure.downloadBlob({
    containerName: 'documents',
    blobName: 'report.pdf',
    downloadPath: './downloads/report.pdf'
});

// List blobs
const blobs = await azure.listBlobs({
    containerName: 'documents',
    prefix: 'reports/'
});
```

## Common Patterns

### Pattern 24: Error Handling

```javascript
import { logger } from '@durlabh/dframework';
import { sqlErrorMapper } from '@durlabh/dframework';

async function saveUser(userData) {
    try {
        const userBusiness = new UserBusiness();
        const result = await userBusiness.save(userData);
        
        if (!result.success) {
            // Handle business logic errors
            const mappedError = sqlErrorMapper(result.err);
            logger.error({ err: result.err }, 'Save failed');
            return { 
                success: false, 
                error: mappedError || 'Failed to save user' 
            };
        }
        
        return { success: true, data: result };
    } catch (err) {
        // Handle unexpected errors
        logger.error({ err }, 'Unexpected error');
        return { 
            success: false, 
            error: 'An unexpected error occurred' 
        };
    }
}
```

### Pattern 25: Pagination Helper

```javascript
import { ListParameters } from '@durlabh/dframework';

async function getPaginatedData(req) {
    const { page = 1, pageSize = 50, sort, dir } = req.query;
    
    const params = new ListParameters({
        start: (page - 1) * pageSize,
        limit: pageSize,
        sort: sort || 'createdDate',
        dir: dir || 'desc',
        filters: parseFilters(req.query.filters)
    });
    
    const userBusiness = new UserBusiness();
    const result = await userBusiness.list(params);
    
    return {
        data: result.data,
        pagination: {
            page: page,
            pageSize: pageSize,
            total: result.total,
            totalPages: Math.ceil(result.total / pageSize)
        }
    };
}
```

### Pattern 26: Configuration Management

```javascript
import config from '@durlabh/dframework/appConfig';

// Access configuration
const dbConfig = config.database;
const logLevel = config.logging?.logLevel || 'info';

// Use environment-specific config
const apiUrl = process.env.NODE_ENV === 'production' 
    ? config.production.apiUrl 
    : config.development.apiUrl;
```

### Pattern 27: Utility Functions

```javascript
import { util } from '@durlabh/dframework';

// Date formatting
const formattedDate = util.formatDate(new Date(), 'MM/DD/YYYY');

// Download file
await util.download({
    url: 'https://example.com/file.pdf',
    dest: './downloads/file.pdf'
});

// String templating
const message = util.template(
    'Hello ${firstName} ${lastName}',
    { firstName: 'John', lastName: 'Doe' }
);

// Days of week formatting
const days = util.formatDaysOfWeek('1010100');
console.log(days); // "Sun, Tue, Thu"
```

## Best Practices

1. **Always use parameterized queries** to prevent SQL injection
2. **Use the logger** instead of console.log for better observability
3. **Pass request logger** to business objects for request tracing
4. **Check result.success** for database operations
5. **Use try-catch blocks** for error handling
6. **Configure connection pooling** appropriately for your workload
7. **Use soft delete** (`IsDeleted` column) instead of hard deletes
8. **Validate input** before saving to database
9. **Use transactions** for multi-step operations
10. **Monitor slow queries** and optimize as needed
11. **Use environment variables** for sensitive configuration
12. **Follow the single responsibility principle** in business objects
13. **Document custom methods** with JSDoc comments
14. **Test thoroughly** including edge cases and error scenarios
15. **Keep business logic in business objects**, not in routes

## Performance Tips

1. **Use pagination** for large datasets
2. **Create appropriate indexes** on frequently queried columns
3. **Use connection pooling** with appropriate settings
4. **Cache frequently accessed data** when appropriate
5. **Use SELECT statements** that only retrieve needed columns
6. **Batch operations** when inserting/updating multiple records
7. **Monitor and optimize slow queries** using the slow query logger
8. **Use streaming** for large file operations
9. **Implement proper error handling** to avoid resource leaks
10. **Close connections** when done (connection pool handles this automatically)
