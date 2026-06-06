# PostgreSQL Comprehensive Guide

## Configuration Tuning

### Memory Configuration

PostgreSQL memory configuration depends on workload type and available system resources.

```sql
-- For a 32GB RAM server, OLTP workload
shared_buffers = 8GB                    -- 25% of RAM (25-40% range)
effective_cache_size = 24GB             -- 75% of RAM (estimate of OS + PG cache)
maintenance_work_mem = 2GB              -- For VACUUM, CREATE INDEX, ALTER TABLE
work_mem = 32MB                         -- Per operation (sort, hash)
wal_buffers = 16MB                      -- Write-ahead log buffers (-1 for auto)

-- For a 64GB RAM server, mixed OLTP/OLAP workload
shared_buffers = 16GB
effective_cache_size = 48GB
maintenance_work_mem = 4GB
work_mem = 64MB
wal_buffers = 16MB

-- For a 128GB RAM server, analytics workload
shared_buffers = 32GB                   -- Don't exceed 40% of RAM
effective_cache_size = 96GB
maintenance_work_mem = 8GB
work_mem = 256MB                        -- Higher for complex queries
wal_buffers = 16MB
```

**Key Points**:
- `shared_buffers`: PostgreSQL's own cache. 25-40% of RAM. Too high can be counterproductive.
- `effective_cache_size`: Tells planner how much memory is available for caching. OS cache + shared_buffers.
- `maintenance_work_mem`: Used by VACUUM, CREATE INDEX, ALTER TABLE. Can be large.
- `work_mem`: Per operation (sort, hash join). Be careful - too high can cause OOM if many concurrent operations.

### Connection Configuration

```sql
max_connections = 100                   -- Total connections allowed

-- Connection pooling (use PgBouncer)
# pgbouncer.ini
[databases]
mydb = host=localhost port=5432 dbname=mydb

[pgbouncer]
listen_port = 6432
listen_addr = *
auth_type = md5
auth_file = /etc/pgbouncer/userlist.txt
pool_mode = transaction                 -- transaction, session, or statement
max_client_conn = 1000                  -- Client-side connections
default_pool_size = 25                  -- Backend connections per database
reserve_pool_size = 5                   -- Emergency connections
```

### Write-Ahead Log (WAL) Configuration

```sql
-- WAL settings for performance and durability
wal_level = replica                     -- minimal, replica, or logical
wal_buffers = 16MB                      -- -1 for auto (1/32 of shared_buffers)
min_wal_size = 1GB                      -- Minimum WAL kept
max_wal_size = 4GB                      -- Checkpoint triggered if exceeded
wal_compression = on                    -- Compress WAL (PG 9.5+)

-- Checkpoint tuning
checkpoint_completion_target = 0.9      -- Spread checkpoint I/O over 90% of interval
checkpoint_timeout = 15min              -- Maximum time between checkpoints

-- Synchronous commit (durability vs performance)
synchronous_commit = on                 -- on, off, remote_write, remote_apply, local
# synchronous_commit = off              -- Faster, risk losing recent commits on crash
```

### Query Planner Configuration

```sql
-- Cost-based planner settings
random_page_cost = 1.1                  -- For SSDs (default 4.0 for HDD)
seq_page_cost = 1.0                     -- Sequential page cost
cpu_tuple_cost = 0.01                   -- Cost of processing a tuple
cpu_index_tuple_cost = 0.005            -- Cost of processing an index entry
cpu_operator_cost = 0.0025              -- Cost of processing an operator

-- Parallel query settings (PG 9.6+)
max_parallel_workers_per_gather = 4     -- Max parallel workers per query
max_parallel_workers = 8                -- Total parallel workers
max_worker_processes = 8                -- Total background processes
parallel_setup_cost = 1000              -- Cost of setting up parallel query
parallel_tuple_cost = 0.1               -- Cost per tuple in parallel mode

-- Effective I/O concurrency
effective_io_concurrency = 200          -- For SSDs (1 for HDD)
```

## Index Strategies

### Index Types

**B-tree (Default)**:
```sql
-- General purpose, supports <, <=, =, >=, >, BETWEEN, IN, IS NULL
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_orders_created ON orders(created DESC);

-- Composite index (column order matters!)
CREATE INDEX idx_orders_customer_date ON orders(customer_id, created DESC);
```

**GIN (Generalized Inverted Index)**:
```sql
-- For arrays, JSONB, full-text search
CREATE INDEX idx_tags_gin ON posts USING GIN(tags);
CREATE INDEX idx_data_gin ON documents USING GIN(data);
CREATE INDEX idx_fulltext ON articles USING GIN(to_tsvector('english', content));

-- JSONB operator support
SELECT * FROM documents WHERE data @> '{"status": "active"}';
SELECT * FROM documents WHERE data ? 'email';
```

**GiST (Generalized Search Tree)**:
```sql
-- For geometric data, full-text search, ranges
CREATE INDEX idx_location ON places USING GIST(location);
CREATE INDEX idx_ip_range ON ip_blocks USING GIST(ip_range);
CREATE INDEX idx_fulltext_gist ON articles USING GIST(to_tsvector('english', content));
```

**BRIN (Block Range Index)**:
```sql
-- For very large tables with natural ordering (time-series)
CREATE INDEX idx_logs_created_brin ON logs USING BRIN(created_at);

-- Much smaller than B-tree, but less precise
-- Best for append-only tables with correlation
```

**Hash**:
```sql
-- Equality only, rarely better than B-tree
CREATE INDEX idx_users_hash ON users USING HASH(username);
```

### Partial Indexes

```sql
-- Index only subset of rows
CREATE INDEX idx_active_orders ON orders(created DESC)
WHERE status = 'active';

-- Useful for queries with common WHERE clauses
CREATE INDEX idx_unprocessed_payments ON payments(created)
WHERE processed = false;

-- Exclude nulls
CREATE INDEX idx_users_email_not_null ON users(email)
WHERE email IS NOT NULL;
```

### Covering Indexes (Index-Only Scans)

```sql
-- Include additional columns for index-only scans
CREATE INDEX idx_orders_covering ON orders(customer_id, created DESC)
INCLUDE (total, status);

-- Query can be satisfied entirely from index
EXPLAIN (ANALYZE, BUFFERS)
SELECT customer_id, total, status
FROM orders
WHERE customer_id = 123
ORDER BY created DESC;

-- Output: Index Only Scan using idx_orders_covering
```

### Expression Indexes

```sql
-- Index on expression
CREATE INDEX idx_users_lower_email ON users(LOWER(email));

-- Query must match expression
SELECT * FROM users WHERE LOWER(email) = 'user@example.com';

-- JSON expression index
CREATE INDEX idx_data_status ON documents((data->>'status'));
```

### Unique Indexes

```sql
-- Enforce uniqueness
CREATE UNIQUE INDEX idx_users_email_unique ON users(email);

-- Partial unique index
CREATE UNIQUE INDEX idx_users_email_unique_active ON users(email)
WHERE deleted_at IS NULL;

-- Deferrable unique constraint (within transaction)
CREATE UNIQUE INDEX idx_users_username ON users(username)
DEFERRABLE INITIALLY DEFERRED;
```

### Index Monitoring

```sql
-- Index usage statistics
SELECT
    schemaname,
    tablename,
    indexname,
    idx_scan,
    idx_tup_read,
    idx_tup_fetch,
    pg_size_pretty(pg_relation_size(indexrelid)) as size
FROM pg_stat_user_indexes
ORDER BY idx_scan ASC;

-- Unused indexes (never scanned)
SELECT
    schemaname,
    tablename,
    indexname,
    pg_size_pretty(pg_relation_size(indexrelid)) as size
FROM pg_stat_user_indexes
WHERE idx_scan = 0
    AND indexrelname NOT LIKE 'pg_toast_%'
ORDER BY pg_relation_size(indexrelid) DESC;

-- Duplicate indexes
SELECT
    indrelid::regclass as table_name,
    array_agg(indexrelid::regclass) as indexes,
    indkey
FROM pg_index
GROUP BY indrelid, indkey
HAVING count(*) > 1;

-- Index bloat
SELECT
    schemaname,
    tablename,
    indexname,
    pg_size_pretty(pg_relation_size(indexrelid)) as size,
    idx_scan,
    idx_tup_read,
    idx_tup_fetch
FROM pg_stat_user_indexes
WHERE idx_scan < 10
ORDER BY pg_relation_size(indexrelid) DESC;
```

## VACUUM and Maintenance

### Understanding VACUUM

VACUUM reclaims storage occupied by dead tuples (deleted or obsoleted by updates).

```sql
-- Regular VACUUM (non-blocking)
VACUUM users;

-- VACUUM ANALYZE (also updates statistics)
VACUUM ANALYZE users;

-- VACUUM FULL (rewrites table, locks table)
VACUUM FULL users;  -- Avoid in production, use pg_repack instead

-- VACUUM FREEZE (prevent transaction ID wraparound)
VACUUM FREEZE users;
```

### Autovacuum Configuration

```sql
-- Global settings (postgresql.conf)
autovacuum = on
autovacuum_max_workers = 3
autovacuum_naptime = 10s               -- Check interval
autovacuum_vacuum_threshold = 50       -- Minimum dead tuples
autovacuum_vacuum_scale_factor = 0.05  -- 5% dead tuples triggers VACUUM
autovacuum_analyze_threshold = 50
autovacuum_analyze_scale_factor = 0.02 -- 2% changes triggers ANALYZE
autovacuum_vacuum_cost_delay = 2ms     -- Throttle to reduce I/O impact
autovacuum_vacuum_cost_limit = 200

-- Per-table settings
ALTER TABLE large_table SET (
    autovacuum_vacuum_scale_factor = 0.01,  -- More aggressive for large tables
    autovacuum_analyze_scale_factor = 0.005
);

ALTER TABLE high_churn_table SET (
    autovacuum_vacuum_threshold = 100,
    autovacuum_vacuum_scale_factor = 0.02,
    autovacuum_vacuum_cost_delay = 0        -- No throttle for critical tables
);
```

### Manual Maintenance

```sql
-- Analyze table (update statistics)
ANALYZE users;

-- Analyze specific columns
ANALYZE users(email, created_at);

-- Reindex (rebuild all indexes)
REINDEX TABLE users;
REINDEX INDEX CONCURRENTLY idx_users_email;  -- Non-blocking (PG 12+)

-- Cluster (reorder table by index)
CLUSTER users USING idx_users_created;  -- Locks table
```

### Bloat Management

```sql
-- Check table bloat
SELECT
    schemaname,
    tablename,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as total_size,
    pg_size_pretty(pg_relation_size(schemaname||'.'||tablename)) as table_size,
    n_dead_tup,
    n_live_tup,
    round(n_dead_tup * 100.0 / NULLIF(n_live_tup + n_dead_tup, 0), 2) as dead_ratio
FROM pg_stat_user_tables
WHERE n_live_tup > 0
ORDER BY n_dead_tup DESC;

-- pg_repack (online table rewrite, requires extension)
CREATE EXTENSION pg_repack;
pg_repack -t users -d mydb;  -- Repack specific table
pg_repack -d mydb;            -- Repack entire database
```

## Partitioning

### Range Partitioning

```sql
-- Parent table
CREATE TABLE orders (
    id BIGSERIAL,
    customer_id INT NOT NULL,
    total DECIMAL(10,2),
    created_at TIMESTAMP NOT NULL,
    PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

-- Partitions
CREATE TABLE orders_2024_q1 PARTITION OF orders
    FOR VALUES FROM ('2024-01-01') TO ('2024-04-01');

CREATE TABLE orders_2024_q2 PARTITION OF orders
    FOR VALUES FROM ('2024-04-01') TO ('2024-07-01');

CREATE TABLE orders_2024_q3 PARTITION OF orders
    FOR VALUES FROM ('2024-07-01') TO ('2024-10-01');

-- Default partition for out-of-range values
CREATE TABLE orders_default PARTITION OF orders DEFAULT;

-- Indexes on parent create indexes on all partitions
CREATE INDEX idx_orders_customer ON orders(customer_id);
```

### List Partitioning

```sql
-- Partition by discrete values
CREATE TABLE sales (
    id BIGSERIAL,
    region VARCHAR(50) NOT NULL,
    amount DECIMAL(10,2),
    sale_date DATE NOT NULL,
    PRIMARY KEY (id, region)
) PARTITION BY LIST (region);

CREATE TABLE sales_north PARTITION OF sales
    FOR VALUES IN ('US-NORTH', 'CA-NORTH');

CREATE TABLE sales_south PARTITION OF sales
    FOR VALUES IN ('US-SOUTH', 'CA-SOUTH');

CREATE TABLE sales_europe PARTITION OF sales
    FOR VALUES IN ('UK', 'FR', 'DE');
```

### Hash Partitioning

```sql
-- Distribute data evenly
CREATE TABLE users (
    id BIGSERIAL PRIMARY KEY,
    username VARCHAR(100) NOT NULL,
    email VARCHAR(255) NOT NULL
) PARTITION BY HASH (id);

CREATE TABLE users_p0 PARTITION OF users
    FOR VALUES WITH (MODULUS 4, REMAINDER 0);

CREATE TABLE users_p1 PARTITION OF users
    FOR VALUES WITH (MODULUS 4, REMAINDER 1);

CREATE TABLE users_p2 PARTITION OF users
    FOR VALUES WITH (MODULUS 4, REMAINDER 2);

CREATE TABLE users_p3 PARTITION OF users
    FOR VALUES WITH (MODULUS 4, REMAINDER 3);
```

### Partition Management

```sql
-- Attach new partition
CREATE TABLE orders_2024_q4 (LIKE orders INCLUDING ALL);
ALTER TABLE orders ATTACH PARTITION orders_2024_q4
    FOR VALUES FROM ('2024-10-01') TO ('2025-01-01');

-- Detach partition (for maintenance)
ALTER TABLE orders DETACH PARTITION orders_2023_q1;

-- Drop old partition
DROP TABLE orders_2023_q1;

-- Partition pruning (automatic query optimization)
EXPLAIN SELECT * FROM orders WHERE created_at >= '2024-07-01';
-- Shows only relevant partitions scanned
```

## Replication

### Streaming Replication

**Primary Server Configuration**:
```sql
-- postgresql.conf
wal_level = replica
max_wal_senders = 5
wal_keep_size = 1GB  -- Or wal_keep_segments in older versions
hot_standby = on

-- pg_hba.conf (allow replication connections)
host    replication     replicator      192.168.1.0/24          md5
```

**Standby Server Setup**:
```bash
# Take base backup from primary
pg_basebackup -h primary_host -D /var/lib/postgresql/data -U replicator -P -v -R

# -R creates standby.signal and recovery configuration
# standby.signal file tells PostgreSQL this is a standby
```

**standby.signal and postgresql.auto.conf**:
```sql
primary_conninfo = 'host=primary_host port=5432 user=replicator password=secret'
primary_slot_name = 'standby_slot'  -- Optional, prevents WAL deletion
```

**Replication Slots** (prevent WAL deletion):
```sql
-- On primary
SELECT * FROM pg_create_physical_replication_slot('standby_slot');

-- Monitor replication lag
SELECT
    client_addr,
    state,
    sent_lsn,
    write_lsn,
    flush_lsn,
    replay_lsn,
    sync_state,
    pg_wal_lsn_diff(sent_lsn, replay_lsn) AS lag_bytes
FROM pg_stat_replication;
```

### Logical Replication

**Publisher Setup**:
```sql
-- postgresql.conf
wal_level = logical

-- Create publication
CREATE PUBLICATION my_publication FOR TABLE users, orders;

-- Or all tables
CREATE PUBLICATION all_tables FOR ALL TABLES;
```

**Subscriber Setup**:
```sql
-- Create subscription
CREATE SUBSCRIPTION my_subscription
    CONNECTION 'host=publisher_host port=5432 dbname=mydb user=replicator password=secret'
    PUBLICATION my_publication;

-- Monitor subscription status
SELECT * FROM pg_stat_subscription;
```

### Cascading Replication

```
Primary → Standby1 → Standby2
       → Standby3
```

**Standby1 Configuration** (relay):
```sql
-- postgresql.conf
hot_standby = on
max_wal_senders = 5  -- Allow downstream standbys
```

## JSON and JSONB

### JSONB vs JSON

Use JSONB (binary JSON) for:
- Storage and indexing
- Querying JSON data
- Better performance

Use JSON only for:
- Preserving exact formatting
- Key order preservation

```sql
-- Create table with JSONB
CREATE TABLE documents (
    id SERIAL PRIMARY KEY,
    data JSONB NOT NULL
);

-- Insert JSONB data
INSERT INTO documents (data) VALUES
    ('{"name": "John", "age": 30, "tags": ["developer", "postgres"]}'),
    ('{"name": "Jane", "age": 25, "tags": ["designer", "css"]}');
```

### JSONB Operators

```sql
-- -> returns JSON object
SELECT data -> 'name' FROM documents;

-- ->> returns text
SELECT data ->> 'name' FROM documents;

-- #> path operator
SELECT data #> '{address,city}' FROM documents;

-- @> contains
SELECT * FROM documents WHERE data @> '{"age": 30}';

-- ? key exists
SELECT * FROM documents WHERE data ? 'email';

-- ?| any key exists
SELECT * FROM documents WHERE data ?| array['email', 'phone'];

-- ?& all keys exist
SELECT * FROM documents WHERE data ?& array['name', 'age'];

-- || concatenation
UPDATE documents SET data = data || '{"updated": true}' WHERE id = 1;

-- - remove key
UPDATE documents SET data = data - 'temp_field' WHERE id = 1;
```

### JSONB Indexing

```sql
-- GIN index for general JSONB queries
CREATE INDEX idx_documents_data ON documents USING GIN(data);

-- GIN index with jsonb_path_ops (more efficient for @> queries)
CREATE INDEX idx_documents_data_path ON documents USING GIN(data jsonb_path_ops);

-- Index specific key
CREATE INDEX idx_documents_status ON documents((data->>'status'));

-- Partial index
CREATE INDEX idx_documents_active ON documents USING GIN(data)
WHERE data->>'status' = 'active';
```

### JSONB Functions

```sql
-- jsonb_set (update value)
UPDATE documents
SET data = jsonb_set(data, '{address,city}', '"New York"')
WHERE id = 1;

-- jsonb_insert (insert value)
UPDATE documents
SET data = jsonb_insert(data, '{tags,0}', '"featured"')
WHERE id = 1;

-- jsonb_array_elements (expand array)
SELECT id, elem->>'tag'
FROM documents, jsonb_array_elements(data->'tags') AS elem;

-- jsonb_each (expand object)
SELECT id, key, value
FROM documents, jsonb_each(data);

-- jsonb_object_keys
SELECT DISTINCT jsonb_object_keys(data) FROM documents;

-- jsonb_pretty (formatted output)
SELECT jsonb_pretty(data) FROM documents WHERE id = 1;
```

## Full-Text Search

### tsvector and tsquery

```sql
-- Create table with tsvector column
CREATE TABLE articles (
    id SERIAL PRIMARY KEY,
    title TEXT,
    content TEXT,
    search_vector TSVECTOR
);

-- Generate tsvector
UPDATE articles SET search_vector =
    to_tsvector('english', coalesce(title, '') || ' ' || coalesce(content, ''));

-- Create GIN index
CREATE INDEX idx_articles_search ON articles USING GIN(search_vector);

-- Search
SELECT id, title
FROM articles
WHERE search_vector @@ to_tsquery('english', 'postgresql & performance');

-- Ranking
SELECT id, title, ts_rank(search_vector, query) AS rank
FROM articles, to_tsquery('english', 'postgresql & performance') query
WHERE search_vector @@ query
ORDER BY rank DESC;
```

### Generated tsvector Column

```sql
-- Automatically update tsvector
CREATE TABLE articles (
    id SERIAL PRIMARY KEY,
    title TEXT,
    content TEXT,
    search_vector TSVECTOR GENERATED ALWAYS AS (
        to_tsvector('english', coalesce(title, '') || ' ' || coalesce(content, ''))
    ) STORED
);

CREATE INDEX idx_articles_search ON articles USING GIN(search_vector);
```

### Advanced Full-Text Search

```sql
-- OR search
SELECT * FROM articles
WHERE search_vector @@ to_tsquery('english', 'postgresql | mysql');

-- NOT search
SELECT * FROM articles
WHERE search_vector @@ to_tsquery('english', 'postgresql & !mysql');

-- Phrase search
SELECT * FROM articles
WHERE search_vector @@ phraseto_tsquery('english', 'full text search');

-- Highlighting
SELECT id, title,
    ts_headline('english', content, to_tsquery('english', 'postgresql')) AS snippet
FROM articles
WHERE search_vector @@ to_tsquery('english', 'postgresql');
```

## Query Optimization

### EXPLAIN ANALYZE

```sql
-- Basic explain
EXPLAIN SELECT * FROM orders WHERE customer_id = 123;

-- With execution
EXPLAIN ANALYZE SELECT * FROM orders WHERE customer_id = 123;

-- Detailed output
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT o.id, o.total, c.name
FROM orders o
JOIN customers c ON o.customer_id = c.id
WHERE o.created > '2024-01-01'
ORDER BY o.created DESC
LIMIT 10;
```

**Reading EXPLAIN output**:
- Seq Scan: Full table scan (bad for large tables)
- Index Scan: Uses index, fetches rows from table
- Index Only Scan: Satisfied entirely from index (best)
- Bitmap Heap Scan: Index → Bitmap → Table
- Hash Join: Build hash table, probe
- Nested Loop: For each outer row, scan inner
- Merge Join: Both inputs sorted

### Query Optimization Examples

**Problem: Sequential Scan**:
```sql
-- Bad
EXPLAIN ANALYZE
SELECT * FROM orders WHERE customer_id = 123;
-- Seq Scan on orders (cost=0.00..1234.00 rows=10)

-- Solution: Add index
CREATE INDEX idx_orders_customer ON orders(customer_id);

-- Good
EXPLAIN ANALYZE
SELECT * FROM orders WHERE customer_id = 123;
-- Index Scan using idx_orders_customer (cost=0.29..15.30 rows=10)
```

**Problem: Not Using Index**:
```sql
-- Bad: Function prevents index usage
SELECT * FROM users WHERE LOWER(email) = 'user@example.com';
-- Seq Scan on users

-- Solution: Expression index
CREATE INDEX idx_users_email_lower ON users(LOWER(email));
```

**Problem: Expensive Sort**:
```sql
-- Bad
EXPLAIN ANALYZE
SELECT * FROM orders
WHERE customer_id = 123
ORDER BY created DESC
LIMIT 10;
-- Index Scan + Sort (cost=156.78..157.03)

-- Solution: Composite index with sort column
CREATE INDEX idx_orders_customer_created ON orders(customer_id, created DESC);
-- Index Scan using idx_orders_customer_created (cost=0.29..10.39)
```

### Statistics

```sql
-- Update statistics
ANALYZE orders;

-- Check statistics
SELECT
    schemaname,
    tablename,
    last_analyze,
    last_autoanalyze,
    n_mod_since_analyze
FROM pg_stat_user_tables;

-- Set statistics target (default 100, max 10000)
ALTER TABLE orders ALTER COLUMN customer_id SET STATISTICS 1000;

-- View column statistics
SELECT * FROM pg_stats WHERE tablename = 'orders' AND attname = 'customer_id';
```

## Connection Pooling with PgBouncer

### PgBouncer Configuration

```ini
# /etc/pgbouncer/pgbouncer.ini
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
default_pool_size = 25           # Backend connections per user+database
reserve_pool_size = 5            # Emergency connections
reserve_pool_timeout = 5         # Timeout for emergency pool

# Logging
admin_users = postgres
stats_users = stats_user
log_connections = 1
log_disconnections = 1
log_pooler_errors = 1

# Timeouts
server_idle_timeout = 600        # Close idle server connections
server_lifetime = 3600           # Reconnect after this many seconds
server_connect_timeout = 15
query_timeout = 0
query_wait_timeout = 120
client_idle_timeout = 0
```

### Pool Modes

- **transaction**: Best for most applications. Connection returned after transaction.
- **session**: Traditional, connection per session. Use for applications needing session state.
- **statement**: Aggressive pooling, connection returned after each statement.

### Monitoring PgBouncer

```sql
-- Connect to PgBouncer admin console
psql -h localhost -p 6432 -U postgres pgbouncer

-- Show pools
SHOW POOLS;

-- Show clients
SHOW CLIENTS;

-- Show servers
SHOW SERVERS;

-- Show statistics
SHOW STATS;

-- Reload configuration
RELOAD;
```

## Performance Tips

1. **Use Connection Pooling**: PgBouncer or application-level pooling
2. **Index Wisely**: Index queries, monitor usage, remove unused indexes
3. **VACUUM Regularly**: Configure autovacuum appropriately
4. **Analyze Statistics**: Keep statistics up to date
5. **Use EXPLAIN**: Understand query plans before optimizing
6. **Partition Large Tables**: For time-series or naturally partitioned data
7. **Use Covering Indexes**: For index-only scans
8. **Optimize JOIN Order**: PostgreSQL usually does this, but verify
9. **Batch Operations**: Use COPY, multi-row INSERT, bulk operations
10. **Monitor**: pg_stat_statements, slow query log, system metrics
