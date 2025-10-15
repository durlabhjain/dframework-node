# GitHub Copilot Instructions for dframework-node

## Project Overview

This is `@durlabh/dframework` - a Node.js library that facilitates using Spraxa's DFramework related applications via NodeJS. It provides a comprehensive framework for:

- Portal API interactions
- SQL database operations (MSSQL and MySQL)
- ElasticSearch integration
- Structured logging with Pino
- Authentication (LDAP, Entra ID, Basic Auth)
- Business object management
- Report generation (Excel, CSV, JSON, text)
- Azure services integration

## Technology Stack

- **Language**: JavaScript (ES6+ modules)
- **Module System**: ES Modules (`.mjs` and `.js` with `"type": "module"`)
- **Main Dependencies**:
  - `mssql` - Microsoft SQL Server client
  - `mysql2` - MySQL client
  - `pino` - Structured logging
  - `exceljs` - Excel file generation
  - `got` - HTTP client
  - `dayjs` - Date/time manipulation
  - `@azure/msal-node` - Microsoft authentication
  - `ldapjs` - LDAP authentication

## Code Style and Conventions

### General Guidelines

1. **Use ES6+ features**: Arrow functions, async/await, destructuring, template literals
2. **Module exports**: Use `export default` for main exports, named exports for utilities
3. **File extensions**: 
   - `.mjs` for pure ES modules (newer code)
   - `.js` for ES modules (with `"type": "module"` in package.json)
4. **Async operations**: Always use `async/await` over promises or callbacks
5. **Error handling**: Use try/catch blocks for async operations

### Naming Conventions

- **Classes**: PascalCase (e.g., `Framework`, `BusinessBase`, `SqlHelper`)
- **Functions/Methods**: camelCase (e.g., `setElastic`, `createControllers`, `formatDate`)
- **Constants**: UPPER_SNAKE_CASE or camelCase (e.g., `SECOND`, `MINUTE`, `dateTimeFields`)
- **File names**: kebab-case or camelCase (e.g., `business-base.mjs`, `util.js`)

### Logging

- Use the Pino logger from `lib/logger.js`
- Import: `import logger from './lib/logger.js'`
- Available levels: `trace`, `debug`, `info`, `warn`, `error`, plus custom levels
- Configuration in `config.json` or `config.local.json`

### Date/Time Handling

- Use `dayjs` for all date/time operations
- Standard formats defined in `lib/util.js`:
  - `dateFormat`: 'M-D-Y'
  - `dateTimeFormat`: 'M-D-Y HH:mm:ss'
  - Report formats in `reportDatesFormat` object

## Project Structure

```
/
├── lib/                       # Main library code
│   ├── business/              # Business logic layer
│   │   ├── business-base.mjs  # Base class for business objects
│   │   ├── business-objects.mjs # Router for business objects
│   │   ├── auth.mjs           # Authentication logic
│   │   ├── auth/              # Auth implementations (LDAP, Entra, Basic)
│   │   ├── sql-helper.mjs     # SQL query helper utilities
│   │   ├── query-base.mjs     # Base query functionality
│   │   ├── lookup.mjs         # Lookup utilities
│   │   └── error-mapper.mjs   # Error mapping for SQL
│   ├── adapters/              # Adapter layer for HTTP clients
│   ├── http-auth/             # HTTP authentication (basic, bearer)
│   ├── middleware/            # Express middleware
│   ├── wrappers/              # Database client wrappers (mssql, mysql)
│   ├── index.js               # Main Framework class
│   ├── logger.js              # Pino logger configuration
│   ├── util.js                # Utility functions
│   ├── sql.js                 # SQL database client
│   ├── mysql.js               # MySQL database client
│   ├── elastic.js             # ElasticSearch client
│   ├── azure.js               # Azure services integration
│   ├── reports.mjs            # Report generation utilities
│   ├── enums.mjs              # Shared enums
│   └── appConfig.mjs          # Application configuration loader
├── docs/                      # Documentation
├── tests/                     # Test files
├── index.js                   # Main entry point
└── package.json
```

## Key Patterns and Practices

### 1. Business Objects

Business objects extend `BusinessBase` from `lib/business/business-base.mjs`:

```javascript
import BusinessBase from './business-base.mjs';

class MyBusinessObject extends BusinessBase {
    constructor({ pool }) {
        super({ pool, tableName: 'MyTable', primaryKey: 'ID' });
    }
    
    // Custom business logic here
}
```

Key features:
- Automatic CRUD operations
- Multi-select columns support
- Soft delete with `IsDeleted` column
- Relationship handling (OneToMany, OneToOne)
- Filter support with comparison operators

### 2. SQL Operations

Use parameterized queries to prevent SQL injection:

```javascript
const request = framework.sql.createRequest();
request.input('IsActive', mssql.VarChar, 'Y');
const { recordset } = await framework.sql.query(`
    SELECT * FROM dbo.Users WHERE IsActive = @IsActive
`);
```

Or use query files:

```javascript
const fileName = 'queries/activeClients.sql';
const activeUsers = await framework.sql.query(fileName);
```

### 3. Configuration Management

- Configuration files: `config.json` (base) and `config.local.json` (overrides)
- Access via `import config from './lib/appConfig.mjs'`
- Environment-specific configs in `environments/` folder (e.g., `.esenv` files)

### 4. Error Handling

- SQL errors mapped via `sqlErrorMapper` in `lib/business/error-mapper.mjs`
- Unique constraint violations detected by error codes 2627 and 2601
- Always provide meaningful error messages

### 5. Report Generation

Reports support multiple formats (Excel, CSV, JSON, text):

```javascript
import { reports } from './lib/reports.mjs';

await reports.execute({
    ReportType: MyReport,
    options: { /* report options */ }
});
```

Excel features:
- Table formatting
- Column width auto-adjustment
- Date/time formatting
- Formula support

## Testing Guidelines

- Test files located in `tests/` directory
- Use descriptive test names
- Test both success and error scenarios
- Mock external dependencies (database, HTTP calls)

## Common Gotchas

1. **Module imports**: Use file extensions in imports (`.js` or `.mjs`)
2. **Date handling**: Always use `dayjs` for date operations, not native Date
3. **SQL parameters**: Use proper type definitions from `mssql` library
4. **Configuration**: Check both `config.json` and `config.local.json`
5. **Logging levels**: Custom levels can be defined in logging config
6. **Optional dependencies**: Many dependencies are marked as optional in peerDependencies

## API Design Principles

1. **Fluent interfaces**: Methods return `this` for chaining where appropriate
2. **Flexible parameters**: Accept both object parameters and simple values
3. **Sensible defaults**: Provide defaults for optional parameters
4. **Backward compatibility**: Maintain existing API signatures
5. **Clear naming**: Use descriptive, self-documenting names

## Authentication

Multiple authentication methods supported:

- **Basic Auth**: Username/password via `lib/business/auth/basicAuth.mjs`
- **Entra ID**: Microsoft Entra (Azure AD) via `lib/business/auth/entraAuth.mjs`
- **LDAP**: LDAP authentication via `lib/business/auth/ldapAuth.mjs`
- **ASPX Forms**: Legacy ASP.NET forms auth via `lib/business/auth/aspxAuth.js`

## Making Changes

When contributing or making changes:

1. **Minimal changes**: Only modify what's necessary
2. **Follow existing patterns**: Match the style of surrounding code
3. **Update documentation**: Keep README.md and JSDoc comments current
4. **Test your changes**: Ensure no regressions
5. **Consider backward compatibility**: Avoid breaking existing APIs
6. **Use proper imports**: Always use explicit file extensions
7. **Handle optional dependencies**: Check if dependencies exist before use

## Documentation

The project has comprehensive documentation:

- **[README.md](../README.md)**: Main documentation with getting started guide, API overview, and usage examples
- **[USAGE_PATTERNS.md](../docs/USAGE_PATTERNS.md)**: 27+ usage patterns covering all major features with complete code examples
- **[NEW_EXPORTS.md](../docs/NEW_EXPORTS.md)**: Documentation on the newly available exports and subpath imports
- **[SQL_LOGGING.md](../docs/SQL_LOGGING.md)**: Flexible SQL logging for web requests with request context
- **[TODO.md](../TODO.md)**: Comprehensive code review with prioritized improvements and enhancements
- **[Examples](../docs/examples/)**: Working examples demonstrating framework features

When making changes, ensure documentation stays up-to-date and consistent with the code.

## TODO Items in Codebase

See [TODO.md](../TODO.md) for a comprehensive list of improvements and future enhancements.

Previously completed items:
- ✅ `README.md`: ElasticSearch parameters are now documented
- ✅ `README.md`: SQL JOIN functionality is now documented

Remaining areas marked for future enhancement:
- `lib/reports.mjs`: Add handler improvements for JSON and text files

When working on these, maintain consistency with existing patterns.
