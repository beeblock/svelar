# SQL Server Comprehensive Guide

## Configuration and Best Practices

### Memory Configuration

```sql
-- Configure max server memory (leave 4GB for OS)
-- For 32GB server: 28GB for SQL Server
EXEC sp_configure 'max server memory (MB)', 28672;
RECONFIGURE;

-- Configure min server memory
EXEC sp_configure 'min server memory (MB)', 16384;
RECONFIGURE;

-- Check current memory usage
SELECT
    physical_memory_in_use_kb / 1024 AS memory_used_mb,
    large_page_allocations_kb / 1024 AS large_page_mb,
    locked_page_allocations_kb / 1024 AS locked_page_mb,
    total_virtual_address_space_kb / 1024 AS virtual_address_space_mb
FROM sys.dm_os_process_memory;
```

### Parallelism Configuration

```sql
-- Cost threshold for parallelism (default 5 is too low)
EXEC sp_configure 'cost threshold for parallelism', 50;
RECONFIGURE;

-- Max degree of parallelism (MAXDOP)
-- Match physical cores, not hyperthreaded cores
-- For 8 physical cores:
EXEC sp_configure 'max degree of parallelism', 8;
RECONFIGURE;

-- Database-level setting
ALTER DATABASE SCOPED CONFIGURATION SET MAXDOP = 4;

-- Query-level hint
SELECT * FROM Orders
OPTION (MAXDOP 4);
```

### TempDB Configuration

```sql
-- Best practice: 1 tempdb file per physical core, max 8
-- All files should be same size
-- On fast storage (SSD)

-- Add tempdb files (requires restart)
ALTER DATABASE tempdb
ADD FILE (
    NAME = tempdev2,
    FILENAME = 'T:\MSSQL\DATA\tempdb2.ndf',
    SIZE = 8GB,
    FILEGROWTH = 512MB
);

-- Check tempdb files
SELECT
    name,
    physical_name,
    size * 8 / 1024 AS size_mb,
    growth,
    is_percent_growth
FROM sys.master_files
WHERE database_id = DB_ID('tempdb');
```

### Enable Important Features

```sql
-- Enable Query Store (query performance tracking)
ALTER DATABASE [MyDB] SET QUERY_STORE = ON;
ALTER DATABASE [MyDB] SET QUERY_STORE (
    OPERATION_MODE = READ_WRITE,
    DATA_FLUSH_INTERVAL_SECONDS = 900,
    INTERVAL_LENGTH_MINUTES = 60,
    MAX_STORAGE_SIZE_MB = 1024,
    QUERY_CAPTURE_MODE = AUTO
);

-- Enable optimize for ad hoc workloads (reduce plan cache bloat)
EXEC sp_configure 'optimize for ad hoc workloads', 1;
RECONFIGURE;

-- Enable backup compression (saves space and time)
EXEC sp_configure 'backup compression default', 1;
RECONFIGURE;
```

## Index Management

### Index Types

**Clustered Index**:
```sql
-- One per table, determines physical row order
CREATE CLUSTERED INDEX IX_Orders_OrderDate
ON Orders(OrderDate DESC);

-- Primary key creates clustered index by default
CREATE TABLE Orders (
    OrderID INT PRIMARY KEY CLUSTERED,  -- Clustered
    CustomerID INT NOT NULL,
    OrderDate DATETIME NOT NULL
);
```

**Nonclustered Index**:
```sql
-- Multiple per table, separate structure with row pointers
CREATE NONCLUSTERED INDEX IX_Orders_CustomerID
ON Orders(CustomerID);

-- Composite index (column order matters)
CREATE NONCLUSTERED INDEX IX_Orders_Customer_Date
ON Orders(CustomerID, OrderDate DESC);
```

**Covering Index (INCLUDE)**:
```sql
-- Include columns for index coverage without affecting key order
CREATE NONCLUSTERED INDEX IX_Orders_Customer_Covering
ON Orders(CustomerID, OrderDate DESC)
INCLUDE (Total, Status);

-- Enables index seek + include columns without key lookup
```

**Filtered Index**:
```sql
-- Index only subset of rows
CREATE NONCLUSTERED INDEX IX_Orders_Active
ON Orders(OrderDate DESC)
WHERE Status = 'Active';

-- Partial unique index
CREATE UNIQUE NONCLUSTERED INDEX IX_Users_Email_Active
ON Users(Email)
WHERE DeletedAt IS NULL;
```

**Columnstore Index**:
```sql
-- For analytics and data warehouse queries
-- Clustered columnstore (entire table)
CREATE CLUSTERED COLUMNSTORE INDEX CCI_Sales
ON Sales;

-- Nonclustered columnstore (for specific queries)
CREATE NONCLUSTERED COLUMNSTORE INDEX NCCI_Orders_Analytics
ON Orders(CustomerID, OrderDate, Total, ProductID);

-- With filter for hot data
CREATE NONCLUSTERED COLUMNSTORE INDEX NCCI_Orders_Recent
ON Orders(CustomerID, OrderDate, Total)
WHERE OrderDate >= '2024-01-01';
```

### Index Analysis

**Missing Indexes**:
```sql
-- Find missing indexes with highest impact
SELECT
    CONVERT(DECIMAL(18,2),
        migs.avg_total_user_cost * migs.avg_user_impact * (migs.user_seeks + migs.user_scans)
    ) AS improvement_measure,
    DB_NAME(mid.database_id) AS database_name,
    mid.statement AS table_name,
    mid.equality_columns,
    mid.inequality_columns,
    mid.included_columns,
    migs.unique_compiles,
    migs.user_seeks,
    migs.user_scans,
    migs.avg_total_user_cost,
    migs.avg_user_impact,
    'CREATE NONCLUSTERED INDEX IX_' +
        OBJECT_NAME(mid.object_id, mid.database_id) + '_' +
        REPLACE(REPLACE(REPLACE(ISNULL(mid.equality_columns, ''), ', ', '_'), '[', ''), ']', '') +
        CASE WHEN mid.inequality_columns IS NOT NULL
             THEN '_' + REPLACE(REPLACE(REPLACE(mid.inequality_columns, ', ', '_'), '[', ''), ']', '')
             ELSE '' END +
    ' ON ' + mid.statement + ' (' +
        ISNULL(mid.equality_columns, '') +
        CASE WHEN mid.equality_columns IS NOT NULL AND mid.inequality_columns IS NOT NULL
             THEN ', ' ELSE '' END +
        ISNULL(mid.inequality_columns, '') + ')' +
        CASE WHEN mid.included_columns IS NOT NULL
             THEN ' INCLUDE (' + mid.included_columns + ')'
             ELSE '' END AS create_index_statement
FROM sys.dm_db_missing_index_groups mig
INNER JOIN sys.dm_db_missing_index_group_stats migs ON mig.index_group_handle = migs.group_handle
INNER JOIN sys.dm_db_missing_index_details mid ON mig.index_handle = mid.index_handle
WHERE migs.avg_total_user_cost * migs.avg_user_impact * (migs.user_seeks + migs.user_scans) > 10000
    AND mid.database_id = DB_ID()
ORDER BY improvement_measure DESC;
```

**Unused Indexes**:
```sql
-- Find indexes with zero usage
SELECT
    OBJECT_NAME(i.object_id) AS table_name,
    i.name AS index_name,
    i.type_desc,
    s.user_seeks,
    s.user_scans,
    s.user_lookups,
    s.user_updates,
    p.rows AS row_count,
    (SUM(a.total_pages) * 8) / 1024 AS index_size_mb
FROM sys.indexes i
LEFT JOIN sys.dm_db_index_usage_stats s ON i.object_id = s.object_id AND i.index_id = s.index_id
INNER JOIN sys.partitions p ON i.object_id = p.object_id AND i.index_id = p.index_id
INNER JOIN sys.allocation_units a ON p.partition_id = a.container_id
WHERE OBJECTPROPERTY(i.object_id, 'IsUserTable') = 1
    AND i.index_id > 0  -- Exclude heap
    AND (s.user_seeks + s.user_scans + s.user_lookups = 0 OR s.index_id IS NULL)
    AND s.database_id = DB_ID() OR s.database_id IS NULL
GROUP BY OBJECT_NAME(i.object_id), i.name, i.type_desc, s.user_seeks, s.user_scans, s.user_lookups, s.user_updates, p.rows
HAVING SUM(p.rows) > 0
ORDER BY index_size_mb DESC;
```

**Duplicate Indexes**:
```sql
-- Find duplicate or overlapping indexes
WITH IndexColumns AS (
    SELECT
        OBJECT_NAME(ic.object_id) AS table_name,
        i.name AS index_name,
        i.index_id,
        i.type_desc,
        STUFF((
            SELECT ', ' + COL_NAME(ic2.object_id, ic2.column_id)
            FROM sys.index_columns ic2
            WHERE ic2.object_id = ic.object_id
                AND ic2.index_id = ic.index_id
                AND ic2.is_included_column = 0
            ORDER BY ic2.key_ordinal
            FOR XML PATH('')
        ), 1, 2, '') AS key_columns,
        STUFF((
            SELECT ', ' + COL_NAME(ic3.object_id, ic3.column_id)
            FROM sys.index_columns ic3
            WHERE ic3.object_id = ic.object_id
                AND ic3.index_id = ic.index_id
                AND ic3.is_included_column = 1
            ORDER BY ic3.column_id
            FOR XML PATH('')
        ), 1, 2, '') AS included_columns
    FROM sys.index_columns ic
    INNER JOIN sys.indexes i ON ic.object_id = i.object_id AND ic.index_id = i.index_id
    WHERE OBJECTPROPERTY(ic.object_id, 'IsUserTable') = 1
    GROUP BY ic.object_id, i.name, i.index_id, i.type_desc
)
SELECT
    ic1.table_name,
    ic1.index_name AS index1,
    ic2.index_name AS index2,
    ic1.key_columns,
    ic1.included_columns
FROM IndexColumns ic1
INNER JOIN IndexColumns ic2 ON ic1.table_name = ic2.table_name
    AND ic1.index_id < ic2.index_id
    AND ic1.key_columns = ic2.key_columns
ORDER BY ic1.table_name, ic1.index_name;
```

**Index Fragmentation**:
```sql
-- Check index fragmentation
SELECT
    OBJECT_NAME(ips.object_id) AS table_name,
    i.name AS index_name,
    ips.index_type_desc,
    ips.avg_fragmentation_in_percent,
    ips.page_count,
    CASE
        WHEN ips.avg_fragmentation_in_percent > 30 THEN 'REBUILD'
        WHEN ips.avg_fragmentation_in_percent > 10 THEN 'REORGANIZE'
        ELSE 'OK'
    END AS recommendation
FROM sys.dm_db_index_physical_stats(DB_ID(), NULL, NULL, NULL, 'LIMITED') ips
INNER JOIN sys.indexes i ON ips.object_id = i.object_id AND ips.index_id = i.index_id
WHERE ips.page_count > 1000  -- Ignore small indexes
    AND OBJECTPROPERTY(ips.object_id, 'IsUserTable') = 1
ORDER BY ips.avg_fragmentation_in_percent DESC;
```

### Index Maintenance

```sql
-- Reorganize index (online, minimal blocking)
ALTER INDEX IX_Orders_CustomerID ON Orders REORGANIZE;

-- Rebuild index (offline, more thorough)
ALTER INDEX IX_Orders_CustomerID ON Orders REBUILD;

-- Rebuild index online (Enterprise Edition)
ALTER INDEX IX_Orders_CustomerID ON Orders REBUILD WITH (ONLINE = ON, MAXDOP = 4);

-- Rebuild all indexes on table
ALTER INDEX ALL ON Orders REBUILD WITH (ONLINE = ON, MAXDOP = 4);

-- Update statistics with full scan
UPDATE STATISTICS Orders WITH FULLSCAN;

-- Automated maintenance script
DECLARE @sql NVARCHAR(MAX);
DECLARE @fragmentation DECIMAL(5,2);
DECLARE @objectid INT;
DECLARE @indexid INT;

DECLARE index_cursor CURSOR FOR
SELECT object_id, index_id, avg_fragmentation_in_percent
FROM sys.dm_db_index_physical_stats(DB_ID(), NULL, NULL, NULL, 'LIMITED')
WHERE page_count > 1000
    AND index_id > 0;

OPEN index_cursor;
FETCH NEXT FROM index_cursor INTO @objectid, @indexid, @fragmentation;

WHILE @@FETCH_STATUS = 0
BEGIN
    IF @fragmentation > 30
        SET @sql = 'ALTER INDEX ' + QUOTENAME((SELECT name FROM sys.indexes WHERE object_id = @objectid AND index_id = @indexid)) +
                   ' ON ' + QUOTENAME(OBJECT_NAME(@objectid)) + ' REBUILD WITH (ONLINE = ON, MAXDOP = 4)';
    ELSE IF @fragmentation > 10
        SET @sql = 'ALTER INDEX ' + QUOTENAME((SELECT name FROM sys.indexes WHERE object_id = @objectid AND index_id = @indexid)) +
                   ' ON ' + QUOTENAME(OBJECT_NAME(@objectid)) + ' REORGANIZE';

    IF @sql IS NOT NULL
    BEGIN
        PRINT @sql;
        EXEC sp_executesql @sql;
    END;

    FETCH NEXT FROM index_cursor INTO @objectid, @indexid, @fragmentation;
END;

CLOSE index_cursor;
DEALLOCATE index_cursor;
```

## Query Optimization

### Execution Plan Analysis

```sql
-- Enable actual execution plan
SET STATISTICS TIME ON;
SET STATISTICS IO ON;

-- Run query
SELECT o.OrderID, o.OrderDate, c.CustomerName
FROM Orders o
INNER JOIN Customers c ON o.CustomerID = c.CustomerID
WHERE o.OrderDate >= '2024-01-01';

-- Expensive operators to watch for:
-- - Table Scan (bad for large tables)
-- - Clustered Index Scan (full table scan)
-- - Key Lookup (bookmark lookup, add covering index)
-- - Sort (add index for ORDER BY)
-- - Hash Match (expensive joins)
-- - Implicit Conversion (fix data type mismatches)
```

**Common Issues in Execution Plans**:

1. **Table Scan**:
```sql
-- Problem: No index
SELECT * FROM Orders WHERE CustomerID = 123;
-- Fix: Add index
CREATE NONCLUSTERED INDEX IX_Orders_CustomerID ON Orders(CustomerID);
```

2. **Key Lookup**:
```sql
-- Problem: Index doesn't include all columns
SELECT OrderID, CustomerID, Total FROM Orders WHERE CustomerID = 123;
-- Shows Index Seek + Key Lookup
-- Fix: Covering index
CREATE NONCLUSTERED INDEX IX_Orders_CustomerID_Covering
ON Orders(CustomerID) INCLUDE (Total);
```

3. **Implicit Conversion**:
```sql
-- Problem: Data type mismatch
-- Column is INT, parameter is VARCHAR
SELECT * FROM Orders WHERE OrderID = '123';  -- Implicit conversion
-- Fix: Use correct data type
SELECT * FROM Orders WHERE OrderID = 123;
```

4. **Parameter Sniffing**:
```sql
-- Problem: Cached plan optimized for first parameter
-- Fix: Use OPTION (RECOMPILE) or optimize for unknown
SELECT * FROM Orders WHERE CustomerID = @CustomerID
OPTION (RECOMPILE);

-- Or
SELECT * FROM Orders WHERE CustomerID = @CustomerID
OPTION (OPTIMIZE FOR (@CustomerID UNKNOWN));
```

### Query Store

```sql
-- Enable Query Store
ALTER DATABASE [MyDB] SET QUERY_STORE = ON;

-- Top queries by duration
SELECT TOP 20
    qsq.query_id,
    qsqt.query_sql_text,
    qsrs.count_executions,
    qsrs.avg_duration / 1000.0 AS avg_duration_ms,
    qsrs.max_duration / 1000.0 AS max_duration_ms,
    qsrs.avg_logical_io_reads,
    qsrs.avg_cpu_time / 1000.0 AS avg_cpu_ms
FROM sys.query_store_query qsq
INNER JOIN sys.query_store_query_text qsqt ON qsq.query_text_id = qsqt.query_text_id
INNER JOIN sys.query_store_plan qsp ON qsq.query_id = qsp.query_id
INNER JOIN sys.query_store_runtime_stats qsrs ON qsp.plan_id = qsrs.plan_id
WHERE qsrs.last_execution_time > DATEADD(day, -7, GETUTCDATE())
ORDER BY qsrs.avg_duration DESC;

-- Queries with plan regression
SELECT
    qsq.query_id,
    qsqt.query_sql_text,
    qsp.plan_id,
    qsrs.avg_duration / 1000.0 AS avg_duration_ms,
    qsrs.last_execution_time
FROM sys.query_store_query qsq
INNER JOIN sys.query_store_query_text qsqt ON qsq.query_text_id = qsqt.query_text_id
INNER JOIN sys.query_store_plan qsp ON qsq.query_id = qsp.query_id
INNER JOIN sys.query_store_runtime_stats qsrs ON qsp.plan_id = qsrs.plan_id
WHERE qsrs.last_execution_time > DATEADD(day, -1, GETUTCDATE())
ORDER BY qsq.query_id, qsrs.last_execution_time DESC;

-- Force a specific plan
EXEC sp_query_store_force_plan @query_id = 123, @plan_id = 456;

-- Unforce plan
EXEC sp_query_store_unforce_plan @query_id = 123, @plan_id = 456;
```

### DMV Queries for Performance

**CPU-intensive queries**:
```sql
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
```

**I/O-intensive queries**:
```sql
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
```

## High Availability

### Always On Availability Groups

**Prerequisites**:
- Windows Server Failover Clustering (WSFC)
- SQL Server Enterprise Edition
- Same SQL Server version across replicas

**Setup**:
```sql
-- Enable Always On
EXEC sp_configure 'show advanced options', 1;
RECONFIGURE;
EXEC sp_configure 'hadr enabled', 1;
RECONFIGURE;
-- Requires restart

-- Create availability group (on primary)
CREATE AVAILABILITY GROUP AG_MyApp
FOR DATABASE MyDB, MyDB2
REPLICA ON
    N'Server1' WITH (
        ENDPOINT_URL = N'TCP://Server1:5022',
        AVAILABILITY_MODE = SYNCHRONOUS_COMMIT,
        FAILOVER_MODE = AUTOMATIC,
        SECONDARY_ROLE (ALLOW_CONNECTIONS = READ_ONLY)
    ),
    N'Server2' WITH (
        ENDPOINT_URL = N'TCP://Server2:5022',
        AVAILABILITY_MODE = SYNCHRONOUS_COMMIT,
        FAILOVER_MODE = AUTOMATIC,
        SECONDARY_ROLE (ALLOW_CONNECTIONS = READ_ONLY)
    ),
    N'Server3' WITH (
        ENDPOINT_URL = N'TCP://Server3:5022',
        AVAILABILITY_MODE = ASYNCHRONOUS_COMMIT,
        FAILOVER_MODE = MANUAL,
        SECONDARY_ROLE (ALLOW_CONNECTIONS = READ_ONLY)
    );

-- Join secondary replicas
ALTER AVAILABILITY GROUP AG_MyApp JOIN;
ALTER DATABASE MyDB SET HADR AVAILABILITY GROUP = AG_MyApp;

-- Monitor AG health
SELECT
    ag.name AS ag_name,
    ar.replica_server_name,
    ar.availability_mode_desc,
    ar.failover_mode_desc,
    ars.role_desc,
    ars.operational_state_desc,
    ars.connected_state_desc,
    ars.synchronization_health_desc
FROM sys.availability_groups ag
INNER JOIN sys.availability_replicas ar ON ag.group_id = ar.group_id
INNER JOIN sys.dm_hadr_availability_replica_states ars ON ar.replica_id = ars.replica_id;
```

### Database Mirroring (Legacy)

```sql
-- Deprecated, use Always On instead
-- Included for legacy systems

-- On principal
ALTER DATABASE MyDB SET PARTNER = 'TCP://MirrorServer:5022';

-- On mirror
ALTER DATABASE MyDB SET PARTNER = 'TCP://PrincipalServer:5022';

-- Add witness (for automatic failover)
ALTER DATABASE MyDB SET WITNESS = 'TCP://WitnessServer:5022';
```

### Log Shipping

```sql
-- Simple disaster recovery solution
-- Primary → Copy transaction logs → Secondary

-- On primary: Enable log shipping
EXEC master.dbo.sp_add_log_shipping_primary_database
    @database = N'MyDB',
    @backup_directory = N'\\BackupServer\LogShipping\MyDB',
    @backup_share = N'\\BackupServer\LogShipping\MyDB',
    @backup_job_name = N'LogShipping_Backup_MyDB',
    @backup_retention_period = 4320,  -- 3 days
    @monitor_server = N'MonitorServer',
    @monitor_server_security_mode = 1;

-- On secondary: Restore and configure
RESTORE DATABASE MyDB
FROM DISK = '\\BackupServer\LogShipping\MyDB\MyDB_backup.bak'
WITH NORECOVERY;

EXEC master.dbo.sp_add_log_shipping_secondary_database
    @secondary_database = N'MyDB',
    @primary_server = N'PrimaryServer',
    @primary_database = N'MyDB',
    @restore_delay = 0,
    @restore_mode = 0,  -- NORECOVERY
    @disconnect_users = 1;
```

## Backup and Recovery

### Backup Types

```sql
-- Full backup
BACKUP DATABASE [MyDB]
TO DISK = N'C:\Backup\MyDB_Full.bak'
WITH COMPRESSION, STATS = 10, CHECKSUM;

-- Differential backup (changes since last full)
BACKUP DATABASE [MyDB]
TO DISK = N'C:\Backup\MyDB_Diff.bak'
WITH DIFFERENTIAL, COMPRESSION, STATS = 10;

-- Transaction log backup (for point-in-time recovery)
BACKUP LOG [MyDB]
TO DISK = N'C:\Backup\MyDB_Log.trn'
WITH COMPRESSION, STATS = 10;

-- Copy-only backup (doesn't affect backup chain)
BACKUP DATABASE [MyDB]
TO DISK = N'C:\Backup\MyDB_CopyOnly.bak'
WITH COPY_ONLY, COMPRESSION;
```

### Restore Scenarios

**Simple restore**:
```sql
-- Restore full backup
RESTORE DATABASE [MyDB]
FROM DISK = N'C:\Backup\MyDB_Full.bak'
WITH REPLACE, RECOVERY;
```

**Point-in-time restore**:
```sql
-- Restore full backup
RESTORE DATABASE [MyDB]
FROM DISK = N'C:\Backup\MyDB_Full.bak'
WITH NORECOVERY, REPLACE;

-- Restore differential backup
RESTORE DATABASE [MyDB]
FROM DISK = N'C:\Backup\MyDB_Diff.bak'
WITH NORECOVERY;

-- Restore transaction logs up to specific time
RESTORE LOG [MyDB]
FROM DISK = N'C:\Backup\MyDB_Log1.trn'
WITH NORECOVERY;

RESTORE LOG [MyDB]
FROM DISK = N'C:\Backup\MyDB_Log2.trn'
WITH RECOVERY, STOPAT = '2024-01-15 14:30:00';
```

**Page-level restore** (for corruption):
```sql
-- Identify damaged pages
SELECT * FROM msdb.dbo.suspect_pages;

-- Restore specific pages
RESTORE DATABASE [MyDB] PAGE = '1:257, 1:258'
FROM DISK = N'C:\Backup\MyDB_Full.bak'
WITH NORECOVERY;

BACKUP LOG [MyDB]
TO DISK = N'C:\Backup\MyDB_TailLog.trn'
WITH NORECOVERY;

RESTORE LOG [MyDB]
FROM DISK = N'C:\Backup\MyDB_TailLog.trn'
WITH RECOVERY;
```

### Backup Verification

```sql
-- Verify backup integrity
RESTORE VERIFYONLY
FROM DISK = N'C:\Backup\MyDB_Full.bak';

-- Restore to test database
RESTORE DATABASE [MyDB_Test]
FROM DISK = N'C:\Backup\MyDB_Full.bak'
WITH MOVE 'MyDB' TO 'C:\Data\MyDB_Test.mdf',
     MOVE 'MyDB_log' TO 'C:\Data\MyDB_Test_log.ldf',
     RECOVERY;

-- Check backup history
SELECT
    bs.database_name,
    bs.backup_start_date,
    bs.backup_finish_date,
    bs.type,  -- D=Full, I=Differential, L=Log
    bmf.physical_device_name,
    bs.compressed_backup_size / 1024 / 1024 AS size_mb
FROM msdb.dbo.backupset bs
INNER JOIN msdb.dbo.backupmediafamily bmf ON bs.media_set_id = bmf.media_set_id
WHERE bs.database_name = 'MyDB'
ORDER BY bs.backup_start_date DESC;
```

## Monitoring and Troubleshooting

### Wait Statistics

```sql
-- Top wait types
SELECT TOP 20
    wait_type,
    wait_time_ms / 1000.0 AS wait_time_s,
    (wait_time_ms - signal_wait_time_ms) / 1000.0 AS resource_wait_s,
    signal_wait_time_ms / 1000.0 AS signal_wait_s,
    waiting_tasks_count,
    wait_time_ms / waiting_tasks_count AS avg_wait_ms
FROM sys.dm_os_wait_stats
WHERE wait_type NOT IN (
    'CLR_SEMAPHORE', 'LAZYWRITER_SLEEP', 'RESOURCE_QUEUE',
    'SLEEP_TASK', 'SLEEP_SYSTEMTASK', 'SQLTRACE_BUFFER_FLUSH',
    'WAITFOR', 'LOGMGR_QUEUE', 'CHECKPOINT_QUEUE', 'REQUEST_FOR_DEADLOCK_SEARCH',
    'XE_TIMER_EVENT', 'BROKER_TO_FLUSH', 'BROKER_TASK_STOP', 'CLR_MANUAL_EVENT',
    'CLR_AUTO_EVENT', 'DISPATCHER_QUEUE_SEMAPHORE', 'FT_IFTS_SCHEDULER_IDLE_WAIT',
    'XE_DISPATCHER_WAIT', 'XE_DISPATCHER_JOIN', 'SQLTRACE_INCREMENTAL_FLUSH_SLEEP'
)
ORDER BY wait_time_ms DESC;

-- Clear wait stats (to measure over specific period)
DBCC SQLPERF('sys.dm_os_wait_stats', CLEAR);
```

### Blocking and Deadlocks

```sql
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

-- Kill blocking session (use with caution)
KILL 52;  -- Session ID

-- Enable deadlock trace flag
DBCC TRACEON(1222, -1);  -- Deadlock info to error log

-- Query deadlock graph from system health session
SELECT
    XEventData.XEvent.value('(data[@name="deadlock_cycle_id"]/value)[1]', 'int') AS DeadlockID,
    XEventData.XEvent.query('.') AS DeadlockGraph
FROM (
    SELECT CAST(target_data AS XML) AS TargetData
    FROM sys.dm_xe_session_targets st
    JOIN sys.dm_xe_sessions s ON s.address = st.event_session_address
    WHERE s.name = 'system_health'
        AND st.target_name = 'ring_buffer'
) AS Data
CROSS APPLY TargetData.nodes('RingBufferTarget/event[@name="xml_deadlock_report"]') AS XEventData(XEvent);
```

### Performance Counters

```sql
-- SQL Server performance counters
SELECT
    object_name,
    counter_name,
    instance_name,
    cntr_value,
    cntr_type
FROM sys.dm_os_performance_counters
WHERE object_name LIKE '%Buffer Manager%'
    OR object_name LIKE '%SQL Statistics%'
    OR object_name LIKE '%Locks%'
ORDER BY object_name, counter_name;

-- Page life expectancy (should be > 300 seconds)
SELECT
    object_name,
    counter_name,
    cntr_value
FROM sys.dm_os_performance_counters
WHERE counter_name = 'Page life expectancy';

-- Buffer cache hit ratio (should be > 95%)
SELECT
    (a.cntr_value * 1.0 / b.cntr_value) * 100.0 AS buffer_cache_hit_ratio
FROM sys.dm_os_performance_counters a
CROSS JOIN (
    SELECT cntr_value
    FROM sys.dm_os_performance_counters
    WHERE counter_name = 'Buffer cache hit ratio base'
) b
WHERE a.counter_name = 'Buffer cache hit ratio'
    AND a.object_name LIKE '%Buffer Manager%';
```

## Best Practices Summary

1. **Memory**: Configure max server memory, leave 4GB for OS
2. **Parallelism**: Cost threshold 50, MAXDOP = physical cores
3. **TempDB**: One file per core (max 8), equal sizes
4. **Query Store**: Enable for all databases
5. **Indexes**: Monitor usage, remove unused, maintain fragmentation
6. **Statistics**: Keep up to date, use FULLSCAN for critical tables
7. **Backups**: Full + differential + transaction log, test restores
8. **Maintenance**: Regular index maintenance, DBCC CHECKDB
9. **Monitoring**: Wait stats, Query Store, DMVs
10. **High Availability**: Always On AG for mission-critical databases
