# Database Monitoring and Alerting Guide

## Key Metrics to Monitor

### Database Health

1. **Connection Count**: Active vs max connections
2. **Transaction Rate**: Commits/rollbacks per second
3. **Replication Lag**: Delay between primary and replicas
4. **Checkpoint Frequency**: How often checkpoints occur
5. **Disk Space**: Available space on database volumes
6. **Cache Hit Ratio**: Should be >99%

### Query Performance

1. **Slow Queries**: Queries exceeding threshold
2. **Query Rate**: Queries per second
3. **Average Query Time**: Mean query execution time
4. **Lock Wait Time**: Time spent waiting for locks
5. **Deadlocks**: Frequency of deadlocks

### System Resources

1. **CPU Usage**: Database process CPU utilization
2. **Memory Usage**: RAM consumption
3. **Disk I/O**: IOPS, throughput, latency
4. **Network I/O**: Bandwidth utilization

## PostgreSQL Monitoring

### Connection Monitoring

```sql
-- Current connections
SELECT
    count(*) AS total_connections,
    count(*) FILTER (WHERE state = 'active') AS active,
    count(*) FILTER (WHERE state = 'idle') AS idle,
    count(*) FILTER (WHERE state = 'idle in transaction') AS idle_in_transaction
FROM pg_stat_activity;

-- Connections by database
SELECT
    datname,
    count(*) AS connections
FROM pg_stat_activity
GROUP BY datname
ORDER BY connections DESC;

-- Connections by user
SELECT
    usename,
    count(*) AS connections,
    max(query_start) AS last_query_start
FROM pg_stat_activity
GROUP BY usename
ORDER BY connections DESC;

-- Idle in transaction (potential problem)
SELECT
    pid,
    usename,
    datname,
    state,
    now() - state_change AS duration,
    query
FROM pg_stat_activity
WHERE state = 'idle in transaction'
    AND (now() - state_change) > interval '5 minutes'
ORDER BY duration DESC;
```

### Cache Hit Ratio

```sql
-- Overall cache hit ratio (should be >99%)
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
    round(heap_blks_hit * 100.0 / NULLIF(heap_blks_hit + heap_blks_read, 0), 2) AS cache_hit_ratio
FROM pg_statio_user_tables
WHERE heap_blks_read + heap_blks_hit > 0
ORDER BY cache_hit_ratio ASC
LIMIT 20;
```

### Index Usage

```sql
-- Index usage statistics
SELECT
    schemaname,
    tablename,
    indexname,
    idx_scan,
    idx_tup_read,
    idx_tup_fetch,
    pg_size_pretty(pg_relation_size(indexrelid)) AS index_size
FROM pg_stat_user_indexes
ORDER BY idx_scan DESC
LIMIT 20;

-- Unused indexes
SELECT
    schemaname,
    tablename,
    indexname,
    idx_scan,
    pg_size_pretty(pg_relation_size(indexrelid)) AS index_size
FROM pg_stat_user_indexes
WHERE idx_scan = 0
    AND indexrelname NOT LIKE 'pg_toast_%'
ORDER BY pg_relation_size(indexrelid) DESC;
```

### Table Statistics

```sql
-- Table sizes
SELECT
    schemaname,
    tablename,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS total_size,
    pg_size_pretty(pg_relation_size(schemaname||'.'||tablename)) AS table_size,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename) - pg_relation_size(schemaname||'.'||tablename)) AS indexes_size
FROM pg_tables
WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC
LIMIT 20;

-- Dead tuples (bloat indicator)
SELECT
    schemaname,
    tablename,
    n_live_tup,
    n_dead_tup,
    round(n_dead_tup * 100.0 / NULLIF(n_live_tup + n_dead_tup, 0), 2) AS dead_ratio,
    last_autovacuum,
    last_autoanalyze
FROM pg_stat_user_tables
WHERE n_live_tup > 0
ORDER BY n_dead_tup DESC
LIMIT 20;
```

### Transaction Statistics

```sql
-- Database-level transaction stats
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
```

### Locks and Blocking

```sql
-- Current locks
SELECT
    locktype,
    database,
    relation::regclass,
    mode,
    granted,
    count(*) AS count
FROM pg_locks
GROUP BY locktype, database, relation, mode, granted
ORDER BY count DESC;

-- Blocking queries
SELECT
    blocked_locks.pid AS blocked_pid,
    blocked_activity.usename AS blocked_user,
    blocking_locks.pid AS blocking_pid,
    blocking_activity.usename AS blocking_user,
    blocked_activity.query AS blocked_statement,
    blocking_activity.query AS blocking_statement,
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
```

### Slow Queries (pg_stat_statements)

```sql
-- Enable extension
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- Top 20 slowest queries by average time
SELECT
    calls,
    total_exec_time / 1000 / 60 AS total_minutes,
    mean_exec_time / 1000 AS mean_seconds,
    max_exec_time / 1000 AS max_seconds,
    stddev_exec_time / 1000 AS stddev_seconds,
    query
FROM pg_stat_statements
WHERE mean_exec_time > 100  -- > 100ms
ORDER BY mean_exec_time DESC
LIMIT 20;

-- Top 20 queries by total time
SELECT
    calls,
    total_exec_time / 1000 / 60 AS total_minutes,
    mean_exec_time / 1000 AS mean_seconds,
    query
FROM pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT 20;

-- Reset statistics
SELECT pg_stat_statements_reset();
```

### Replication Monitoring

```sql
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
    now() - pg_stat_replication.reply_time AS lag_time
FROM pg_stat_replication;

-- Replication lag (on replica)
SELECT
    now() - pg_last_xact_replay_timestamp() AS replication_lag;
```

## SQL Server Monitoring

### Connection Monitoring

```sql
-- Current connections
SELECT
    DB_NAME(dbid) AS database_name,
    COUNT(*) AS connection_count,
    loginame,
    hostname,
    program_name
FROM sys.sysprocesses
GROUP BY DB_NAME(dbid), loginame, hostname, program_name
ORDER BY connection_count DESC;

-- Active requests
SELECT
    session_id,
    status,
    command,
    wait_type,
    wait_time,
    blocking_session_id,
    cpu_time,
    total_elapsed_time,
    reads,
    writes,
    logical_reads,
    text.text AS query_text
FROM sys.dm_exec_requests
CROSS APPLY sys.dm_exec_sql_text(sql_handle) AS text
WHERE session_id > 50  -- User sessions
ORDER BY total_elapsed_time DESC;
```

### Buffer Cache

```sql
-- Buffer cache hit ratio (should be >95%)
SELECT
    (a.cntr_value * 1.0 / b.cntr_value) * 100.0 AS buffer_cache_hit_ratio
FROM sys.dm_os_performance_counters a
CROSS JOIN (
    SELECT cntr_value
    FROM sys.dm_os_performance_counters
    WHERE counter_name = 'Buffer cache hit ratio base'
        AND object_name LIKE '%Buffer Manager%'
) b
WHERE a.counter_name = 'Buffer cache hit ratio'
    AND a.object_name LIKE '%Buffer Manager%';

-- Page life expectancy (should be > 300 seconds)
SELECT
    object_name,
    counter_name,
    cntr_value AS page_life_expectancy_seconds
FROM sys.dm_os_performance_counters
WHERE counter_name = 'Page life expectancy'
    AND object_name LIKE '%Buffer Manager%';
```

### Index Usage

```sql
-- Index usage statistics
SELECT
    OBJECT_NAME(s.object_id) AS table_name,
    i.name AS index_name,
    s.user_seeks,
    s.user_scans,
    s.user_lookups,
    s.user_updates,
    (SUM(a.total_pages) * 8) / 1024 AS index_size_mb
FROM sys.dm_db_index_usage_stats s
INNER JOIN sys.indexes i ON s.object_id = i.object_id AND s.index_id = i.index_id
INNER JOIN sys.partitions p ON i.object_id = p.object_id AND i.index_id = p.index_id
INNER JOIN sys.allocation_units a ON p.partition_id = a.container_id
WHERE s.database_id = DB_ID()
    AND OBJECTPROPERTY(s.object_id, 'IsUserTable') = 1
GROUP BY OBJECT_NAME(s.object_id), i.name, s.user_seeks, s.user_scans, s.user_lookups, s.user_updates
ORDER BY s.user_seeks + s.user_scans + s.user_lookups DESC;
```

### Wait Statistics

```sql
-- Top wait types
SELECT TOP 20
    wait_type,
    wait_time_ms / 1000.0 AS wait_time_s,
    (wait_time_ms - signal_wait_time_ms) / 1000.0 AS resource_wait_s,
    signal_wait_time_ms / 1000.0 AS signal_wait_s,
    waiting_tasks_count,
    wait_time_ms / NULLIF(waiting_tasks_count, 0) AS avg_wait_ms
FROM sys.dm_os_wait_stats
WHERE wait_type NOT IN (
    -- Filter out benign waits
    'CLR_SEMAPHORE', 'LAZYWRITER_SLEEP', 'RESOURCE_QUEUE',
    'SLEEP_TASK', 'SLEEP_SYSTEMTASK', 'SQLTRACE_BUFFER_FLUSH',
    'WAITFOR', 'LOGMGR_QUEUE', 'CHECKPOINT_QUEUE',
    'REQUEST_FOR_DEADLOCK_SEARCH', 'XE_TIMER_EVENT',
    'BROKER_TO_FLUSH', 'BROKER_TASK_STOP', 'CLR_MANUAL_EVENT',
    'CLR_AUTO_EVENT', 'DISPATCHER_QUEUE_SEMAPHORE'
)
ORDER BY wait_time_ms DESC;
```

### Query Store

```sql
-- Top queries by duration
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

## Monitoring Tools

### Prometheus + Grafana

**PostgreSQL exporter**:
```yaml
# docker-compose.yml
services:
  postgres_exporter:
    image: prometheuscommunity/postgres-exporter
    environment:
      DATA_SOURCE_NAME: "postgresql://user:password@postgres:5432/dbname?sslmode=disable"
    ports:
      - "9187:9187"
```

**Sample queries**:
```promql
# Connection count
pg_stat_database_numbackends

# Transaction rate
rate(pg_stat_database_xact_commit[5m])

# Cache hit ratio
pg_stat_database_blks_hit / (pg_stat_database_blks_hit + pg_stat_database_blks_read)

# Replication lag
pg_replication_lag
```

### Datadog

**PostgreSQL integration**:
```yaml
# /etc/datadog-agent/conf.d/postgres.d/conf.yaml
init_config:

instances:
  - host: localhost
    port: 5432
    username: datadog
    password: <PASSWORD>
    dbname: postgres
    tags:
      - env:production
```

### New Relic

**APM for database monitoring**:
- Slow query tracking
- Database throughput
- Query time breakdown
- Error rates

### pgBadger

**PostgreSQL log analyzer**:
```bash
# Enable logging in postgresql.conf
log_min_duration_statement = 100  # Log queries > 100ms
log_line_prefix = '%t [%p]: [%l-1] user=%u,db=%d,app=%a,client=%h '
log_checkpoints = on
log_connections = on
log_disconnections = on
log_lock_waits = on
log_temp_files = 0
log_autovacuum_min_duration = 0

# Generate report
pgbadger /var/log/postgresql/postgresql-*.log -o report.html
```

## Alerting

### Critical Alerts

**High connection count**:
```sql
-- PostgreSQL
SELECT count(*) FROM pg_stat_activity;
-- Alert if > 80% of max_connections
```

**Low cache hit ratio**:
```sql
-- Alert if cache hit ratio < 95%
```

**Replication lag**:
```sql
-- PostgreSQL
SELECT pg_wal_lsn_diff(sent_lsn, replay_lsn) FROM pg_stat_replication;
-- Alert if lag > 100MB

-- SQL Server
SELECT
    DATEDIFF(second, last_commit_time, GETDATE()) AS lag_seconds
FROM sys.dm_hadr_database_replica_states
WHERE is_local = 0;
-- Alert if lag > 60 seconds
```

**Disk space**:
```bash
# Alert if < 20% free space
df -h /var/lib/postgresql
```

**Long-running queries**:
```sql
-- PostgreSQL
SELECT pid, now() - query_start AS duration, query
FROM pg_stat_activity
WHERE state = 'active'
    AND (now() - query_start) > interval '5 minutes';
-- Alert if any queries > 5 minutes
```

**Deadlocks**:
```sql
-- PostgreSQL
SELECT deadlocks FROM pg_stat_database WHERE datname = 'mydb';
-- Alert if deadlocks increasing

-- SQL Server
SELECT * FROM sys.dm_os_performance_counters
WHERE counter_name = 'Number of Deadlocks/sec';
```

### Warning Alerts

- Connection count > 60% of max
- Cache hit ratio < 98%
- Autovacuum running for > 1 hour
- Table bloat > 30%
- Index fragmentation > 30%
- Long idle transactions (> 10 minutes)

## Sample Monitoring Dashboard

**Key metrics to display**:

1. **Overview**:
   - Database status (up/down)
   - Connection count
   - Queries per second
   - Transaction rate
   - Cache hit ratio

2. **Performance**:
   - Top slow queries
   - Average query time
   - Lock wait time
   - Deadlocks

3. **System**:
   - CPU usage
   - Memory usage
   - Disk I/O
   - Network I/O

4. **Replication**:
   - Replication lag
   - Replica status
   - WAL generation rate

5. **Storage**:
   - Database size growth
   - Table sizes
   - Index sizes
   - Disk space usage

## Monitoring Checklist

- [ ] Connection monitoring
- [ ] Query performance tracking (slow query log, pg_stat_statements, Query Store)
- [ ] Cache hit ratio monitoring
- [ ] Replication lag monitoring
- [ ] Disk space alerts
- [ ] Lock and blocking query detection
- [ ] Deadlock monitoring
- [ ] Transaction rate tracking
- [ ] System resource monitoring (CPU, memory, disk I/O)
- [ ] Backup success/failure alerts
- [ ] Index usage tracking
- [ ] Table bloat monitoring
- [ ] Dashboard for key metrics
- [ ] Alerting configured (email, Slack, PagerDuty)
- [ ] Runbooks for common issues

## Summary

- **Monitor key metrics**: Connections, queries, cache hit ratio, replication lag
- **Use monitoring tools**: Prometheus/Grafana, Datadog, New Relic
- **Configure alerting**: Critical alerts for production issues
- **Track slow queries**: pg_stat_statements, Query Store, slow query log
- **Watch system resources**: CPU, memory, disk I/O
- **Dashboard**: Visualize key metrics for quick health check
- **Regular review**: Weekly review of performance trends
