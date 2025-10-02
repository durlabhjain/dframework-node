# DFramework Node - TODO and Improvements

This document contains a comprehensive code review identifying areas for improvement, technical debt, and future enhancements for the @durlabh/dframework library.

## Critical Issues

### 1. Security & Data Validation

- [ ] **SQL Injection Prevention**: While parameterized queries are used, ensure all dynamic table/column names in `business-base.mjs` are properly sanitized
  - Location: `lib/business/business-base.mjs` - dynamic column names in multiSelectColumns
  - Location: `lib/business/sql-helper.mjs` - pivot queries with dynamic field names
  - Current mitigation: `fieldNameRegex` validation exists but should be enforced everywhere

- [ ] **Password Handling in AspxAuth**: Password hash is hardcoded to "nothing" when `withoutPassword` is true
  - Location: `lib/business/auth/aspxAuth.js:7`
  - Risk: Potential authentication bypass scenario
  - Recommendation: Review authentication flow and ensure proper validation

### 2. Error Handling

- [ ] **Silent Error Swallowing**: Some async operations don't properly propagate errors
  - Location: `lib/sql.js:97-100` - SQL errors return `{ success: false }` but calling code may not check
  - Location: `lib/mysql.js:78-82` - Same pattern as mssql
  - Recommendation: Consider throwing errors or ensure all callers check success flag

- [ ] **Missing Error Context**: Some error logs lack sufficient context for debugging
  - Location: `lib/reports.mjs:196` - Handler not defined error could include more info
  - Location: `lib/elastic.js` - Network errors could include retry information

## Documentation Gaps

### 3. Missing Documentation (Existing TODOs)

- [ ] **ElasticSearch Parameters**: Document query parameters for `elastic.aggregate()`
  - Location: `README.md:180`
  - Required: Document `query`, `customize`, `mappings` parameters with examples
  - Reference: `lib/elastic.js` aggregate method

- [ ] **SQL JOIN Functionality**: Add documentation for JOIN support
  - Location: `README.md:140`
  - Required: Document how to use SQL joins with the framework
  - Reference: Look at `lib/sql.js` and `lib/business/business-base.mjs` for join patterns

- [ ] **Report Handler Improvements**: JSON and text file handlers need enhancement
  - Location: `lib/reports.mjs:71`
  - Current: Uses same handler for CSV, JSON, and text
  - Improvement: Create dedicated handlers for better formatting

### 4. API Documentation

- [ ] **Business Object Relations**: Document the relationship system more thoroughly
  - OneToMany relationships in `business-base.mjs`
  - OneToOne relationships
  - How to define foreign keys
  - Example: Advanced relationship scenarios

- [ ] **ListParameters**: Document all filter comparison operators
  - Location: `lib/business/business-base.mjs:32-150` - All comparison operators
  - Current: Only basic examples in docs
  - Need: Complete reference of: contains, startsWith, endsWith, notContains, is, not, onOrAfter, onOrBefore, isEmpty, isNotEmpty, etc.

- [ ] **Multi-Select Columns**: Better documentation with real-world examples
  - Location: `README.md:234-269`
  - Current: Good basic documentation
  - Enhancement: Add examples with all configuration options

## Code Quality Issues

### 5. Console Usage Instead of Logger

Replace console.* calls with proper logger usage:

- [ ] `lib/reports.mjs:246` - `console.table(rows)` should use logger
- [ ] `lib/business/sql-helper.mjs:138` - Debug console.log should use logger.debug
- [ ] `lib/business/sql-helper.mjs:142` - Debug console.log should use logger.debug
- [ ] `lib/azure.js:37,45,46,48,55` - Multiple console.log calls should use logger

### 6. Legacy Code Patterns

- [ ] **var usage**: Replace with const/let
  - Location: `lib/util.js:115,131` - var len = arr.length

- [ ] **ES6+ Modernization**: Some files still use older patterns
  - Location: `lib/business/auth/aspxAuth.js` - Uses `.js` extension but could be `.mjs`
  - Consider: Consistent use of arrow functions, destructuring, etc.

### 7. Type Safety

- [ ] **Add JSDoc Type Annotations**: Improve IDE support and catch errors
  - All public methods in `BusinessBase`, `Sql`, `MySql`, `Framework`
  - Report configuration objects
  - Filter and parameter objects

- [ ] **Consider TypeScript Migration**: For better type safety
  - Benefits: Catch errors at compile time, better IDE support
  - Challenge: Large codebase, optional dependencies
  - Alternative: Continue with comprehensive JSDoc

## Performance Improvements

### 8. Database Operations

- [ ] **Connection Pooling**: Review pool configuration options
  - Location: `lib/sql.js:50-57`, `lib/mysql.js:57-64`
  - Add: Configurable pool size, timeout, retry logic
  - Document: Best practices for pool configuration

- [ ] **Query Optimization**:
  - [ ] Add query result caching mechanism for frequently accessed data
  - [ ] Implement batch operations for multiple inserts/updates
  - [ ] Add query explain/analyze tools for slow query debugging

- [ ] **Slow Query Logging**: Already implemented but could be enhanced
  - Current: Logs queries over threshold
  - Enhancement: Add query statistics aggregation, track most frequent slow queries

### 9. Memory Management

- [ ] **Large Dataset Handling**: Reports module could handle large datasets better
  - Location: `lib/reports.mjs` - Currently loads all data in memory
  - Improvement: Add streaming support for very large Excel files
  - Reference: ExcelJS streaming write is partially implemented

- [ ] **ElasticSearch Pagination**: Review cursor handling for large result sets
  - Location: `lib/elastic.js:86-140`
  - Current: Uses cursors but could optimize memory usage

## Testing

### 10. Test Coverage

- [ ] **Unit Tests**: Add comprehensive unit tests
  - Priority: `BusinessBase` CRUD operations
  - Priority: `Sql` and `MySql` query building
  - Priority: Filter/comparison operators
  - Priority: Report generation

- [ ] **Integration Tests**: Add tests for:
  - Database operations (with test database)
  - ElasticSearch queries (with test instance)
  - Authentication flows
  - Report generation

- [ ] **End-to-End Tests**: Add tests for common workflows
  - User CRUD operations
  - Complex filtering
  - Multi-table queries
  - Report generation with all formats

### 11. Test Infrastructure

- [ ] **Add Test Framework**: Set up Jest, Mocha, or similar
- [ ] **Add Mocking Utilities**: For database, HTTP, ElasticSearch
- [ ] **CI/CD Integration**: Run tests on pull requests
- [ ] **Code Coverage**: Set up coverage reporting (target: 80%+)

## Feature Enhancements

### 12. Authentication

- [ ] **Token Refresh**: Add automatic token refresh for Entra ID
  - Location: `lib/business/auth/entraAuth.mjs`
  - Current: Handles token acquisition
  - Enhancement: Automatic refresh before expiration

- [ ] **Multi-Factor Authentication**: Add MFA support
- [ ] **OAuth2 Providers**: Add support for more OAuth2 providers (Google, GitHub, etc.)
- [ ] **API Key Authentication**: Add simple API key auth option

### 13. Logging Enhancements

- [ ] **Structured Logging**: Already uses Pino, but enhance with:
  - Standard log format across all modules
  - Correlation IDs for tracing requests
  - Performance metrics logging
  - Security event logging

- [ ] **Log Rotation**: Already configured, but document best practices
- [ ] **Log Aggregation**: Document integration with ELK, Splunk, etc.

### 14. Report Generation

- [ ] **Additional Formats**:
  - [ ] PDF generation support
  - [ ] HTML reports
  - [ ] Markdown reports

- [ ] **Report Templates**: Add template system for reports
- [ ] **Scheduled Reports**: Add support for scheduled report generation
- [ ] **Report Caching**: Cache generated reports for performance

### 15. Business Objects

- [ ] **Validation Framework**: Add built-in validation
  - Required fields
  - Field types (email, phone, etc.)
  - Custom validators
  - Validation error messages

- [ ] **Audit Trail**: Enhance audit logging
  - Track all changes (who, what, when)
  - Soft delete tracking
  - Change history

- [ ] **Versioning**: Add support for record versioning
  - Track record versions
  - Compare versions
  - Rollback to previous version

## Architecture Improvements

### 16. Dependency Management

- [ ] **Optional Dependencies**: Review peerDependencies
  - Many dependencies are marked optional
  - Document which features require which dependencies
  - Add runtime checks with helpful error messages

- [ ] **Dependency Upgrades**: Keep dependencies up-to-date
  - Already done in `docs/upgrade.md`
  - Set up automated dependency updates (Dependabot, Renovate)
  - Regular security audits

### 17. Modularity

- [ ] **Reduce Coupling**: Some modules have tight coupling
  - `BusinessBase` depends on global `BusinessBase.businessObject`
  - Consider dependency injection pattern
  - Make modules more independently testable

- [ ] **Plugin System**: Add plugin architecture
  - Custom authentication methods
  - Custom report formats
  - Custom field validators
  - Custom data transformers

### 18. Configuration

- [ ] **Configuration Validation**: Validate config.json schema
- [ ] **Environment Variables**: Better support for env vars
  - Document all supported environment variables
  - Add .env.example file
  - Validate required environment variables

- [ ] **Configuration Hot Reload**: Allow config changes without restart
  - Useful for logging level changes
  - Database connection pool adjustments

## Developer Experience

### 19. Documentation

- [ ] **API Reference**: Generate API docs from JSDoc
  - Use JSDoc to generate HTML documentation
  - Publish to GitHub Pages or similar
  - Keep in sync with code

- [ ] **Tutorials**: Add step-by-step tutorials
  - Getting started guide
  - Building a simple CRUD app
  - Advanced filtering and reporting
  - Authentication setup
  - Deployment guide

- [ ] **Migration Guides**: Document breaking changes
  - Version upgrade guides
  - Migration scripts if needed

- [ ] **Troubleshooting Guide**: Common issues and solutions
  - Connection issues
  - Authentication problems
  - Performance tuning
  - Error messages explained

### 20. Examples

- [ ] **Sample Applications**: Add complete example apps
  - Simple REST API
  - GraphQL API
  - Full-stack app with UI
  - Microservices example

- [ ] **Code Snippets**: Expand examples in docs
  - More complex queries
  - Advanced filtering
  - Custom authentication
  - Report customization

### 21. Tooling

- [ ] **CLI Tool**: Add command-line tool for common tasks
  - Generate business objects from database schema
  - Create new authentication providers
  - Test database connections
  - Generate reports from CLI

- [ ] **Development Tools**:
  - Debug middleware for Express
  - Query builder UI (optional)
  - Schema inspector

- [ ] **IDE Support**:
  - Better TypeScript definitions
  - Code snippets for common patterns
  - Better autocomplete

## Monitoring & Observability

### 22. Metrics

- [ ] **Performance Metrics**: Collect and expose metrics
  - Query execution times
  - Connection pool stats
  - Cache hit rates
  - Report generation times

- [ ] **Health Checks**: Add health check endpoints
  - Database connectivity
  - ElasticSearch connectivity
  - Azure services availability

- [ ] **Distributed Tracing**: Add OpenTelemetry support
  - Trace requests across services
  - Identify bottlenecks
  - Monitor dependencies

### 23. Error Tracking

- [ ] **Error Reporting**: Integrate with error tracking services
  - Sentry, Rollbar, or similar
  - Capture and report unhandled errors
  - Group similar errors
  - Track error trends

## Backward Compatibility

### 24. Deprecation Process

- [ ] **Deprecation Warnings**: Add warnings for deprecated features
- [ ] **Deprecation Timeline**: Document when features will be removed
- [ ] **Migration Path**: Provide clear migration paths

## Security

### 25. Security Enhancements

- [ ] **Security Audit**: Conduct thorough security review
  - SQL injection vulnerabilities
  - Authentication bypass scenarios
  - XSS prevention in reports
  - CSRF protection in APIs

- [ ] **Input Sanitization**: Ensure all user input is sanitized
  - Already has some validation
  - Expand to cover all input points
  - Document sanitization approach

- [ ] **Secrets Management**: Improve secrets handling
  - Don't log sensitive data
  - Use secure credential storage
  - Rotate secrets regularly

- [ ] **Rate Limiting**: Add rate limiting support
  - Prevent abuse
  - Protect against DoS
  - Configurable limits

## Internationalization

### 26. i18n Support

- [ ] **Message Translation**: Support multiple languages
  - Error messages
  - Validation messages
  - Report labels

- [ ] **Date/Time Formatting**: Locale-aware formatting
  - Already uses dayjs
  - Add locale configuration
  - Document date/time handling

- [ ] **Number Formatting**: Locale-aware number formatting
  - Currency formatting
  - Decimal separators
  - Thousand separators

## Priority Matrix

### High Priority (Next Release)
1. Document ElasticSearch parameters
2. Document SQL JOIN functionality
3. Fix console.log usage (replace with logger)
4. Add comprehensive JSDoc type annotations
5. Improve error handling and propagation
6. Add unit tests for core functionality

### Medium Priority (Future Releases)
1. Report handler improvements (JSON/text)
2. Add TypeScript definitions
3. Improve validation framework
4. Add CLI tools
5. Performance optimizations
6. Add integration tests

### Low Priority (Long Term)
1. TypeScript migration
2. Plugin system
3. Additional report formats (PDF, HTML)
4. Distributed tracing
5. Advanced caching mechanisms

## Notes

- This TODO list is comprehensive and should be prioritized based on business needs
- Many improvements are optional and depend on use cases
- Maintain backward compatibility when possible
- Document all breaking changes
- Regular reviews and updates to this list recommended
