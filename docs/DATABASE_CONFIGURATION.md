# Database Configuration Guide

This guide provides best practices and examples for configuring database connections in DFramework.

## MSSQL Connection Configuration

### Basic Configuration

```javascript
import { Sql } from '@durlabh/dframework';

const sql = new Sql();
await sql.setConfig({
    user: process.env.SQL_USER,
    password: process.env.SQL_PASSWORD,
    server: process.env.SQL_SERVER,
    database: process.env.SQL_DATABASE,
    options: {
        trustServerCertificate: true,
        encrypt: true
    }
});
```

### Advanced Configuration with Connection Pooling

```javascript
import { Sql } from '@durlabh/dframework';

const sql = new Sql();
await sql.setConfig({
    user: process.env.SQL_USER,
    password: process.env.SQL_PASSWORD,
    server: process.env.SQL_SERVER,
    database: process.env.SQL_DATABASE,
    
    // Connection pool configuration
    pool: {
        max: 10,                    // Maximum number of connections in pool
        min: 0,                     // Minimum number of connections in pool
        idleTimeoutMillis: 30000,   // Close idle connections after 30 seconds
        acquireTimeoutMillis: 30000 // Time to wait for connection before timing out
    },
    
    // Connection options
    options: {
        trustServerCertificate: true,
        encrypt: true,              // Use encryption for data sent between client and server
        enableArithAbort: true,     // Terminate query when overflow or divide-by-zero occurs
        connectTimeout: 30000,      // Connection timeout in ms (default: 15000)
        requestTimeout: 30000       // Request timeout in ms (default: 15000)
    },
    
    // Logging configuration
    logger: customLogger,           // Custom logger instance (optional)
    queryLogThreshold: 1000,        // Log queries taking longer than 1000ms
    timeoutLogLevel: 'warn'         // Log level for slow queries
});
```

### Production Configuration Example

```javascript
const sqlConfig = {
    user: process.env.SQL_USER,
    password: process.env.SQL_PASSWORD,
    server: process.env.SQL_SERVER,
    database: process.env.SQL_DATABASE,
    
    // Production pool settings for high-traffic applications
    pool: {
        max: 50,                    // Handle up to 50 concurrent connections
        min: 10,                    // Keep 10 connections always ready
        idleTimeoutMillis: 60000,   // Close idle connections after 1 minute
        acquireTimeoutMillis: 45000 // Wait up to 45 seconds for a connection
    },
    
    options: {
        trustServerCertificate: false,
        encrypt: true,
        enableArithAbort: true,
        connectTimeout: 45000,
        requestTimeout: 45000
    },
    
    queryLogThreshold: 500,         // Log queries taking > 500ms in production
    timeoutLogLevel: 'warn'
};

const sql = new Sql();
await sql.setConfig(sqlConfig);
```

### Development Configuration Example

```javascript
const sqlConfig = {
    user: 'dev_user',
    password: 'dev_password',
    server: 'localhost',
    database: 'dev_database',
    
    // Smaller pool for development
    pool: {
        max: 5,
        min: 2,
        idleTimeoutMillis: 30000,
        acquireTimeoutMillis: 30000
    },
    
    options: {
        trustServerCertificate: true,
        encrypt: false,             // May disable encryption in dev for debugging
        enableArithAbort: true,
        connectTimeout: 15000,
        requestTimeout: 15000
    },
    
    queryLogThreshold: 100,         // Log slower queries in dev for optimization
    timeoutLogLevel: 'info'
};

const sql = new Sql();
await sql.setConfig(sqlConfig);
```

## MySQL Connection Configuration

### Basic Configuration

```javascript
import { MySql } from '@durlabh/dframework';

const mysql = new MySql();
await mysql.setConfig({
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    namedPlaceholders: true
});
```

### Advanced Configuration with Connection Pooling

```javascript
import { MySql } from '@durlabh/dframework';

const mysql = new MySql();
await mysql.setConfig({
    host: process.env.MYSQL_HOST,
    port: process.env.MYSQL_PORT || 3306,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    namedPlaceholders: true,
    
    // Connection pool configuration
    connectionLimit: 10,            // Maximum number of connections
    waitForConnections: true,       // Wait for connection if pool is full
    queueLimit: 0,                  // Unlimited queued connection requests
    connectTimeout: 30000,          // Connection timeout in ms
    
    // Additional options
    timezone: 'Z',                  // Use UTC timezone
    dateStrings: false,             // Convert dates to Date objects
    charset: 'utf8mb4',             // Support full UTF-8 character set
    
    // Logging
    logger: customLogger,
    queryLogThreshold: 1000,
    timeoutLogLevel: 'warn'
});
```

### Production MySQL Configuration

```javascript
const mysqlConfig = {
    host: process.env.MYSQL_HOST,
    port: process.env.MYSQL_PORT || 3306,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    namedPlaceholders: true,
    
    // Production pool settings
    connectionLimit: 100,           // Support high concurrency
    waitForConnections: true,
    queueLimit: 0,
    connectTimeout: 45000,
    
    // SSL/TLS configuration for secure connections
    ssl: {
        ca: fs.readFileSync('/path/to/ca.pem'),
        rejectUnauthorized: true
    },
    
    timezone: 'Z',
    dateStrings: false,
    charset: 'utf8mb4',
    
    queryLogThreshold: 500,
    timeoutLogLevel: 'warn'
};

const mysql = new MySql();
await mysql.setConfig(mysqlConfig);
```

## Best Practices

### 1. Connection Pool Sizing

**For MSSQL:**
- **Low traffic** (< 100 users): pool.max = 10-20
- **Medium traffic** (100-1000 users): pool.max = 20-50
- **High traffic** (> 1000 users): pool.max = 50-100

**For MySQL:**
- **Low traffic**: connectionLimit = 10-20
- **Medium traffic**: connectionLimit = 20-50
- **High traffic**: connectionLimit = 50-100

### 2. Timeout Settings

```javascript
// Adjust based on your query complexity
{
    connectTimeout: 30000,      // Time to establish connection
    requestTimeout: 45000,      // Time for query execution
    acquireTimeoutMillis: 30000 // Time to get connection from pool
}
```

**Guidelines:**
- Simple queries: 15-30 seconds
- Complex queries/reports: 45-60 seconds
- Batch operations: 90-120 seconds

### 3. Slow Query Logging

```javascript
{
    queryLogThreshold: 500,     // Production: 500-1000ms
    timeoutLogLevel: 'warn'     // Log slow queries as warnings
}
```

Monitor slow queries regularly and optimize:
- Add indexes for frequently queried columns
- Optimize JOIN operations
- Use query execution plans
- Consider caching for read-heavy operations

### 4. Environment-Specific Configuration

```javascript
const getDbConfig = () => {
    const env = process.env.NODE_ENV || 'development';
    
    const baseConfig = {
        user: process.env.SQL_USER,
        password: process.env.SQL_PASSWORD,
        server: process.env.SQL_SERVER,
        database: process.env.SQL_DATABASE
    };
    
    if (env === 'production') {
        return {
            ...baseConfig,
            pool: { max: 50, min: 10, idleTimeoutMillis: 60000 },
            options: { 
                trustServerCertificate: false, 
                encrypt: true 
            },
            queryLogThreshold: 500
        };
    } else if (env === 'staging') {
        return {
            ...baseConfig,
            pool: { max: 20, min: 5, idleTimeoutMillis: 45000 },
            options: { 
                trustServerCertificate: false, 
                encrypt: true 
            },
            queryLogThreshold: 300
        };
    } else {
        return {
            ...baseConfig,
            pool: { max: 5, min: 2, idleTimeoutMillis: 30000 },
            options: { 
                trustServerCertificate: true, 
                encrypt: false 
            },
            queryLogThreshold: 100
        };
    }
};

const sql = new Sql();
await sql.setConfig(getDbConfig());
```

### 5. Connection Monitoring

Monitor these metrics in production:

- **Active connections**: Current number of active connections
- **Pool utilization**: Percentage of max connections in use
- **Wait time**: Time requests wait for available connection
- **Query duration**: Average and p95/p99 query times
- **Connection errors**: Failed connection attempts

### 6. Error Handling

```javascript
import { Sql } from '@durlabh/dframework';

let sql;

try {
    sql = new Sql();
    await sql.setConfig(sqlConfig);
    console.log('Database connected successfully');
} catch (err) {
    console.error('Database connection failed:', err);
    
    // Implement retry logic
    let retries = 3;
    while (retries > 0) {
        try {
            await new Promise(resolve => setTimeout(resolve, 5000));
            await sql.setConfig(sqlConfig);
            console.log('Database reconnected after retry');
            break;
        } catch (retryErr) {
            retries--;
            if (retries === 0) {
                console.error('Failed to connect after retries');
                process.exit(1);
            }
        }
    }
}
```

### 7. Graceful Shutdown

```javascript
// Close pool on application shutdown
process.on('SIGTERM', async () => {
    console.log('SIGTERM received, closing database connections...');
    await sql.pool.close();
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('SIGINT received, closing database connections...');
    await sql.pool.close();
    process.exit(0);
});
```

## Common Issues and Solutions

### Issue: Pool Exhaustion

**Symptom**: `TimeoutError: Timeout acquiring a connection`

**Solution:**
```javascript
{
    pool: {
        max: 50,                    // Increase max connections
        acquireTimeoutMillis: 45000 // Increase timeout
    }
}
```

### Issue: Slow Queries

**Symptom**: Queries taking longer than expected

**Solution:**
1. Check slow query logs
2. Add database indexes
3. Optimize query structure
4. Consider query result caching
5. Adjust `requestTimeout` if needed

### Issue: Connection Timeouts

**Symptom**: `ConnectionError: Connection timeout`

**Solution:**
```javascript
{
    options: {
        connectTimeout: 60000,  // Increase connection timeout
        requestTimeout: 60000   // Increase request timeout
    }
}
```

### Issue: Too Many Idle Connections

**Symptom**: Database shows many idle connections

**Solution:**
```javascript
{
    pool: {
        min: 2,                     // Reduce minimum connections
        idleTimeoutMillis: 15000    // Close idle connections faster
    }
}
```

## Framework-Specific Configuration

When using DFramework's Framework class:

```javascript
import { Framework } from '@durlabh/dframework';

const framework = new Framework({ logger });

// MSSQL
await framework.setSql({
    user: process.env.SQL_USER,
    password: process.env.SQL_PASSWORD,
    server: process.env.SQL_SERVER,
    database: process.env.SQL_DATABASE,
    pool: { max: 20, min: 5 },
    options: {
        trustServerCertificate: true,
        encrypt: true
    },
    queryLogThreshold: 1000
});

// MySQL
await framework.setMySql({
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    namedPlaceholders: true,
    connectionLimit: 20,
    queryLogThreshold: 1000
});
```

## References

- [MSSQL Node.js Driver Documentation](https://github.com/tediousjs/node-mssql)
- [MySQL2 Documentation](https://github.com/sidorares/node-mysql2)
- [Connection Pooling Best Practices](https://node-postgres.com/features/pooling)
