-- SQL Server Maintenance Queries

-- ============================================================================
-- INDEX MAINTENANCE
-- ============================================================================

-- Rebuild fragmented indexes
-- ALTER INDEX ALL ON [TableName] REBUILD WITH (ONLINE = ON, MAXDOP = 4);

-- Reorganize index
-- ALTER INDEX [IndexName] ON [TableName] REORGANIZE;

-- Update statistics
-- UPDATE STATISTICS [TableName] WITH FULLSCAN;

-- ============================================================================
-- DATABASE INTEGRITY CHECK
-- ============================================================================

-- Check database integrity
DBCC CHECKDB (N'MyDB') WITH NO_INFOMSGS;

-- Check table integrity
DBCC CHECKTABLE (N'TableName') WITH NO_INFOMSGS;

-- Check index integrity
DBCC CHECKIDENT (N'TableName', RESEED, 1000);

-- ============================================================================
-- SHRINK DATABASE/FILES (use cautiously)
-- ============================================================================

-- Shrink database (not recommended for production)
-- DBCC SHRINKDATABASE (N'MyDB', 10);  -- 10% free space

-- Shrink log file
-- DBCC SHRINKFILE (N'MyDB_log', 1024);  -- Shrink to 1GB

-- Better: Backup log to truncate
-- BACKUP LOG [MyDB] TO DISK = 'C:\Backup\MyDB_Log.trn';

-- ============================================================================
-- UPDATE STATISTICS
-- ============================================================================

-- Update all statistics in database
EXEC sp_updatestats;

-- Update statistics for specific table
UPDATE STATISTICS [TableName] WITH FULLSCAN;

-- Update statistics for specific index
UPDATE STATISTICS [TableName] [IndexName] WITH FULLSCAN;

-- Check statistics age
SELECT
    OBJECT_NAME(s.object_id) AS table_name,
    s.name AS stats_name,
    sp.last_updated,
    sp.rows,
    sp.rows_sampled,
    sp.modification_counter,
    CASE
        WHEN sp.modification_counter > sp.rows * 0.2 THEN 'UPDATE NEEDED'
        WHEN sp.last_updated < DATEADD(day, -7, GETDATE()) THEN 'STALE'
        ELSE 'OK'
    END AS status
FROM sys.stats s
CROSS APPLY sys.dm_db_stats_properties(s.object_id, s.stats_id) sp
WHERE s.object_id = OBJECT_ID('TableName');

-- ============================================================================
-- RECOMPILE STORED PROCEDURES
-- ============================================================================

-- Recompile specific procedure
EXEC sp_recompile 'ProcedureName';

-- Recompile all procedures
EXEC sp_recompile '?';  -- Recompile all in database

-- Clear procedure cache
DBCC FREEPROCCACHE;

-- ============================================================================
-- MONITOR LONG-RUNNING OPERATIONS
-- ============================================================================

-- Check progress of restore, backup, DBCC, index rebuild
SELECT
    session_id,
    command,
    percent_complete,
    CONVERT(VARCHAR(20), DATEADD(ms, estimated_completion_time, GETDATE()), 120) AS estimated_completion,
    estimated_completion_time / 1000 / 60 AS remaining_minutes,
    total_elapsed_time / 1000 / 60 AS elapsed_minutes
FROM sys.dm_exec_requests
WHERE percent_complete > 0
ORDER BY percent_complete DESC;

-- ============================================================================
-- AUTOMATED MAINTENANCE PLAN (T-SQL)
-- ============================================================================

-- Example maintenance script
DECLARE @sql NVARCHAR(MAX);
DECLARE @table NVARCHAR(256);
DECLARE @schema NVARCHAR(128);

-- 1. Update statistics for all tables
PRINT 'Starting statistics update...';
EXEC sp_updatestats;
PRINT 'Statistics updated.';

-- 2. Rebuild or reorganize indexes based on fragmentation
DECLARE index_cursor CURSOR FOR
SELECT
    OBJECT_SCHEMA_NAME(ips.object_id) AS schema_name,
    OBJECT_NAME(ips.object_id) AS table_name,
    i.name AS index_name,
    ips.avg_fragmentation_in_percent
FROM sys.dm_db_index_physical_stats(DB_ID(), NULL, NULL, NULL, 'LIMITED') ips
INNER JOIN sys.indexes i ON ips.object_id = i.object_id AND ips.index_id = i.index_id
WHERE ips.page_count > 1000
    AND ips.index_id > 0
    AND OBJECTPROPERTY(ips.object_id, 'IsUserTable') = 1;

OPEN index_cursor;
FETCH NEXT FROM index_cursor INTO @schema, @table, @sql, @sql;

WHILE @@FETCH_STATUS = 0
BEGIN
    -- Rebuild if > 30% fragmented
    IF CAST(@sql AS FLOAT) > 30
    BEGIN
        PRINT 'Rebuilding index: ' + @sql + ' on ' + @schema + '.' + @table;
        SET @sql = 'ALTER INDEX ' + QUOTENAME(@sql) + ' ON ' + QUOTENAME(@schema) + '.' + QUOTENAME(@table) + ' REBUILD WITH (ONLINE = ON, MAXDOP = 4)';
        EXEC sp_executesql @sql;
    END
    -- Reorganize if 10-30% fragmented
    ELSE IF CAST(@sql AS FLOAT) > 10
    BEGIN
        PRINT 'Reorganizing index: ' + @sql + ' on ' + @schema + '.' + @table;
        SET @sql = 'ALTER INDEX ' + QUOTENAME(@sql) + ' ON ' + QUOTENAME(@schema) + '.' + QUOTENAME(@table) + ' REORGANIZE';
        EXEC sp_executesql @sql;
    END;

    FETCH NEXT FROM index_cursor INTO @schema, @table, @sql, @sql;
END;

CLOSE index_cursor;
DEALLOCATE index_cursor;

-- 3. Database integrity check
PRINT 'Running integrity check...';
DBCC CHECKDB WITH NO_INFOMSGS;
PRINT 'Integrity check complete.';

-- ============================================================================
-- CLEANUP OLD BACKUP HISTORY
-- ============================================================================

-- Delete backup history older than 30 days
EXEC msdb.dbo.sp_delete_backuphistory @oldest_date = '2024-01-01';

-- ============================================================================
-- CHECK AND FIX ORPHANED USERS
-- ============================================================================

-- Find orphaned users
SELECT
    dp.name AS orphaned_user,
    dp.type_desc
FROM sys.database_principals dp
LEFT JOIN sys.server_principals sp ON dp.sid = sp.sid
WHERE sp.sid IS NULL
    AND dp.type IN ('S', 'U', 'G')
    AND dp.name NOT IN ('dbo', 'guest', 'INFORMATION_SCHEMA', 'sys');

-- Fix orphaned user
-- ALTER USER [UserName] WITH LOGIN = [LoginName];

-- ============================================================================
-- MONITOR AUTOGROWTH EVENTS
-- ============================================================================

-- Check autogrowth events from default trace
SELECT
    te.name AS event_name,
    t.DatabaseName,
    t.FileName,
    t.StartTime,
    (Duration / 1000) AS duration_ms,
    (IntegerData * 8 / 1024) AS growth_mb
FROM sys.fn_trace_gettable((
    SELECT path
    FROM sys.traces
    WHERE is_default = 1
), DEFAULT) t
JOIN sys.trace_events te ON t.EventClass = te.trace_event_id
WHERE te.name IN ('Data File Auto Grow', 'Log File Auto Grow')
    AND t.StartTime > DATEADD(day, -7, GETDATE())
ORDER BY t.StartTime DESC;

-- ============================================================================
-- MAINTENANCE CHECKLIST
-- ============================================================================

/*
Daily:
- [ ] Check for blocking queries
- [ ] Monitor disk space
- [ ] Verify backups completed
- [ ] Check error log for issues

Weekly:
- [ ] Update statistics for critical tables
- [ ] Check index fragmentation
- [ ] Review slow queries
- [ ] Monitor database growth

Monthly:
- [ ] Rebuild fragmented indexes
- [ ] Run integrity check (DBCC CHECKDB)
- [ ] Review and optimize poorly performing queries
- [ ] Clean up old backup history
- [ ] Review and remove unused indexes
- [ ] Test restore procedures
*/

-- ============================================================================
-- PERFORMANCE BASELINE
-- ============================================================================

-- Create baseline table
CREATE TABLE dbo.PerformanceBaseline (
    RecordedAt DATETIME DEFAULT GETDATE(),
    BufferCacheHitRatio DECIMAL(5,2),
    PageLifeExpectancy INT,
    BatchRequestsPerSec DECIMAL(18,2),
    TransactionsPerSec DECIMAL(18,2),
    UserConnections INT
);

-- Capture baseline (run periodically)
INSERT INTO dbo.PerformanceBaseline (
    BufferCacheHitRatio,
    PageLifeExpectancy,
    BatchRequestsPerSec,
    TransactionsPerSec,
    UserConnections
)
SELECT
    (SELECT (a.cntr_value * 1.0 / b.cntr_value) * 100.0
     FROM sys.dm_os_performance_counters a
     CROSS JOIN (SELECT cntr_value FROM sys.dm_os_performance_counters
                 WHERE counter_name = 'Buffer cache hit ratio base') b
     WHERE a.counter_name = 'Buffer cache hit ratio') AS BufferCacheHitRatio,
    (SELECT cntr_value
     FROM sys.dm_os_performance_counters
     WHERE counter_name = 'Page life expectancy') AS PageLifeExpectancy,
    (SELECT cntr_value
     FROM sys.dm_os_performance_counters
     WHERE counter_name = 'Batch Requests/sec') AS BatchRequestsPerSec,
    (SELECT cntr_value
     FROM sys.dm_os_performance_counters
     WHERE counter_name = 'Transactions/sec' AND instance_name = '_Total') AS TransactionsPerSec,
    (SELECT COUNT(*) FROM sys.dm_exec_sessions WHERE is_user_process = 1) AS UserConnections;
