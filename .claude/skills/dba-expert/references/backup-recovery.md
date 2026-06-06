# Backup and Recovery Guide

## The 3-2-1 Backup Rule

- **3** copies of your data
- **2** different media types (disk, tape, cloud)
- **1** copy offsite

## Recovery Objectives

### RPO (Recovery Point Objective)

Maximum acceptable data loss measured in time.

- RPO = 1 hour: Can afford to lose 1 hour of data
- RPO = 0: No data loss acceptable (requires synchronous replication)

### RTO (Recovery Time Objective)

Maximum acceptable downtime for recovery.

- RTO = 4 hours: System must be back online within 4 hours
- RTO = 5 minutes: Near-zero downtime required

## Backup Types

### Full Backup

Complete copy of entire database.

**Pros**:
- Simple to restore
- No dependencies
- Fastest restore

**Cons**:
- Largest storage requirement
- Longest backup time
- Most resource-intensive

**When to use**: Weekly or monthly baseline

### Differential Backup

Changes since last **full** backup.

**Pros**:
- Faster than full backup
- Only need full + latest differential to restore

**Cons**:
- Grows larger over time
- Still requires full backup

**When to use**: Daily backups

**Restore process**:
1. Restore full backup
2. Restore latest differential

### Incremental Backup

Changes since last backup of **any type**.

**Pros**:
- Fastest backup
- Smallest storage

**Cons**:
- Complex restore (need all incremental backups)
- Slower restore time

**When to use**: Hourly or frequent backups

**Restore process**:
1. Restore full backup
2. Restore all differential/incremental backups in order

### Continuous/Point-in-Time Backup

Archive transaction logs for replay.

**Pros**:
- Minimal data loss (RPO near 0)
- Restore to any point in time
- Small, frequent backups

**Cons**:
- Requires transaction logs
- Complex restore process

**When to use**: Production databases requiring low RPO

## PostgreSQL Backup Strategies

### pg_dump (Logical Backup)

**Full database dump**:
```bash
# Custom format (compressed, selective restore)
pg_dump -Fc dbname > backup.dump

# Plain SQL format
pg_dump dbname > backup.sql

# Compressed SQL
pg_dump dbname | gzip > backup.sql.gz

# Specific tables
pg_dump -t users -t orders dbname > tables_backup.sql

# Schema only
pg_dump --schema-only dbname > schema.sql

# Data only
pg_dump --data-only dbname > data.sql
```

**Restore**:
```bash
# From custom format
pg_restore -d dbname backup.dump

# Specific tables
pg_restore -d dbname -t users backup.dump

# From SQL
psql dbname < backup.sql

# From compressed SQL
gunzip -c backup.sql.gz | psql dbname
```

**pg_dumpall** (all databases):
```bash
# Dump all databases and global objects
pg_dumpall > all_databases.sql

# Restore
psql -f all_databases.sql postgres
```

**Pros**:
- Database-independent format
- Can restore to different PostgreSQL version
- Selective restore (specific tables)

**Cons**:
- Locks tables during dump
- Slower for large databases
- No point-in-time recovery

### pg_basebackup (Physical Backup)

**Base backup**:
```bash
# Take base backup
pg_basebackup -h localhost -D /backup/base -Fp -Xs -P -R

# Options:
# -D: Backup directory
# -Fp: Plain format (directory)
# -Ft: Tar format
# -Xs: Stream WAL during backup
# -P: Show progress
# -R: Create standby.signal and recovery config
```

**Pros**:
- Faster than pg_dump
- Foundation for point-in-time recovery
- Can create standby servers

**Cons**:
- Requires PostgreSQL to be running
- Same PostgreSQL version required
- Entire cluster backup (all databases)

### Continuous Archiving (WAL Archiving)

**Enable WAL archiving** (postgresql.conf):
```sql
wal_level = replica
archive_mode = on
archive_command = 'test ! -f /mnt/backup/wal/%f && cp %p /mnt/backup/wal/%f'
# Or for cloud storage:
# archive_command = 'aws s3 cp %p s3://bucket/wal/%f'

# Optional: archive timeout (force WAL switch)
archive_timeout = 300  # 5 minutes
```

**Verify archiving**:
```sql
SELECT
    archived_count,
    last_archived_wal,
    last_archived_time,
    failed_count,
    last_failed_wal
FROM pg_stat_archiver;
```

**Point-in-time recovery**:
```bash
# 1. Restore base backup
cp -r /backup/base/* /var/lib/postgresql/data/

# 2. Create recovery.signal
touch /var/lib/postgresql/data/recovery.signal

# 3. Configure recovery (postgresql.auto.conf or postgresql.conf)
restore_command = 'cp /mnt/backup/wal/%f %p'
recovery_target_time = '2024-01-15 14:30:00'
# Or:
# recovery_target_xid = '12345'  # Transaction ID
# recovery_target_lsn = '0/3000000'  # Log sequence number
# recovery_target_name = 'my_restore_point'  # Named restore point

# 4. Start PostgreSQL
systemctl start postgresql

# 5. PostgreSQL replays WAL up to target
# 6. When done, promotes to primary and removes recovery.signal
```

**Create restore point**:
```sql
-- Named restore point
SELECT pg_create_restore_point('before_migration');

-- Restore to this point
recovery_target_name = 'before_migration'
```

### pgBackRest (Recommended)

Modern backup tool for PostgreSQL.

**Install**:
```bash
# Ubuntu/Debian
apt install pgbackrest

# Configure /etc/pgbackrest/pgbackrest.conf
[global]
repo1-path=/var/lib/pgbackrest
repo1-retention-full=2
process-max=4

[mydb]
pg1-path=/var/lib/postgresql/14/main
```

**Backups**:
```bash
# Full backup
pgbackrest --stanza=mydb backup

# Differential backup
pgbackrest --stanza=mydb --type=diff backup

# Incremental backup
pgbackrest --stanza=mydb --type=incr backup

# Check backup
pgbackrest --stanza=mydb info
```

**Restore**:
```bash
# Latest backup
pgbackrest --stanza=mydb restore

# Point-in-time
pgbackrest --stanza=mydb --type=time \
    --target="2024-01-15 14:30:00" restore

# Specific backup
pgbackrest --stanza=mydb --set=20240115-143000F restore
```

**Pros**:
- Parallel backup and restore
- Compression and encryption
- Full, differential, and incremental backups
- Cloud storage support (S3, Azure, GCS)
- Automatic retention management

## SQL Server Backup Strategies

### Full Backup

```sql
-- Full database backup
BACKUP DATABASE [MyDB]
TO DISK = N'C:\Backup\MyDB_Full.bak'
WITH COMPRESSION, STATS = 10, CHECKSUM, INIT;

-- Multiple files (faster)
BACKUP DATABASE [MyDB]
TO DISK = N'C:\Backup\MyDB_Full_1.bak',
   DISK = N'C:\Backup\MyDB_Full_2.bak',
   DISK = N'C:\Backup\MyDB_Full_3.bak'
WITH COMPRESSION, STATS = 10;

-- To network share
BACKUP DATABASE [MyDB]
TO DISK = N'\\BackupServer\Backups\MyDB_Full.bak'
WITH COMPRESSION;
```

### Differential Backup

```sql
-- Differential backup
BACKUP DATABASE [MyDB]
TO DISK = N'C:\Backup\MyDB_Diff.bak'
WITH DIFFERENTIAL, COMPRESSION, STATS = 10;
```

### Transaction Log Backup

Required for point-in-time recovery.

```sql
-- Set recovery model to FULL
ALTER DATABASE [MyDB] SET RECOVERY FULL;

-- Transaction log backup
BACKUP LOG [MyDB]
TO DISK = N'C:\Backup\MyDB_Log.trn'
WITH COMPRESSION, STATS = 10;

-- Backup log and truncate
BACKUP LOG [MyDB]
TO DISK = N'C:\Backup\MyDB_Log.trn'
WITH NO_TRUNCATE;  -- If database is damaged
```

### Copy-Only Backup

Doesn't interfere with normal backup sequence.

```sql
-- Copy-only full backup
BACKUP DATABASE [MyDB]
TO DISK = N'C:\Backup\MyDB_CopyOnly.bak'
WITH COPY_ONLY, COMPRESSION;
```

### Restore Scenarios

**Simple restore**:
```sql
-- Restore full backup (replace existing)
RESTORE DATABASE [MyDB]
FROM DISK = N'C:\Backup\MyDB_Full.bak'
WITH REPLACE, RECOVERY;

-- Restore to different database
RESTORE DATABASE [MyDB_Dev]
FROM DISK = N'C:\Backup\MyDB_Full.bak'
WITH MOVE 'MyDB' TO 'C:\Data\MyDB_Dev.mdf',
     MOVE 'MyDB_log' TO 'C:\Data\MyDB_Dev_log.ldf',
     RECOVERY;
```

**Point-in-time restore**:
```sql
-- 1. Backup tail log (current active log)
BACKUP LOG [MyDB]
TO DISK = N'C:\Backup\MyDB_TailLog.trn'
WITH NORECOVERY;

-- 2. Restore full backup
RESTORE DATABASE [MyDB]
FROM DISK = N'C:\Backup\MyDB_Full.bak'
WITH NORECOVERY, REPLACE;

-- 3. Restore differential (if exists)
RESTORE DATABASE [MyDB]
FROM DISK = N'C:\Backup\MyDB_Diff.bak'
WITH NORECOVERY;

-- 4. Restore transaction logs in sequence
RESTORE LOG [MyDB]
FROM DISK = N'C:\Backup\MyDB_Log1.trn'
WITH NORECOVERY;

RESTORE LOG [MyDB]
FROM DISK = N'C:\Backup\MyDB_Log2.trn'
WITH NORECOVERY;

-- 5. Restore tail log to specific time
RESTORE LOG [MyDB]
FROM DISK = N'C:\Backup\MyDB_TailLog.trn'
WITH RECOVERY, STOPAT = '2024-01-15 14:30:00';

-- Database is now online at 2024-01-15 14:30:00
```

**Page restore** (for corruption):
```sql
-- 1. Identify damaged pages
SELECT * FROM msdb.dbo.suspect_pages;

-- 2. Restore specific pages
RESTORE DATABASE [MyDB] PAGE = '1:257, 1:258'
FROM DISK = N'C:\Backup\MyDB_Full.bak'
WITH NORECOVERY;

-- 3. Backup tail log
BACKUP LOG [MyDB]
TO DISK = N'C:\Backup\MyDB_TailLog.trn'
WITH NORECOVERY;

-- 4. Restore tail log
RESTORE LOG [MyDB]
FROM DISK = N'C:\Backup\MyDB_TailLog.trn'
WITH RECOVERY;
```

### Maintenance Plan

```sql
-- Create maintenance plan (T-SQL)
-- Or use SQL Server Management Studio GUI

-- Daily full backup
USE msdb;
EXEC sp_add_maintenance_plan_db @plan_id = 'plan_guid', @db_name = 'MyDB';

-- Schedule with SQL Server Agent
EXEC msdb.dbo.sp_add_schedule
    @schedule_name = 'DailyFullBackup',
    @freq_type = 4,  -- Daily
    @freq_interval = 1,
    @active_start_time = 020000;  -- 2:00 AM
```

## Backup Verification

### Test Restore Procedure

**Automated testing**:
```bash
#!/bin/bash
# PostgreSQL backup test

BACKUP_FILE="/backup/latest.dump"
TEST_DB="restore_test_$(date +%s)"

# Create test database
createdb $TEST_DB

# Restore backup
if pg_restore -d $TEST_DB $BACKUP_FILE; then
    echo "✓ Backup restore successful"

    # Run validation queries
    psql $TEST_DB -c "SELECT COUNT(*) FROM users;" || exit 1
    psql $TEST_DB -c "SELECT COUNT(*) FROM orders;" || exit 1

    # Cleanup
    dropdb $TEST_DB
    echo "✓ Backup validation passed"
else
    echo "✗ Backup restore failed!"
    exit 1
fi
```

**SQL Server**:
```sql
-- Verify backup integrity
RESTORE VERIFYONLY
FROM DISK = N'C:\Backup\MyDB_Full.bak'
WITH CHECKSUM;

-- Restore to test database
RESTORE DATABASE [MyDB_Test]
FROM DISK = N'C:\Backup\MyDB_Full.bak'
WITH MOVE 'MyDB' TO 'C:\Data\MyDB_Test.mdf',
     MOVE 'MyDB_log' TO 'C:\Data\MyDB_Test_log.ldf',
     RECOVERY;

-- Validate data
SELECT COUNT(*) FROM MyDB_Test.dbo.Users;

-- Cleanup
DROP DATABASE [MyDB_Test];
```

### Verify Backup Checksums

**PostgreSQL**:
```bash
# Verify pg_dump integrity
pg_restore --list backup.dump > /dev/null
echo $?  # 0 = success

# Verify file integrity with checksums
sha256sum backup.dump > backup.dump.sha256
sha256sum -c backup.dump.sha256
```

**SQL Server**:
```sql
-- Backups with CHECKSUM
BACKUP DATABASE [MyDB]
TO DISK = N'C:\Backup\MyDB.bak'
WITH CHECKSUM;

-- Verify
RESTORE VERIFYONLY
FROM DISK = N'C:\Backup\MyDB.bak'
WITH CHECKSUM;
```

## Backup to Cloud Storage

### PostgreSQL to S3

**Using pgBackRest**:
```ini
# /etc/pgbackrest/pgbackrest.conf
[global]
repo1-type=s3
repo1-s3-bucket=my-db-backups
repo1-s3-region=us-east-1
repo1-s3-key=<access-key>
repo1-s3-key-secret=<secret-key>
repo1-retention-full=7
process-max=4
```

**Using wal-g**:
```bash
# Install wal-g
wget https://github.com/wal-g/wal-g/releases/latest/download/wal-g-pg-ubuntu-20.04-amd64.tar.gz
tar -xzf wal-g-pg-ubuntu-20.04-amd64.tar.gz

# Configure
export AWS_ACCESS_KEY_ID=<key>
export AWS_SECRET_ACCESS_KEY=<secret>
export WALG_S3_PREFIX=s3://my-db-backups
export PGHOST=/var/run/postgresql

# Backup
wal-g backup-push /var/lib/postgresql/data

# Restore
wal-g backup-fetch /var/lib/postgresql/data LATEST
```

### SQL Server to Azure

```sql
-- Create credential
CREATE CREDENTIAL [https://myaccount.blob.core.windows.net/backups]
WITH IDENTITY = 'SHARED ACCESS SIGNATURE',
SECRET = '<SAS_TOKEN>';

-- Backup to Azure Blob Storage
BACKUP DATABASE [MyDB]
TO URL = N'https://myaccount.blob.core.windows.net/backups/MyDB.bak'
WITH COMPRESSION, STATS = 10;

-- Restore from Azure
RESTORE DATABASE [MyDB]
FROM URL = N'https://myaccount.blob.core.windows.net/backups/MyDB.bak';
```

## Backup Retention Policy

### Sample Policy

| Backup Type | Frequency | Retention |
|-------------|-----------|-----------|
| Full | Weekly (Sunday 2 AM) | 4 weeks |
| Differential | Daily (2 AM) | 7 days |
| Transaction Log | Every 15 minutes | 7 days |
| Monthly Archive | First Sunday of month | 1 year |

### Implementation

**PostgreSQL pgBackRest**:
```ini
[global]
repo1-retention-full=4
repo1-retention-diff=2
```

**SQL Server**:
```sql
-- Delete backups older than 7 days
EXECUTE msdb.dbo.sp_delete_backuphistory @oldest_date = '2024-01-08';

-- Or use maintenance cleanup task
EXEC msdb.dbo.sp_maintplan_create_plan
    @plan_name = N'Cleanup Old Backups',
    @cleanup_time = 168;  -- 7 days in hours
```

## Disaster Recovery Procedures

### PostgreSQL

1. **Assess damage**: Determine extent of data loss
2. **Stop application**: Prevent further changes
3. **Identify restore point**: Latest backup or specific point-in-time
4. **Restore base backup**: Copy base backup to data directory
5. **Configure recovery**: Set restore_command and recovery target
6. **Start PostgreSQL**: Database replays WAL logs
7. **Verify data**: Check critical tables and data integrity
8. **Resume application**: Bring application back online

### SQL Server

1. **Assess damage**: Check error logs and alert notifications
2. **Backup tail log**: If possible, backup current transaction log
3. **Identify restore point**: Determine recovery target time
4. **Restore full backup**: RESTORE DATABASE ... WITH NORECOVERY
5. **Restore differential**: If exists, WITH NORECOVERY
6. **Restore log backups**: All transaction logs in sequence
7. **Final recovery**: RESTORE LOG ... WITH RECOVERY, STOPAT
8. **Verify integrity**: DBCC CHECKDB, verify critical data
9. **Resume application**: Update connection strings, restart app

## Backup Best Practices

1. **Test restores regularly**: Monthly restore tests to verify backups
2. **Monitor backup success**: Alert on failed backups immediately
3. **Offsite backups**: Store backups in different location/region
4. **Encrypt backups**: Protect sensitive data (pgcrypto, TDE)
5. **Compress backups**: Save storage space and transfer time
6. **Document procedures**: Clear recovery runbooks
7. **Verify checksums**: Ensure backup integrity
8. **Automate backups**: Scheduled backups, no manual intervention
9. **Monitor storage**: Ensure adequate space for backups
10. **Retention policy**: Balance storage costs with recovery needs

## Backup Checklist

- [ ] Full backups scheduled (weekly/monthly)
- [ ] Differential backups scheduled (daily)
- [ ] Transaction log backups scheduled (hourly/15min)
- [ ] Backups tested monthly (restore verification)
- [ ] Offsite/cloud backups configured
- [ ] Backup encryption enabled
- [ ] Backup monitoring and alerts configured
- [ ] Recovery procedures documented
- [ ] Retention policy implemented
- [ ] Backup storage monitored
- [ ] RTO and RPO defined and achievable
- [ ] Disaster recovery plan tested annually

## Summary

- **3-2-1 rule**: 3 copies, 2 media types, 1 offsite
- **Full + Differential + Log**: Balanced approach for most systems
- **Test restores**: Untested backups are not backups
- **Point-in-time recovery**: WAL archiving (PostgreSQL) or transaction log backups (SQL Server)
- **Cloud storage**: S3, Azure Blob Storage for offsite backups
- **Automation**: Scheduled backups, monitoring, retention management
- **Documentation**: Clear procedures for recovery scenarios
