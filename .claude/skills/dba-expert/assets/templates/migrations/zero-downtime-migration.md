# Zero-Downtime Migration Guide

## Expand-Contract Pattern

Safe pattern for schema changes without downtime.

### Phase 1: EXPAND

Add new schema elements without removing old ones.

```sql
-- Example: Rename column from "email" to "email_address"

-- Step 1: Add new column
ALTER TABLE users ADD COLUMN email_address VARCHAR(255);

-- Step 2: Create index on new column (if needed)
CREATE INDEX CONCURRENTLY idx_users_email_address ON users(email_address);

-- Step 3: Backfill data (in batches for large tables)
UPDATE users
SET email_address = email
WHERE email_address IS NULL
LIMIT 10000;
-- Repeat until all rows updated
```

### Phase 2: MIGRATE

Dual-write to both old and new schema.

```python
# Deploy application code that writes to both columns
def create_user(email):
    db.execute("""
        INSERT INTO users (email, email_address)
        VALUES (%s, %s)
    """, (email, email))
```

### Phase 3: VERIFY

Ensure data consistency.

```sql
-- Check for discrepancies
SELECT COUNT(*)
FROM users
WHERE email != email_address OR email_address IS NULL;
```

### Phase 4: SWITCH

Update application to read from new column only.

```python
# Deploy application code that reads from new column
def get_user_email(user_id):
    return db.query("""
        SELECT email_address FROM users WHERE id = %s
    """, user_id)
```

### Phase 5: CONTRACT

Remove old schema elements.

```sql
-- Step 1: Drop old column
ALTER TABLE users DROP COLUMN email;

-- Step 2: Rename new column (optional)
ALTER TABLE users RENAME COLUMN email_address TO email;
```

## Online DDL Operations

### PostgreSQL

**Concurrent Index Creation**:
```sql
-- Non-blocking index creation
CREATE INDEX CONCURRENTLY idx_users_email ON users(email);

-- If fails, drop and retry
DROP INDEX CONCURRENTLY IF EXISTS idx_users_email;
CREATE INDEX CONCURRENTLY idx_users_email ON users(email);
```

**Adding Column with Default** (PostgreSQL 11+):
```sql
-- Fast (metadata-only in PG 11+)
ALTER TABLE users ADD COLUMN status VARCHAR(20) DEFAULT 'active';
```

**Add NOT NULL Constraint**:
```sql
-- Step 1: Add CHECK constraint (NOT VALID doesn't block reads)
ALTER TABLE users ADD CONSTRAINT chk_email_not_null
    CHECK (email IS NOT NULL) NOT VALID;

-- Step 2: Validate constraint (uses lower lock)
ALTER TABLE users VALIDATE CONSTRAINT chk_email_not_null;

-- Step 3: Add NOT NULL (fast, metadata-only)
ALTER TABLE users ALTER COLUMN email SET NOT NULL;

-- Step 4: Drop CHECK constraint
ALTER TABLE users DROP CONSTRAINT chk_email_not_null;
```

### SQL Server

**Online Index Operations** (Enterprise Edition):
```sql
-- Create index online
CREATE NONCLUSTERED INDEX IX_Users_Email
ON Users(Email)
WITH (ONLINE = ON, MAXDOP = 4);

-- Rebuild index online
ALTER INDEX IX_Users_Email ON Users
REBUILD WITH (ONLINE = ON, MAXDOP = 4);
```

## Common Migration Patterns

### Pattern 1: Add Column

```sql
-- Safe approach
ALTER TABLE users ADD COLUMN phone VARCHAR(20);
-- Nullable column is fast

-- Deploy code that writes to phone

-- Backfill existing rows (batched)
-- See batched migration example in migration-template.sql

-- Make NOT NULL if required
ALTER TABLE users ALTER COLUMN phone SET NOT NULL;
```

### Pattern 2: Change Column Type

```sql
-- Example: INT to BIGINT

-- Step 1: Add new column
ALTER TABLE orders ADD COLUMN id_new BIGINT;

-- Step 2: Backfill
UPDATE orders SET id_new = id WHERE id_new IS NULL;

-- Step 3: Create index
CREATE INDEX CONCURRENTLY idx_orders_id_new ON orders(id_new);

-- Step 4: Deploy code using new column

-- Step 5: Verify, then drop old column
ALTER TABLE orders DROP COLUMN id;
ALTER TABLE orders RENAME COLUMN id_new TO id;
```

### Pattern 3: Split Table

```sql
-- Split users into users + user_profiles

-- Phase 1: Create new table
CREATE TABLE user_profiles (
    user_id INT PRIMARY KEY REFERENCES users(id),
    bio TEXT,
    avatar_url VARCHAR(500),
    created_at TIMESTAMP DEFAULT NOW()
);

-- Phase 2: Backfill
INSERT INTO user_profiles (user_id, bio, avatar_url)
SELECT id, bio, avatar_url FROM users
WHERE id NOT IN (SELECT user_id FROM user_profiles);

-- Phase 3: Deploy code writing to both tables

-- Phase 4: Verify data consistency

-- Phase 5: Deploy code reading from user_profiles

-- Phase 6: Drop columns from users
ALTER TABLE users DROP COLUMN bio;
ALTER TABLE users DROP COLUMN avatar_url;
```

## Batched Data Migration

For large tables, migrate data in small batches:

```sql
-- PostgreSQL
DO $$
DECLARE
    batch_size INT := 10000;
    rows_affected INT;
    total_updated INT := 0;
BEGIN
    LOOP
        UPDATE users
        SET email_verified = true
        WHERE id IN (
            SELECT id FROM users
            WHERE email_verified IS NULL
            ORDER BY id
            LIMIT batch_size
        );

        GET DIAGNOSTICS rows_affected = ROW_COUNT;
        total_updated := total_updated + rows_affected;

        RAISE NOTICE 'Updated % rows (total: %)', rows_affected, total_updated;

        EXIT WHEN rows_affected = 0;

        -- Pause between batches
        PERFORM pg_sleep(0.1);
    END LOOP;
END $$;
```

## Monitoring During Migration

**Check Locks**:
```sql
-- PostgreSQL
SELECT * FROM pg_locks WHERE NOT granted;

-- SQL Server
SELECT * FROM sys.dm_tran_locks WHERE request_status = 'WAIT';
```

**Check Replication Lag**:
```sql
-- PostgreSQL (on primary)
SELECT pg_wal_lsn_diff(sent_lsn, replay_lsn) AS lag_bytes
FROM pg_stat_replication;

-- SQL Server (Always On AG)
SELECT
    database_name,
    synchronization_state_desc,
    log_send_queue_size
FROM sys.dm_hadr_database_replica_states;
```

## Rollback Strategy

Always have a rollback plan:

1. **Forward-only migrations**: Create new migration to undo
2. **Save point**: Use transactions with savepoints
3. **Database snapshot**: SQL Server snapshots for quick revert

```sql
-- SQL Server: Create snapshot before migration
CREATE DATABASE MyDB_Snapshot ON
(NAME = MyDB, FILENAME = 'C:\Snapshots\MyDB_Snapshot.ss')
AS SNAPSHOT OF MyDB;

-- Revert if needed
USE master;
RESTORE DATABASE MyDB FROM DATABASE_SNAPSHOT = 'MyDB_Snapshot';

-- Drop snapshot
DROP DATABASE MyDB_Snapshot;
```

## Testing Checklist

Before production migration:

- [ ] Test on production-like data volume
- [ ] Measure migration time
- [ ] Verify no long-running transactions blocked
- [ ] Test rollback procedure
- [ ] Document all steps
- [ ] Plan maintenance window (if needed)
- [ ] Notify stakeholders
- [ ] Backup database

During migration:

- [ ] Monitor locks and blocking
- [ ] Monitor replication lag
- [ ] Watch error logs
- [ ] Verify application health

After migration:

- [ ] Verify schema changes
- [ ] Run smoke tests
- [ ] Monitor query performance
- [ ] Check for errors in logs
- [ ] Update documentation
