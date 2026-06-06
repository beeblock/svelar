# Query Optimization Guide

## Query Optimization Process

### 1. Identify Slow Queries

**PostgreSQL**:
```sql
-- Enable slow query logging
ALTER SYSTEM SET log_min_duration_statement = 1000;  -- Log queries > 1s
SELECT pg_reload_conf();

-- Enable pg_stat_statements
CREATE EXTENSION pg_stat_statements;

-- Find slow queries
SELECT
    calls,
    total_exec_time / 1000 / 60 AS total_minutes,
    mean_exec_time / 1000 AS mean_seconds,
    max_exec_time / 1000 AS max_seconds,
    stddev_exec_time / 1000 AS stddev_seconds,
    query
FROM pg_stat_statements
WHERE mean_exec_time > 1000  -- > 1 second
ORDER BY total_exec_time DESC
LIMIT 20;
```

**SQL Server**:
```sql
-- Enable Query Store
ALTER DATABASE [MyDB] SET QUERY_STORE = ON;

-- Find slow queries
SELECT TOP 20
    qsqt.query_sql_text,
    qsrs.count_executions,
    qsrs.avg_duration / 1000.0 AS avg_duration_ms,
    qsrs.max_duration / 1000.0 AS max_duration_ms,
    qsrs.avg_logical_io_reads,
    qsrs.avg_cpu_time / 1000.0 AS avg_cpu_ms
FROM sys.query_store_query_text qsqt
INNER JOIN sys.query_store_query qsq ON qsqt.query_text_id = qsq.query_text_id
INNER JOIN sys.query_store_plan qsp ON qsq.query_id = qsp.query_id
INNER JOIN sys.query_store_runtime_stats qsrs ON qsp.plan_id = qsrs.plan_id
WHERE qsrs.last_execution_time > DATEADD(day, -7, GETUTCDATE())
ORDER BY qsrs.avg_duration DESC;
```

### 2. Analyze Execution Plans

**PostgreSQL**:
```sql
EXPLAIN (ANALYZE, BUFFERS, VERBOSE, COSTS)
SELECT o.id, o.total, c.name
FROM orders o
JOIN customers c ON o.customer_id = c.id
WHERE o.created_at > '2024-01-01'
  AND o.status = 'completed'
ORDER BY o.created_at DESC
LIMIT 10;
```

**SQL Server**:
```sql
SET STATISTICS IO ON;
SET STATISTICS TIME ON;

SELECT o.OrderID, o.Total, c.CustomerName
FROM Orders o
INNER JOIN Customers c ON o.CustomerID = c.CustomerID
WHERE o.CreatedAt > '2024-01-01'
  AND o.Status = 'Completed'
ORDER BY o.CreatedAt DESC;
```

### 3. Identify Issues and Apply Fixes

Common issues and their solutions covered in detail below.

## Reading Execution Plans

### PostgreSQL Execution Plan Operators

**Sequential Scan** (Table Scan):
```
Seq Scan on orders  (cost=0.00..1234.56 rows=1000 width=50)
  Filter: (status = 'active')
```
- **Problem**: Scans entire table
- **Fix**: Add index on filtered column

**Index Scan**:
```
Index Scan using idx_orders_customer on orders  (cost=0.29..8.30 rows=1 width=50)
  Index Cond: (customer_id = 123)
```
- **Good**: Uses index to find rows
- **Note**: Still fetches rows from table

**Index Only Scan**:
```
Index Only Scan using idx_orders_covering on orders  (cost=0.29..4.30 rows=1 width=20)
  Index Cond: (customer_id = 123)
```
- **Best**: All data from index, no table access

**Bitmap Heap Scan**:
```
Bitmap Heap Scan on orders  (cost=5.15..10.25 rows=3 width=50)
  Recheck Cond: (status = 'active')
  -> Bitmap Index Scan on idx_orders_status
       Index Cond: (status = 'active')
```
- **Good**: Index → Bitmap → Table (efficient for multiple rows)

**Nested Loop**:
```
Nested Loop  (cost=0.29..16.60 rows=1 width=100)
  -> Index Scan on customers  (cost=0.29..8.30 rows=1)
  -> Index Scan on orders  (cost=0.29..8.30 rows=1)
```
- **Best for**: Small result sets, indexed joins
- **Inefficient for**: Large result sets

**Hash Join**:
```
Hash Join  (cost=25.00..100.00 rows=100 width=100)
  Hash Cond: (o.customer_id = c.id)
  -> Seq Scan on orders o
  -> Hash  -> Seq Scan on customers c
```
- **Good for**: Large result sets
- **Requires**: Enough memory for hash table

**Merge Join**:
```
Merge Join  (cost=0.57..50.00 rows=100 width=100)
  Merge Cond: (o.customer_id = c.id)
  -> Index Scan on orders o
  -> Index Scan on customers c
```
- **Best for**: Both inputs already sorted
- **Requires**: Sorted inputs

**Sort**:
```
Sort  (cost=100.00..110.00 rows=1000 width=50)
  Sort Key: created_at DESC
  -> Seq Scan on orders
```
- **Problem**: Expensive for large datasets
- **Fix**: Add index for ORDER BY

### SQL Server Execution Plan Operators

**Table Scan**:
- Same as PostgreSQL Seq Scan
- Fix: Add index

**Clustered Index Scan**:
- Full scan of clustered index (table)
- Often indicates missing non-clustered index

**Index Seek**:
- Good: Uses index to find specific rows
- Similar to PostgreSQL Index Scan

**Index Scan**:
- Scans entire index (not seeking)
- May indicate missing WHERE clause or poor index choice

**Key Lookup** (Bookmark Lookup):
- Index seek followed by table access
- Fix: Create covering index with INCLUDE clause

**Hash Match**:
- Similar to PostgreSQL Hash Join
- Can be expensive for large datasets

## Common Query Problems and Solutions

### Problem 1: Sequential Scan on Large Table

**Symptom**:
```sql
EXPLAIN ANALYZE
SELECT * FROM orders WHERE customer_id = 123;

-- Seq Scan on orders  (cost=0.00..5000.00 rows=10)
-- Execution time: 250.123 ms
```

**Solution**: Add index
```sql
CREATE INDEX idx_orders_customer ON orders(customer_id);

-- After:
-- Index Scan using idx_orders_customer on orders  (cost=0.29..8.30 rows=10)
-- Execution time: 0.234 ms
```

### Problem 2: Index Not Used (Expression)

**Symptom**:
```sql
EXPLAIN ANALYZE
SELECT * FROM users WHERE LOWER(email) = 'user@example.com';

-- Seq Scan on users
-- Filter: (lower(email) = 'user@example.com')
```

**Solution**: Expression index
```sql
CREATE INDEX idx_users_email_lower ON users(LOWER(email));

-- After:
-- Index Scan using idx_users_email_lower on users
```

### Problem 3: Expensive Sort

**Symptom**:
```sql
EXPLAIN ANALYZE
SELECT * FROM orders
WHERE customer_id = 123
ORDER BY created_at DESC
LIMIT 10;

-- Sort  (cost=500.00..505.00)
--   Sort Key: created_at DESC
--   -> Index Scan using idx_orders_customer
-- Execution time: 150.456 ms
```

**Solution**: Composite index with sort column
```sql
CREATE INDEX idx_orders_customer_created ON orders(customer_id, created_at DESC);

-- After:
-- Index Scan using idx_orders_customer_created on orders
-- No separate sort operation
-- Execution time: 0.456 ms
```

### Problem 4: Key Lookup / Bookmark Lookup

**Symptom (SQL Server)**:
```sql
-- Execution plan shows:
-- Index Seek (idx_orders_customer) + Key Lookup (Clustered)
-- Expensive for many rows
```

**Solution**: Covering index
```sql
CREATE NONCLUSTERED INDEX IX_Orders_Customer_Covering
ON Orders(CustomerID, CreatedAt)
INCLUDE (Total, Status, ShippingAddress);

-- After:
-- Index Seek only, no Key Lookup
```

### Problem 5: Wrong Join Strategy

**Symptom**:
```sql
EXPLAIN ANALYZE
SELECT *
FROM small_table s
JOIN huge_table h ON s.id = h.small_id;

-- Nested Loop
--   -> Seq Scan on small_table
--   -> Index Scan on huge_table (repeated many times)
-- Execution time: 5000.123 ms
```

**Solution**: Provide accurate statistics or hints
```sql
-- Update statistics
ANALYZE small_table;
ANALYZE huge_table;

-- Or force join strategy (PostgreSQL)
SET enable_nestloop = off;

-- SQL Server: Use query hint
SELECT *
FROM small_table s
INNER HASH JOIN huge_table h ON s.id = h.small_id;
```

### Problem 6: Implicit Conversion

**Symptom (SQL Server)**:
```sql
-- Column is INT, but query uses VARCHAR
SELECT * FROM Orders WHERE OrderID = '12345';

-- Execution plan shows CONVERT_IMPLICIT
-- Index not used efficiently
```

**Solution**: Use correct data type
```sql
SELECT * FROM Orders WHERE OrderID = 12345;
```

### Problem 7: Parameter Sniffing (SQL Server)

**Symptom**:
```sql
-- Cached plan optimized for first parameter value
-- Subsequent calls with different parameters perform poorly
```

**Solution 1**: OPTION (RECOMPILE)
```sql
SELECT * FROM Orders WHERE CustomerID = @CustomerID
OPTION (RECOMPILE);
```

**Solution 2**: OPTION (OPTIMIZE FOR)
```sql
SELECT * FROM Orders WHERE CustomerID = @CustomerID
OPTION (OPTIMIZE FOR (@CustomerID UNKNOWN));
```

**Solution 3**: Local variable
```sql
DECLARE @LocalCustomerID INT = @CustomerID;
SELECT * FROM Orders WHERE CustomerID = @LocalCustomerID;
```

### Problem 8: OR Conditions

**Symptom**:
```sql
SELECT * FROM users
WHERE email = 'user@example.com'
   OR username = 'john_doe';

-- Cannot efficiently use indexes
```

**Solution**: Rewrite as UNION
```sql
SELECT * FROM users WHERE email = 'user@example.com'
UNION
SELECT * FROM users WHERE username = 'john_doe';

-- Or use EXISTS
SELECT * FROM users
WHERE email = 'user@example.com'
UNION ALL
SELECT * FROM users
WHERE username = 'john_doe'
  AND NOT EXISTS (SELECT 1 FROM users WHERE email = 'user@example.com');
```

### Problem 9: NOT IN with NULL Values

**Symptom**:
```sql
SELECT * FROM orders
WHERE customer_id NOT IN (SELECT id FROM blacklisted_customers);

-- Returns incorrect results if blacklisted_customers.id contains NULL
```

**Solution**: Use NOT EXISTS or exclude NULLs
```sql
-- Option 1: NOT EXISTS
SELECT * FROM orders o
WHERE NOT EXISTS (
  SELECT 1 FROM blacklisted_customers b
  WHERE b.id = o.customer_id
);

-- Option 2: Exclude NULLs
SELECT * FROM orders
WHERE customer_id NOT IN (
  SELECT id FROM blacklisted_customers WHERE id IS NOT NULL
);
```

### Problem 10: Function in WHERE Clause

**Symptom**:
```sql
SELECT * FROM orders
WHERE YEAR(created_at) = 2024;

-- Cannot use index on created_at
```

**Solution**: Rewrite as range query
```sql
SELECT * FROM orders
WHERE created_at >= '2024-01-01'
  AND created_at < '2025-01-01';

-- Can use index on created_at
```

## Query Rewriting Techniques

### Technique 1: Subquery to JOIN

**Before** (correlated subquery):
```sql
SELECT *
FROM customers c
WHERE (
  SELECT SUM(total)
  FROM orders o
  WHERE o.customer_id = c.id
) > 1000;

-- Subquery executed for each customer (N+1 problem)
```

**After** (JOIN):
```sql
SELECT c.*
FROM customers c
INNER JOIN (
  SELECT customer_id, SUM(total) AS total_orders
  FROM orders
  GROUP BY customer_id
  HAVING SUM(total) > 1000
) o ON c.id = o.customer_id;

-- Subquery executed once
```

### Technique 2: EXISTS Instead of IN

**Before**:
```sql
SELECT * FROM customers
WHERE id IN (SELECT customer_id FROM orders WHERE total > 100);

-- Builds entire list of customer_ids
```

**After**:
```sql
SELECT * FROM customers c
WHERE EXISTS (
  SELECT 1 FROM orders o
  WHERE o.customer_id = c.id AND o.total > 100
);

-- Stops at first match (short-circuit)
```

### Technique 3: CTE vs Subquery

**CTE** (readable, but may be optimized differently):
```sql
WITH high_value_customers AS (
  SELECT customer_id, SUM(total) AS total_orders
  FROM orders
  GROUP BY customer_id
  HAVING SUM(total) > 1000
)
SELECT c.*, h.total_orders
FROM customers c
JOIN high_value_customers h ON c.id = h.customer_id;
```

**Subquery** (inline, may be better optimized):
```sql
SELECT c.*, h.total_orders
FROM customers c
JOIN (
  SELECT customer_id, SUM(total) AS total_orders
  FROM orders
  GROUP BY customer_id
  HAVING SUM(total) > 1000
) h ON c.id = h.customer_id;
```

**Note**: PostgreSQL 12+ optimizes CTEs better. SQL Server treats them differently. Test both!

### Technique 4: Window Functions vs Self-Join

**Before** (self-join):
```sql
SELECT o1.*
FROM orders o1
LEFT JOIN orders o2 ON o1.customer_id = o2.customer_id
  AND o1.created_at < o2.created_at
WHERE o2.id IS NULL;

-- Find latest order per customer
-- Expensive self-join
```

**After** (window function):
```sql
SELECT *
FROM (
  SELECT *,
    ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY created_at DESC) AS rn
  FROM orders
) ranked
WHERE rn = 1;

-- More efficient, clearer intent
```

### Technique 5: UNION ALL vs UNION

**UNION** (removes duplicates):
```sql
SELECT email FROM customers
UNION
SELECT email FROM prospects;

-- Adds DISTINCT operation (expensive)
```

**UNION ALL** (keeps duplicates):
```sql
SELECT email FROM customers
UNION ALL
SELECT email FROM prospects;

-- No DISTINCT, faster
-- Use when duplicates are impossible or acceptable
```

## Advanced Optimization Techniques

### Partial Aggregation

**Before**:
```sql
SELECT
  customer_id,
  COUNT(*) AS order_count,
  SUM(total) AS total_revenue
FROM orders
WHERE created_at >= '2024-01-01'
GROUP BY customer_id;

-- Aggregates all matching rows
```

**After**: Pre-aggregate with materialized view
```sql
CREATE MATERIALIZED VIEW customer_monthly_stats AS
SELECT
  customer_id,
  DATE_TRUNC('month', created_at) AS month,
  COUNT(*) AS order_count,
  SUM(total) AS total_revenue
FROM orders
GROUP BY customer_id, DATE_TRUNC('month', created_at);

CREATE INDEX idx_customer_stats_month ON customer_monthly_stats(month);

-- Query materialized view
SELECT customer_id, SUM(total_revenue)
FROM customer_monthly_stats
WHERE month >= '2024-01-01'
GROUP BY customer_id;

-- Refresh periodically
REFRESH MATERIALIZED VIEW CONCURRENTLY customer_monthly_stats;
```

### Indexed Views (SQL Server)

```sql
-- Create view
CREATE VIEW dbo.CustomerOrderSummary
WITH SCHEMABINDING
AS
SELECT
  c.CustomerID,
  COUNT_BIG(*) AS OrderCount,
  SUM(o.Total) AS TotalRevenue
FROM dbo.Customers c
INNER JOIN dbo.Orders o ON c.CustomerID = o.CustomerID
GROUP BY c.CustomerID;

-- Create unique clustered index
CREATE UNIQUE CLUSTERED INDEX IX_CustomerOrderSummary
ON dbo.CustomerOrderSummary(CustomerID);

-- Query optimizer uses indexed view automatically
SELECT CustomerID, TotalRevenue
FROM dbo.CustomerOrderSummary
WHERE TotalRevenue > 1000;
```

### Lateral Joins (PostgreSQL)

**Problem**: Top N per group
```sql
-- Get top 3 orders per customer

-- Bad: Self-join or subquery (inefficient)
SELECT o.*
FROM orders o
WHERE o.id IN (
  SELECT o2.id
  FROM orders o2
  WHERE o2.customer_id = o.customer_id
  ORDER BY o2.total DESC
  LIMIT 3
);
```

**Good**: LATERAL join
```sql
SELECT c.id, c.name, o.*
FROM customers c
CROSS JOIN LATERAL (
  SELECT *
  FROM orders
  WHERE customer_id = c.id
  ORDER BY total DESC
  LIMIT 3
) o;

-- Efficient, readable
```

### Partitioning for Query Performance

```sql
-- Large table partitioned by date
CREATE TABLE orders (
    id BIGSERIAL,
    customer_id INT,
    total DECIMAL(10,2),
    created_at TIMESTAMP NOT NULL,
    PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

CREATE TABLE orders_2024_q1 PARTITION OF orders
    FOR VALUES FROM ('2024-01-01') TO ('2024-04-01');

CREATE TABLE orders_2024_q2 PARTITION OF orders
    FOR VALUES FROM ('2024-04-01') TO ('2024-07-01');

-- Query with partition pruning
SELECT * FROM orders
WHERE created_at >= '2024-04-01' AND created_at < '2024-05-01';

-- Only scans orders_2024_q2 partition (partition pruning)
```

## Statistics Management

### PostgreSQL

```sql
-- Analyze table
ANALYZE orders;

-- Analyze specific columns
ANALYZE orders(customer_id, created_at);

-- Increase statistics target for complex distributions
ALTER TABLE orders ALTER COLUMN customer_id SET STATISTICS 1000;

-- View statistics
SELECT * FROM pg_stats WHERE tablename = 'orders';

-- Check if statistics are stale
SELECT
    schemaname,
    tablename,
    n_live_tup,
    n_mod_since_analyze,
    last_analyze,
    last_autoanalyze
FROM pg_stat_user_tables
WHERE n_mod_since_analyze > n_live_tup * 0.1  -- 10% changes
ORDER BY n_mod_since_analyze DESC;
```

### SQL Server

```sql
-- Update statistics with full scan
UPDATE STATISTICS Orders WITH FULLSCAN;

-- Update statistics for all tables
EXEC sp_updatestats;

-- Check statistics age
SELECT
    OBJECT_NAME(s.object_id) AS table_name,
    s.name AS stats_name,
    sp.last_updated,
    sp.rows,
    sp.rows_sampled,
    sp.modification_counter
FROM sys.stats s
CROSS APPLY sys.dm_db_stats_properties(s.object_id, s.stats_id) sp
WHERE s.object_id = OBJECT_ID('Orders');

-- Auto-update statistics settings
ALTER DATABASE MyDB SET AUTO_UPDATE_STATISTICS ON;
ALTER DATABASE MyDB SET AUTO_UPDATE_STATISTICS_ASYNC ON;  -- Don't wait
```

## Query Optimization Checklist

1. **Identify slow queries**: Enable logging, use pg_stat_statements / Query Store
2. **Analyze execution plan**: EXPLAIN ANALYZE to understand query execution
3. **Check for sequential scans**: Add indexes for WHERE, JOIN, ORDER BY columns
4. **Verify index usage**: Ensure queries use available indexes
5. **Optimize joins**: Verify join strategy (nested loop, hash, merge)
6. **Avoid functions in WHERE**: Rewrite as ranges or use expression indexes
7. **Update statistics**: Keep statistics current for accurate plans
8. **Use covering indexes**: Include all columns for index-only scans
9. **Rewrite subqueries**: Convert to JOINs when beneficial
10. **Test and measure**: Always verify improvements with EXPLAIN ANALYZE

## Performance Tuning Summary

- **Indexes**: Right columns, right order, covering when beneficial
- **Execution Plans**: Understand and optimize based on actual execution
- **Statistics**: Keep up to date for accurate query planning
- **Query Rewriting**: Subqueries → JOINs, OR → UNION, functions → ranges
- **Materialized Views**: Pre-aggregate for complex reporting
- **Partitioning**: Improve query performance with partition pruning
- **Monitor**: Continuous monitoring and optimization
