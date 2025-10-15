# API Reference

Comprehensive reference for DFramework API features, focusing on business objects, filtering, and advanced features.

## Table of Contents

1. [Business Object Relations](#business-object-relations)
2. [Filter Comparison Operators](#filter-comparison-operators)
3. [Multi-Select Columns](#multi-select-columns)

## Business Object Relations

DFramework supports defining relationships between business objects to automatically load and manage related data.

### Relationship Types

#### OneToMany Relationships

A OneToMany relationship represents a parent record that has multiple child records.

**Basic Example:**

```javascript
import { BusinessBase } from '@durlabh/dframework';

class CustomerBusiness extends BusinessBase {
    tableName = 'Customers';
    keyField = 'CustomerId';
    
    // Define relationships
    relations = [
        {
            relation: 'Order',           // Relationship name (will be pluralized to "Orders")
            type: 'OneToMany',           // Relationship type
            foreignTable: 'OrderBusiness', // Business object class name for the related entity
            table: 'Orders',             // Database table name (optional, defaults to relation name)
            field: 'OrderId'             // Foreign key field (optional, defaults to keyField of foreignTable)
        }
    ];
}

// Load customer with orders
const customerBusiness = new CustomerBusiness();
const customer = await customerBusiness.load({ id: 1 });

console.log(customer);
// {
//   CustomerId: 1,
//   CustomerName: 'ACME Corp',
//   Orders: '101,102,103'  // Comma-separated list of OrderIds
// }
```

**Advanced OneToMany with Filtering:**

```javascript
class ProductBusiness extends BusinessBase {
    tableName = 'Products';
    keyField = 'ProductId';
    
    relations = [
        {
            relation: 'Review',
            type: 'OneToMany',
            foreignTable: 'ReviewBusiness',
            table: 'ProductReviews',
            field: 'ReviewId',
            // Add WHERE clause conditions to the relationship query
            where: {
                IsApproved: { value: true, operator: '=' },
                Rating: { value: 3, operator: '>=' }
            }
        }
    ];
}

// Load product with only approved reviews rated 3+ stars
const product = await productBusiness.load({ id: 1 });
console.log(product.Reviews); // Only includes approved, high-rated review IDs
```

**Multiple OneToMany Relationships:**

```javascript
class OrderBusiness extends BusinessBase {
    tableName = 'Orders';
    keyField = 'OrderId';
    
    relations = [
        {
            relation: 'OrderItem',
            type: 'OneToMany',
            foreignTable: 'OrderItemBusiness',
            table: 'OrderItems',
            field: 'OrderItemId'
        },
        {
            relation: 'Payment',
            type: 'OneToMany',
            foreignTable: 'PaymentBusiness',
            table: 'Payments',
            field: 'PaymentId'
        },
        {
            relation: 'Shipment',
            type: 'OneToMany',
            foreignTable: 'ShipmentBusiness',
            table: 'Shipments',
            field: 'ShipmentId'
        }
    ];
}

const order = await orderBusiness.load({ id: 100 });
console.log({
    orderId: order.OrderId,
    items: order.OrderItems,      // '1,2,3'
    payments: order.Payments,     // '10,11'
    shipments: order.Shipments    // '20'
});
```

#### OneToOne Relationships

A OneToOne relationship represents a parent record that has exactly one related child record.

**Basic Example:**

```javascript
class UserBusiness extends BusinessBase {
    tableName = 'Users';
    keyField = 'UserId';
    
    relations = [
        {
            relation: 'UserProfile',
            type: 'OneToOne',
            foreignTable: 'UserProfileBusiness',
            table: 'UserProfiles',
            // Specify columns to include in list queries
            listColumns: ['Bio', 'AvatarUrl', 'Location']
        }
    ];
}

// When listing users, the profile columns are joined
const users = await userBusiness.list({ start: 0, limit: 10 });
console.log(users.data[0]);
// {
//   UserId: 1,
//   Username: 'john_doe',
//   Bio: 'Software developer',        // From UserProfiles
//   AvatarUrl: 'https://...',         // From UserProfiles
//   Location: 'New York'              // From UserProfiles
// }
```

**OneToOne with Count:**

```javascript
class CustomerBusiness extends BusinessBase {
    tableName = 'Customers';
    keyField = 'CustomerId';
    
    relations = [
        {
            relation: 'Order',
            type: 'OneToMany',
            foreignTable: 'OrderBusiness',
            countInList: true  // Include count of orders in list queries
        }
    ];
}

const customers = await customerBusiness.list({ start: 0, limit: 10 });
console.log(customers.data[0]);
// {
//   CustomerId: 1,
//   CustomerName: 'ACME Corp',
//   OrderCount: 25  // Count of related orders
// }
```

### Saving Related Data

When saving a record with relationships, you can update the related records:

```javascript
// Save customer with updated order relationships
await customerBusiness.save({
    id: 1,
    CustomerName: 'ACME Corp Updated',
    Orders: '101,102,104,105',  // Update order relationships
    relations: true              // Enable relationship updates
});

// The framework will:
// 1. Remove OrderId 103 from the relationship
// 2. Add OrderIds 104 and 105 to the relationship
// 3. Keep OrderIds 101 and 102 unchanged
```

### Disabling Relationship Loading

You can disable relationship loading when it's not needed:

```javascript
// Load without relationships for better performance
const customer = await customerBusiness.load({ 
    id: 1, 
    relations: false 
});

// customer.Orders will be undefined
```

### Advanced Relationship Scenarios

**Scenario 1: Conditional Relationships**

```javascript
class InvoiceBusiness extends BusinessBase {
    tableName = 'Invoices';
    keyField = 'InvoiceId';
    
    relations = [
        {
            relation: 'Payment',
            type: 'OneToMany',
            foreignTable: 'PaymentBusiness',
            where: {
                Status: { value: 'completed', operator: '=' },
                Amount: { value: 0, operator: '>' }
            }
        }
    ];
}
```

**Scenario 2: Custom Relationship Queries**

```javascript
class ProjectBusiness extends BusinessBase {
    tableName = 'Projects';
    keyField = 'ProjectId';
    
    relations = [
        {
            relation: 'Task',
            type: 'OneToMany',
            foreignTable: 'TaskBusiness',
            where: {
                CompletedDate: { value: null, operator: 'IS' }  // Only incomplete tasks
            }
        }
    ];
    
    getRelationAdditionalQuery({ sql, request, relationWhere }) {
        // Custom logic to modify relationship query
        if (relationWhere) {
            return sql.addParameters({ 
                query: '', 
                request, 
                parameters: relationWhere, 
                forWhere: true 
            });
        }
        return '';
    }
}
```

## Filter Comparison Operators

Complete reference for all available filter comparison operators in ListParameters and business object queries.

### String Operators

#### contains
Searches for values containing the specified substring (case-insensitive).

```javascript
const params = new ListParameters({
    filters: [
        { field: 'name', value: 'john', comparison: 'contains' }
    ]
});
// SQL: WHERE name LIKE '%john%'
```

#### startsWith
Searches for values that start with the specified string.

```javascript
{ field: 'email', value: 'admin', comparison: 'startsWith' }
// SQL: WHERE email LIKE 'admin%'
```

#### endsWith
Searches for values that end with the specified string.

```javascript
{ field: 'email', value: '@company.com', comparison: 'endsWith' }
// SQL: WHERE email LIKE '%@company.com'
```

#### notContains
Searches for values that do NOT contain the specified substring.

```javascript
{ field: 'description', value: 'draft', comparison: 'notContains' }
// SQL: WHERE description NOT LIKE '%draft%'
```

### Equality Operators

#### = (equals)
Exact match comparison.

```javascript
{ field: 'status', value: 'active', comparison: '=' }
// SQL: WHERE status = 'active'
```

**Aliases:** `equals`

#### != (not equals)
Excludes exact matches.

```javascript
{ field: 'status', value: 'deleted', comparison: '!=' }
// SQL: WHERE status != 'deleted'
```

**Aliases:** `notEquals`

### Numeric Comparison Operators

#### > (greater than)
Values greater than the specified number.

```javascript
{ field: 'price', value: 100, comparison: '>' }
// SQL: WHERE price > 100
```

**Aliases:** `greaterThan`, `isAfter` (for dates)

#### < (less than)
Values less than the specified number.

```javascript
{ field: 'stock', value: 10, comparison: '<' }
// SQL: WHERE stock < 10
```

**Aliases:** `lessThan`, `isBefore` (for dates)

#### >= (greater than or equal)
Values greater than or equal to the specified number.

```javascript
{ field: 'age', value: 18, comparison: '>=' }
// SQL: WHERE age >= 18
```

**Aliases:** `greaterThanOrEqual`, `isOnOrAfter`

#### <= (less than or equal)
Values less than or equal to the specified number.

```javascript
{ field: 'discount', value: 50, comparison: '<=' }
// SQL: WHERE discount <= 50
```

**Aliases:** `lessThanOrEqual`, `isOnOrBefore`

### Date/Time Operators

#### is (date range)
For date fields, creates a BETWEEN clause for the entire day.

```javascript
{ field: 'createdDate', value: '2024-01-15', comparison: 'is', type: 'date' }
// SQL: WHERE createdDate BETWEEN '2024-01-15 00:00:00' AND '2024-01-15 23:59:59'
```

#### not (date exclusion)
Excludes the specified date range.

```javascript
{ field: 'updatedDate', value: '2024-01-15', comparison: 'not', type: 'date' }
// SQL: WHERE updatedDate NOT BETWEEN '2024-01-15 00:00:00' AND '2024-01-15 23:59:59'
```

#### onOrAfter
Values on or after the specified date (includes the entire start date).

```javascript
{ field: 'startDate', value: '2024-01-01', comparison: 'onOrAfter' }
// SQL: WHERE startDate >= '2024-01-01 00:00:00'
```

#### onOrBefore
Values on or before the specified date (includes the entire end date).

```javascript
{ field: 'endDate', value: '2024-12-31', comparison: 'onOrBefore' }
// SQL: WHERE endDate <= '2024-12-31 23:59:59'
```

#### after
Values after the specified date (excludes the date itself).

```javascript
{ field: 'publishDate', value: '2024-01-15', comparison: 'after' }
// SQL: WHERE publishDate > '2024-01-15 23:59:59'
```

#### before
Values before the specified date (excludes the date itself).

```javascript
{ field: 'expiryDate', value: '2024-12-31', comparison: 'before' }
// SQL: WHERE expiryDate < '2024-12-31 00:00:00'
```

#### isToday
Matches records from today.

```javascript
{ field: 'loginDate', value: null, comparison: 'isToday' }
// SQL: WHERE loginDate = CAST(GETDATE() AS DATE)
```

#### isYesterday
Matches records from yesterday.

```javascript
{ field: 'reportDate', value: null, comparison: 'isYesterday' }
// SQL: WHERE reportDate = CAST(DATEADD(day, -1, GETDATE()) AS DATE)
```

#### isTomorrow
Matches records from tomorrow.

```javascript
{ field: 'scheduledDate', value: null, comparison: 'isTomorrow' }
// SQL: WHERE scheduledDate = CAST(DATEADD(day, 1, GETDATE()) AS DATE)
```

### Null Operators

#### isEmpty
Checks if value is NULL or empty.

```javascript
{ field: 'deletedDate', value: null, comparison: 'isEmpty' }
// SQL: WHERE deletedDate IS NULL
```

**Aliases:** `isBlank`

#### isNotEmpty
Checks if value is NOT NULL and not empty.

```javascript
{ field: 'email', value: null, comparison: 'isNotEmpty' }
// SQL: WHERE email IS NOT NULL
```

**Aliases:** `isNotBlank`

### Multi-Value Operators

#### isAnyOf
Matches if the value is in the specified list (IN clause).

```javascript
{ field: 'category', value: ['Electronics', 'Computers', 'Phones'], comparison: 'isAnyOf' }
// SQL: WHERE category IN ('Electronics', 'Computers', 'Phones')
```

### Boolean Operators

#### isTrue
Matches true/1 values.

```javascript
{ field: 'isActive', value: null, comparison: 'isTrue' }
// SQL: WHERE isActive = 1
```

#### isFalse
Matches false/0 values.

```javascript
{ field: 'isArchived', value: null, comparison: 'isFalse' }
// SQL: WHERE isArchived = 0
```

### Complete Filter Examples

**Example 1: Complex Product Filter**

```javascript
const params = new ListParameters({
    start: 0,
    limit: 50,
    sort: 'createdDate',
    dir: 'desc',
    filters: [
        // String filters
        { field: 'name', value: 'laptop', comparison: 'contains' },
        { field: 'sku', value: 'PROD-', comparison: 'startsWith' },
        
        // Numeric filters
        { field: 'price', value: 500, comparison: '>=' },
        { field: 'price', value: 2000, comparison: '<=' },
        { field: 'stock', value: 0, comparison: '>' },
        
        // Category filter
        { field: 'category', value: ['Electronics', 'Computers'], comparison: 'isAnyOf' },
        
        // Boolean filters
        { field: 'isActive', value: null, comparison: 'isTrue' },
        { field: 'isDiscontinued', value: null, comparison: 'isFalse' },
        
        // Date filters
        { field: 'createdDate', value: '2024-01-01', comparison: 'onOrAfter' },
        
        // Null checks
        { field: 'deletedDate', value: null, comparison: 'isEmpty' }
    ]
});

const products = await productBusiness.list(params);
```

**Example 2: Customer Search with Various Operators**

```javascript
const searchParams = new ListParameters({
    filters: [
        // Email must not be empty
        { field: 'email', value: null, comparison: 'isNotEmpty' },
        
        // Email must be from company domain
        { field: 'email', value: '@company.com', comparison: 'endsWith' },
        
        // Account created in last 30 days
        { field: 'createdDate', value: '2024-01-01', comparison: 'onOrAfter' },
        
        // Has made purchases
        { field: 'totalPurchases', value: 0, comparison: '>' },
        
        // Not in blocked countries
        { field: 'country', value: 'BlockedCountry', comparison: '!=' },
        
        // Active account
        { field: 'status', value: 'active', comparison: '=' }
    ]
});
```

## Multi-Select Columns

Multi-select columns allow you to store and manage multiple related values in a comma-separated format, with automatic handling of the relationship table.

### Basic Configuration

```javascript
class ManufacturerBusiness extends BusinessBase {
    tableName = 'Manufacturer';
    keyField = 'ManufacturerId';
    
    multiSelectColumns = {
        // Simple configuration - uses defaults
        "Alias": {}
        // Defaults to:
        // - table: 'ManufacturerAlias'
        // - column: 'Alias'
        // - type: 'string'
    };
}

// Loading
const manufacturer = await manufacturerBusiness.load({ id: 1 });
console.log(manufacturer.Alias); // "ACME, ACMECorp, ACME Inc"

// Saving
await manufacturerBusiness.save({
    id: 1,
    Name: 'ACME Corporation',
    Alias: 'ACME, ACMECorp, ACME Inc, ACME Co'
});
// Automatically updates the ManufacturerAlias table
```

### Custom Configuration

```javascript
class ProductBusiness extends BusinessBase {
    tableName = 'Products';
    keyField = 'ProductId';
    
    multiSelectColumns = {
        // Custom table and column names
        "Tags": {
            table: 'ProductTags',      // Custom table name
            column: 'TagName',          // Custom column name
            type: 'string'              // Data type
        },
        
        // Numeric multi-select
        "Categories": {
            table: 'ProductCategories',
            column: 'CategoryId',
            type: 'number'
        },
        
        // Multiple multi-select columns
        "Features": {
            table: 'ProductFeatures',
            column: 'FeatureName',
            type: 'string'
        }
    };
}

// Loading returns comma-separated values
const product = await productBusiness.load({ id: 100 });
console.log({
    tags: product.Tags,           // "new, featured, sale"
    categories: product.Categories, // "1, 5, 12"
    features: product.Features     // "waterproof, wireless, rechargeable"
});

// Saving updates all relationship tables
await productBusiness.save({
    id: 100,
    Name: 'Premium Wireless Speaker',
    Tags: 'new, featured, premium, wireless',
    Categories: '1, 5, 12, 15',
    Features: 'waterproof, wireless, rechargeable, portable'
});
```

### Real-World Example: User Permissions

```javascript
class UserBusiness extends BusinessBase {
    tableName = 'Users';
    keyField = 'UserId';
    
    multiSelectColumns = {
        "Roles": {
            table: 'UserRoles',
            column: 'RoleId',
            type: 'number'
        },
        "Permissions": {
            table: 'UserPermissions',
            column: 'PermissionId',
            type: 'number'
        },
        "Groups": {
            table: 'UserGroups',
            column: 'GroupId',
            type: 'number'
        }
    };
}

// Create user with multiple roles, permissions, and groups
await userBusiness.save({
    Username: 'john.doe',
    Email: 'john@example.com',
    Roles: '1, 2, 5',           // Admin, Manager, Editor
    Permissions: '10, 20, 30, 40, 50',
    Groups: '100, 200'
});

// Load user with all relationships
const user = await userBusiness.load({ id: 1 });
console.log({
    username: user.Username,
    roles: user.Roles.split(',').map(r => parseInt(r.trim())),
    permissions: user.Permissions.split(',').map(p => parseInt(p.trim())),
    groups: user.Groups.split(',').map(g => parseInt(g.trim()))
});
```

### Real-World Example: Product Variants

```javascript
class ProductBusiness extends BusinessBase {
    tableName = 'Products';
    keyField = 'ProductId';
    
    multiSelectColumns = {
        "Sizes": {
            table: 'ProductSizes',
            column: 'Size',
            type: 'string'
        },
        "Colors": {
            table: 'ProductColors',
            column: 'Color',
            type: 'string'
        },
        "Materials": {
            table: 'ProductMaterials',
            column: 'Material',
            type: 'string'
        }
    };
}

// Create product with multiple variants
await productBusiness.save({
    Name: 'Premium T-Shirt',
    Price: 29.99,
    Sizes: 'XS, S, M, L, XL, XXL',
    Colors: 'Black, White, Navy, Gray, Red',
    Materials: 'Cotton, Polyester Blend'
});
```

### Database Schema for Multi-Select Columns

When using multi-select columns, ensure your database has the appropriate relationship tables:

```sql
-- Main table
CREATE TABLE Manufacturer (
    ManufacturerId INT PRIMARY KEY,
    Name NVARCHAR(255),
    IsDeleted BIT DEFAULT 0
);

-- Multi-select relationship table
CREATE TABLE ManufacturerAlias (
    ManufacturerId INT,
    Alias NVARCHAR(100),
    IsDeleted BIT DEFAULT 0,
    FOREIGN KEY (ManufacturerId) REFERENCES Manufacturer(ManufacturerId)
);

-- For numeric multi-select
CREATE TABLE ProductCategories (
    ProductId INT,
    CategoryId INT,
    IsDeleted BIT DEFAULT 0,
    FOREIGN KEY (ProductId) REFERENCES Products(ProductId),
    FOREIGN KEY (CategoryId) REFERENCES Categories(CategoryId)
);
```

### Best Practices

1. **Use Appropriate Data Types**: Choose 'string' for text values, 'number' for IDs
2. **Consistent Naming**: Follow naming conventions for relationship tables
3. **Include IsDeleted**: Support soft delete in relationship tables
4. **Validate Input**: Ensure comma-separated values are properly formatted
5. **Performance**: For large datasets, consider pagination and indexing on relationship tables

### Limitations

- Multi-select columns are stored as comma-separated strings in the loaded object
- For complex queries on multi-select values, consider using separate list methods
- Soft delete support requires IsDeleted column in relationship tables
- The framework handles basic CRUD operations; complex operations may require custom methods

## Summary

This API reference covers:

- **Business Object Relations**: OneToMany and OneToOne relationships with filtering and conditional loading
- **Filter Comparison Operators**: Complete list of 30+ operators for strings, numbers, dates, nulls, and multi-value filtering
- **Multi-Select Columns**: Configuration and usage for managing many-to-many relationships with comma-separated values

For more examples and patterns, see:
- [USAGE_PATTERNS.md](USAGE_PATTERNS.md)
- [README.md](../README.md)
