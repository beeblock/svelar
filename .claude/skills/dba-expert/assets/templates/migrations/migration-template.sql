-- Migration Template: Safe Database Migration
-- Description: [Describe what this migration does]
-- Author: [Your name]
-- Date: [YYYY-MM-DD]

-- ============================================================================
-- PRE-MIGRATION CHECKS
-- ============================================================================

-- Verify database and version
SELECT @@VERSION;
SELECT DB_NAME();

-- Check current schema state
-- [Add queries to verify current schema]

-- Verify no blocking sessions
-- PostgreSQL:
-- SELECT * FROM pg_stat_activity WHERE state = 'active';

-- SQL Server:
-- SELECT * FROM sys.dm_exec_requests WHERE blocking_session_id > 0;

-- ============================================================================
-- BACKUP (if not handled externally)
-- ============================================================================

-- PostgreSQL:
-- pg_dump -Fc dbname > backup_before_migration.dump

-- SQL Server:
-- BACKUP DATABASE [MyDB] TO DISK = 'C:\Backup\MyDB_BeforeMigration.bak';

-- ============================================================================
-- MIGRATION (wrapped in transaction where possible)
-- ============================================================================

-- PostgreSQL: Begin transaction
BEGIN;

-- SQL Server: Begin transaction
-- BEGIN TRANSACTION;

    -- Step 1: Add new schema elements (EXPAND)
    -- Example: Add new column
    -- ALTER TABLE users ADD COLUMN email_verified BOOLEAN;

    -- Step 2: Migrate data (if needed)
    -- Example: Backfill new column
    -- UPDATE users SET email_verified = false WHERE email_verified IS NULL;

    -- Step 3: Add indexes
    -- PostgreSQL:
    -- CREATE INDEX CONCURRENTLY idx_users_email_verified ON users(email_verified);

    -- SQL Server:
    -- CREATE NONCLUSTERED INDEX IX_Users_EmailVerified ON Users(EmailVerified);

    -- Step 4: Add constraints (NOT VALID first, then VALIDATE)
    -- PostgreSQL:
    -- ALTER TABLE users ADD CONSTRAINT chk_users_email_verified CHECK (email_verified IN (true, false)) NOT VALID;
    -- ALTER TABLE users VALIDATE CONSTRAINT chk_users_email_verified;

    -- SQL Server:
    -- ALTER TABLE Users ADD CONSTRAINT CHK_Users_EmailVerified CHECK (EmailVerified IN (0, 1));

    -- Step 5: Create views/functions if needed
    -- [Add DDL statements]

-- PostgreSQL: Commit transaction
COMMIT;

-- SQL Server: Commit transaction
-- COMMIT TRANSACTION;

-- ============================================================================
-- POST-MIGRATION VERIFICATION
-- ============================================================================

-- Verify schema changes
-- PostgreSQL:
-- SELECT column_name, data_type, is_nullable
-- FROM information_schema.columns
-- WHERE table_name = 'users' AND column_name = 'email_verified';

-- SQL Server:
-- SELECT name, TYPE_NAME(system_type_id), is_nullable
-- FROM sys.columns
-- WHERE object_id = OBJECT_ID('Users') AND name = 'EmailVerified';

-- Verify data integrity
-- [Add queries to verify data]

-- Verify indexes
-- PostgreSQL:
-- SELECT indexname FROM pg_indexes WHERE tablename = 'users';

-- SQL Server:
-- SELECT name FROM sys.indexes WHERE object_id = OBJECT_ID('Users');

-- ============================================================================
-- ROLLBACK PROCEDURE (if migration fails)
-- ============================================================================

-- If migration is wrapped in transaction, ROLLBACK will undo changes
-- ROLLBACK;

-- If migration is already committed, create rollback migration:
/*
BEGIN;
    -- Reverse Step 4: Drop constraints
    -- ALTER TABLE users DROP CONSTRAINT chk_users_email_verified;

    -- Reverse Step 3: Drop indexes
    -- DROP INDEX idx_users_email_verified;

    -- Reverse Step 1: Drop columns
    -- ALTER TABLE users DROP COLUMN email_verified;
COMMIT;
*/

-- ============================================================================
-- NOTES
-- ============================================================================

/*
Migration Guidelines:
1. Always test on non-production environment first
2. Run during low-traffic period if possible
3. Monitor replication lag during migration
4. Have rollback plan ready
5. Communicate with team before and after migration

For large data migrations:
- Use batch processing (see batched update example below)
- Add delays between batches to reduce load
- Monitor locks and blocking queries

For zero-downtime migrations:
- Use expand-contract pattern
- Ensure backward compatibility
- Use online DDL operations (CREATE INDEX CONCURRENTLY, etc.)
*/

-- ============================================================================
-- BATCHED DATA MIGRATION EXAMPLE
-- ============================================================================

-- PostgreSQL batched update:
/*
DO $$
DECLARE
    batch_size INT := 10000;
    rows_affected INT;
BEGIN
    LOOP
        UPDATE users
        SET email_verified = false
        WHERE id IN (
            SELECT id FROM users
            WHERE email_verified IS NULL
            LIMIT batch_size
        );

        GET DIAGNOSTICS rows_affected = ROW_COUNT;
        EXIT WHEN rows_affected = 0;

        RAISE NOTICE 'Updated % rows', rows_affected;
        PERFORM pg_sleep(0.1);  -- Pause between batches
    END LOOP;
END $$;
*/

-- SQL Server batched update:
/*
DECLARE @BatchSize INT = 10000;
DECLARE @RowsAffected INT = 1;

WHILE @RowsAffected > 0
BEGIN
    UPDATE TOP (@BatchSize) Users
    SET EmailVerified = 0
    WHERE EmailVerified IS NULL;

    SET @RowsAffected = @@ROWCOUNT;
    RAISERROR('Updated %d rows', 0, 1, @RowsAffected) WITH NOWAIT;

    WAITFOR DELAY '00:00:00.100';  -- 100ms pause
END;
*/
