# Purpose

This library is to facilate using Spraxa's DFramework related applications via NodeJS

## Documentation

- [Usage Patterns](docs/USAGE_PATTERNS.md) - Comprehensive guide with common usage patterns and examples
- [Database Configuration](docs/DATABASE_CONFIGURATION.md) - Connection pooling, best practices, and configuration examples
- [Batch Operations](docs/BATCH_OPERATIONS.md) - Efficient batch INSERT, UPDATE, DELETE operations with examples
- [ElasticSearch Queries](docs/ELASTICSEARCH_QUERIES.md) - SQL and Search API queries with pagination and memory optimization
- [New Exports](docs/NEW_EXPORTS.md) - Documentation on newly available exports
- [SQL Logging](docs/SQL_LOGGING.md) - Request-specific logging for SQL operations
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

#### Configuration
1. Need to create config.json file on root of the project, which can be override with all config with local file like config.local.json
2. Configuration in the JSON file which has all default values which can change accordingly
```
{
     "logging": {
        "otherConfig": {
            "stdout": true,
            "httpConfig": {
                "url": "http://xyz.com/error_post",
                "headers": {}
            },
            postLevel: "error",
            stdout: true,
            logLevel: 'debug',
            logFolder: './logs',
            mixin: null,
        },
        "prettyPrint": {
            translateTime: 'SYS:yyyy-mm-dd h:MM:ss',
            ignore: '',
            colorize: true,
            singleLine: false,
            levelFirst: false,
        },
        "file": {
            frequency: 'daily',
            verbose: false,
            max_logs: '10d',
            date_format: 'YYYY-MM-DD',
            size: '1m',
            extension: ".log"
        },
        "customLevels" : { custom: 35 }
    }
}
```

#### Example

```
import { logger } from '@durlabh/dframework';

logger.info("info");
logger.debug("debug");
logger.error("error");
logger.trace("trace");
```

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