# Examples

This directory contains example code demonstrating how to use DFramework features.

## express-with-logging.mjs

Demonstrates the flexible SQL logging feature with Express.js and pino-http.

**Key Features Shown:**
- Automatic request logger propagation to SQL operations
- Request ID correlation in SQL logs
- Slow query logging with request context
- Error logging with request context

**To Run:**

```bash
# Install dependencies (if not already installed)
npm install

# Update the SQL configuration in the file with your database details

# Run the example
node docs/examples/express-with-logging.mjs
```

**Example Requests:**

```bash
# List users (will automatically log with request ID)
curl -X POST http://localhost:3000/api/v1/user/list \
  -H "Content-Type: application/json" \
  -H "X-Request-ID: my-custom-request-123" \
  -d '{"start":0,"limit":10}'

# Get a specific user
curl -X GET http://localhost:3000/api/v1/user/1 \
  -H "X-Request-ID: my-custom-request-456"

# Create a user with custom endpoint
curl -X POST http://localhost:3000/api/users/custom \
  -H "Content-Type: application/json" \
  -H "X-Request-ID: my-custom-request-789" \
  -d '{"username":"johndoe","email":"john@example.com"}'
```

## Benefits of Request-Context Logging

When you use these examples, you'll see SQL logs that include the request ID:

```
[INFO] Request received
  reqId: "my-custom-request-123"
  method: "POST"
  url: "/api/v1/user/list"

[WARN] Query execution exceeded 500 milliseconds
  reqId: "my-custom-request-123"  ← Same request ID!
  query: "SELECT * FROM Users..."
  executionTime: "750ms"

[INFO] Request completed
  reqId: "my-custom-request-123"
  statusCode: 200
```

This makes it easy to:
- Trace all operations for a specific request
- Debug performance issues
- Identify which requests cause database problems
- Correlate frontend errors with backend database operations
