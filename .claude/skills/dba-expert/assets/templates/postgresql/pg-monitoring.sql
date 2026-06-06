-- PostgreSQL Monitoring Queries

-- ============================================================================
-- CONNECTION MONITORING
-- ============================================================================

-- Current connections summary
SELECT
    count(*) AS total,
    count(*) FILTER (WHERE state = 'active') AS active,
    count(*) FILTER (WHERE state = 'idle') AS idle,
    count(*) FILTER (WHERE state = 'idle in transaction') AS idle_in_transaction,
    count(*) FILTER (WHERE state IS NULL) AS null_state
FROM pg_stat_activity;

-- Connections by database
SELECT
    datname,
    count(*) AS connections,
    count(*) FILTER (WHERE state = 'active') AS active,
    max(query_start) AS last_query
FROM pg_stat_activity
WHERE datname IS NOT NULL
GROUP BY datname
ORDER BY connections DESC;

-- Connections by user
SELECT
    usename,
    count(*) AS connections,
    count(*) FILTER (WHERE state = 'active') AS active
FROM pg_stat_activity
WHERE usename IS NOT NULL
GROUP BY usename
ORDER BY connections DESC;

-- Long-running queries
SELECT
    pid,
    usename,
    datname,
    state,
    now() - query_start AS duration,
    query
FROM pg_stat_activity
WHERE state = 'active'
    AND (now() - query_start) > interval '5 minutes'
ORDER BY duration DESC;

-- Idle in transaction (potential problem)
SELECT
    pid,
    usename,
    datname,
    state,
    now() - state_change AS duration,
    now() - xact_start AS transaction_duration,
    query
FROM pg_stat_activity
WHERE state = 'idle in transaction'
    AND (now() - state_change) > interval '5 minutes'
ORDER BY duration DESC;

-- Kill idle in transaction (use with caution)
-- SELECT pg_terminate_backend(pid)
-- FROM pg_stat_activity
-- WHERE state = 'idle in transaction'
--     AND (now() - state_change) > interval '1 hour';

-- ============================================================================
-- PERFORMANCE METRICS
-- ============================================================================

-- Cache hit ratio (should be >99%)
SELECT
    sum(heap_blks_read) AS heap_read,
    sum(heap_blks_hit) AS heap_hit,
    round(sum(heap_blks_hit) * 100.0 / NULLIF(sum(heap_blks_hit) + sum(heap_blks_read), 0), 2) AS cache_hit_ratio
FROM pg_statio_user_tables;

-- Per-table cache hit ratio
SELECT
    schemaname,
    tablename,
    heap_blks_read,
    heap_blks_hit,
    round(heap_blks_hit * 100.0 / NULLIF(heap_blks_hit + heap_blks_read, 0), 2) AS cache_hit_ratio,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS table_size
FROM pg_statio_user_tables
WHERE heap_blks_read + heap_blks_hit > 0
ORDER BY cache_hit_ratio ASC
LIMIT 20;

-- Transaction statistics
SELECT
    datname,
    xact_commit,
    xact_rollback,
    round(xact_rollback * 100.0 / NULLIF(xact_commit + xact_rollback, 0), 2) AS rollback_ratio,
    blks_read,
    blks_hit,
    tup_returned,
    tup_fetched,
    tup_inserted,
    tup_updated,
    tup_deleted
FROM pg_stat_database
WHERE datname = current_database();

-- ============================================================================
-- TABLE STATISTICS
-- ============================================================================

-- Table sizes
SELECT
    schemaname,
    tablename,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS total_size,
    pg_size_pretty(pg_relation_size(schemaname||'.'||tablename)) AS table_size,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename) - pg_relation_size(schemaname||'.'||tablename)) AS indexes_size,
    n_live_tup AS live_rows,
    n_dead_tup AS dead_rows
FROM pg_stat_user_tables
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC
LIMIT 20;

-- Table bloat (dead tuples)
SELECT
    schemaname,
    tablename,
    n_live_tup,
    n_dead_tup,
    round(n_dead_tup * 100.0 / NULLIF(n_live_tup + n_dead_tup, 0), 2) AS dead_ratio,
    last_vacuum,
    last_autovacuum,
    last_analyze,
    last_autoanalyze
FROM pg_stat_user_tables
WHERE n_live_tup > 0
ORDER BY n_dead_tup DESC
LIMIT 20;

-- Sequential scans (potential missing indexes)
SELECT
    schemaname,
    tablename,
    seq_scan,
    seq_tup_read,
    idx_scan,
    seq_tup_read / NULLIF(seq_scan, 0) AS avg_tuples_per_scan,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS table_size
FROM pg_stat_user_tables
WHERE seq_scan > 0
ORDER BY seq_tup_read DESC
LIMIT 20;

-- ============================================================================
-- INDEX STATISTICS
-- ============================================================================

-- Most used indexes
SELECT
    schemaname,
    tablename,
    indexname,
    idx_scan,
    idx_tup_read,
    idx_tup_fetch,
    pg_size_pretty(pg_relation_size(indexrelid)) AS size
FROM pg_stat_user_indexes
ORDER BY idx_scan DESC
LIMIT 20;

-- Unused indexes
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

-- ============================================================================
-- LOCKS AND BLOCKING
-- ============================================================================

-- Current locks
SELECT
    locktype,
    database,
    relation::regclass AS relation,
    mode,
    granted,
    count(*) AS count
FROM pg_locks
WHERE database = (SELECT oid FROM pg_database WHERE datname = current_database())
GROUP BY locktype, database, relation, mode, granted
ORDER BY count DESC;

-- Blocking queries
SELECT
    blocked_locks.pid AS blocked_pid,
    blocked_activity.usename AS blocked_user,
    blocking_locks.pid AS blocking_pid,
    blocking_activity.usename AS blocking_user,
    blocked_activity.query AS blocked_query,
    blocking_activity.query AS blocking_query,
    blocked_activity.state AS blocked_state,
    blocking_activity.state AS blocking_state
FROM pg_catalog.pg_locks blocked_locks
JOIN pg_catalog.pg_stat_activity blocked_activity ON blocked_activity.pid = blocked_locks.pid
JOIN pg_catalog.pg_locks blocking_locks
    ON blocking_locks.locktype = blocked_locks.locktype
    AND blocking_locks.database IS NOT DISTINCT FROM blocked_locks.database
    AND blocking_locks.relation IS NOT DISTINCT FROM blocked_locks.relation
    AND blocking_locks.page IS NOT DISTINCT FROM blocked_locks.page
    AND blocking_locks.tuple IS NOT DISTINCT FROM blocked_locks.tuple
    AND blocking_locks.virtualxid IS NOT DISTINCT FROM blocked_locks.virtualxid
    AND blocking_locks.transactionid IS NOT DISTINCT FROM blocked_locks.transactionid
    AND blocking_locks.classid IS NOT DISTINCT FROM blocked_locks.classid
    AND blocking_locks.objid IS NOT DISTINCT FROM blocked_locks.objid
    AND blocking_locks.objsubid IS NOT DISTINCT FROM blocked_locks.objsubid
    AND blocking_locks.pid != blocked_locks.pid
JOIN pg_catalog.pg_stat_activity blocking_activity ON blocking_activity.pid = blocking_locks.pid
WHERE NOT blocked_locks.granted;

-- ============================================================================
-- SLOW QUERIES (requires pg_stat_statements)
-- ============================================================================

-- Enable extension
-- CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- Top 20 slowest queries by average time
SELECT
    calls,
    round(total_exec_time::numeric / 1000 / 60, 2) AS total_minutes,
    round(mean_exec_time::numeric / 1000, 2) AS mean_seconds,
    round(max_exec_time::numeric / 1000, 2) AS max_seconds,
    round(stddev_exec_time::numeric / 1000, 2) AS stddev_seconds,
    query
FROM pg_stat_statements
WHERE mean_exec_time > 100  -- > 100ms
ORDER BY mean_exec_time DESC
LIMIT 20;

-- Top 20 queries by total time
SELECT
    calls,
    round(total_exec_time::numeric / 1000 / 60, 2) AS total_minutes,
    round(mean_exec_time::numeric / 1000, 2) AS mean_seconds,
    query
FROM pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT 20;

-- Top 20 queries by calls
SELECT
    calls,
    round(total_exec_time::numeric / 1000 / 60, 2) AS total_minutes,
    round(mean_exec_time::numeric / 1000, 2) AS mean_seconds,
    query
FROM pg_stat_statements
ORDER BY calls DESC
LIMIT 20;

-- Reset pg_stat_statements
-- SELECT pg_stat_statements_reset();

-- ============================================================================
-- REPLICATION MONITORING
-- ============================================================================

-- Replication status (on primary)
SELECT
    client_addr,
    usename,
    application_name,
    state,
    sync_state,
    sent_lsn,
    write_lsn,
    flush_lsn,
    replay_lsn,
    pg_wal_lsn_diff(sent_lsn, replay_lsn) AS lag_bytes,
    round(pg_wal_lsn_diff(sent_lsn, replay_lsn) / 1024.0 / 1024.0, 2) AS lag_mb,
    now() - reply_time AS lag_time
FROM pg_stat_replication;

-- Replication lag (on replica)
SELECT
    now() - pg_last_xact_replay_timestamp() AS replication_lag;

-- Replication slots
SELECT
    slot_name,
    slot_type,
    database,
    active,
    pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn)) AS retained_wal
FROM pg_replication_slots;

-- ============================================================================
-- AUTOVACUUM MONITORING
-- ============================================================================

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

-- Autovacuum configuration per table
SELECT
    schemaname,
    tablename,
    reloptions
FROM pg_tables
WHERE reloptions IS NOT NULL
    AND schemaname NOT IN ('pg_catalog', 'information_schema');

-- ============================================================================
-- CHECKPOINTS
-- ============================================================================

-- Checkpoint statistics (requires pg_stat_bgwriter)
SELECT
    checkpoints_timed,
    checkpoints_req,
    round(checkpoints_req * 100.0 / NULLIF(checkpoints_timed + checkpoints_req, 0), 2) AS checkpoint_req_ratio,
    buffers_checkpoint,
    buffers_clean,
    buffers_backend,
    pg_size_pretty(buffers_checkpoint * 8192) AS checkpoint_size
FROM pg_stat_bgwriter;

-- ============================================================================
-- DATABASE SIZE AND GROWTH
-- ============================================================================

-- Database sizes
SELECT
    datname,
    pg_size_pretty(pg_database_size(datname)) AS size
FROM pg_database
WHERE datname NOT IN ('template0', 'template1')
ORDER BY pg_database_size(datname) DESC;

-- Track growth (run periodically and compare)
-- CREATE TABLE IF NOT EXISTS db_size_history (
--     recorded_at TIMESTAMP DEFAULT NOW(),
--     datname TEXT,
--     size_bytes BIGINT
-- );

-- INSERT INTO db_size_history (datname, size_bytes)
-- SELECT datname, pg_database_size(datname)
-- FROM pg_database
-- WHERE datname NOT IN ('template0', 'template1');

-- ============================================================================
-- DISK USAGE
-- ============================================================================

-- WAL directory size (approximate)
SELECT pg_size_pretty(sum(size)) AS wal_size
FROM pg_ls_waldir();

-- Temporary files
SELECT
    datname,
    temp_files,
    pg_size_pretty(temp_bytes) AS temp_size
FROM pg_stat_database
WHERE datname = current_database();
