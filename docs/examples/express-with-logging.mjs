/**
 * Example: Using Flexible SQL Logging with Express and pino-http
 * 
 * This example demonstrates how SQL logging automatically includes
 * request context when using pino-http middleware.
 */

import express from 'express';
import pinoHttp from 'pino-http';
import pino from 'pino';
import BusinessBaseObjectsRouter from '../../lib/business/business-objects.mjs';
import Framework from '../../lib/index.js';

// Create the Express app
const app = express();
app.use(express.json());

// Setup pino-http for request logging
const logger = pino({
  level: 'debug',
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname'
    }
  }
});

app.use(pinoHttp({
  logger,
  genReqId: (req) => req.headers['x-request-id'] || require('crypto').randomUUID(),
  customLogLevel: (req, res, err) => {
    if (res.statusCode >= 400 && res.statusCode < 500) {
      return 'warn';
    } else if (res.statusCode >= 500 || err) {
      return 'error';
    }
    return 'info';
  }
}));

// Initialize Framework with SQL configuration
const framework = new Framework({ serverUrl: 'http://localhost:3000' });

// Example SQL configuration (you would use your actual config)
await framework.setSql({
  server: 'localhost',
  database: 'mydb',
  user: 'user',
  password: 'password',
  options: {
    encrypt: false,
    trustServerCertificate: true
  },
  logger,  // Framework-level logger
  queryLogThreshold: 500  // Log queries slower than 500ms
});

// Attach framework to business objects
import { BusinessBase } from '../../lib/business/business-base.mjs';
BusinessBase.businessObject = framework;

// Setup business object routes
const router = express.Router();
new BusinessBaseObjectsRouter(router, {
  User: {
    tableName: 'Users',
    keyField: 'UserId',
    displayField: 'UserName',
    standardTable: true
  },
  Product: {
    tableName: 'Products',
    keyField: 'ProductId',
    displayField: 'ProductName',
    standardTable: true
  }
});

app.use('/api/v1', router);

// Example custom endpoint showing manual logger usage
app.post('/api/users/custom', async (req, res) => {
  try {
    const { BusinessBase } = await import('../../lib/business/business-base.mjs');
    
    class UserBusiness extends BusinessBase {
      tableName = 'Users';
      keyField = 'UserId';
      standardTable = true;
    }
    
    const userBusiness = new UserBusiness();
    userBusiness.user = req.user || { id: 1 };
    
    // Pass the request logger for SQL operations
    userBusiness.logger = req.log;
    
    const result = await userBusiness.save({
      UserId: 0,
      UserName: req.body.username,
      Email: req.body.email,
      relations: false
    });
    
    res.json({ success: true, data: result });
  } catch (error) {
    req.log.error({ err: error }, 'Error in custom user creation');
    res.status(500).json({ success: false, error: error.message });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  req.log.error({ err }, 'Unhandled error');
  res.status(500).json({ 
    success: false, 
    error: 'Internal server error',
    reqId: req.id 
  });
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  logger.info(`Server listening on port ${PORT}`);
  logger.info(`Try: POST http://localhost:${PORT}/api/v1/user/list`);
  logger.info(`Try: GET http://localhost:${PORT}/api/v1/user/1`);
  logger.info(`Try: POST http://localhost:${PORT}/api/users/custom`);
});

/**
 * Example Request:
 * 
 * curl -X POST http://localhost:3000/api/v1/user/list \
 *   -H "Content-Type: application/json" \
 *   -H "X-Request-ID: my-custom-request-123" \
 *   -d '{"start":0,"limit":10}'
 * 
 * Expected Log Output (with request context):
 * 
 * [INFO] 20:00:00 - Incoming request
 *   reqId: "my-custom-request-123"
 *   method: "POST"
 *   url: "/api/v1/user/list"
 * 
 * [WARN] 20:00:00 - Query execution exceeded 500 milliseconds
 *   reqId: "my-custom-request-123"
 *   query: "SELECT * FROM vwUsersList Main WHERE Main.IsDeleted = 0 ORDER BY UserId OFFSET @_start ROWS FETCH NEXT @_limit ROWS ONLY"
 *   executionTime: "750ms"
 *   parameters: { _start: 0, _limit: 10 }
 * 
 * [INFO] 20:00:00 - Request completed
 *   reqId: "my-custom-request-123"
 *   statusCode: 200
 *   responseTime: 755
 */
