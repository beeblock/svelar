# Database Migration Guide

## Zero-Downtime Migration Principles

1. **Backward compatibility**: New schema works with old code
2. **Incremental changes**: Small, tested steps
3. **Online operations**: Use non-blocking DDL when possible
4. **Rollback plan**: Always have a way back
5. **Monitor replication**: Ensure replicas stay in sync

## Migration Strategies

### Expand-Contract Pattern

Safe pattern for schema changes:

1. **Expand**: Add new schema elements (columns, tables)
2. **Migrate**: Dual-write to old and new schema
3. **Contract**: Remove old schema elements

**Example: Rename column**

```sql
-- Phase 1: EXPAND - Add new column
ALTER TABLE users ADD COLUMN email_address VARCHAR(255);

-- Phase 2: MIGRATE - Backfill data
UPDATE users SET email_address = email WHERE email_address IS NULL;

-- Deploy application code that writes to both columns

-- Phase 3: Verify data sync
SELECT COUNT(*) FROM users WHERE email != email_address;

-- Deploy application code that reads from new column only

-- Phase 4: CONTRACT - Drop old column
ALTER TABLE users DROP COLUMN email;

-- Phase 5: CLEANUP - Rename new column
ALTER TABLE users RENAME COLUMN email_address TO email;
```

### Online DDL Operations

#### PostgreSQL

**Concurrent index creation**:
```sql
-- Non-blocking index creation (PostgreSQL)
CREATE INDEX CONCURRENTLY idx_users_email ON users(email);

-- If fails, drop and retry
DROP INDEX CONCURRENTLY IF EXISTS idx_users_email;
CREATE INDEX CONCURRENTLY idx_users_email ON users(email);
```

**Adding column with default** (PostgreSQL 11+):
```sql
-- Fast (metadata-only)
ALTER TABLE users ADD COLUMN status VARCHAR(20) DEFAULT 'active';

-- Older PostgreSQL: Add without default, then set
ALTER TABLE users ADD COLUMN status VARCHAR(20);
UPDATE users SET status = 'active' WHERE status IS NULL;
ALTER TABLE users ALTER COLUMN status SET DEFAULT 'active';
```

**Non-blocking operations**:
```sql
-- Add nullable column (fast)
ALTER TABLE users ADD COLUMN middle_name VARCHAR(100);

-- Add column with default (PG 11+, fast)
ALTER TABLE users ADD COLUMN verified BOOLEAN DEFAULT false;

-- Create index concurrently
CREATE INDEX CONCURRENTLY idx_users_created ON users(created_at);

-- Add check constraint (NOT VALID first)
ALTER TABLE users ADD CONSTRAINT chk_age_positive CHECK (age > 0) NOT VALID;
-- Validate later (uses lower lock)
ALTER TABLE users VALIDATE CONSTRAINT chk_age_positive;
```

**Blocking operations** (avoid in production):
```sql
-- Add NOT NULL to existing column (locks table)
ALTER TABLE users ALTER COLUMN email SET NOT NULL;

-- Better: Add check constraint first
ALTER TABLE users ADD CONSTRAINT chk_email_not_null CHECK (email IS NOT NULL) NOT VALID;
ALTER TABLE users VALIDATE CONSTRAINT chk_email_not_null;
-- Then add NOT NULL (fast, metadata-only)
ALTER TABLE users ALTER COLUMN email SET NOT NULL;
ALTER TABLE users DROP CONSTRAINT chk_email_not_null;
```

#### SQL Server

**Online index operations** (Enterprise Edition):
```sql
-- Create index online
CREATE NONCLUSTERED INDEX IX_Users_Email
ON Users(Email)
WITH (ONLINE = ON, MAXDOP = 4);

-- Rebuild index online
ALTER INDEX IX_Users_Email ON Users REBUILD WITH (ONLINE = ON);

-- Add column (blocking)
ALTER TABLE Users ADD EmailVerified BIT DEFAULT 0;
-- Consider doing during maintenance window
```

**Online operations** (SQL Server 2019+):
```sql
-- Online alter column (limited support)
ALTER TABLE Users ALTER COLUMN Status VARCHAR(50) NULL
WITH (ONLINE = ON);
```

### Backward-Compatible Changes

**Safe changes** (no downtime):
- Add nullable column
- Add table
- Add index (CONCURRENTLY)
- Add check constraint (NOT VALID, then VALIDATE)
- Increase VARCHAR length
- Add foreign key (NOT VALID, then VALIDATE)

**Unsafe changes** (require careful planning):
- Drop column
- Drop table
- Rename column/table
- Add NOT NULL constraint
- Decrease VARCHAR length
- Change column type
- Add unique constraint

## Migration Patterns

### Pattern 1: Add Column

**Safe approach**:
```sql
-- Step 1: Add nullable column
ALTER TABLE users ADD COLUMN phone VARCHAR(20);

-- Deploy application code that writes to phone column

-- Step 2: Backfill existing rows (in batches)
UPDATE users
SET phone = '+1234567890'
WHERE id IN (
    SELECT id FROM users
    WHERE phone IS NULL
    LIMIT 10000
);

-- Repeat until all rows updated

-- Step 3: Add NOT NULL constraint
ALTER TABLE users ALTER COLUMN phone SET NOT NULL;
```

### Pattern 2: Drop Column

**Safe approach**:
```sql
-- Step 1: Deploy code that stops reading/writing column

-- Step 2: Wait to ensure all deployments complete

-- Step 3: Drop column
ALTER TABLE users DROP COLUMN old_field;
```

### Pattern 3: Rename Column

**Expand-contract approach**:
```sql
-- Phase 1: Add new column
ALTER TABLE users ADD COLUMN email_address VARCHAR(255);

-- Phase 2: Backfill
UPDATE users SET email_address = email WHERE email_address IS NULL;

-- Phase 3: Deploy code writing to both columns

-- Phase 4: Verify data consistency

-- Phase 5: Deploy code reading from new column

-- Phase 6: Drop old column
ALTER TABLE users DROP COLUMN email;

-- Phase 7: Rename new column
ALTER TABLE users RENAME COLUMN email_address TO email;
```

**Simpler approach** (if possible to coordinate):
```sql
-- Option: Use database view
CREATE VIEW users_v AS
SELECT id, email AS email_address, name
FROM users;

-- Application uses view instead of table
-- Later, rename column and update view
```

### Pattern 4: Change Column Type

**Safe approach**:
```sql
-- Example: INT to BIGINT

-- Step 1: Add new column
ALTER TABLE orders ADD COLUMN id_new BIGINT;

-- Step 2: Backfill (in batches)
UPDATE orders
SET id_new = id
WHERE id_new IS NULL
LIMIT 10000;

-- Step 3: Create index on new column
CREATE INDEX CONCURRENTLY idx_orders_id_new ON orders(id_new);

-- Step 4: Deploy code using new column

-- Step 5: Drop old column and rename
ALTER TABLE orders DROP COLUMN id;
ALTER TABLE orders RENAME COLUMN id_new TO id;
```

### Pattern 5: Split Table

**Scenario**: Split users table into users and user_profiles

```sql
-- Phase 1: Create new table
CREATE TABLE user_profiles (
    user_id INT PRIMARY KEY REFERENCES users(id),
    bio TEXT,
    avatar_url VARCHAR(500),
    created_at TIMESTAMP DEFAULT NOW()
);

-- Phase 2: Backfill data
INSERT INTO user_profiles (user_id, bio, avatar_url)
SELECT id, bio, avatar_url
FROM users
WHERE id NOT IN (SELECT user_id FROM user_profiles);

-- Phase 3: Deploy code writing to both tables

-- Phase 4: Verify data consistency

-- Phase 5: Deploy code reading from user_profiles

-- Phase 6: Drop columns from users
ALTER TABLE users DROP COLUMN bio;
ALTER TABLE users DROP COLUMN avatar_url;
```

### Pattern 6: Merge Tables

**Scenario**: Merge user_settings into users table

```sql
-- Phase 1: Add columns to target table
ALTER TABLE users ADD COLUMN theme VARCHAR(20);
ALTER TABLE users ADD COLUMN language VARCHAR(10);

-- Phase 2: Backfill data
UPDATE users u
SET
    theme = s.theme,
    language = s.language
FROM user_settings s
WHERE u.id = s.user_id;

-- Phase 3: Deploy code writing to users table

-- Phase 4: Verify data consistency

-- Phase 5: Deploy code reading from users table

-- Phase 6: Drop user_settings table
DROP TABLE user_settings;
```

## Batch Data Migration

For large tables, migrate data in small batches to avoid long locks.

### PostgreSQL Batch Migration

```sql
-- Function for batched updates
DO $$
DECLARE
    batch_size INT := 10000;
    rows_affected INT;
    total_updated INT := 0;
BEGIN
    LOOP
        -- Update batch
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

        -- Exit when no more rows
        EXIT WHEN rows_affected = 0;

        -- Pause between batches
        PERFORM pg_sleep(0.1);
    END LOOP;

    RAISE NOTICE 'Migration complete: % total rows updated', total_updated;
END $$;
```

### SQL Server Batch Migration

```sql
DECLARE @BatchSize INT = 10000;
DECLARE @RowsAffected INT = 1;
DECLARE @TotalUpdated INT = 0;

WHILE @RowsAffected > 0
BEGIN
    UPDATE TOP (@BatchSize) Users
    SET EmailVerified = 1
    WHERE EmailVerified IS NULL;

    SET @RowsAffected = @@ROWCOUNT;
    SET @TotalUpdated = @TotalUpdated + @RowsAffected;

    RAISERROR('Updated %d rows (total: %d)', 0, 1, @RowsAffected, @TotalUpdated) WITH NOWAIT;

    -- Pause between batches
    WAITFOR DELAY '00:00:00.100';  -- 100ms
END;

PRINT 'Migration complete: ' + CAST(@TotalUpdated AS VARCHAR) + ' total rows updated';
```

## Migration Tools

### Flyway

**Project structure**:
```
migrations/
  V1__initial_schema.sql
  V2__add_users_email_index.sql
  V3__add_orders_table.sql
  V4__rename_users_email.sql
```

**Migration file** (V4__rename_users_email.sql):
```sql
-- Step 1: Add new column
ALTER TABLE users ADD COLUMN email_address VARCHAR(255);

-- Step 2: Backfill data
UPDATE users SET email_address = email WHERE email_address IS NULL;

-- Note: Drop old column and rename in separate migration
-- after deploying code changes
```

**Run migrations**:
```bash
flyway -url=jdbc:postgresql://localhost/mydb \
       -user=postgres \
       -password=secret \
       migrate
```

### Liquibase

**changelog.xml**:
```xml
<changeSet id="1" author="john">
    <addColumn tableName="users">
        <column name="email_verified" type="boolean" defaultValueBoolean="false"/>
    </addColumn>
</changeSet>

<changeSet id="2" author="john">
    <createIndex indexName="idx_users_email" tableName="users">
        <column name="email"/>
    </createIndex>
</changeSet>
```

**Run**:
```bash
liquibase --url=jdbc:postgresql://localhost/mydb \
          --username=postgres \
          --password=secret \
          update
```

### Alembic (Python/SQLAlchemy)

**Generate migration**:
```bash
alembic revision -m "add users email index"
```

**Migration file**:
```python
def upgrade():
    op.create_index('idx_users_email', 'users', ['email'])
    op.add_column('users', sa.Column('email_verified', sa.Boolean(), nullable=True))

def downgrade():
    op.drop_column('users', 'email_verified')
    op.drop_index('idx_users_email', table_name='users')
```

**Run**:
```bash
alembic upgrade head
```

### Entity Framework Migrations (C#)

**Create migration**:
```bash
dotnet ef migrations add AddEmailVerified
```

**Generated migration**:
```csharp
public partial class AddEmailVerified : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.AddColumn<bool>(
            name: "EmailVerified",
            table: "Users",
            nullable: false,
            defaultValue: false);
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropColumn(
            name: "EmailVerified",
            table: "Users");
    }
}
```

**Apply**:
```bash
dotnet ef database update
```

## Rollback Strategies

### Forward-Only Migrations

**Philosophy**: Never rollback, only migrate forward

**Example**:
```sql
-- Migration V4: Add column
ALTER TABLE users ADD COLUMN phone VARCHAR(20);

-- If there's an issue, create new migration V5:
-- Migration V5: Remove phone column
ALTER TABLE users DROP COLUMN phone;
```

**Pros**:
- Simpler to reason about
- Matches production reality
- Clear audit trail

**Cons**:
- Can't undo automatically
- Need to write fix migrations

### Reversible Migrations

**Example** (Alembic):
```python
def upgrade():
    op.add_column('users', sa.Column('phone', sa.String(20)))

def downgrade():
    op.drop_column('users', 'phone')
```

**Rollback**:
```bash
alembic downgrade -1  # Down one version
alembic downgrade base  # Rollback all
```

### Database Snapshots (SQL Server)

**Create snapshot before migration**:
```sql
CREATE DATABASE MyDB_Snapshot ON
(NAME = MyDB, FILENAME = 'C:\Snapshots\MyDB_Snapshot.ss')
AS SNAPSHOT OF MyDB;
```

**Revert if migration fails**:
```sql
-- Restore from snapshot
USE master;
RESTORE DATABASE MyDB FROM DATABASE_SNAPSHOT = 'MyDB_Snapshot';

-- Drop snapshot
DROP DATABASE MyDB_Snapshot;
```

## Testing Migrations

### Test on Production-Like Data

**Create anonymized copy**:
```sql
-- PostgreSQL: Create test database from production dump
pg_dump -Fc production_db > prod_backup.dump

createdb test_db
pg_restore -d test_db prod_backup.dump

-- Anonymize sensitive data
UPDATE users SET email = CONCAT('user', id, '@test.com');
UPDATE users SET password_hash = 'dummy_hash';
```

### Test Migration Performance

```bash
# Time the migration
time psql test_db < migration.sql

# Monitor locks
# In another terminal:
psql test_db -c "
SELECT
    pid,
    usename,
    pg_blocking_pids(pid) as blocked_by,
    query
FROM pg_stat_activity
WHERE state != 'idle';"
```

### Integration Tests

```python
# Python test
def test_migration_v4():
    # Run migration
    run_migration('V4__add_email_verified.sql')

    # Verify schema
    result = db.execute("""
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_name = 'users' AND column_name = 'email_verified'
    """)
    assert result.rowcount == 1

    # Verify data
    db.execute("INSERT INTO users (email, email_verified) VALUES ('test@example.com', true)")
    result = db.execute("SELECT email_verified FROM users WHERE email = 'test@example.com'")
    assert result.fetchone()[0] == True
```

## Migration Checklist

Before migration:
- [ ] Review migration script
- [ ] Test on production-like data
- [ ] Measure migration time
- [ ] Check for long-running queries that might block
- [ ] Verify rollback procedure
- [ ] Plan maintenance window (if needed)
- [ ] Notify stakeholders
- [ ] Backup database
- [ ] Monitor replication lag

During migration:
- [ ] Monitor locks and blocking queries
- [ ] Monitor replication lag
- [ ] Watch for errors
- [ ] Verify application health

After migration:
- [ ] Verify schema changes
- [ ] Run smoke tests
- [ ] Monitor application errors
- [ ] Check query performance
- [ ] Update documentation

## Best Practices

1. **Small, incremental changes**: One logical change per migration
2. **Test thoroughly**: On production-like data and volume
3. **Use transactions**: Wrap DDL in transactions when possible
4. **Online operations**: Use CONCURRENTLY, ONLINE when available
5. **Backward compatible**: New code works with old schema
6. **Monitor replication**: Ensure replicas don't fall behind
7. **Have rollback plan**: Know how to undo changes
8. **Document migrations**: Clear comments explaining changes
9. **Version control**: Track all migrations in git
10. **Automate**: Use migration tools, not manual SQL

## Common Pitfalls

1. **Long-running migrations blocking production**: Test on real data volume
2. **Forgetting to update indexes**: Add indexes for new columns
3. **Not testing rollback**: Rollback procedure should be tested
4. **Large batches**: Use small batches for data migrations
5. **Not monitoring replication**: Replicas falling behind can cause issues
6. **Assuming fast operations**: Always test migration time
7. **No communication**: Notify team of migrations
8. **Direct production changes**: Always use migration tools
9. **Not checking dependencies**: Foreign keys, views, triggers
10. **Ignoring statistics**: Update statistics after large data changes

## Summary

- **Expand-contract pattern**: Add new, migrate data, remove old
- **Online DDL**: Use CONCURRENTLY (PostgreSQL) or ONLINE (SQL Server)
- **Backward compatibility**: New code works with old schema
- **Batch migrations**: Small batches to avoid long locks
- **Test migrations**: On production-like data and volume
- **Rollback plan**: Forward-only or reversible migrations
- **Monitor**: Locks, replication lag, application errors
- **Automate**: Use migration tools (Flyway, Liquibase, Alembic, EF)
