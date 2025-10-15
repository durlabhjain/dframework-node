# Batch Operations Guide

This guide provides examples and best practices for performing batch operations with DFramework.

## Batch INSERT Operations

### Pattern 1: Batch Insert with Multiple Individual Queries

```javascript
import { Sql, mssql } from '@durlabh/dframework';

const sql = new Sql();
await sql.setConfig({ /* config */ });

// Batch insert using multiple INSERT statements
async function batchInsertUsers(users) {
    const request = sql.createRequest();
    
    // Build batch query with multiple INSERT statements
    let batchQuery = '';
    users.forEach((user, index) => {
        const userPrefix = `user${index}`;
        request.input(`${userPrefix}Name`, mssql.VarChar, user.name);
        request.input(`${userPrefix}Email`, mssql.VarChar, user.email);
        request.input(`${userPrefix}Age`, mssql.Int, user.age);
        
        batchQuery += `
            INSERT INTO Users (Name, Email, Age) 
            VALUES (@${userPrefix}Name, @${userPrefix}Email, @${userPrefix}Age);
        `;
    });
    
    const result = await request.query(batchQuery);
    
    if (result.success) {
        console.log(`Inserted ${users.length} users successfully`);
    } else {
        console.error('Batch insert failed:', result.err);
    }
    
    return result;
}

// Usage
const users = [
    { name: 'John Doe', email: 'john@example.com', age: 30 },
    { name: 'Jane Smith', email: 'jane@example.com', age: 25 },
    { name: 'Bob Johnson', email: 'bob@example.com', age: 35 }
];

await batchInsertUsers(users);
```

### Pattern 2: Batch Insert with Table-Valued Parameters (TVP)

Table-Valued Parameters are the most efficient way to insert multiple rows in MSSQL.

**Step 1: Create the Table Type in SQL Server**

```sql
-- Create a user-defined table type
CREATE TYPE dbo.UserListType AS TABLE (
    Name NVARCHAR(100),
    Email NVARCHAR(255),
    Age INT
);
GO
```

**Step 2: Use TVP in Node.js**

```javascript
import { Sql, mssql } from '@durlabh/dframework';

const sql = new Sql();
await sql.setConfig({ /* config */ });

async function batchInsertUsersWithTVP(users) {
    const request = sql.createRequest();
    
    // Create table-valued parameter
    const table = new mssql.Table('dbo.UserListType');
    table.columns.add('Name', mssql.NVarChar(100));
    table.columns.add('Email', mssql.NVarChar(255));
    table.columns.add('Age', mssql.Int);
    
    // Add rows to the table
    users.forEach(user => {
        table.rows.add(user.name, user.email, user.age);
    });
    
    // Pass TVP as parameter
    request.input('UserList', table);
    
    const query = `
        INSERT INTO Users (Name, Email, Age)
        SELECT Name, Email, Age FROM @UserList
    `;
    
    const result = await request.query(query);
    
    if (result.success) {
        console.log(`Inserted ${users.length} users via TVP`);
    }
    
    return result;
}

// Usage
const users = [
    { name: 'John Doe', email: 'john@example.com', age: 30 },
    { name: 'Jane Smith', email: 'jane@example.com', age: 25 },
    { name: 'Bob Johnson', email: 'bob@example.com', age: 35 }
];

await batchInsertUsersWithTVP(users);
```

### Pattern 3: Batch Insert with Stored Procedure

**Step 1: Create Stored Procedure**

```sql
CREATE PROCEDURE dbo.BatchInsertUsers
    @UserList dbo.UserListType READONLY
AS
BEGIN
    SET NOCOUNT ON;
    
    INSERT INTO Users (Name, Email, Age)
    SELECT Name, Email, Age FROM @UserList;
    
    -- Return inserted count
    SELECT @@ROWCOUNT AS InsertedCount;
END
GO
```

**Step 2: Call from Node.js**

```javascript
async function batchInsertUsersWithStoredProc(users) {
    const request = sql.createRequest();
    
    // Create and populate table
    const table = new mssql.Table('dbo.UserListType');
    table.columns.add('Name', mssql.NVarChar(100));
    table.columns.add('Email', mssql.NVarChar(255));
    table.columns.add('Age', mssql.Int);
    
    users.forEach(user => {
        table.rows.add(user.name, user.email, user.age);
    });
    
    request.input('UserList', table);
    
    const result = await request.execute('dbo.BatchInsertUsers');
    
    if (result.success) {
        const insertedCount = result.recordset[0].InsertedCount;
        console.log(`Inserted ${insertedCount} users via stored procedure`);
    }
    
    return result;
}
```

## Batch UPDATE Operations

### Pattern 4: Batch Update with Multiple Statements

```javascript
async function batchUpdateUsers(updates) {
    const request = sql.createRequest();
    
    let batchQuery = '';
    updates.forEach((update, index) => {
        const prefix = `upd${index}`;
        request.input(`${prefix}Id`, mssql.Int, update.id);
        request.input(`${prefix}Name`, mssql.VarChar, update.name);
        request.input(`${prefix}Email`, mssql.VarChar, update.email);
        
        batchQuery += `
            UPDATE Users 
            SET Name = @${prefix}Name, Email = @${prefix}Email
            WHERE UserId = @${prefix}Id;
        `;
    });
    
    const result = await request.query(batchQuery);
    return result;
}

// Usage
const updates = [
    { id: 1, name: 'John Updated', email: 'john.new@example.com' },
    { id: 2, name: 'Jane Updated', email: 'jane.new@example.com' }
];

await batchUpdateUsers(updates);
```

### Pattern 5: Batch Update with MERGE Statement

```javascript
async function batchUpsertUsers(users) {
    const request = sql.createRequest();
    
    // Create TVP
    const table = new mssql.Table('dbo.UserListType');
    table.columns.add('Name', mssql.NVarChar(100));
    table.columns.add('Email', mssql.NVarChar(255));
    table.columns.add('Age', mssql.Int);
    
    users.forEach(user => {
        table.rows.add(user.name, user.email, user.age);
    });
    
    request.input('UserList', table);
    
    const query = `
        MERGE Users AS target
        USING @UserList AS source
        ON (target.Email = source.Email)
        WHEN MATCHED THEN
            UPDATE SET 
                Name = source.Name,
                Age = source.Age
        WHEN NOT MATCHED THEN
            INSERT (Name, Email, Age)
            VALUES (source.Name, source.Email, source.Age);
    `;
    
    const result = await request.query(query);
    return result;
}
```

## Batch DELETE Operations

### Pattern 6: Batch Delete with IN Clause

```javascript
async function batchDeleteUsers(userIds) {
    const request = sql.createRequest();
    
    // Use the framework's in() helper
    const { statement } = sql.in({
        request,
        fieldName: 'UserId',
        paramName: 'UserId',
        values: userIds,
        sqlType: mssql.Int
    });
    
    const query = `DELETE FROM Users WHERE ${statement}`;
    
    const result = await request.query(query);
    return result;
}

// Usage
await batchDeleteUsers([1, 2, 3, 4, 5]);
```

### Pattern 7: Batch Delete with TVP

```javascript
async function batchDeleteUsersWithTVP(userIds) {
    const request = sql.createRequest();
    
    // Create INT list TVP
    const table = new mssql.Table('dbo.IntList');
    table.columns.add('Value', mssql.Int);
    
    userIds.forEach(id => {
        table.rows.add(id);
    });
    
    request.input('UserIds', table);
    
    const query = `
        DELETE FROM Users 
        WHERE UserId IN (SELECT Value FROM @UserIds)
    `;
    
    const result = await request.query(query);
    return result;
}
```

## MySQL Batch Operations

### Pattern 8: MySQL Batch Insert

```javascript
import { MySql, mysql } from '@durlabh/dframework';

const mysqlDb = new MySql();
await mysqlDb.setConfig({ /* config */ });

async function batchInsertUsersMySql(users) {
    const request = mysqlDb.createRequest();
    
    // Build VALUES clause
    let query = 'INSERT INTO Users (Name, Email, Age) VALUES ';
    const valueClauses = [];
    
    users.forEach((user, index) => {
        const prefix = `user${index}`;
        request.input(`${prefix}Name`, mysql.Types.VARCHAR, user.name);
        request.input(`${prefix}Email`, mysql.Types.VARCHAR, user.email);
        request.input(`${prefix}Age`, mysql.Types.INT24, user.age);
        
        valueClauses.push(`(:${prefix}Name, :${prefix}Email, :${prefix}Age)`);
    });
    
    query += valueClauses.join(', ');
    
    const result = await request.query(query);
    return result;
}
```

### Pattern 9: MySQL Batch Insert (Simplified)

```javascript
async function batchInsertUsersMySqlSimple(users) {
    const values = users.map(u => [u.name, u.email, u.age]);
    
    const query = 'INSERT INTO Users (Name, Email, Age) VALUES ?';
    
    // Note: This uses raw mysql2 API
    const [result] = await mysqlDb.pool.query(query, [values]);
    
    return {
        success: true,
        data: result,
        insertedCount: result.affectedRows
    };
}
```

## Performance Optimization

### Chunking Large Batches

When dealing with very large datasets, process in chunks:

```javascript
async function batchInsertInChunks(allUsers, chunkSize = 1000) {
    const chunks = [];
    
    // Split into chunks
    for (let i = 0; i < allUsers.length; i += chunkSize) {
        chunks.push(allUsers.slice(i, i + chunkSize));
    }
    
    console.log(`Processing ${chunks.length} chunks of ${chunkSize} records each`);
    
    let totalInserted = 0;
    
    // Process each chunk
    for (let i = 0; i < chunks.length; i++) {
        console.log(`Processing chunk ${i + 1}/${chunks.length}`);
        
        const result = await batchInsertUsersWithTVP(chunks[i]);
        
        if (result.success) {
            totalInserted += chunks[i].length;
        } else {
            console.error(`Chunk ${i + 1} failed:`, result.err);
            // Decide whether to continue or abort
        }
        
        // Optional: Add delay between chunks to avoid overwhelming the database
        if (i < chunks.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }
    
    console.log(`Total inserted: ${totalInserted} records`);
    return totalInserted;
}

// Usage with 10,000 records
const largeUserList = generateUsers(10000);
await batchInsertInChunks(largeUserList, 1000);
```

### Transaction-Based Batch Operations

```javascript
import { mssql } from '@durlabh/dframework';

async function batchInsertWithTransaction(users) {
    const transaction = new mssql.Transaction(sql.pool);
    
    try {
        await transaction.begin();
        
        const request = new mssql.Request(transaction);
        
        // Create TVP
        const table = new mssql.Table('dbo.UserListType');
        table.columns.add('Name', mssql.NVarChar(100));
        table.columns.add('Email', mssql.NVarChar(255));
        table.columns.add('Age', mssql.Int);
        
        users.forEach(user => {
            table.rows.add(user.name, user.email, user.age);
        });
        
        request.input('UserList', table);
        
        await request.query(`
            INSERT INTO Users (Name, Email, Age)
            SELECT Name, Email, Age FROM @UserList
        `);
        
        // Commit transaction
        await transaction.commit();
        
        return { success: true, insertedCount: users.length };
    } catch (err) {
        // Rollback on error
        await transaction.rollback();
        
        console.error('Batch insert failed, rolled back:', err);
        return { success: false, err };
    }
}
```

### Parallel Batch Processing

```javascript
async function parallelBatchInsert(allUsers, chunkSize = 1000, maxParallel = 3) {
    const chunks = [];
    
    for (let i = 0; i < allUsers.length; i += chunkSize) {
        chunks.push(allUsers.slice(i, i + chunkSize));
    }
    
    const results = [];
    
    // Process chunks in parallel batches
    for (let i = 0; i < chunks.length; i += maxParallel) {
        const batch = chunks.slice(i, i + maxParallel);
        
        console.log(`Processing parallel batch ${Math.floor(i / maxParallel) + 1}`);
        
        const batchResults = await Promise.all(
            batch.map(chunk => batchInsertUsersWithTVP(chunk))
        );
        
        results.push(...batchResults);
    }
    
    const successCount = results.filter(r => r.success).length;
    console.log(`Successfully inserted ${successCount}/${chunks.length} chunks`);
    
    return results;
}
```

## Best Practices

### 1. Choose the Right Method

- **Small batches (< 100 records)**: Multiple INSERT statements
- **Medium batches (100-10,000 records)**: Table-Valued Parameters
- **Large batches (> 10,000 records)**: TVP with chunking
- **Very large batches (> 100,000 records)**: Bulk insert utilities or SSIS

### 2. Use Transactions for Data Integrity

Always wrap batch operations in transactions when:
- Data consistency is critical
- Operations are interdependent
- You need all-or-nothing behavior

### 3. Monitor Memory Usage

```javascript
async function batchInsertWithMemoryMonitoring(users, chunkSize = 1000) {
    const chunks = [];
    
    for (let i = 0; i < users.length; i += chunkSize) {
        chunks.push(users.slice(i, i + chunkSize));
    }
    
    for (const [index, chunk] of chunks.entries()) {
        const memBefore = process.memoryUsage().heapUsed / 1024 / 1024;
        
        await batchInsertUsersWithTVP(chunk);
        
        const memAfter = process.memoryUsage().heapUsed / 1024 / 1024;
        console.log(`Chunk ${index + 1}: Memory delta: ${(memAfter - memBefore).toFixed(2)} MB`);
        
        // Force garbage collection if available
        if (global.gc && index % 10 === 0) {
            global.gc();
        }
    }
}
```

### 4. Error Handling and Retry Logic

```javascript
async function batchInsertWithRetry(users, maxRetries = 3) {
    let attempt = 0;
    
    while (attempt < maxRetries) {
        try {
            const result = await batchInsertUsersWithTVP(users);
            
            if (result.success) {
                return result;
            }
            
            // If not successful, throw to trigger retry
            throw new Error(result.err);
        } catch (err) {
            attempt++;
            
            if (attempt >= maxRetries) {
                console.error(`Batch insert failed after ${maxRetries} attempts:`, err);
                return { success: false, err };
            }
            
            console.warn(`Attempt ${attempt} failed, retrying...`);
            
            // Exponential backoff
            await new Promise(resolve => 
                setTimeout(resolve, Math.pow(2, attempt) * 1000)
            );
        }
    }
}
```

### 5. Performance Benchmarking

```javascript
async function benchmarkBatchMethods(users) {
    console.log(`Benchmarking with ${users.length} users\n`);
    
    // Method 1: Multiple INSERTs
    console.time('Multiple INSERTs');
    await batchInsertUsers(users);
    console.timeEnd('Multiple INSERTs');
    
    // Clear data
    await sql.query('DELETE FROM Users');
    
    // Method 2: TVP
    console.time('Table-Valued Parameter');
    await batchInsertUsersWithTVP(users);
    console.timeEnd('Table-Valued Parameter');
    
    // Clear data
    await sql.query('DELETE FROM Users');
    
    // Method 3: Stored Procedure with TVP
    console.time('Stored Procedure + TVP');
    await batchInsertUsersWithStoredProc(users);
    console.timeEnd('Stored Procedure + TVP');
}

// Results typically show:
// Multiple INSERTs: ~2000ms for 1000 records
// TVP: ~500ms for 1000 records
// Stored Proc + TVP: ~400ms for 1000 records
```

## Common Pitfalls to Avoid

1. **Don't exceed parameter limits**: SQL Server has a 2100 parameter limit
2. **Avoid N+1 queries**: Use batch operations instead of loops
3. **Don't ignore transactions**: Use transactions for data consistency
4. **Avoid loading all data in memory**: Use chunking for large datasets
5. **Don't forget error handling**: Always check result.success flag
6. **Monitor database locks**: Batch operations can cause table locks
7. **Test with production-like data**: Performance varies with data size

## Summary

- Use **Table-Valued Parameters** for best performance with MSSQL
- **Chunk large batches** to avoid memory issues
- **Wrap in transactions** for data integrity
- **Implement retry logic** for resilience
- **Monitor and benchmark** to optimize performance
