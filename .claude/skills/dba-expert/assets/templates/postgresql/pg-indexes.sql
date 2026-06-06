-- PostgreSQL Index Analysis and Creation Templates

-- ============================================================================
-- INDEX USAGE STATISTICS
-- ============================================================================

-- Find most used indexes
SELECT
    schemaname,
    tablename,
    indexname,
    idx_scan AS scans,
    idx_tup_read AS tuples_read,
    idx_tup_fetch AS tuples_fetched,
    pg_size_pretty(pg_relation_size(indexrelid)) AS size
FROM pg_stat_user_indexes
ORDER BY idx_scan DESC
LIMIT 20;

-- Find unused indexes
SELECT
    schemaname,
    tablename,
    indexname,
    idx_scan,
    pg_size_pretty(pg_relation_size(indexrelid)) AS size
FROM pg_stat_user_indexes
WHERE idx_scan = 0
    AND indexrelname NOT LIKE 'pg_toast_%'
ORDER BY pg_relation_size(indexrelid) DESC;

-- Find duplicate indexes
SELECT
    indrelid::regclass AS table_name,
    array_agg(indexrelid::regclass) AS indexes,
    indkey AS columns
FROM pg_index
GROUP BY indrelid, indkey
HAVING count(*) > 1;

-- ============================================================================
-- INDEX BLOAT
-- ============================================================================

-- Check index bloat (requires pgstattuple extension)
CREATE EXTENSION IF NOT EXISTS pgstattuple;

SELECT
    schemaname,
    tablename,
    indexname,
    pg_size_pretty(pg_relation_size(indexrelid)) AS index_size,
    round(100 * (1 - avg_leaf_density / 100), 2) AS bloat_pct
FROM pg_stat_user_indexes
JOIN LATERAL pgstatindex(indexrelid) ON true
WHERE avg_leaf_density IS NOT NULL
ORDER BY pg_relation_size(indexrelid) DESC;

-- ============================================================================
-- MISSING INDEX SUGGESTIONS
-- ============================================================================

-- Tables with seq scans (potential missing indexes)
SELECT
    schemaname,
    tablename,
    seq_scan,
    seq_tup_read,
    idx_scan,
    seq_tup_read / NULLIF(seq_scan, 0) AS avg_tuples_per_seqscan,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS table_size
FROM pg_stat_user_tables
WHERE seq_scan > 0
    AND seq_tup_read / NULLIF(seq_scan, 0) > 10000  -- Large seq scans
ORDER BY seq_tup_read DESC
LIMIT 20;

-- ============================================================================
-- INDEX CREATION TEMPLATES
-- ============================================================================

-- B-tree index (default, general purpose)
-- CREATE INDEX idx_table_column ON table_name(column_name);
-- CREATE INDEX idx_table_column1_column2 ON table_name(column1, column2);

-- B-tree index with DESC for descending order
-- CREATE INDEX idx_table_created_desc ON table_name(created_at DESC);

-- Unique index
-- CREATE UNIQUE INDEX idx_table_email ON table_name(email);

-- Partial index (index subset of rows)
-- CREATE INDEX idx_table_active ON table_name(column_name)
-- WHERE status = 'active';

-- Covering index (includes additional columns)
-- CREATE INDEX idx_table_covering ON table_name(key_column)
-- INCLUDE (col1, col2, col3);  -- PostgreSQL 11+

-- Expression index (function on column)
-- CREATE INDEX idx_table_lower_email ON table_name(LOWER(email));

-- CREATE INDEX CONCURRENTLY (non-blocking)
-- CREATE INDEX CONCURRENTLY idx_table_column ON table_name(column_name);

-- ============================================================================
-- GIN INDEXES (for arrays, JSONB, full-text search)
-- ============================================================================

-- GIN index for JSONB
-- CREATE INDEX idx_table_data ON table_name USING GIN(data);

-- GIN index with jsonb_path_ops (more efficient for @> operator)
-- CREATE INDEX idx_table_data_path ON table_name USING GIN(data jsonb_path_ops);

-- GIN index for arrays
-- CREATE INDEX idx_table_tags ON table_name USING GIN(tags);

-- GIN index for full-text search
-- CREATE INDEX idx_table_fts ON table_name USING GIN(to_tsvector('english', content));

-- ============================================================================
-- GiST INDEXES (for geometric data, ranges)
-- ============================================================================

-- GiST index for geometric data (PostGIS)
-- CREATE INDEX idx_table_location ON table_name USING GIST(location);

-- GiST index for range types
-- CREATE INDEX idx_table_ip_range ON table_name USING GIST(ip_range);

-- ============================================================================
-- BRIN INDEXES (for very large tables with natural ordering)
-- ============================================================================

-- BRIN index for time-series data
-- CREATE INDEX idx_table_created_brin ON table_name USING BRIN(created_at);

-- Check correlation (should be close to 1.0 or -1.0 for BRIN)
-- SELECT correlation
-- FROM pg_stats
-- WHERE tablename = 'table_name' AND attname = 'created_at';

-- ============================================================================
-- INDEX MAINTENANCE
-- ============================================================================

-- Reindex specific index (blocking)
-- REINDEX INDEX idx_name;

-- Reindex concurrently (PostgreSQL 12+, non-blocking)
-- REINDEX INDEX CONCURRENTLY idx_name;

-- Reindex table
-- REINDEX TABLE table_name;

-- Drop index
-- DROP INDEX idx_name;

-- Drop index concurrently (PostgreSQL 14+)
-- DROP INDEX CONCURRENTLY idx_name;

-- ============================================================================
-- INDEX SIZE ANALYSIS
-- ============================================================================

-- Total index size per table
SELECT
    schemaname,
    tablename,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS total_size,
    pg_size_pretty(pg_relation_size(schemaname||'.'||tablename)) AS table_size,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename) - pg_relation_size(schemaname||'.'||tablename)) AS indexes_size,
    round((pg_total_relation_size(schemaname||'.'||tablename) - pg_relation_size(schemaname||'.'||tablename)) * 100.0 / NULLIF(pg_total_relation_size(schemaname||'.'||tablename), 0), 2) AS indexes_ratio_pct
FROM pg_tables
WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC
LIMIT 20;

-- Largest indexes
SELECT
    schemaname,
    tablename,
    indexname,
    pg_size_pretty(pg_relation_size(indexrelid)) AS index_size,
    idx_scan
FROM pg_stat_user_indexes
ORDER BY pg_relation_size(indexrelid) DESC
LIMIT 20;

-- ============================================================================
-- EXAMPLE: Create indexes for common query patterns
-- ============================================================================

-- Example table: orders
/*
CREATE TABLE orders (
    id BIGSERIAL PRIMARY KEY,
    customer_id INT NOT NULL,
    total DECIMAL(10,2) NOT NULL,
    status VARCHAR(20) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
*/

-- Index for customer lookup
-- CREATE INDEX idx_orders_customer ON orders(customer_id);

-- Composite index for customer + date queries with sort
-- CREATE INDEX idx_orders_customer_created ON orders(customer_id, created_at DESC);

-- Partial index for active orders
-- CREATE INDEX idx_orders_active ON orders(customer_id, created_at DESC)
-- WHERE status IN ('pending', 'processing');

-- Covering index (includes all query columns)
-- CREATE INDEX idx_orders_covering ON orders(customer_id, created_at DESC)
-- INCLUDE (total, status);

-- Index for status filtering
-- CREATE INDEX idx_orders_status ON orders(status)
-- WHERE status != 'completed';  -- Don't index completed orders

-- ============================================================================
-- VERIFY INDEX USAGE
-- ============================================================================

-- Check if query uses index
-- EXPLAIN (ANALYZE, BUFFERS)
-- SELECT * FROM orders
-- WHERE customer_id = 123
-- ORDER BY created_at DESC
-- LIMIT 10;

-- Look for "Index Scan" or "Index Only Scan" in output
-- Avoid "Seq Scan" on large tables
