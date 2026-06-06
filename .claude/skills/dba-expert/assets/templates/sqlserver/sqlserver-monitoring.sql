-- SQL Server Monitoring Queries

-- ============================================================================
-- CONNECTION MONITORING
-- ============================================================================

-- Current connections
SELECT
    DB_NAME(dbid) AS database_name,
    COUNT(*) AS connection_count,
    loginame,
    hostname,
    program_name,
    MAX(last_batch) AS last_activity
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
    total_elapsed_time / 1000.0 AS elapsed_seconds,
    reads,
    writes,
    logical_reads,
    SUBSTRING(text.text, (statement_start_offset/2) + 1,
        ((CASE statement_end_offset
            WHEN -1 THEN DATALENGTH(text.text)
            ELSE statement_end_offset
        END - statement_start_offset)/2) + 1) AS query_text
FROM sys.dm_exec_requests
CROSS APPLY sys.dm_exec_sql_text(sql_handle) AS text
WHERE session_id > 50  -- User sessions
ORDER BY total_elapsed_time DESC;

-- ============================================================================
-- BUFFER CACHE
-- ============================================================================

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

-- ============================================================================
-- WAIT STATISTICS
-- ============================================================================

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
    'CLR_SEMAPHORE', 'LAZYWRITER_SLEEP', 'RESOURCE_QUEUE',
    'SLEEP_TASK', 'SLEEP_SYSTEMTASK', 'SQLTRACE_BUFFER_FLUSH',
    'WAITFOR', 'LOGMGR_QUEUE', 'CHECKPOINT_QUEUE',
    'REQUEST_FOR_DEADLOCK_SEARCH', 'XE_TIMER_EVENT',
    'BROKER_TO_FLUSH', 'BROKER_TASK_STOP', 'CLR_MANUAL_EVENT',
    'CLR_AUTO_EVENT', 'DISPATCHER_QUEUE_SEMAPHORE',
    'FT_IFTS_SCHEDULER_IDLE_WAIT', 'XE_DISPATCHER_WAIT', 'XE_DISPATCHER_JOIN'
)
ORDER BY wait_time_ms DESC;

-- Clear wait stats (to measure over specific period)
-- DBCC SQLPERF('sys.dm_os_wait_stats', CLEAR);

-- ============================================================================
-- BLOCKING AND DEADLOCKS
-- ============================================================================

-- Find blocking queries
SELECT
    blocking.session_id AS blocking_session_id,
    blocked.session_id AS blocked_session_id,
    waitstat.wait_type,
    waitstat.wait_duration_ms,
    blocking_sql.text AS blocking_query,
    blocked_sql.text AS blocked_query
FROM sys.dm_exec_requests blocked
LEFT JOIN sys.dm_exec_requests blocking ON blocked.blocking_session_id = blocking.session_id
CROSS APPLY sys.dm_exec_sql_text(blocked.sql_handle) blocked_sql
CROSS APPLY sys.dm_exec_sql_text(blocking.sql_handle) blocking_sql
CROSS APPLY (
    SELECT wait_type, wait_time AS wait_duration_ms
    FROM sys.dm_os_waiting_tasks
    WHERE session_id = blocked.session_id
) waitstat
WHERE blocked.blocking_session_id > 0;

-- Deadlock information (from system health session)
SELECT
    XEventData.XEvent.value('(data[@name="deadlock_cycle_id"]/value)[1]', 'int') AS DeadlockID,
    XEventData.XEvent.value('(@timestamp)[1]', 'datetime2') AS DeadlockTime,
    XEventData.XEvent.query('.') AS DeadlockGraph
FROM (
    SELECT CAST(target_data AS XML) AS TargetData
    FROM sys.dm_xe_session_targets st
    JOIN sys.dm_xe_sessions s ON s.address = st.event_session_address
    WHERE s.name = 'system_health'
        AND st.target_name = 'ring_buffer'
) AS Data
CROSS APPLY TargetData.nodes('RingBufferTarget/event[@name="xml_deadlock_report"]') AS XEventData(XEvent)
ORDER BY DeadlockTime DESC;

-- ============================================================================
-- CPU-INTENSIVE QUERIES
-- ============================================================================

SELECT TOP 20
    SUBSTRING(qt.text, (qs.statement_start_offset/2) + 1,
        ((CASE qs.statement_end_offset
            WHEN -1 THEN DATALENGTH(qt.text)
            ELSE qs.statement_end_offset
        END - qs.statement_start_offset)/2) + 1) AS query_text,
    qs.execution_count,
    qs.total_worker_time / 1000 AS total_cpu_ms,
    qs.total_worker_time / qs.execution_count / 1000 AS avg_cpu_ms,
    qs.total_elapsed_time / 1000 AS total_elapsed_ms,
    qs.total_logical_reads,
    qs.total_logical_writes,
    qp.query_plan
FROM sys.dm_exec_query_stats qs
CROSS APPLY sys.dm_exec_sql_text(qs.sql_handle) qt
CROSS APPLY sys.dm_exec_query_plan(qs.plan_handle) qp
ORDER BY qs.total_worker_time DESC;

-- ============================================================================
-- I/O-INTENSIVE QUERIES
-- ============================================================================

SELECT TOP 20
    SUBSTRING(qt.text, (qs.statement_start_offset/2) + 1,
        ((CASE qs.statement_end_offset
            WHEN -1 THEN DATALENGTH(qt.text)
            ELSE qs.statement_end_offset
        END - qs.statement_start_offset)/2) + 1) AS query_text,
    qs.execution_count,
    qs.total_logical_reads,
    qs.total_logical_reads / qs.execution_count AS avg_logical_reads,
    qs.total_logical_writes,
    qs.total_physical_reads,
    qs.total_elapsed_time / 1000 AS total_elapsed_ms
FROM sys.dm_exec_query_stats qs
CROSS APPLY sys.dm_exec_sql_text(qs.sql_handle) qt
ORDER BY qs.total_logical_reads DESC;

-- ============================================================================
-- QUERY STORE (if enabled)
-- ============================================================================

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

-- ============================================================================
-- DATABASE SIZE AND GROWTH
-- ============================================================================

-- Database file sizes
SELECT
    DB_NAME(database_id) AS database_name,
    name AS file_name,
    type_desc,
    physical_name,
    size * 8 / 1024 AS size_mb,
    max_size * 8 / 1024 AS max_size_mb,
    growth,
    is_percent_growth
FROM sys.master_files
WHERE database_id = DB_ID()
ORDER BY type_desc, name;

-- Database size summary
EXEC sp_spaceused;

-- Table sizes
SELECT
    t.name AS table_name,
    SUM(a.total_pages) * 8 / 1024 AS total_space_mb,
    SUM(a.used_pages) * 8 / 1024 AS used_space_mb,
    (SUM(a.total_pages) - SUM(a.used_pages)) * 8 / 1024 AS unused_space_mb,
    p.rows
FROM sys.tables t
INNER JOIN sys.indexes i ON t.object_id = i.object_id
INNER JOIN sys.partitions p ON i.object_id = p.object_id AND i.index_id = p.index_id
INNER JOIN sys.allocation_units a ON p.partition_id = a.container_id
WHERE t.is_ms_shipped = 0
GROUP BY t.name, p.rows
ORDER BY total_space_mb DESC;

-- ============================================================================
-- BACKUP HISTORY
-- ============================================================================

-- Recent backups
SELECT TOP 20
    bs.database_name,
    bs.backup_start_date,
    bs.backup_finish_date,
    CASE bs.type
        WHEN 'D' THEN 'Full'
        WHEN 'I' THEN 'Differential'
        WHEN 'L' THEN 'Log'
    END AS backup_type,
    bs.backup_size / 1024 / 1024 AS backup_size_mb,
    bs.compressed_backup_size / 1024 / 1024 AS compressed_size_mb,
    bmf.physical_device_name
FROM msdb.dbo.backupset bs
INNER JOIN msdb.dbo.backupmediafamily bmf ON bs.media_set_id = bmf.media_set_id
WHERE bs.database_name = DB_NAME()
ORDER BY bs.backup_start_date DESC;

-- ============================================================================
-- INDEX MAINTENANCE HISTORY
-- ============================================================================

-- Recent index operations
SELECT TOP 20
    object_name,
    index_name,
    operation,
    start_time,
    end_time,
    DATEDIFF(minute, start_time, end_time) AS duration_minutes
FROM sys.dm_db_index_operational_stats(DB_ID(), NULL, NULL, NULL) ops
CROSS APPLY (
    SELECT
        OBJECT_NAME(ops.object_id) AS object_name,
        i.name AS index_name
    FROM sys.indexes i
    WHERE i.object_id = ops.object_id
        AND i.index_id = ops.index_id
) idx
WHERE start_time IS NOT NULL
ORDER BY start_time DESC;

-- ============================================================================
-- TEMPDB USAGE
-- ============================================================================

-- TempDB file usage
SELECT
    name,
    size * 8 / 1024 AS size_mb,
    max_size * 8 / 1024 AS max_size_mb,
    (size * 8.0 / 1024) - ((size - FILEPROPERTY(name, 'SpaceUsed')) * 8.0 / 1024) AS used_mb
FROM tempdb.sys.database_files;

-- Sessions using TempDB
SELECT
    session_id,
    SUM(user_objects_alloc_page_count) * 8 / 1024 AS user_objects_mb,
    SUM(internal_objects_alloc_page_count) * 8 / 1024 AS internal_objects_mb
FROM sys.dm_db_session_space_usage
GROUP BY session_id
HAVING SUM(user_objects_alloc_page_count + internal_objects_alloc_page_count) > 0
ORDER BY user_objects_mb + internal_objects_mb DESC;
