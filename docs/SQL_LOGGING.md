# Flexible SQL Logging for Web Requests

## Overview

The DFramework SQL classes (Sql and MySql) now support request-specific logging, allowing SQL operations to be logged with web request context such as request IDs. This makes it much easier to debug and trace database operations in production environments.

## How It Works

When a web request comes in with a logger attached (e.g., `req.log` from pino-http), the framework automatically:

1. Detects the request logger in the BusinessBaseObjectsRouter middleware
2. Attaches the logger to the business object instance
3. Passes the logger through to SQL operations
4. Logs SQL errors and slow queries with the request context

## Usage

### Automatic (Recommended)

If you're using Express.js with pino-http or similar request logging middleware:

```javascript
import express from 'express';
import pinoHttp from 'pino-http';
import BusinessBaseObjectsRouter from '@durlabh/dframework/business/business-objects';

const app = express();

// Add request logging middleware
app.use(pinoHttp({
  genReqId: (req) => req.headers['x-request-id'] || crypto.randomUUID()
}));

// Setup business object routes
const router = express.Router();
new BusinessBaseObjectsRouter(router, {
  User: { tableName: 'Users', keyField: 'UserId' }
});

app.use('/api', router);
```

That's it! No additional configuration needed.

### Manual

You can also manually set a logger on a business object:

```javascript
import pino from 'pino';
import { BusinessBase } from '@durlabh/dframework/business/business-base';

const logger = pino();
const requestLogger = logger.child({ reqId: 'custom-123' });

class UserBusiness extends BusinessBase {
  tableName = 'Users';
  keyField = 'UserId';
}

const userBusiness = new UserBusiness();
userBusiness.logger = requestLogger;

// All SQL operations will now use this logger
await userBusiness.load({ id: 1 });
```

## Log Output Examples

### Before (global logger only)
```json
{
  "level": 50,
  "time": 1234567890,
  "msg": "SQL Error",
  "err": { "message": "..." },
  "query": "SELECT * FROM Users WHERE UserId = @UserId",
  "parameters": { "UserId": 123 }
}
```

### After (with request context)
```json
{
  "level": 50,
  "time": 1234567890,
  "reqId": "abc-123-def-456",
  "msg": "SQL Error",
  "err": { "message": "..." },
  "query": "SELECT * FROM Users WHERE UserId = @UserId",
  "parameters": { "UserId": 123 }
}
```

Notice the `reqId` field - this makes it easy to correlate SQL errors with specific requests!

## Supported Scenarios

The logger is used in the following scenarios:

- **SQL Errors**: When a query fails, the error is logged with request context
- **Slow Queries**: When a query exceeds the threshold, it's logged with request context
- **All Business Operations**: load, save, delete, list, etc.

## Backward Compatibility

All changes are fully backward compatible:

- If no custom logger is provided, the default SQL logger is used
- Existing code continues to work without modification
- The feature is opt-in through the use of request logging middleware

## Advanced Configuration

### Custom Logger per Business Object

```javascript
class UserBusiness extends BusinessBase {
  constructor() {
    super();
    this.logger = pino({ level: 'debug' });
  }
}
```

### Conditional Logging

```javascript
const business = new UserBusiness();
if (process.env.NODE_ENV === 'production') {
  business.logger = requestLogger;
}
```

## Benefits

1. **Easy Debugging**: Trace SQL operations back to specific web requests
2. **Performance Monitoring**: Identify which requests cause slow queries
3. **Error Tracking**: Correlate database errors with specific user actions
4. **Production Insights**: Better observability in production environments
5. **Zero Configuration**: Works automatically with standard logging middleware

## Technical Details

The logger is passed through this chain:

```
HTTP Request (req.log/req.logger)
  ↓
BusinessBaseObjectsRouter middleware
  ↓
BusinessBase instance (logger property)
  ↓
createRequest() method
  ↓
SQL Request object (_logger property)
  ↓
runQuery/logSlowQuery (uses _logger if available)
```

This ensures every SQL operation has access to the appropriate logger context.
