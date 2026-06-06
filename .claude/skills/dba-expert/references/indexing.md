# Index Design and Optimization Guide

## Index Fundamentals

### What is an Index?

An index is a data structure that improves the speed of data retrieval operations on a database table at the cost of additional writes and storage space.

**Trade-offs**:
- **Pros**: Faster SELECT queries, faster WHERE, ORDER BY, GROUP BY, JOIN operations
- **Cons**: Slower INSERT, UPDATE, DELETE operations, additional storage space, maintenance overhead

### When to Index

**Good candidates for indexing**:
- Primary key columns (automatically indexed)
- Foreign key columns (for joins)
- Columns in WHERE clauses
- Columns in ORDER BY clauses
- Columns in GROUP BY clauses
- Columns in JOIN conditions
- Columns with high selectivity (many unique values)

**Poor candidates for indexing**:
- Columns with low cardinality (few unique values like gender, boolean)
- Columns frequently updated
- Small tables (full scan may be faster)
- Columns in expressions (unless using expression index)

## Index Selectivity and Cardinality

### Selectivity

Selectivity measures how unique values are in a column.

```sql
-- Calculate selectivity (PostgreSQL)
SELECT
    COUNT(DISTINCT column_name)::float / COUNT(*)::float AS selectivity,
    COUNT(DISTINCT column_name) AS distinct_values,
    COUNT(*) AS total_rows
FROM table_name;

-- Selectivity ranges from 0 to 1
-- 1.0 = All unique values (excellent for indexing)
-- 0.5 = Half the values are unique
-- 0.01 = Low selectivity (poor for indexing)
```

**Rule of Thumb**: Index columns with selectivity > 0.05 (5%)

### Cardinality

Cardinality is the number of distinct values in a column.

**High cardinality** (good for indexing):
- User IDs, email addresses, usernames
- Order numbers, invoice numbers
- Timestamps

**Low cardinality** (poor for indexing):
- Gender (M/F)
- Status (active/inactive)
- Boolean fields
- Country (limited set)

**Exception**: Partial indexes can make low cardinality columns useful:
```sql
-- Index only active users
CREATE INDEX idx_users_active ON users(last_login)
WHERE status = 'active';
```

## Composite Indexes

### Column Order Matters

The order of columns in a composite index significantly impacts its effectiveness.

**Left-most Prefix Rule**: An index on (A, B, C) can be used for queries filtering on:
- A
- A, B
- A, B, C

But NOT for:
- B
- C
- B, C

**Example**:
```sql
-- Index on (customer_id, order_date, status)
CREATE INDEX idx_orders_composite ON orders(customer_id, order_date, status);

-- ✓ Can use index
SELECT * FROM orders WHERE customer_id = 123;
SELECT * FROM orders WHERE customer_id = 123 AND order_date > '2024-01-01';
SELECT * FROM orders WHERE customer_id = 123 AND order_date > '2024-01-01' AND status = 'completed';

-- ✗ Cannot use index efficiently
SELECT * FROM orders WHERE order_date > '2024-01-01';
SELECT * FROM orders WHERE status = 'completed';
```

### Column Order Strategy

**General rule**: Most selective columns first (highest to lowest selectivity)

**Exception for range queries**: Put equality columns before range columns

```sql
-- Query: WHERE status = 'active' AND created > '2024-01-01' ORDER BY created DESC

-- Bad: Range column first
CREATE INDEX idx_bad ON orders(created, status);
-- Can use created for range, but status filter happens after

-- Good: Equality column first
CREATE INDEX idx_good ON orders(status, created DESC);
-- Filters on status first, then uses created for range and sort
```

### Composite Index Design Examples

**Example 1: Equality + Range + Sort**
```sql
-- Query
SELECT * FROM orders
WHERE customer_id = 123
  AND created_at > '2024-01-01'
ORDER BY created_at DESC
LIMIT 10;

-- Optimal index
CREATE INDEX idx_orders_customer_created ON orders(customer_id, created_at DESC);
-- customer_id (equality) first, created_at (range + sort) second
```

**Example 2: Multiple Equality Conditions**
```sql
-- Query
SELECT * FROM products
WHERE category = 'electronics'
  AND brand = 'Apple'
  AND in_stock = true;

-- Analyze selectivity
-- category: 10 distinct values (low)
-- brand: 100 distinct values (medium)
-- in_stock: 2 distinct values (very low)

-- Optimal index: Most selective first
CREATE INDEX idx_products_brand_category_stock ON products(brand, category, in_stock);
```

**Example 3: Covering Index**
```sql
-- Query
SELECT order_id, total, status
FROM orders
WHERE customer_id = 123
ORDER BY created_at DESC;

-- Without covering index: Index seek + Key lookup
CREATE INDEX idx_orders_customer_created ON orders(customer_id, created_at DESC);

-- With covering index: Index-only scan
CREATE INDEX idx_orders_covering ON orders(customer_id, created_at DESC)
INCLUDE (total, status);  -- SQL Server, PostgreSQL 11+

-- Or for older PostgreSQL
CREATE INDEX idx_orders_covering ON orders(customer_id, created_at DESC, total, status);
```

## Index Types by Database

### B-tree Indexes (Default)

**Characteristics**:
- Balanced tree structure
- Good for equality and range queries
- Supports <, <=, =, >=, >, BETWEEN, IN
- Supports ORDER BY, MIN, MAX
- Default index type in most databases

**Best for**:
- Primary keys
- Foreign keys
- General-purpose indexing

```sql
-- PostgreSQL
CREATE INDEX idx_users_email ON users(email);

-- SQL Server
CREATE NONCLUSTERED INDEX idx_users_email ON users(email);
```

### Hash Indexes

**Characteristics**:
- Hash table structure
- Only supports equality (=)
- Cannot support range queries
- Cannot support ORDER BY
- Faster than B-tree for equality, but limited use cases

**PostgreSQL**:
```sql
CREATE INDEX idx_users_username_hash ON users USING HASH(username);
```

**Note**: B-tree is usually sufficient. Hash indexes rarely needed.

### GIN (Generalized Inverted Index) - PostgreSQL

**Best for**:
- Full-text search
- JSONB queries
- Array contains queries

```sql
-- Full-text search
CREATE INDEX idx_articles_search ON articles USING GIN(to_tsvector('english', content));

-- JSONB
CREATE INDEX idx_documents_data ON documents USING GIN(data);

-- Array
CREATE INDEX idx_posts_tags ON posts USING GIN(tags);

-- Queries that benefit
SELECT * FROM documents WHERE data @> '{"status": "active"}';
SELECT * FROM posts WHERE tags @> ARRAY['postgresql', 'database'];
```

**GIN vs GIN (jsonb_path_ops)**:
```sql
-- Default GIN: Supports all JSONB operators
CREATE INDEX idx_data_gin ON documents USING GIN(data);

-- jsonb_path_ops: More efficient for @> operator, smaller index
CREATE INDEX idx_data_path ON documents USING GIN(data jsonb_path_ops);
```

### GiST (Generalized Search Tree) - PostgreSQL

**Best for**:
- Geometric data (PostGIS)
- Full-text search
- Range types

```sql
-- Geometric data
CREATE INDEX idx_places_location ON places USING GIST(location);

-- Range type
CREATE INDEX idx_ip_ranges ON ip_blocks USING GIST(ip_range);

-- Full-text search
CREATE INDEX idx_articles_gist ON articles USING GIST(to_tsvector('english', content));
```

### BRIN (Block Range Index) - PostgreSQL

**Best for**:
- Very large tables (100GB+)
- Naturally ordered data (time-series)
- Append-only tables

**Characteristics**:
- Extremely small index size
- Less precise than B-tree
- Excellent for correlated data

```sql
-- Time-series data
CREATE INDEX idx_logs_created_brin ON logs USING BRIN(created_at);

-- Check correlation (should be close to 1.0 or -1.0)
SELECT correlation
FROM pg_stats
WHERE tablename = 'logs' AND attname = 'created_at';
-- Correlation > 0.9 or < -0.9 = good for BRIN
```

### Columnstore Indexes - SQL Server

**Best for**:
- Analytics and data warehouse queries
- Aggregations
- Large table scans

```sql
-- Clustered columnstore (entire table)
CREATE CLUSTERED COLUMNSTORE INDEX CCI_Sales ON Sales;

-- Nonclustered columnstore (for specific queries)
CREATE NONCLUSTERED COLUMNSTORE INDEX NCCI_Orders
ON Orders(OrderDate, CustomerID, Total, ProductID);

-- Best practices
-- - Use for read-heavy analytics
-- - Batch inserts (> 102,400 rows for compressed rowgroups)
-- - Partition for maintenance
```

## Covering Indexes

A covering index contains all columns needed by a query, allowing an index-only scan.

### PostgreSQL

```sql
-- Query
SELECT user_id, username, email
FROM users
WHERE status = 'active'
ORDER BY created_at DESC;

-- Non-covering index (requires table access)
CREATE INDEX idx_users_status_created ON users(status, created_at DESC);

-- Covering index (PostgreSQL 11+)
CREATE INDEX idx_users_covering ON users(status, created_at DESC)
INCLUDE (username, email);

-- For older PostgreSQL
CREATE INDEX idx_users_covering ON users(status, created_at DESC, username, email);

-- Verify with EXPLAIN
EXPLAIN (ANALYZE, BUFFERS)
SELECT user_id, username, email
FROM users
WHERE status = 'active'
ORDER BY created_at DESC;
-- Should show "Index Only Scan"
```

### SQL Server

```sql
-- Covering index with INCLUDE
CREATE NONCLUSTERED INDEX IX_Users_Covering
ON Users(Status, CreatedAt DESC)
INCLUDE (Username, Email);

-- Verify in execution plan (shows "Index Seek" with no "Key Lookup")
```

### Benefits

- **No table access**: All data retrieved from index
- **Reduced I/O**: Significantly faster queries
- **Better for SSDs**: Sequential index reads

### Trade-offs

- **Larger index size**: More storage needed
- **Slower writes**: More columns to update
- **Maintenance overhead**: More data to reorganize/rebuild

## Partial Indexes

Indexes that include only a subset of rows.

### PostgreSQL

```sql
-- Index only active users
CREATE INDEX idx_users_active ON users(email)
WHERE status = 'active';

-- Index recent orders
CREATE INDEX idx_orders_recent ON orders(customer_id, created_at)
WHERE created_at > '2024-01-01';

-- Index non-null values
CREATE INDEX idx_users_phone ON users(phone)
WHERE phone IS NOT NULL;

-- Unique partial index
CREATE UNIQUE INDEX idx_users_email_active ON users(email)
WHERE deleted_at IS NULL;
```

### SQL Server (Filtered Indexes)

```sql
-- Filtered index on active users
CREATE NONCLUSTERED INDEX IX_Users_Email_Active
ON Users(Email)
WHERE Status = 'Active';

-- Index non-null values
CREATE NONCLUSTERED INDEX IX_Users_Phone
ON Users(Phone)
WHERE Phone IS NOT NULL;
```

### Benefits

- **Smaller index size**: Only relevant rows
- **Faster queries**: Fewer index pages to scan
- **Targeted optimization**: Focus on specific use cases

## Expression Indexes

Indexes on computed expressions or functions.

### PostgreSQL

```sql
-- Case-insensitive search
CREATE INDEX idx_users_email_lower ON users(LOWER(email));

-- Query must match expression
SELECT * FROM users WHERE LOWER(email) = 'user@example.com';

-- JSON extraction
CREATE INDEX idx_data_status ON documents((data->>'status'));

-- Computed column
CREATE INDEX idx_orders_total_with_tax ON orders((total * 1.1));
```

### SQL Server (Computed Columns)

```sql
-- Add computed column
ALTER TABLE Users
ADD EmailLower AS LOWER(Email) PERSISTED;

-- Index computed column
CREATE INDEX IX_Users_EmailLower ON Users(EmailLower);

-- Or create index on expression directly
CREATE INDEX IX_Users_EmailLower ON Users(LOWER(Email));
```

## Index Monitoring and Maintenance

### Identify Missing Indexes

**PostgreSQL**:
```sql
-- Queries are table scanning frequently
SELECT
    schemaname,
    tablename,
    seq_scan,
    seq_tup_read,
    idx_scan,
    seq_tup_read / seq_scan as avg_seq_tup_read
FROM pg_stat_user_tables
WHERE seq_scan > 0
ORDER BY seq_tup_read DESC
LIMIT 20;
```

**SQL Server**:
```sql
-- See SQL Server reference (dm_db_missing_index_details)
```

### Identify Unused Indexes

**PostgreSQL**:
```sql
SELECT
    schemaname,
    tablename,
    indexname,
    idx_scan,
    pg_size_pretty(pg_relation_size(indexrelid)) as size
FROM pg_stat_user_indexes
WHERE idx_scan = 0
    AND indexrelname NOT LIKE 'pg_toast_%'
ORDER BY pg_relation_size(indexrelid) DESC;
```

**SQL Server**:
```sql
-- See SQL Server reference (dm_db_index_usage_stats)
```

### Check Index Bloat

**PostgreSQL**:
```sql
-- Check dead tuples (indicates bloat)
SELECT
    schemaname,
    tablename,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as total_size,
    n_dead_tup,
    n_live_tup,
    round(n_dead_tup * 100.0 / NULLIF(n_live_tup + n_dead_tup, 0), 2) as dead_ratio
FROM pg_stat_user_tables
WHERE n_live_tup > 0
ORDER BY n_dead_tup DESC;

-- VACUUM to clean up
VACUUM ANALYZE tablename;

-- REINDEX to rebuild
REINDEX INDEX CONCURRENTLY indexname;  -- PG 12+
```

**SQL Server**:
```sql
-- Check fragmentation
SELECT
    OBJECT_NAME(ips.object_id) AS table_name,
    i.name AS index_name,
    ips.avg_fragmentation_in_percent,
    ips.page_count
FROM sys.dm_db_index_physical_stats(DB_ID(), NULL, NULL, NULL, 'LIMITED') ips
INNER JOIN sys.indexes i ON ips.object_id = i.object_id AND ips.index_id = i.index_id
WHERE ips.avg_fragmentation_in_percent > 10
    AND ips.page_count > 1000
ORDER BY ips.avg_fragmentation_in_percent DESC;

-- Maintenance
-- Reorganize if 10-30% fragmented
ALTER INDEX IX_IndexName ON TableName REORGANIZE;

-- Rebuild if > 30% fragmented
ALTER INDEX IX_IndexName ON TableName REBUILD;
```

### Monitor Index Usage

**PostgreSQL**:
```sql
-- Index usage statistics
SELECT
    schemaname,
    tablename,
    indexname,
    idx_scan,
    idx_tup_read,
    idx_tup_fetch,
    pg_size_pretty(pg_relation_size(indexrelid)) as size
FROM pg_stat_user_indexes
ORDER BY idx_scan DESC;

-- Reset statistics (to measure over period)
SELECT pg_stat_reset();
```

**SQL Server**:
```sql
SELECT
    OBJECT_NAME(s.object_id) AS table_name,
    i.name AS index_name,
    s.user_seeks,
    s.user_scans,
    s.user_lookups,
    s.user_updates,
    s.last_user_seek,
    s.last_user_scan
FROM sys.dm_db_index_usage_stats s
INNER JOIN sys.indexes i ON s.object_id = i.object_id AND s.index_id = i.index_id
WHERE s.database_id = DB_ID()
ORDER BY s.user_seeks + s.user_scans + s.user_lookups DESC;
```

## Index Design Patterns

### Pattern 1: Equality + Range + Sort

```sql
-- Query pattern
WHERE column_a = value
  AND column_b > value
ORDER BY column_b

-- Optimal index
CREATE INDEX idx_name ON table(column_a, column_b);
-- Equality first, then range/sort
```

### Pattern 2: Multiple Equality + Sort

```sql
-- Query pattern
WHERE column_a = value
  AND column_b = value
ORDER BY column_c

-- Optimal index
CREATE INDEX idx_name ON table(column_a, column_b, column_c);
-- All equality conditions, then sort column
```

### Pattern 3: Covering Index for Frequent Query

```sql
-- Frequent query
SELECT column_a, column_b, column_c
FROM table
WHERE column_d = value
ORDER BY column_e;

-- Covering index
CREATE INDEX idx_name ON table(column_d, column_e)
INCLUDE (column_a, column_b, column_c);
-- Filter + sort in key, selected columns in INCLUDE
```

### Pattern 4: Partial Index for Common Filter

```sql
-- 90% of queries filter on status = 'active'
-- 10% query all statuses

-- Partial index for common case
CREATE INDEX idx_table_active ON table(created_at)
WHERE status = 'active';

-- Regular index for uncommon case (or table scan acceptable)
```

### Pattern 5: Index for JOIN

```sql
-- Query
SELECT *
FROM orders o
JOIN customers c ON o.customer_id = c.id
WHERE o.status = 'pending';

-- Indexes needed
CREATE INDEX idx_orders_status ON orders(status);  -- Filter
CREATE INDEX idx_orders_customer ON orders(customer_id);  -- JOIN
CREATE INDEX idx_customers_pk ON customers(id);  -- JOIN (usually PK)
```

## Common Index Anti-Patterns

### Anti-Pattern 1: Index Every Column

```sql
-- Bad: Too many indexes
CREATE INDEX idx_users_id ON users(id);  -- Unnecessary (PK already indexed)
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_first_name ON users(first_name);
CREATE INDEX idx_users_last_name ON users(last_name);
CREATE INDEX idx_users_created ON users(created_at);
-- Slows down writes, wastes storage

-- Good: Only index queried columns
CREATE UNIQUE INDEX idx_users_email ON users(email);
CREATE UNIQUE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_created ON users(created_at)
WHERE status = 'active';  -- Partial if applicable
```

### Anti-Pattern 2: Wrong Column Order

```sql
-- Query
SELECT * FROM orders
WHERE customer_id = 123
  AND created_at > '2024-01-01'
ORDER BY created_at DESC;

-- Bad: Range column first
CREATE INDEX idx_bad ON orders(created_at, customer_id);
-- Can't efficiently filter by customer_id

-- Good: Equality first, then range/sort
CREATE INDEX idx_good ON orders(customer_id, created_at DESC);
```

### Anti-Pattern 3: Index on Expressions Without Expression Index

```sql
-- Query
SELECT * FROM users WHERE LOWER(email) = 'user@example.com';

-- Bad: Regular index not used
CREATE INDEX idx_users_email ON users(email);
-- Query does LOWER(email), so index not used

-- Good: Expression index
CREATE INDEX idx_users_email_lower ON users(LOWER(email));
```

### Anti-Pattern 4: Index on Low Selectivity Column

```sql
-- Bad: Low cardinality column
CREATE INDEX idx_users_gender ON users(gender);
-- gender has only 2-3 values, not selective

-- Good: Use partial index or skip entirely
CREATE INDEX idx_users_active_females ON users(created_at)
WHERE gender = 'F' AND status = 'active';
-- More selective with multiple conditions
```

### Anti-Pattern 5: Duplicate or Redundant Indexes

```sql
-- Bad: Redundant indexes
CREATE INDEX idx_orders_customer ON orders(customer_id);
CREATE INDEX idx_orders_customer_created ON orders(customer_id, created_at);
-- First index is redundant (covered by second)

-- Good: Remove redundant index
CREATE INDEX idx_orders_customer_created ON orders(customer_id, created_at);
```

## Index Design Checklist

1. **Analyze queries first**: Index based on actual query patterns
2. **Check selectivity**: High selectivity columns benefit most
3. **Order composite indexes carefully**: Equality → Range → Sort
4. **Consider covering indexes**: For frequently run queries
5. **Use partial indexes**: For common filters
6. **Monitor index usage**: Remove unused indexes
7. **Maintain indexes**: VACUUM, REINDEX, REORGANIZE, REBUILD
8. **Test performance**: Measure before and after with EXPLAIN
9. **Balance reads vs writes**: More indexes = slower writes
10. **Document index purpose**: Note why each index exists

## Summary

- **B-tree**: Default, general purpose, most common
- **Hash**: Rare, equality only, usually B-tree is better
- **GIN**: JSONB, arrays, full-text search (PostgreSQL)
- **GiST**: Geometric, ranges (PostgreSQL)
- **BRIN**: Very large tables, time-series (PostgreSQL)
- **Columnstore**: Analytics, aggregations (SQL Server)
- **Covering indexes**: Include all query columns for index-only scans
- **Partial indexes**: Index subset of rows for common filters
- **Expression indexes**: Index computed expressions
- **Column order**: Critical for composite indexes (equality → range → sort)
- **Monitor usage**: Remove unused indexes, maintain fragmentation
