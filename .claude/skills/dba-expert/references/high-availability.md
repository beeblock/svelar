# High Availability and Replication Guide

## High Availability Concepts

### Availability Levels

- **99% uptime**: 3.65 days downtime per year
- **99.9% uptime** (three nines): 8.76 hours downtime per year
- **99.99% uptime** (four nines): 52.56 minutes downtime per year
- **99.999% uptime** (five nines): 5.26 minutes downtime per year

### RTO vs RPO

- **RTO** (Recovery Time Objective): Maximum acceptable downtime
- **RPO** (Recovery Point Objective): Maximum acceptable data loss

### Replication vs Clustering

**Replication**:
- Primary-replica architecture
- Asynchronous or synchronous
- Horizontal scalability for reads
- Failover for writes

**Clustering**:
- Shared storage or distributed consensus
- Active-active or active-passive
- Automatic failover
- Higher availability

## PostgreSQL High Availability

### Streaming Replication

**Primary server configuration** (postgresql.conf):
```sql
wal_level = replica
max_wal_senders = 5              -- Number of standbys
wal_keep_size = 1GB              -- WAL retention (PG 13+)
# wal_keep_segments = 64         -- For PG < 13
hot_standby = on
synchronous_commit = on          -- For synchronous replication
# synchronous_standby_names = 'standby1,standby2'  -- For sync replication
```

**pg_hba.conf** (allow replication connections):
```
host    replication     replicator      192.168.1.0/24          md5
```

**Create replication user**:
```sql
CREATE ROLE replicator WITH REPLICATION LOGIN ENCRYPTED PASSWORD 'secret';
```

**Standby server setup**:
```bash
# Stop standby PostgreSQL
systemctl stop postgresql

# Remove data directory
rm -rf /var/lib/postgresql/14/main/*

# Take base backup from primary
pg_basebackup -h primary_host -D /var/lib/postgresql/14/main \
              -U replicator -P -v -R -X stream -C -S standby_slot

# -R creates standby.signal and recovery configuration
# -X stream: streams WAL during backup
# -C creates replication slot
# -S standby_slot: slot name

# Start standby
systemctl start postgresql
```

**standby.signal** (created by pg_basebackup -R):
```
# Exists in data directory to indicate standby mode
```

**postgresql.auto.conf** (recovery configuration):
```
primary_conninfo = 'host=primary_host port=5432 user=replicator password=secret'
primary_slot_name = 'standby_slot'
```

**Monitor replication** (on primary):
```sql
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
    now() - reply_time AS lag_time
FROM pg_stat_replication;
```

**Check replication lag** (on standby):
```sql
SELECT
    now() - pg_last_xact_replay_timestamp() AS replication_lag;
```

### Synchronous vs Asynchronous Replication

**Asynchronous** (default):
- Primary doesn't wait for replica
- Faster writes
- Potential data loss on primary failure
- Good for read replicas

**Synchronous**:
- Primary waits for replica acknowledgment
- Slower writes
- No data loss on primary failure
- Good for zero RPO requirements

**Enable synchronous replication**:
```sql
-- postgresql.conf on primary
synchronous_commit = on
synchronous_standby_names = 'FIRST 1 (standby1, standby2)'

-- FIRST 1: Wait for at least 1 standby
-- Can also use ANY 1 or list all standbys
```

### Replication Slots

Prevent WAL deletion before standby consumes it.

```sql
-- Create replication slot (on primary)
SELECT pg_create_physical_replication_slot('standby_slot');

-- View replication slots
SELECT * FROM pg_replication_slots;

-- Drop replication slot
SELECT pg_drop_replication_slot('standby_slot');

-- Monitor slot WAL retention
SELECT
    slot_name,
    pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn)) AS retained_wal
FROM pg_replication_slots;
```

### Logical Replication

Selective replication at table level.

**Publisher** (source):
```sql
-- Create publication
CREATE PUBLICATION my_publication FOR TABLE users, orders;

-- Or all tables
CREATE PUBLICATION all_tables FOR ALL TABLES;

-- Add/remove tables
ALTER PUBLICATION my_publication ADD TABLE products;
ALTER PUBLICATION my_publication DROP TABLE users;
```

**Subscriber** (destination):
```sql
-- Create subscription
CREATE SUBSCRIPTION my_subscription
    CONNECTION 'host=publisher_host port=5432 dbname=mydb user=replicator password=secret'
    PUBLICATION my_publication;

-- Monitor subscription
SELECT * FROM pg_stat_subscription;

-- Drop subscription
DROP SUBSCRIPTION my_subscription;
```

**Use cases**:
- Replicate specific tables
- Replicate to different PostgreSQL version
- Aggregate data from multiple databases
- Bi-directional replication (with conflict resolution)

### Failover and Promotion

**Manual failover**:
```bash
# 1. On primary: Stop accepting writes
systemctl stop postgresql

# 2. On standby: Promote to primary
pg_ctl promote -D /var/lib/postgresql/14/main
# Or create trigger file
touch /var/lib/postgresql/14/main/promote

# 3. Update application connection string

# 4. Convert old primary to standby (when recovered)
pg_basebackup -h new_primary -D /var/lib/postgresql/14/main -U replicator -R
systemctl start postgresql
```

**Automatic failover** (use tools):
- **Patroni**: PostgreSQL HA with etcd/Consul/ZooKeeper
- **repmgr**: Replication management and failover
- **Pgpool-II**: Connection pooling and automatic failover
- **Stolon**: Cloud-native PostgreSQL HA

### Patroni (Recommended)

**Architecture**:
```
Primary PostgreSQL <-> etcd Cluster
  ↓
Standby PostgreSQL <-> etcd Cluster
  ↓
Standby PostgreSQL <-> etcd Cluster
```

**Configuration** (patroni.yml):
```yaml
scope: postgres-cluster
name: node1

restapi:
  listen: 0.0.0.0:8008
  connect_address: 192.168.1.10:8008

etcd:
  hosts: 192.168.1.20:2379,192.168.1.21:2379,192.168.1.22:2379

bootstrap:
  dcs:
    ttl: 30
    loop_wait: 10
    retry_timeout: 10
    maximum_lag_on_failover: 1048576
    postgresql:
      use_pg_rewind: true
      parameters:
        wal_level: replica
        hot_standby: on
        max_wal_senders: 5
        max_replication_slots: 5

postgresql:
  listen: 0.0.0.0:5432
  connect_address: 192.168.1.10:5432
  data_dir: /var/lib/postgresql/14/main
  authentication:
    replication:
      username: replicator
      password: secret
    superuser:
      username: postgres
      password: secret
```

**Start Patroni**:
```bash
patroni /etc/patroni/patroni.yml
```

**Operations**:
```bash
# Cluster status
patronictl -c /etc/patroni/patroni.yml list

# Manual failover
patronictl -c /etc/patroni/patroni.yml failover

# Switchover (graceful)
patronictl -c /etc/patroni/patroni.yml switchover

# Restart node
patronictl -c /etc/patroni/patroni.yml restart postgres-cluster node1
```

## SQL Server High Availability

### Always On Availability Groups

**Prerequisites**:
- Windows Server Failover Clustering (WSFC)
- SQL Server Enterprise Edition
- All replicas on same SQL Server version

**Setup steps**:

1. **Enable Always On** (on all nodes):
```sql
-- Enable Always On
EXEC sp_configure 'show advanced options', 1;
RECONFIGURE;
EXEC sp_configure 'hadr enabled', 1;
RECONFIGURE;

-- Requires SQL Server restart
```

2. **Create database mirroring endpoint** (on all nodes):
```sql
CREATE ENDPOINT Hadr_endpoint
    STATE = STARTED
    AS TCP (LISTENER_PORT = 5022)
    FOR DATABASE_MIRRORING (ROLE = ALL);

-- Grant permission
GRANT CONNECT ON ENDPOINT::Hadr_endpoint TO [domain\sql_service_account];
```

3. **Create Availability Group** (on primary):
```sql
CREATE AVAILABILITY GROUP AG_MyApp
    FOR DATABASE MyDB, MyDB2
    REPLICA ON
        N'Server1' WITH (
            ENDPOINT_URL = N'TCP://Server1.domain.com:5022',
            AVAILABILITY_MODE = SYNCHRONOUS_COMMIT,
            FAILOVER_MODE = AUTOMATIC,
            BACKUP_PRIORITY = 50,
            SECONDARY_ROLE (ALLOW_CONNECTIONS = READ_ONLY)
        ),
        N'Server2' WITH (
            ENDPOINT_URL = N'TCP://Server2.domain.com:5022',
            AVAILABILITY_MODE = SYNCHRONOUS_COMMIT,
            FAILOVER_MODE = AUTOMATIC,
            BACKUP_PRIORITY = 50,
            SECONDARY_ROLE (ALLOW_CONNECTIONS = READ_ONLY)
        ),
        N'Server3' WITH (
            ENDPOINT_URL = N'TCP://Server3.domain.com:5022',
            AVAILABILITY_MODE = ASYNCHRONOUS_COMMIT,
            FAILOVER_MODE = MANUAL,
            BACKUP_PRIORITY = 25,
            SECONDARY_ROLE (ALLOW_CONNECTIONS = READ_ONLY)
        );

-- Create listener for client connections
ALTER AVAILABILITY GROUP AG_MyApp
ADD LISTENER N'AG_Listener' (
    WITH IP ((N'192.168.1.50', N'255.255.255.0')),
    PORT = 1433
);
```

4. **Join secondary replicas** (on secondaries):
```sql
ALTER AVAILABILITY GROUP AG_MyApp JOIN;

-- Add databases to AG (after full backup/restore)
ALTER DATABASE MyDB SET HADR AVAILABILITY GROUP = AG_MyApp;
ALTER DATABASE MyDB2 SET HADR AVAILABILITY GROUP = AG_MyApp;
```

**Monitor AG**:
```sql
-- Availability group health
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

-- Database replication state
SELECT
    ag.name AS ag_name,
    db.database_name,
    drs.synchronization_state_desc,
    drs.synchronization_health_desc,
    drs.database_state_desc,
    drs.is_suspended,
    drs.log_send_queue_size / 1024 AS log_send_queue_mb,
    drs.log_send_rate / 1024 AS log_send_rate_mb_s,
    drs.redo_queue_size / 1024 AS redo_queue_mb,
    drs.redo_rate / 1024 AS redo_rate_mb_s
FROM sys.dm_hadr_database_replica_states drs
INNER JOIN sys.availability_databases_cluster db ON drs.group_database_id = db.group_database_id
INNER JOIN sys.availability_groups ag ON db.group_id = ag.group_id;
```

**Failover**:
```sql
-- Manual failover (no data loss for sync replicas)
ALTER AVAILABILITY GROUP AG_MyApp FAILOVER;

-- Forced failover (potential data loss)
ALTER AVAILABILITY GROUP AG_MyApp FORCE_FAILOVER_ALLOW_DATA_LOSS;
```

### Database Mirroring (Legacy)

**Deprecated** in favor of Always On AG, but still used in older systems.

```sql
-- On principal
ALTER DATABASE MyDB SET PARTNER = 'TCP://MirrorServer:5022';

-- On mirror
ALTER DATABASE MyDB SET PARTNER = 'TCP://PrincipalServer:5022';

-- Add witness for automatic failover
ALTER DATABASE MyDB SET WITNESS = 'TCP://WitnessServer:5022';

-- Failover
ALTER DATABASE MyDB SET PARTNER FAILOVER;

-- Monitor
SELECT
    database_name,
    mirroring_state_desc,
    mirroring_role_desc,
    mirroring_safety_level_desc,
    mirroring_partner_instance
FROM sys.database_mirroring
WHERE mirroring_guid IS NOT NULL;
```

### Log Shipping

Simple disaster recovery solution.

**Setup**:
```sql
-- 1. On primary: Enable log shipping
EXEC master.dbo.sp_add_log_shipping_primary_database
    @database = N'MyDB',
    @backup_directory = N'\\BackupServer\LogShipping\MyDB',
    @backup_share = N'\\BackupServer\LogShipping\MyDB',
    @backup_job_name = N'LogShipping_Backup_MyDB',
    @backup_retention_period = 4320,  -- 3 days in minutes
    @backup_threshold = 60,           -- Alert if no backup in 60 min
    @threshold_alert_enabled = 1;

-- 2. On secondary: Restore database in standby mode
RESTORE DATABASE MyDB
FROM DISK = '\\BackupServer\LogShipping\MyDB\MyDB_backup.bak'
WITH NORECOVERY;

-- Configure log shipping on secondary
EXEC master.dbo.sp_add_log_shipping_secondary_database
    @secondary_database = N'MyDB',
    @primary_server = N'PrimaryServer',
    @primary_database = N'MyDB',
    @restore_delay = 0,
    @restore_mode = 0,  -- NORECOVERY
    @disconnect_users = 1,
    @restore_threshold = 60,
    @threshold_alert_enabled = 1;

-- 3. Monitor
SELECT * FROM msdb.dbo.log_shipping_monitor_primary;
SELECT * FROM msdb.dbo.log_shipping_monitor_secondary;
```

## Connection Pooling

### PgBouncer (PostgreSQL)

**Configuration** (/etc/pgbouncer/pgbouncer.ini):
```ini
[databases]
mydb = host=localhost port=5432 dbname=mydb
analytics = host=analytics-db port=5432 dbname=analytics

[pgbouncer]
listen_addr = *
listen_port = 6432
auth_type = md5
auth_file = /etc/pgbouncer/userlist.txt

# Pool mode
pool_mode = transaction          # transaction, session, or statement

# Connection limits
max_client_conn = 1000           # Max client connections
default_pool_size = 25           # Backend connections per db
reserve_pool_size = 5            # Emergency connections

# Timeouts
server_idle_timeout = 600
server_lifetime = 3600
query_timeout = 0
query_wait_timeout = 120

# Logging
admin_users = postgres
stats_users = stats_user
```

**userlist.txt**:
```
"user1" "md5_hash_of_password"
"user2" "md5_hash_of_password"
```

**Application connection**:
```python
# Connect to PgBouncer instead of PostgreSQL
DATABASE_URL = "postgresql://user:pass@pgbouncer_host:6432/mydb"
```

### Connection Pooling (SQL Server)

**Built-in connection pooling** in ADO.NET:
```csharp
// Connection string
string connectionString =
    "Server=ag_listener;Database=MyDB;User=sa;Password=secret;" +
    "Pooling=true;Min Pool Size=5;Max Pool Size=100;";
```

**Application-level pooling** (HikariCP for Java):
```java
HikariConfig config = new HikariConfig();
config.setJdbcUrl("jdbc:sqlserver://ag_listener:1433;database=MyDB");
config.setUsername("sa");
config.setPassword("secret");
config.setMaximumPoolSize(100);
config.setMinimumIdle(10);

HikariDataSource dataSource = new HikariDataSource(config);
```

## Load Balancing

### HAProxy for PostgreSQL

**haproxy.cfg**:
```
global
    maxconn 100

defaults
    log global
    mode tcp
    timeout connect 10s
    timeout client 1m
    timeout server 1m

frontend postgres_frontend
    bind *:5432
    default_backend postgres_backend

backend postgres_backend
    option httpchk
    http-check expect status 200
    default-server inter 3s fall 3 rise 2 on-marked-down shutdown-sessions
    server postgres1 192.168.1.10:5432 maxconn 100 check port 8008
    server postgres2 192.168.1.11:5432 maxconn 100 check port 8008 backup

# Health check (Patroni REST API)
backend postgres_healthcheck
    option httpchk GET /read-write
    http-check expect status 200
```

### Read Replicas

Distribute read traffic across replicas.

**Application-level routing**:
```python
# Primary for writes
primary_db = "postgresql://user:pass@primary:5432/mydb"

# Replicas for reads (round-robin)
read_replicas = [
    "postgresql://user:pass@replica1:5432/mydb",
    "postgresql://user:pass@replica2:5432/mydb",
    "postgresql://user:pass@replica3:5432/mydb"
]

def get_read_connection():
    return random.choice(read_replicas)

def get_write_connection():
    return primary_db
```

**SQL Server read-only routing**:
```sql
-- Configure read-only routing
ALTER AVAILABILITY GROUP AG_MyApp
MODIFY REPLICA ON N'Server2'
WITH (SECONDARY_ROLE (READ_ONLY_ROUTING_URL = N'TCP://Server2.domain.com:1433'));

-- Connection string for read intent
Server=AG_Listener;Database=MyDB;ApplicationIntent=ReadOnly;
```

## Disaster Recovery

### Regular Testing

**Disaster recovery drill**:
1. **Schedule regular drills**: Quarterly or bi-annual
2. **Simulate failure**: Shutdown primary server
3. **Execute failover**: Follow runbook procedures
4. **Verify application**: Test critical functionality
5. **Document results**: Time to recover, issues encountered
6. **Improve procedures**: Update runbooks based on findings

### Backup Strategy for HA

Even with replication, backups are essential:
- Protect against data corruption
- Enable point-in-time recovery
- Protect against logical errors (accidental deletes)

**Combined strategy**:
- Replication for high availability
- Regular backups for disaster recovery
- Offsite backups for catastrophic failures

## High Availability Checklist

- [ ] Replication configured (streaming or AG)
- [ ] Automatic failover enabled (Patroni, WSFC)
- [ ] Connection pooling configured
- [ ] Load balancing for read replicas
- [ ] Monitoring and alerting for replication lag
- [ ] Documented failover procedures
- [ ] Regular disaster recovery drills
- [ ] Backup strategy independent of replication
- [ ] Application connection string uses listener/load balancer
- [ ] Health checks configured
- [ ] Replica promotion tested
- [ ] Network segmentation and firewall rules
- [ ] SSL/TLS for replication connections
- [ ] Monitoring dashboard for cluster health

## Summary

- **Streaming replication**: PostgreSQL primary-replica architecture
- **Always On AG**: SQL Server high availability solution
- **Patroni**: Automatic failover for PostgreSQL
- **Connection pooling**: PgBouncer for PostgreSQL, built-in for SQL Server
- **Load balancing**: HAProxy or application-level routing
- **Read replicas**: Distribute read traffic, scale horizontally
- **Disaster recovery**: Regular testing, documented procedures
- **Monitor**: Replication lag, cluster health, automatic alerts
