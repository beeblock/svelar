-- SQL Server Index Analysis and Management

-- ============================================================================
-- MISSING INDEX SUGGESTIONS
-- ============================================================================

-- Find missing indexes with highest impact
SELECT TOP 20
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
             ELSE '' END +
    ';' AS create_index_statement
FROM sys.dm_db_missing_index_groups mig
INNER JOIN sys.dm_db_missing_index_group_stats migs ON mig.index_group_handle = migs.group_handle
INNER JOIN sys.dm_db_missing_index_details mid ON mig.index_handle = mid.index_handle
WHERE migs.avg_total_user_cost * migs.avg_user_impact * (migs.user_seeks + migs.user_scans) > 10000
    AND mid.database_id = DB_ID()
ORDER BY improvement_measure DESC;

-- ============================================================================
-- UNUSED INDEXES
-- ============================================================================

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
LEFT JOIN sys.dm_db_index_usage_stats s ON i.object_id = s.object_id AND i.index_id = s.index_id AND s.database_id = DB_ID()
INNER JOIN sys.partitions p ON i.object_id = p.object_id AND i.index_id = p.index_id
INNER JOIN sys.allocation_units a ON p.partition_id = a.container_id
WHERE OBJECTPROPERTY(i.object_id, 'IsUserTable') = 1
    AND i.index_id > 0  -- Exclude heap
    AND (s.user_seeks + s.user_scans + s.user_lookups = 0 OR s.index_id IS NULL)
GROUP BY OBJECT_NAME(i.object_id), i.name, i.type_desc, s.user_seeks, s.user_scans, s.user_lookups, s.user_updates, p.rows
HAVING SUM(p.rows) > 0
ORDER BY index_size_mb DESC;

-- ============================================================================
-- DUPLICATE INDEXES
-- ============================================================================

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

-- ============================================================================
-- INDEX FRAGMENTATION
-- ============================================================================

-- Check index fragmentation
SELECT
    OBJECT_NAME(ips.object_id) AS table_name,
    i.name AS index_name,
    ips.index_type_desc,
    ips.avg_fragmentation_in_percent,
    ips.page_count,
    ips.avg_page_space_used_in_percent,
    CASE
        WHEN ips.avg_fragmentation_in_percent > 30 THEN 'REBUILD'
        WHEN ips.avg_fragmentation_in_percent > 10 THEN 'REORGANIZE'
        ELSE 'OK'
    END AS recommendation,
    'ALTER INDEX ' + QUOTENAME(i.name) + ' ON ' + QUOTENAME(OBJECT_SCHEMA_NAME(ips.object_id)) + '.' + QUOTENAME(OBJECT_NAME(ips.object_id)) +
    CASE
        WHEN ips.avg_fragmentation_in_percent > 30 THEN ' REBUILD WITH (ONLINE = ON, MAXDOP = 4);'
        WHEN ips.avg_fragmentation_in_percent > 10 THEN ' REORGANIZE;'
        ELSE ' -- OK, no action needed'
    END AS maintenance_command
FROM sys.dm_db_index_physical_stats(DB_ID(), NULL, NULL, NULL, 'LIMITED') ips
INNER JOIN sys.indexes i ON ips.object_id = i.object_id AND ips.index_id = i.index_id
WHERE ips.page_count > 1000  -- Ignore small indexes
    AND OBJECTPROPERTY(ips.object_id, 'IsUserTable') = 1
ORDER BY ips.avg_fragmentation_in_percent DESC;

-- ============================================================================
-- INDEX USAGE STATISTICS
-- ============================================================================

-- Index usage statistics
SELECT
    OBJECT_NAME(s.object_id) AS table_name,
    i.name AS index_name,
    i.type_desc,
    s.user_seeks,
    s.user_scans,
    s.user_lookups,
    s.user_updates,
    s.last_user_seek,
    s.last_user_scan,
    s.last_user_lookup,
    (SUM(a.total_pages) * 8) / 1024 AS index_size_mb
FROM sys.dm_db_index_usage_stats s
INNER JOIN sys.indexes i ON s.object_id = i.object_id AND s.index_id = i.index_id
INNER JOIN sys.partitions p ON i.object_id = p.object_id AND i.index_id = p.index_id
INNER JOIN sys.allocation_units a ON p.partition_id = a.container_id
WHERE s.database_id = DB_ID()
    AND OBJECTPROPERTY(s.object_id, 'IsUserTable') = 1
GROUP BY OBJECT_NAME(s.object_id), i.name, i.type_desc, s.user_seeks, s.user_scans, s.user_lookups, s.user_updates,
         s.last_user_seek, s.last_user_scan, s.last_user_lookup
ORDER BY s.user_seeks + s.user_scans + s.user_lookups DESC;

-- ============================================================================
-- INDEX MAINTENANCE COMMANDS
-- ============================================================================

-- Reorganize index (online, minimal blocking)
-- ALTER INDEX IX_IndexName ON TableName REORGANIZE;

-- Rebuild index (offline, more thorough)
-- ALTER INDEX IX_IndexName ON TableName REBUILD;

-- Rebuild index online (Enterprise Edition)
-- ALTER INDEX IX_IndexName ON TableName REBUILD WITH (ONLINE = ON, MAXDOP = 4);

-- Rebuild all indexes on table
-- ALTER INDEX ALL ON TableName REBUILD WITH (ONLINE = ON, MAXDOP = 4);

-- Update statistics with full scan
-- UPDATE STATISTICS TableName WITH FULLSCAN;

-- ============================================================================
-- INDEX CREATION TEMPLATES
-- ============================================================================

-- Nonclustered index
-- CREATE NONCLUSTERED INDEX IX_TableName_ColumnName
-- ON TableName(ColumnName);

-- Composite index
-- CREATE NONCLUSTERED INDEX IX_TableName_Column1_Column2
-- ON TableName(Column1, Column2);

-- Covering index with INCLUDE
-- CREATE NONCLUSTERED INDEX IX_TableName_Column1_Covering
-- ON TableName(Column1)
-- INCLUDE (Column2, Column3);

-- Filtered index (partial index)
-- CREATE NONCLUSTERED INDEX IX_TableName_Active
-- ON TableName(ColumnName)
-- WHERE Status = 'Active';

-- Unique index
-- CREATE UNIQUE NONCLUSTERED INDEX IX_TableName_Email
-- ON TableName(Email);

-- Columnstore index for analytics
-- CREATE NONCLUSTERED COLUMNSTORE INDEX NCCI_TableName
-- ON TableName(Column1, Column2, Column3);

-- ============================================================================
-- AUTOMATED MAINTENANCE SCRIPT
-- ============================================================================

-- Script to automatically maintain indexes based on fragmentation
DECLARE @sql NVARCHAR(MAX);
DECLARE @objectid INT;
DECLARE @indexid INT;
DECLARE @fragmentation DECIMAL(5,2);

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
    BEGIN
        SET @sql = 'ALTER INDEX ' + QUOTENAME((SELECT name FROM sys.indexes WHERE object_id = @objectid AND index_id = @indexid)) +
                   ' ON ' + QUOTENAME(OBJECT_NAME(@objectid)) + ' REBUILD WITH (ONLINE = ON, MAXDOP = 4)';
        PRINT @sql;
        -- EXEC sp_executesql @sql;  -- Uncomment to execute
    END
    ELSE IF @fragmentation > 10
    BEGIN
        SET @sql = 'ALTER INDEX ' + QUOTENAME((SELECT name FROM sys.indexes WHERE object_id = @objectid AND index_id = @indexid)) +
                   ' ON ' + QUOTENAME(OBJECT_NAME(@objectid)) + ' REORGANIZE';
        PRINT @sql;
        -- EXEC sp_executesql @sql;  -- Uncomment to execute
    END;

    FETCH NEXT FROM index_cursor INTO @objectid, @indexid, @fragmentation;
END;

CLOSE index_cursor;
DEALLOCATE index_cursor;
