# Purpose

This library is to facilate using Spraxa's DFramework related applications via NodeJS

## Documentation

- [API Reference](docs/API_REFERENCE.md) - Complete reference for business objects, filtering, and multi-select columns
- [Usage Patterns](docs/USAGE_PATTERNS.md) - Comprehensive guide with common usage patterns and examples
- [Database Configuration](docs/DATABASE_CONFIGURATION.md) - Connection pooling, best practices, and configuration examples
- [Batch Operations](docs/BATCH_OPERATIONS.md) - Efficient batch INSERT, UPDATE, DELETE operations with examples
- [ElasticSearch Queries](docs/ELASTICSEARCH_QUERIES.md) - SQL and Search API queries with pagination and memory optimization
- [New Exports](docs/NEW_EXPORTS.md) - Documentation on newly available exports
- [SQL Logging](docs/SQL_LOGGING.md) - Request-specific logging for SQL operations
- [Logger Migration](docs/LOGGER_MIGRATION.md) - Migration guide for the modernized logging system
- [Examples](docs/examples/) - Working examples demonstrating framework features
- [TODO](TODO.md) - Comprehensive list of improvements and future enhancements

# Available Exports

The library exports several utility classes and modules that can be used in your applications:

## Core Exports
- `Framework` - Main framework class for Portal APIs
- `Sql` - MSSQL database wrapper with common functionality
- `MySql` - MySQL database wrapper with common functionality
- `SqlHelper` - SQL utility functions for field validation and queries
- `ListParameters` - Helper for constructing list request parameters
- `reports` / `toExcel` - Report generation utilities (Excel, CSV, JSON, text)
- `generateReport` - Express middleware for report generation
- `enums` - Shared enums and constants

## Business Layer
- `BusinessBase` - Base class for business objects
- `ElasticBusinessBase` - ElasticSearch-enabled business base
- `BusinessBaseRouter` - Router for business objects
- `Auth` - Authentication utilities
- `lookup` - Lookup utilities
- `sqlErrorMapper` - SQL error mapping

## Infrastructure
- `Azure` - Azure services integration
- `Elastic` - ElasticSearch client
- `logger` - Pino logger
- `util` - Utility functions
- `httpAuth` - HTTP authentication (Basic, Bearer)
- `adapters` - HTTP client adapters
- `appConfig` - Application configuration
- `responseTransformer` - Express response transformer middleware
- `mssql` - Direct access to mssql library types
- `mysql` - Direct access to mysql2 library types

See [NEW_EXPORTS.md](docs/NEW_EXPORTS.md) for detailed documentation on the newly available exports.

# Usage

## Getting started
```
import Framework from 'dframework-node';

const framework = new Framework({
    logger
});
```

## Using Portal APIs

### Login for future use
```
const loggedIn = await framework.login({
    username: process.env.APP_USER,
    password: process.env.APP_PASSWORD,
});

if (!loggedIn) {
    logger.error('Login failed');
}
```

### Define application controllers

// create 2 controllers User and Item
framework.createControllers('User', 'Item');

### Getting list from a controller
```
const result = await framework.controllers.User.list({
    controller: 'User',
    listParameters: new portal.ListParameters({
        comboTypes: ['Role']
    })
});
```
### Loading a record
```
const result = await framework.controllers.User.get({
    id: 1
});
```
or
```
const result = await framework.controllers.User.get(1);
```
### Saving a record
```
const result = await framework.controllers.User.save({
    id: 1
    firstName: 'John',
    lastName: 'Doe'
});
```

## Using Raw SQL

### Initialize
```
const sqlConfig = {
    user: env.SQL_USER || env.USER,
    password: env.SQL_PASSWORD || env.PASSWORD,
    server: env.SQL_SERVER || env.SERVER,
    database: env.SQL_DATABASE || env.DATABASE,
    options: {
        trustServerCertificate: true,
    }
};

await DFramework.setSql(sqlConfig);
```

### Querying

#### Running query stored in a file

```
const fileName = 'queries/activeClients.sql';
const activeUsers = await framework.sql.query(fileName);
```

where fileName is the name of a file containing actual SQL query.

#### Running raw query

```
import { mssql } from 'dframework-node';
const request = framework.sql.createRequest();
request.input('IsActive', mssql.VarChar, 'Y');
const { recordset: activeUsers } = await framework.sql.query(`
    SELECT * FROM dbo.Users WHERE IsActive = @IsActive
`);
```

#### IN Operator Optimization

The framework provides three configurable strategies for IN operations to optimize query performance:

```javascript
import { enums } from 'dframework-node';

const { inOperatorStrategies } = enums;

// Configure the default IN operator strategy during initialization
await framework.setSql({
    /* database config */
    inOperatorStrategy: inOperatorStrategies.INNER_JOIN // Options: INNER_JOIN (default), EXISTS, IN
});

// The strategy affects how IN operations are executed:
// 1. INNER_JOIN: Uses INNER JOIN (fastest in most cases)
// 2. EXISTS: Uses EXISTS subquery (good for NOT IN scenarios)
// 3. IN: Traditional IN operator (backward compatible)

// Override strategy for specific queries
const users = await framework.sql.execute({
    query: 'SELECT * FROM Users',
    where: {
        UserId: {
            value: [1, 2, 3, 4, 5],
            operator: 'in',
            inOperatorStrategy: inOperatorStrategies.EXISTS // Override default
        }
    }
});
```

For detailed examples and performance comparisons, see [Pattern 4a in USAGE_PATTERNS.md](docs/USAGE_PATTERNS.md).


### Join

The framework supports SQL joins through the business object's selectStatement property:

```javascript
class UserBusiness extends BusinessBase {
    tableName = 'Users';
    keyField = 'UserId';
    
    // Define a custom select statement with joins
    selectStatement = `
        SELECT 
            u.*, 
            r.RoleName,
            d.DepartmentName
        FROM Users u
        LEFT JOIN Roles r ON u.RoleId = r.RoleId
        LEFT JOIN Departments d ON u.DepartmentId = d.DepartmentId
    `;
}
```

For dynamic joins based on parameters, override the `getSelectStatement` method:

```javascript
class UserBusiness extends BusinessBase {
    tableName = 'Users';
    keyField = 'UserId';
    
    getSelectStatement(alias = 'Main') {
        let query = super.getSelectStatement(alias);
        
        // Add joins based on requirements
        if (this.includeRoles) {
            query += ` LEFT JOIN Roles r ON ${alias}.RoleId = r.RoleId`;
        }
        
        if (this.includeDepartments) {
            query += ` LEFT JOIN Departments d ON ${alias}.DepartmentId = d.DepartmentId`;
        }
        
        return query;
    }
}

// Usage
const userBusiness = new UserBusiness();
userBusiness.includeRoles = true;
userBusiness.includeDepartments = true;
const users = await userBusiness.list({ start: 0, limit: 50 });
```

**Important Notes:**
- Ensure column names don't conflict when using joins
- Use table aliases to avoid ambiguity
- The framework automatically handles WHERE clauses and filters



## Using ElasticSearch

### Initialize

1. Create a file demo.esenv in environments folder with host information:
{
    "host": "http://0.0.0.0:9000",
    "name": "Demo"
}

2. Initialize code
```
const elasticConfig = {
    environment: env.ELASTIC_ENVIRONMENT || 'Demo'
};

await framework.setElastic(elasticConfig);
```

### Querying

The `elastic.aggregate()` method performs aggregation queries on ElasticSearch indices.

```javascript
const elasticResults = await framework.elastic.aggregate({
    query: 'myQuery',                        // Query name or query object
    customize: this.customizeElasticQuery,   // Optional function to customize elastic query
    mappings: {                              // Define how to map aggregation results
        "Items": {
            root: "items",                   // Root path in the aggregation result
            map: {
                "Transactions": "doc_count"  // Map result fields to output fields
            }
        }
    }
});
```

**Parameters:**

- **query** (String|Object): Either a query name that will be loaded from a file, or a complete ElasticSearch query object
- **customize** (Function, optional): A callback function to modify the query before execution. Receives the query object and should return the modified query
- **mappings** (Object, optional): Defines how to transform the aggregation results into a structured format
  - **root** (String): The path to navigate in the aggregation buckets (e.g., "items.buckets")
  - **map** (Object): Key-value pairs mapping result field names to output field names

**Example with Custom Query:**

```javascript
// Custom aggregation query
const results = await framework.elastic.aggregate({
    query: {
        index: 'sales',
        body: {
            aggs: {
                by_category: {
                    terms: { field: 'category.keyword' },
                    aggs: {
                        total_sales: { sum: { field: 'amount' } }
                    }
                }
            }
        }
    },
    mappings: {
        "Categories": {
            root: "by_category.buckets",
            map: {
                "CategoryName": "key",
                "TotalSales": "total_sales.value"
            }
        }
    }
});
```

**Example with Customize Function:**

```javascript
class SalesReport {
    customizeElasticQuery(query) {
        // Add date range filter
        query.body.query = {
            range: {
                date: {
                    gte: this.startDate,
                    lte: this.endDate
                }
            }
        };
        return query;
    }
    
    async generateReport() {
        const results = await framework.elastic.aggregate({
            query: 'salesByRegion',
            customize: this.customizeElasticQuery.bind(this),
            mappings: {
                "Regions": {
                    root: "regions.buckets",
                    map: {
                        "Region": "key",
                        "Sales": "total.value"
                    }
                }
            }
        });
        return results;
    }
}
```

**Using SQL Queries with ElasticSearch:**

The framework also supports SQL-style queries via `elastic.sqlQuery()`:

```javascript
const results = await framework.elastic.sqlQuery({
    indexName: 'products',
    select: ['name', 'category'],
    aggregates: ['Avg(price) AS avg_price', 'Count(*) AS total'],
    groupBy: ['category'],
    where: [
        { field: 'status', value: 'active', operator: '=' },
        { field: 'stock', value: 0, operator: '>' }
    ],
    limit: 100,
    offset: 0,
    sort: [['avg_price', 'DESC']]
});
```

**SQL Query Parameters:**

- **indexName** (String): ElasticSearch index name
- **select** (Array): Fields to select
- **aggregates** (Array): Aggregation expressions (e.g., "Avg(price) AS avg_price")
- **groupBy** (Array): Fields to group by
- **where** (Array): Filter conditions (each object has field, value, operator)
- **limit** (Number, optional): Maximum number of results
- **offset** (Number, optional): Number of results to skip (for pagination)
- **sort** (Array, optional): Sort criteria as [field, direction] pairs
- **returnAll** (Boolean, default: true): If false, use callback to process results incrementally
- **callback** (Function, optional): Function to process each batch of results
- **translateSqlRows** (Boolean, default: true): Convert rows to key-value format

### Logging

The framework uses [Pino](https://getpino.io/) v10+ for high-performance, asynchronous logging with automatic file rotation via [pino-roll](https://github.com/mcollina/pino-roll).

#### Key Features
- **Async Logging**: Non-blocking log writes for better performance under heavy load
- **Automatic File Rotation**: Time-based (daily/hourly) and size-based rotation
- **Multiple Log Streams**: Separate files for different log levels (main, error, slow, client-error)
- **Custom Log Levels**: Define application-specific log levels
- **HTTP Transport**: Send logs to remote endpoints
- **Graceful Shutdown**: Automatic log flushing on process exit
- **Symlinks**: Always-current log file symlinks (e.g., `current.log`)

#### Configuration
1. Create `config.json` in the project root (can be overridden with `config.local.json`)
2. Configure logging options as needed:

```json
{
    "logging": {
        "otherConfig": {
            "stdout": true,
            "logLevel": "info",
            "logFolder": "./logs",
            "mixin": null,
            "httpConfig": {
                "url": "http://xyz.com/error_post",
                "headers": {}
            },
            "postLevel": "error"
        },
        "prettyPrint": {
            "translateTime": "SYS:yyyy-mm-dd h:MM:ss",
            "ignore": "",
            "colorize": true,
            "singleLine": false,
            "levelFirst": false
        },
        "file": {
            "frequency": "daily",
            "size": "10m",
            "extension": ".json",
            "limit": { "count": 10 }
        },
        "customLevels": {
            "slow": 35,
            "clienterror": 45
        }
    }
}
```

#### Configuration Options

**otherConfig:**
- `stdout` (boolean): Enable/disable console output (default: true)
- `logLevel` (string): Minimum log level ('trace', 'debug', 'info', 'warn', 'error', 'fatal')
- `logFolder` (string): Directory for log files (default: './logs')
- `mixin` (function): Function to add custom properties to all log entries
- `httpConfig` (object): HTTP endpoint configuration for remote logging
- `postLevel` (string): Minimum level for HTTP transport (default: 'error')

**prettyPrint:**
- `translateTime` (string): Time format for console output
- `colorize` (boolean): Enable colored output (default: true for stdout)
- `ignore` (string): Comma-separated list of keys to omit from logs
- `singleLine` (boolean): Format logs as single lines
- `levelFirst` (boolean): Show level before timestamp

**file:**
- `frequency` (string): Rotation frequency - 'daily', 'hourly', or milliseconds (default: 'daily')
- `size` (string): Maximum file size before rotation - e.g., '1m', '100k', '1g' (default: '10m')
- `extension` (string): Log file extension (default: '.json')
- `limit` (object): File retention policy - `{ count: 10 }` keeps 10 old files (default: 10)

**customLevels:**
Define custom log levels with numeric values (higher = more severe). The framework includes:
- `slow`: For slow query logging
- `clienterror`: For client-side errors

#### Log File Naming

Log files are automatically named with dates and rotation counters:
- `log.2026-01-20.1.json` - Main application log
- `error.2026-01-20.1.json` - Error-level logs
- `slow.2026-01-20.1.json` - Slow query logs (if custom level defined)
- `client-error.2026-01-20.1.json` - Client error logs (if custom level defined)
- `current.log` - Symlink to the current active log file

#### Usage Example

```javascript
import { logger } from '@durlabh/dframework';

// Basic logging
logger.info('Application started');
logger.debug('Debug information');
logger.warn('Warning message');
logger.error('Error occurred');
logger.trace('Trace details');

// Custom levels (if defined in config)
logger.slow('Slow query detected', { query: 'SELECT...', duration: 5000 });
logger.clienterror('Client error', { error: 'Invalid input' });

// Child loggers with context
const requestLogger = logger.child({ reqId: 'abc-123' });
requestLogger.info('Processing request');

// Structured logging
logger.info({ user: 'john', action: 'login' }, 'User logged in');
```

#### Performance Considerations

The logger uses worker threads for all file operations, keeping the main event loop responsive under heavy load. Logs are automatically flushed on:
- Process signals (SIGINT, SIGTERM)
- Before process exit
- Periodic intervals (managed by pino)

For maximum performance in production:
1. Set `logLevel` to 'info' or higher
2. Use JSON format (`extension: '.json'`) for efficient parsing
3. Enable file rotation to manage disk space
4. Consider using remote log aggregation via `httpConfig`

#### Migration from v1.0.62 and Earlier

If upgrading from a version using `file-stream-rotator`:
- The new implementation uses `pino-roll` for better performance and reliability
- Configuration option `max_logs` is replaced by `limit: { count: N }`
- Default date format is now 'yyyy-MM-dd' for consistency across all log files
- `verbose` option is removed; the former `date_format` option has been superseded by `dateFormat` (the legacy `date_format` name may still be accepted for backward compatibility but is deprecated)
- All other options remain backward compatible

## Business object columns

### `multiSelectColumns` Documentation

The `multiSelectColumns` object is used to define configurations for columns that support multi-select functionality in on the UI side. 
It brings the multiple values as CSV string. 
``**references - business-base.mjs ``

#### Structure

```json
{
  "Alias": {}  // Uses all defaults
}
```

This is equivalent to:
```json
{
  "Alias": {
    "table": "ManufacturerAlias",  // Defaults to ParentTable + Key
    "column": "Alias",            // Defaults to Key
    "type": "string"             // Defaults to "string"
  }
}
```

You can override any of these defaults by specifying them in the configuration:
```json
{
  "Alias": {
    "table": "CustomTable",     // Override default table name
    "column": "CustomColumn",   // Override default column name
    "type": "number"           // Override default type
  }
}
```