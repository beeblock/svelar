-- PostgreSQL VACUUM and Maintenance Queries

-- ============================================================================
-- MANUAL VACUUM OPERATIONS
-- ============================================================================

-- VACUUM specific table (removes dead tuples)
-- VACUUM VERBOSE users;

-- VACUUM ANALYZE (vacuum + update statistics)
-- VACUUM ANALYZE users;

-- VACUUM FULL (reclaims space, locks table)
-- Avoid in production, use pg_repack instead
-- VACUUM FULL users;

-- VACUUM FREEZE (prevent transaction ID wraparound)
-- VACUUM FREEZE users;

-- ============================================================================
-- ANALYZE (update table statistics)
-- ============================================================================

-- Analyze specific table
-- ANALYZE users;

-- Analyze specific columns
-- ANALYZE users(email, created_at);

-- Analyze all tables
-- ANALYZE;

-- ============================================================================
-- CHECK AUTOVACUUM STATUS
-- ============================================================================

-- Tables needing autovacuum
SELECT
    schemaname,
    tablename,
    n_live_tup,
    n_dead_tup,
    round(n_dead_tup * 100.0 / NULLIF(n_live_tup + n_dead_tup, 0), 2) AS dead_ratio,
    last_vacuum,
    last_autovacuum,
    last_analyze,
    last_autoanalyze,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS table_size
FROM pg_stat_user_tables
WHERE n_live_tup > 0
    AND n_dead_tup > 1000
ORDER BY n_dead_tup DESC;

-- Currently running autovacuum
SELECT
    pid,
    datname,
    usename,
    state,
    now() - query_start AS duration,
    query
FROM pg_stat_activity
WHERE query LIKE 'autovacuum:%'
ORDER BY duration DESC;

-- ============================================================================
-- TABLE BLOAT ESTIMATION
-- ============================================================================

-- Estimate table bloat
SELECT
    schemaname,
    tablename,
    n_live_tup,
    n_dead_tup,
    round(n_dead_tup * 100.0 / NULLIF(n_live_tup + n_dead_tup, 0), 2) AS dead_ratio,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS total_size,
    pg_size_pretty(pg_relation_size(schemaname||'.'||tablename)) AS table_size
FROM pg_stat_user_tables
WHERE n_live_tup > 0
ORDER BY n_dead_tup DESC
LIMIT 20;

-- ============================================================================
-- CONFIGURE AUTOVACUUM PER TABLE
-- ============================================================================

-- More aggressive autovacuum for high-churn table
-- ALTER TABLE high_churn_table SET (
--     autovacuum_vacuum_threshold = 100,
--     autovacuum_vacuum_scale_factor = 0.01,
--     autovacuum_analyze_scale_factor = 0.005,
--     autovacuum_vacuum_cost_delay = 0
-- );

-- Less aggressive for low-churn large table
-- ALTER TABLE large_table SET (
--     autovacuum_vacuum_scale_factor = 0.1,
--     autovacuum_analyze_scale_factor = 0.05
-- );

-- Disable autovacuum (not recommended)
-- ALTER TABLE table_name SET (
--     autovacuum_enabled = false
-- );

-- View current settings
SELECT
    schemaname,
    tablename,
    reloptions
FROM pg_tables
WHERE reloptions IS NOT NULL
    AND schemaname NOT IN ('pg_catalog', 'information_schema');

-- ============================================================================
-- REINDEX OPERATIONS
-- ============================================================================

-- Reindex specific index (blocking)
-- REINDEX INDEX idx_name;

-- Reindex concurrently (PostgreSQL 12+, non-blocking)
-- REINDEX INDEX CONCURRENTLY idx_name;

-- Reindex table
-- REINDEX TABLE table_name;

-- Reindex database (all tables and indexes)
-- REINDEX DATABASE dbname;

-- ============================================================================
-- CLUSTER (reorder table by index)
-- ============================================================================

-- Cluster table by index (locks table)
-- CLUSTER table_name USING idx_name;

-- Recluster all previously clustered tables
-- CLUSTER;

-- Remove clustering
-- ALTER TABLE table_name SET WITHOUT CLUSTER;

-- ============================================================================
-- STATISTICS MANAGEMENT
-- ============================================================================

-- Check if statistics are stale
SELECT
    schemaname,
    tablename,
    n_live_tup,
    n_mod_since_analyze,
    round(n_mod_since_analyze * 100.0 / NULLIF(n_live_tup, 0), 2) AS pct_changed,
    last_analyze,
    last_autoanalyze
FROM pg_stat_user_tables
WHERE n_mod_since_analyze > n_live_tup * 0.1  -- 10% changes
ORDER BY n_mod_since_analyze DESC;

-- Increase statistics target for better query planning
-- ALTER TABLE table_name ALTER COLUMN column_name SET STATISTICS 1000;

-- View column statistics
-- SELECT * FROM pg_stats
-- WHERE tablename = 'table_name' AND attname = 'column_name';

-- ============================================================================
-- TRANSACTION ID WRAPAROUND PREVENTION
-- ============================================================================

-- Check tables approaching wraparound
SELECT
    c.oid::regclass AS table_name,
    age(c.relfrozenxid) AS xid_age,
    pg_size_pretty(pg_total_relation_size(c.oid)) AS size,
    CASE
        WHEN age(c.relfrozenxid) > 200000000
        THEN 'CRITICAL - VACUUM FREEZE NOW'
        WHEN age(c.relfrozenxid) > 150000000
        THEN 'WARNING - Schedule VACUUM FREEZE'
        ELSE 'OK'
    END AS status
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind IN ('r', 't', 'm')
    AND n.nspname NOT IN ('pg_catalog', 'information_schema')
    AND age(c.relfrozenxid) > 100000000
ORDER BY age(c.relfrozenxid) DESC;

-- VACUUM FREEZE to prevent wraparound
-- VACUUM FREEZE table_name;

-- ============================================================================
-- MAINTENANCE SCRIPT TEMPLATE
-- ============================================================================

-- Run this periodically (daily/weekly)
-- DO $$
-- DECLARE
--     r RECORD;
-- BEGIN
--     -- VACUUM tables with >10% dead tuples
--     FOR r IN
--         SELECT schemaname, tablename
--         FROM pg_stat_user_tables
--         WHERE n_live_tup > 0
--             AND n_dead_tup > n_live_tup * 0.1
--     LOOP
--         EXECUTE format('VACUUM ANALYZE %I.%I', r.schemaname, r.tablename);
--         RAISE NOTICE 'Vacuumed %.%', r.schemaname, r.tablename;
--     END LOOP;
-- END $$;

-- ============================================================================
-- PG_REPACK (online table rewrite)
-- ============================================================================

-- Install extension
-- CREATE EXTENSION pg_repack;

-- Repack specific table
-- pg_repack -t table_name -d database_name

-- Repack entire database
-- pg_repack -d database_name

-- Dry run (see what would be repacked)
-- pg_repack --dry-run -d database_name

-- ============================================================================
-- MONITORING AND ALERTS
-- ============================================================================

-- Alert conditions:
-- 1. Tables with >30% dead tuples
-- 2. Autovacuum running for >1 hour
-- 3. Transaction ID age >150 million
-- 4. Tables not vacuumed in >7 days

-- Example alert query
SELECT
    schemaname,
    tablename,
    n_dead_tup,
    round(n_dead_tup * 100.0 / NULLIF(n_live_tup + n_dead_tup, 0), 2) AS dead_ratio,
    now() - last_autovacuum AS time_since_autovacuum
FROM pg_stat_user_tables
WHERE n_live_tup > 0
    AND (
        n_dead_tup * 100.0 / NULLIF(n_live_tup + n_dead_tup, 0) > 30
        OR now() - last_autovacuum > interval '7 days'
    )
ORDER BY dead_ratio DESC;
