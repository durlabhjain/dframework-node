# ElasticSearch Query Guide

This guide provides comprehensive examples for querying ElasticSearch using both SQL and Search APIs with DFramework.

## Table of Contents

1. [SQL Queries (_sql API)](#sql-queries-_sql-api)
2. [Search Queries (_search API)](#search-queries-_search-api)
3. [Pagination](#pagination)
4. [Memory Optimization](#memory-optimization)
5. [Best Practices](#best-practices)

## SQL Queries (_sql API)

### Basic SQL Query

```javascript
import { Framework } from '@durlabh/dframework';

const framework = new Framework({ logger });

await framework.setElastic({
    environment: 'Production'  // Reads from environments/Production.esenv
});

// Simple SQL query
const results = await framework.elastic.sqlQuery({
    indexName: 'products',
    select: ['name', 'category', 'price', 'stock'],
    where: [
        { field: 'status', value: 'active', operator: '=' },
        { field: 'price', value: 100, operator: '>' }
    ],
    limit: 100
});

console.log(results); // Array of product objects
```

### SQL Query with Aggregations

```javascript
const salesByRegion = await framework.elastic.sqlQuery({
    indexName: 'sales',
    select: [],
    aggregates: [
        'SUM(amount) AS total_sales',
        'AVG(amount) AS avg_order',
        'COUNT(*) AS order_count'
    ],
    groupBy: ['region', 'product_category'],
    where: [
        { field: 'order_date', value: '2024-01-01', operator: '>=' },
        { field: 'status', value: 'completed', operator: '=' }
    ],
    sort: [['total_sales', 'DESC']],
    limit: 50
});
```

### SQL Query with All Options

```javascript
const comprehensiveQuery = await framework.elastic.sqlQuery({
    indexName: 'orders',
    
    // Select specific fields
    select: ['order_id', 'customer_name', 'order_date'],
    
    // Aggregations
    aggregates: [
        'SUM(total_amount) AS revenue',
        'COUNT(*) AS total_orders'
    ],
    
    // Group by
    groupBy: ['customer_id', 'region'],
    
    // WHERE conditions
    where: [
        { field: 'order_date', value: '2024-01-01', operator: '>=' },
        { field: 'order_date', value: '2024-12-31', operator: '<=' },
        { field: 'status', value: 'pending', operator: '!=' }
    ],
    
    // Sorting
    sort: [
        ['revenue', 'DESC'],
        ['total_orders', 'DESC']
    ],
    
    // Pagination
    limit: 100,
    offset: 0,
    
    // Processing options
    returnAll: true,              // Return all results at once
    translateSqlRows: true        // Convert to key-value format
});
```

### SQL Query with Callback Processing

For large result sets, use callback to process data incrementally:

```javascript
const processedData = [];

await framework.elastic.sqlQuery({
    indexName: 'large_dataset',
    select: ['*'],
    where: [],
    returnAll: false,  // Don't return all at once
    callback: function({ rows }) {
        // Process each batch of rows
        rows.forEach(row => {
            // Transform or filter data
            if (row.amount > 1000) {
                processedData.push({
                    id: row.id,
                    amount: row.amount,
                    processed: true
                });
            }
        });
        
        console.log(`Processed ${rows.length} rows, total so far: ${processedData.length}`);
    }
});

console.log(`Total processed records: ${processedData.length}`);
```

## Search Queries (_search API)

The Search API provides more flexibility and advanced features compared to SQL.

### Basic Search Query

```javascript
const results = await framework.elastic.requestAdapter.getJson({
    method: 'POST',
    url: `${framework.elastic.baseUrl}/products/_search`,
    body: {
        query: {
            match: {
                name: 'laptop'
            }
        },
        size: 20
    }
});

const products = results.hits.hits.map(hit => hit._source);
```

### Search with Bool Query

```javascript
const results = await framework.elastic.requestAdapter.getJson({
    method: 'POST',
    url: `${framework.elastic.baseUrl}/products/_search`,
    body: {
        query: {
            bool: {
                must: [
                    { match: { category: 'electronics' } },
                    { range: { price: { gte: 500, lte: 2000 } } }
                ],
                must_not: [
                    { term: { status: 'discontinued' } }
                ],
                should: [
                    { term: { brand: 'Apple' } },
                    { term: { brand: 'Samsung' } }
                ],
                minimum_should_match: 1
            }
        },
        size: 100,
        from: 0
    }
});
```

### Search with Aggregations

```javascript
const results = await framework.elastic.requestAdapter.getJson({
    method: 'POST',
    url: `${framework.elastic.baseUrl}/sales/_search`,
    body: {
        size: 0,  // Don't return documents, only aggregations
        aggs: {
            sales_by_region: {
                terms: {
                    field: 'region.keyword',
                    size: 50
                },
                aggs: {
                    total_revenue: {
                        sum: { field: 'amount' }
                    },
                    avg_order: {
                        avg: { field: 'amount' }
                    }
                }
            },
            date_histogram: {
                date_histogram: {
                    field: 'order_date',
                    calendar_interval: 'month'
                },
                aggs: {
                    monthly_revenue: {
                        sum: { field: 'amount' }
                    }
                }
            }
        }
    }
});

// Extract aggregation results
const salesByRegion = results.aggregations.sales_by_region.buckets;
const monthlyData = results.aggregations.date_histogram.buckets;
```

### Using Framework's Aggregate Method

DFramework provides a convenient `aggregate()` method:

```javascript
const results = await framework.elastic.aggregate({
    query: {
        index: 'sales',
        body: {
            aggs: {
                by_category: {
                    terms: {
                        field: 'category.keyword',
                        size: 20
                    },
                    aggs: {
                        total_sales: {
                            sum: { field: 'amount' }
                        }
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
                "TotalSales": "total_sales.value",
                "Count": "doc_count"
            }
        }
    }
});

console.log(results.Categories);
// [
//   { CategoryName: 'Electronics', TotalSales: 50000, Count: 125 },
//   { CategoryName: 'Clothing', TotalSales: 30000, Count: 200 },
//   ...
// ]
```

### Customize Query Function

```javascript
class SalesReport {
    constructor() {
        this.startDate = '2024-01-01';
        this.endDate = '2024-12-31';
    }
    
    customizeQuery(query) {
        // Add date range filter
        query.body.query = {
            range: {
                order_date: {
                    gte: this.startDate,
                    lte: this.endDate
                }
            }
        };
        return query;
    }
    
    async generate(framework) {
        return await framework.elastic.aggregate({
            query: {
                index: 'sales',
                body: {
                    aggs: {
                        by_product: {
                            terms: { field: 'product_id' }
                        }
                    }
                }
            },
            customize: this.customizeQuery.bind(this),
            mappings: {
                "Products": {
                    root: "by_product.buckets",
                    map: {
                        "ProductId": "key",
                        "Sales": "doc_count"
                    }
                }
            }
        });
    }
}
```

## Pagination

### SQL-Based Pagination

```javascript
async function paginatedSqlQuery(indexName, pageSize = 100) {
    let offset = 0;
    let hasMore = true;
    const allResults = [];
    
    while (hasMore) {
        console.log(`Fetching page at offset ${offset}`);
        
        const results = await framework.elastic.sqlQuery({
            indexName,
            select: ['*'],
            where: [],
            limit: pageSize,
            offset: offset,
            returnAll: true
        });
        
        if (results.length > 0) {
            allResults.push(...results);
            offset += pageSize;
            
            // Check if we got fewer results than requested
            hasMore = results.length === pageSize;
        } else {
            hasMore = false;
        }
        
        console.log(`Fetched ${results.length} records, total: ${allResults.length}`);
    }
    
    return allResults;
}

// Usage
const allProducts = await paginatedSqlQuery('products', 1000);
```

### Search API Pagination (Point in Time)

```javascript
async function paginatedSearchWithPIT(indexName, pageSize = 1000) {
    // Step 1: Open a Point in Time
    const pitResponse = await framework.elastic.requestAdapter.getJson({
        method: 'POST',
        url: `${framework.elastic.baseUrl}/${indexName}/_pit?keep_alive=5m`
    });
    
    const pitId = pitResponse.id;
    const allResults = [];
    let searchAfter = null;
    
    try {
        while (true) {
            const body = {
                size: pageSize,
                query: { match_all: {} },
                pit: {
                    id: pitId,
                    keep_alive: '5m'
                },
                sort: [{ _shard_doc: 'asc' }]
            };
            
            if (searchAfter) {
                body.search_after = searchAfter;
            }
            
            const results = await framework.elastic.requestAdapter.getJson({
                method: 'POST',
                url: `${framework.elastic.baseUrl}/_search`,
                body
            });
            
            const hits = results.hits.hits;
            
            if (hits.length === 0) {
                break;
            }
            
            allResults.push(...hits.map(hit => hit._source));
            
            // Get the sort values from the last hit for next iteration
            searchAfter = hits[hits.length - 1].sort;
            
            console.log(`Fetched ${hits.length} records, total: ${allResults.length}`);
        }
    } finally {
        // Step 3: Close the Point in Time
        await framework.elastic.requestAdapter.getJson({
            method: 'DELETE',
            url: `${framework.elastic.baseUrl}/_pit`,
            body: { id: pitId }
        });
    }
    
    return allResults;
}
```

### Scroll API Pagination (Deprecated but still useful)

```javascript
async function paginatedSearchWithScroll(indexName, pageSize = 1000) {
    const allResults = [];
    
    // Initial search with scroll
    let response = await framework.elastic.requestAdapter.getJson({
        method: 'POST',
        url: `${framework.elastic.baseUrl}/${indexName}/_search?scroll=5m`,
        body: {
            size: pageSize,
            query: { match_all: {} }
        }
    });
    
    let scrollId = response._scroll_id;
    let hits = response.hits.hits;
    
    while (hits.length > 0) {
        allResults.push(...hits.map(hit => hit._source));
        console.log(`Fetched ${hits.length} records, total: ${allResults.length}`);
        
        // Continue scrolling
        response = await framework.elastic.requestAdapter.getJson({
            method: 'POST',
            url: `${framework.elastic.baseUrl}/_search/scroll`,
            body: {
                scroll: '5m',
                scroll_id: scrollId
            }
        });
        
        scrollId = response._scroll_id;
        hits = response.hits.hits;
    }
    
    // Clear scroll context
    await framework.elastic.requestAdapter.getJson({
        method: 'DELETE',
        url: `${framework.elastic.baseUrl}/_search/scroll`,
        body: {
            scroll_id: scrollId
        }
    });
    
    return allResults;
}
```

## Memory Optimization

### Streaming Large Results

```javascript
import { Writable } from 'stream';

class DataProcessor extends Writable {
    constructor(options) {
        super({ objectMode: true, ...options });
        this.processedCount = 0;
    }
    
    _write(chunk, encoding, callback) {
        // Process each chunk of data
        this.processData(chunk);
        this.processedCount++;
        callback();
    }
    
    processData(data) {
        // Transform or write to file/database
        console.log(`Processing record ${this.processedCount}:`, data.id);
    }
}

async function streamElasticData(indexName) {
    const processor = new DataProcessor();
    let processed = 0;
    
    await framework.elastic.sqlQuery({
        indexName,
        select: ['*'],
        where: [],
        returnAll: false,
        callback: function({ rows }) {
            rows.forEach(row => {
                processor.write(row);
                processed++;
                
                // Force garbage collection every 10000 records
                if (processed % 10000 === 0 && global.gc) {
                    global.gc();
                    console.log(`Memory: ${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MB`);
                }
            });
        }
    });
    
    processor.end();
}
```

### Cursor-Based Pagination with Memory Limits

```javascript
async function memoryEfficientPagination(indexName, maxMemoryMB = 100) {
    const startMemory = process.memoryUsage().heapUsed / 1024 / 1024;
    const results = [];
    let offset = 0;
    const pageSize = 1000;
    
    while (true) {
        const currentMemory = process.memoryUsage().heapUsed / 1024 / 1024;
        const memoryUsed = currentMemory - startMemory;
        
        if (memoryUsed > maxMemoryMB) {
            console.warn(`Memory limit reached (${memoryUsed.toFixed(2)}MB), stopping pagination`);
            break;
        }
        
        const page = await framework.elastic.sqlQuery({
            indexName,
            select: ['*'],
            where: [],
            limit: pageSize,
            offset: offset
        });
        
        if (page.length === 0) {
            break;
        }
        
        // Process immediately instead of storing
        await processAndDiscardData(page);
        
        offset += pageSize;
        
        // Periodic garbage collection
        if (offset % 10000 === 0 && global.gc) {
            global.gc();
        }
    }
}

async function processAndDiscardData(data) {
    // Process data without keeping it in memory
    for (const item of data) {
        // Write to file, database, or external system
        await saveToExternalSystem(item);
    }
}
```

### Batch Processing with Checkpoints

```javascript
async function batchProcessWithCheckpoints(indexName) {
    let lastProcessedOffset = loadCheckpoint(); // Load from file/db
    const batchSize = 5000;
    
    try {
        while (true) {
            const batch = await framework.elastic.sqlQuery({
                indexName,
                select: ['*'],
                where: [],
                limit: batchSize,
                offset: lastProcessedOffset
            });
            
            if (batch.length === 0) {
                break;
            }
            
            // Process batch
            await processBatch(batch);
            
            lastProcessedOffset += batch.length;
            
            // Save checkpoint
            saveCheckpoint(lastProcessedOffset);
            
            console.log(`Processed ${lastProcessedOffset} total records`);
            
            // Small delay to prevent overwhelming the system
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    } catch (err) {
        console.error('Error at offset:', lastProcessedOffset);
        throw err;
    }
}

function loadCheckpoint() {
    // Load from file or database
    return 0;
}

function saveCheckpoint(offset) {
    // Save to file or database for recovery
}
```

## Best Practices

### 1. Choose the Right API

**Use SQL API when:**
- You need simple SELECT queries
- You're familiar with SQL syntax
- You need basic aggregations
- Performance is not critical (SQL has some overhead)

**Use Search API when:**
- You need advanced queries (fuzzy, wildcard, regex)
- You need complex aggregations
- Performance is critical
- You need full ElasticSearch features

### 2. Optimize Query Performance

```javascript
// Bad: Fetching all fields
const results = await framework.elastic.sqlQuery({
    indexName: 'products',
    select: ['*'],
    limit: 1000
});

// Good: Fetch only needed fields
const results = await framework.elastic.sqlQuery({
    indexName: 'products',
    select: ['id', 'name', 'price'],
    limit: 1000
});
```

### 3. Use Filters Instead of Queries for Exact Matches

```javascript
// Better performance with filters
const results = await framework.elastic.requestAdapter.getJson({
    method: 'POST',
    url: `${framework.elastic.baseUrl}/products/_search`,
    body: {
        query: {
            bool: {
                filter: [
                    { term: { status: 'active' } },
                    { range: { price: { gte: 100 } } }
                ]
            }
        }
    }
});
```

### 4. Implement Proper Error Handling

```javascript
async function robustElasticQuery(indexName) {
    const maxRetries = 3;
    let attempt = 0;
    
    while (attempt < maxRetries) {
        try {
            const results = await framework.elastic.sqlQuery({
                indexName,
                select: ['*'],
                limit: 1000
            });
            
            return results;
        } catch (err) {
            attempt++;
            
            if (err.message.includes('timeout')) {
                console.warn(`Timeout on attempt ${attempt}, retrying...`);
                
                if (attempt >= maxRetries) {
                    throw new Error('Max retries reached for ElasticSearch query');
                }
                
                // Exponential backoff
                await new Promise(resolve => 
                    setTimeout(resolve, Math.pow(2, attempt) * 1000)
                );
            } else {
                // Non-retryable error
                throw err;
            }
        }
    }
}
```

### 5. Monitor Query Performance

```javascript
async function monitoredQuery(indexName) {
    const startTime = Date.now();
    const startMemory = process.memoryUsage().heapUsed / 1024 / 1024;
    
    const results = await framework.elastic.sqlQuery({
        indexName,
        select: ['*'],
        limit: 10000
    });
    
    const endTime = Date.now();
    const endMemory = process.memoryUsage().heapUsed / 1024 / 1024;
    
    console.log({
        duration: `${endTime - startTime}ms`,
        memoryDelta: `${(endMemory - startMemory).toFixed(2)}MB`,
        resultCount: results.length,
        avgTimePerRecord: `${((endTime - startTime) / results.length).toFixed(2)}ms`
    });
    
    return results;
}
```

## Summary

- **SQL API**: Simple queries, familiar syntax, good for basic operations
- **Search API**: Advanced features, better performance, more flexible
- **Pagination**: Use Point in Time (PIT) for large datasets
- **Memory**: Process data in chunks, use callbacks for large results
- **Performance**: Fetch only needed fields, use filters for exact matches
- **Error Handling**: Implement retries with exponential backoff
- **Monitoring**: Track query performance and memory usage
