# NoSQL Databases Guide

## When to Use NoSQL

### Document Databases (MongoDB)

**Use when**:
- Flexible, evolving schemas
- Hierarchical/nested data structures
- Rapid development and iteration
- Horizontal scaling requirements
- Complex queries on JSON-like data

**Avoid when**:
- Complex multi-document transactions required (use PostgreSQL/SQL Server)
- Strict ACID compliance needed across multiple records
- Heavy relational data with many joins

### Key-Value Stores (Redis)

**Use when**:
- Caching and session management
- Real-time analytics and counters
- Pub/sub messaging
- Leaderboards and ranking
- Rate limiting

**Avoid when**:
- Complex querying needed
- Durable, long-term storage required (without proper persistence)
- Large values (>100MB)

### Search Engines (Elasticsearch)

**Use when**:
- Full-text search requirements
- Log and event analytics
- Real-time data exploration
- Geospatial queries
- Aggregations and analytics

**Avoid when**:
- Primary data store (use as secondary index)
- Strong consistency required
- ACID transactions needed

## MongoDB

### Document Design

**Embedding vs Referencing**:

```javascript
// Embedding (denormalization) - Good for 1:few
{
  "_id": ObjectId("..."),
  "username": "john_doe",
  "email": "john@example.com",
  "addresses": [
    { "street": "123 Main St", "city": "NYC", "type": "home" },
    { "street": "456 Work Ave", "city": "NYC", "type": "work" }
  ]
}

// Referencing (normalization) - Good for 1:many or many:many
// User document
{
  "_id": ObjectId("user123"),
  "username": "john_doe",
  "email": "john@example.com"
}

// Order documents (separate collection)
{
  "_id": ObjectId("order456"),
  "user_id": ObjectId("user123"),
  "total": 99.99,
  "items": [...]
}
```

**Design Patterns**:

1. **Subset Pattern** (avoid large arrays):
```javascript
// Only store recent orders in user document
{
  "_id": ObjectId("user123"),
  "username": "john_doe",
  "recent_orders": [  // Last 10 orders
    { "id": ObjectId("order1"), "date": ISODate("2024-01-15"), "total": 50.00 },
    { "id": ObjectId("order2"), "date": ISODate("2024-01-14"), "total": 75.00 }
  ]
}
```

2. **Extended Reference Pattern**:
```javascript
// Duplicate frequently accessed data
{
  "_id": ObjectId("order123"),
  "customer": {
    "id": ObjectId("user123"),
    "name": "John Doe",  // Duplicated for quick access
    "email": "john@example.com"  // Duplicated
  },
  "items": [...]
}
```

3. **Bucket Pattern** (time-series data):
```javascript
// Group measurements into time buckets
{
  "_id": ObjectId("..."),
  "sensor_id": "sensor_001",
  "date": ISODate("2024-01-15"),
  "hour": 14,
  "measurements": [
    { "minute": 0, "temp": 20.5, "humidity": 45 },
    { "minute": 1, "temp": 20.6, "humidity": 45 },
    // ... 58 more minute measurements
  ],
  "summary": {
    "avg_temp": 20.7,
    "max_temp": 21.2,
    "min_temp": 20.3
  }
}
```

### Indexing

**Index Types**:

```javascript
// Single field index
db.users.createIndex({ email: 1 })

// Compound index (order matters!)
db.orders.createIndex({ customer_id: 1, created_at: -1 })

// Multikey index (for arrays)
db.posts.createIndex({ tags: 1 })

// Text index (full-text search)
db.articles.createIndex({ title: "text", content: "text" })

// Geospatial index
db.places.createIndex({ location: "2dsphere" })

// TTL index (auto-delete documents)
db.sessions.createIndex({ createdAt: 1 }, { expireAfterSeconds: 3600 })

// Partial index (index subset)
db.orders.createIndex(
  { customer_id: 1 },
  { partialFilterExpression: { status: "active" } }
)

// Unique index
db.users.createIndex({ email: 1 }, { unique: true })

// Sparse index (only documents with field)
db.users.createIndex({ phone: 1 }, { sparse: true })
```

**Covering Queries**:
```javascript
// Index covers query (no document fetch)
db.users.createIndex({ email: 1, name: 1, created: 1 })

db.users.find(
  { email: "user@example.com" },
  { name: 1, created: 1, _id: 0 }  // Projection matches index
).explain()
// Shows IXSCAN with "PROJECTION_COVERED"
```

**Index Monitoring**:
```javascript
// Find slow queries
db.setProfilingLevel(1, { slowms: 100 })  // Log queries > 100ms
db.system.profile.find().sort({ ts: -1 }).limit(10)

// Analyze query performance
db.orders.find({ customer_id: 123 }).explain("executionStats")

// Check index usage
db.orders.aggregate([
  { $indexStats: {} }
])

// Find unused indexes
db.orders.aggregate([
  { $indexStats: {} },
  { $match: { "accesses.ops": 0 } }
])
```

### Aggregation Pipeline

```javascript
// Complex aggregation example
db.orders.aggregate([
  // Stage 1: Filter
  {
    $match: {
      created_at: { $gte: ISODate("2024-01-01") },
      status: "completed"
    }
  },

  // Stage 2: Join with customers
  {
    $lookup: {
      from: "customers",
      localField: "customer_id",
      foreignField: "_id",
      as: "customer"
    }
  },

  // Stage 3: Unwind array
  { $unwind: "$customer" },

  // Stage 4: Group and aggregate
  {
    $group: {
      _id: {
        customer_id: "$customer_id",
        month: { $month: "$created_at" }
      },
      customer_name: { $first: "$customer.name" },
      total_orders: { $sum: 1 },
      total_revenue: { $sum: "$total" },
      avg_order_value: { $avg: "$total" }
    }
  },

  // Stage 5: Sort
  { $sort: { total_revenue: -1 } },

  // Stage 6: Limit
  { $limit: 10 },

  // Stage 7: Project (shape output)
  {
    $project: {
      _id: 0,
      customer_id: "$_id.customer_id",
      customer_name: 1,
      month: "$_id.month",
      total_orders: 1,
      total_revenue: { $round: ["$total_revenue", 2] },
      avg_order_value: { $round: ["$avg_order_value", 2] }
    }
  }
])

// Use indexes in aggregation
// - $match early to reduce documents
// - Index on match fields
// - Index on sort fields
```

### Sharding

**Shard Key Selection**:

```javascript
// Good shard key: High cardinality, even distribution
// user_id for user data
sh.shardCollection("mydb.orders", { user_id: 1 })

// Compound shard key
sh.shardCollection("mydb.logs", { date: 1, server_id: 1 })

// Hashed shard key (even distribution)
sh.shardCollection("mydb.users", { _id: "hashed" })

// Bad shard keys:
// - Low cardinality (status, country)
// - Monotonically increasing (_id, timestamp)
// - Hotspot-prone fields
```

**Monitoring Sharding**:
```javascript
// Check shard distribution
db.orders.getShardDistribution()

// Balancer status
sh.getBalancerState()
sh.status()

// Check chunk distribution
use config
db.chunks.aggregate([
  { $group: { _id: "$shard", count: { $sum: 1 } } },
  { $sort: { count: -1 } }
])
```

### Best Practices

```javascript
// 1. Use projection (return only needed fields)
db.users.find({ status: "active" }, { name: 1, email: 1 })

// 2. Limit results
db.orders.find({}).limit(100)

// 3. Use covered queries
db.users.createIndex({ email: 1, name: 1 })
db.users.find({ email: "test@example.com" }, { name: 1, _id: 0 })

// 4. Batch inserts
db.orders.insertMany([
  { customer_id: 1, total: 50 },
  { customer_id: 2, total: 75 }
], { ordered: false })  // Parallel inserts

// 5. Update operators (avoid full document replacement)
db.users.updateOne(
  { _id: ObjectId("...") },
  {
    $set: { last_login: new Date() },
    $inc: { login_count: 1 }
  }
)

// 6. Use bulk operations
const bulk = db.orders.initializeUnorderedBulkOp()
bulk.find({ status: "pending" }).update({ $set: { status: "processing" } })
bulk.find({ created_at: { $lt: old_date } }).remove()
bulk.execute()

// 7. Connection pooling
// Set appropriate pool size in connection string
mongodb://localhost:27017/mydb?maxPoolSize=50

// 8. Read preference for replica sets
db.users.find({}).readPref("secondaryPreferred")
```

## Redis

### Data Structures

**Strings**:
```redis
# Set/Get
SET user:1000:name "John Doe"
GET user:1000:name

# Increment/Decrement
INCR page:views
INCRBY page:views 10
DECR inventory:item:123

# Expire
SETEX session:abc123 3600 "session_data"  # 1 hour TTL
EXPIRE user:1000:name 3600

# Atomic operations
GETSET user:1000:status "active"  # Get old value, set new
```

**Hashes** (objects):
```redis
# Set/Get fields
HSET user:1000 name "John Doe" email "john@example.com" age 30
HGET user:1000 name
HGETALL user:1000

# Increment field
HINCRBY user:1000 login_count 1

# Multiple fields
HMSET user:1000 name "John" email "john@example.com"
HMGET user:1000 name email
```

**Lists** (queues, stacks):
```redis
# Push/Pop (Queue - FIFO)
LPUSH queue:jobs "job1"
LPUSH queue:jobs "job2"
RPOP queue:jobs  # Returns "job1"

# Push/Pop (Stack - LIFO)
LPUSH stack:history "page1"
LPUSH stack:history "page2"
LPOP stack:history  # Returns "page2"

# Blocking pop (wait for items)
BRPOP queue:jobs 0  # Wait forever
BRPOP queue:jobs 30  # Wait 30 seconds

# Range
LRANGE queue:jobs 0 9  # First 10 items

# Trim (limit size)
LTRIM recent:logs 0 99  # Keep last 100
```

**Sets** (unique values):
```redis
# Add/Remove members
SADD tags:post:123 "redis" "database" "nosql"
SREM tags:post:123 "database"

# Check membership
SISMEMBER tags:post:123 "redis"  # Returns 1

# Set operations
SINTER tags:post:123 tags:post:456  # Intersection
SUNION tags:post:123 tags:post:456  # Union
SDIFF tags:post:123 tags:post:456   # Difference

# Random member
SRANDMEMBER tags:post:123

# Count
SCARD tags:post:123
```

**Sorted Sets** (leaderboards, rankings):
```redis
# Add with score
ZADD leaderboard 1000 "player1"
ZADD leaderboard 1500 "player2"
ZADD leaderboard 2000 "player3"

# Get rank
ZRANK leaderboard "player2"  # Returns 1 (0-indexed)
ZREVRANK leaderboard "player2"  # Reverse rank

# Get score
ZSCORE leaderboard "player2"

# Range by rank
ZRANGE leaderboard 0 9  # Top 10
ZREVRANGE leaderboard 0 9 WITHSCORES  # Top 10 with scores

# Range by score
ZRANGEBYSCORE leaderboard 1000 2000

# Increment score
ZINCRBY leaderboard 100 "player1"

# Count in range
ZCOUNT leaderboard 1000 2000

# Remove by rank
ZREMRANGEBYRANK leaderboard 10 -1  # Keep top 10
```

### Common Patterns

**Caching** (cache-aside pattern):
```python
def get_user(user_id):
    # Try cache first
    cache_key = f"user:{user_id}"
    cached = redis.get(cache_key)

    if cached:
        return json.loads(cached)

    # Cache miss - fetch from database
    user = db.query("SELECT * FROM users WHERE id = %s", user_id)

    # Store in cache with TTL
    redis.setex(cache_key, 3600, json.dumps(user))

    return user
```

**Session Management**:
```redis
# Store session
SETEX session:abc123 1800 '{"user_id": 1000, "authenticated": true}'

# Get session
GET session:abc123

# Extend session
EXPIRE session:abc123 1800
```

**Rate Limiting** (fixed window):
```redis
# Allow 100 requests per minute
SET rate:user:1000:2024-01-15-14:30 1 EX 60 NX
INCR rate:user:1000:2024-01-15-14:30
GET rate:user:1000:2024-01-15-14:30  # Check count
```

**Rate Limiting** (sliding window):
```redis
# More accurate rate limiting
ZADD rate:user:1000 <timestamp> <unique_id>
ZREMRANGEBYSCORE rate:user:1000 0 <timestamp - window>
ZCARD rate:user:1000  # Check count
```

**Distributed Lock**:
```redis
# Acquire lock
SET lock:resource:123 "owner_id" NX EX 10

# Release lock (only if owner)
-- Lua script for atomic check and delete
EVAL "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end" 1 lock:resource:123 owner_id
```

**Pub/Sub**:
```redis
# Publisher
PUBLISH channel:notifications '{"message": "New order received"}'

# Subscriber
SUBSCRIBE channel:notifications

# Pattern subscription
PSUBSCRIBE channel:*
```

### Persistence

**RDB (Point-in-time snapshots)**:
```redis
# redis.conf
save 900 1      # Save if 1 key changed in 900 seconds
save 300 10     # Save if 10 keys changed in 300 seconds
save 60 10000   # Save if 10000 keys changed in 60 seconds

# Manual save
SAVE        # Blocking
BGSAVE      # Background
```

**AOF (Append-Only File)**:
```redis
# redis.conf
appendonly yes
appendfsync everysec    # everysec, always, or no

# Rewrite AOF
BGREWRITEAOF
```

**Hybrid Persistence** (RDB + AOF):
```redis
# Best of both worlds
# Fast restarts (RDB) + durability (AOF)
appendonly yes
aof-use-rdb-preamble yes
```

### Redis Best Practices

1. **Use connection pooling**: Don't create new connections per request
2. **Pipeline commands**: Reduce round trips
3. **Use appropriate data structures**: Hashes for objects, sorted sets for rankings
4. **Set TTLs**: Prevent memory bloat
5. **Monitor memory**: Set maxmemory and eviction policy
6. **Use Redis Cluster**: For horizontal scaling
7. **Avoid large keys**: Break into smaller keys or use hashes
8. **Use Lua scripts**: For atomic complex operations

```redis
# Pipelining example (Python)
pipe = redis.pipeline()
pipe.set('key1', 'value1')
pipe.set('key2', 'value2')
pipe.incr('counter')
pipe.execute()  # Single round trip

# Memory management
CONFIG SET maxmemory 2gb
CONFIG SET maxmemory-policy allkeys-lru
```

## Elasticsearch

### Document Indexing

**Create Index with Mapping**:
```json
PUT /products
{
  "mappings": {
    "properties": {
      "name": {
        "type": "text",
        "analyzer": "english",
        "fields": {
          "keyword": { "type": "keyword" }
        }
      },
      "description": {
        "type": "text",
        "analyzer": "english"
      },
      "price": { "type": "float" },
      "category": { "type": "keyword" },
      "tags": { "type": "keyword" },
      "created_at": { "type": "date" },
      "in_stock": { "type": "boolean" },
      "rating": { "type": "float" }
    }
  },
  "settings": {
    "number_of_shards": 3,
    "number_of_replicas": 1,
    "refresh_interval": "1s"
  }
}
```

**Index Document**:
```json
POST /products/_doc/1
{
  "name": "Wireless Mouse",
  "description": "Ergonomic wireless mouse with USB receiver",
  "price": 29.99,
  "category": "electronics",
  "tags": ["wireless", "mouse", "computer"],
  "created_at": "2024-01-15T10:00:00Z",
  "in_stock": true,
  "rating": 4.5
}

# Bulk indexing
POST /_bulk
{"index": {"_index": "products", "_id": "1"}}
{"name": "Product 1", "price": 19.99}
{"index": {"_index": "products", "_id": "2"}}
{"name": "Product 2", "price": 29.99}
```

### Search Queries

**Full-Text Search**:
```json
GET /products/_search
{
  "query": {
    "match": {
      "description": "wireless mouse"
    }
  }
}

# Multi-field search
GET /products/_search
{
  "query": {
    "multi_match": {
      "query": "wireless",
      "fields": ["name^2", "description"]  # Boost name field
    }
  }
}

# Phrase search
GET /products/_search
{
  "query": {
    "match_phrase": {
      "description": "ergonomic wireless mouse"
    }
  }
}
```

**Boolean Queries**:
```json
GET /products/_search
{
  "query": {
    "bool": {
      "must": [
        { "match": { "description": "wireless" } }
      ],
      "filter": [
        { "term": { "category": "electronics" } },
        { "range": { "price": { "gte": 10, "lte": 50 } } }
      ],
      "should": [
        { "term": { "tags": "bestseller" } }
      ],
      "must_not": [
        { "term": { "in_stock": false } }
      ]
    }
  }
}
```

**Aggregations**:
```json
GET /products/_search
{
  "size": 0,
  "aggs": {
    "categories": {
      "terms": { "field": "category" }
    },
    "price_ranges": {
      "range": {
        "field": "price",
        "ranges": [
          { "to": 20 },
          { "from": 20, "to": 50 },
          { "from": 50 }
        ]
      }
    },
    "avg_rating": {
      "avg": { "field": "rating" }
    },
    "price_stats": {
      "stats": { "field": "price" }
    }
  }
}
```

### Analyzers

**Custom Analyzer**:
```json
PUT /products
{
  "settings": {
    "analysis": {
      "analyzer": {
        "custom_english": {
          "type": "custom",
          "tokenizer": "standard",
          "filter": [
            "lowercase",
            "english_stop",
            "english_stemmer"
          ]
        }
      },
      "filter": {
        "english_stop": {
          "type": "stop",
          "stopwords": "_english_"
        },
        "english_stemmer": {
          "type": "stemmer",
          "language": "english"
        }
      }
    }
  },
  "mappings": {
    "properties": {
      "description": {
        "type": "text",
        "analyzer": "custom_english"
      }
    }
  }
}
```

### Performance Optimization

**Indexing Performance**:
```json
# Disable refresh during bulk indexing
PUT /products/_settings
{
  "refresh_interval": "-1",
  "number_of_replicas": 0
}

# After bulk indexing
PUT /products/_settings
{
  "refresh_interval": "1s",
  "number_of_replicas": 1
}

# Force merge (after bulk indexing)
POST /products/_forcemerge?max_num_segments=1
```

**Search Performance**:
```json
# Use filter context (cacheable)
GET /products/_search
{
  "query": {
    "bool": {
      "filter": [
        { "term": { "category": "electronics" } }
      ]
    }
  }
}

# Routing for targeted shards
POST /products/_doc/1?routing=user123

# Request cache
GET /products/_search?request_cache=true
{
  "size": 0,
  "aggs": {...}
}
```

### Best Practices

1. **Use appropriate field types**: text vs keyword, disable indexing for fields you don't search
2. **Shard sizing**: 20-40GB per shard, avoid over-sharding
3. **Replica strategy**: At least 1 replica for high availability
4. **Use filters**: Filters are cached, must queries are scored
5. **Bulk operations**: Batch indexing for performance
6. **Disable _source for large docs**: If you only need specific fields
7. **Monitor cluster health**: Green (all good), Yellow (no replicas), Red (missing primary)
8. **Index lifecycle management**: Rotate indices for time-series data

## Comparison Summary

| Feature | MongoDB | Redis | Elasticsearch |
|---------|---------|-------|---------------|
| Data Model | Document | Key-Value | Document |
| Primary Use | General Purpose | Caching, Session | Search, Analytics |
| Query Language | MQL | Commands | Query DSL |
| ACID | Document-level | Key-level | Document-level |
| Transactions | Multi-document | Single-key | No |
| Joins | $lookup | Application-level | Nested objects |
| Full-Text Search | Limited | No | Excellent |
| Horizontal Scaling | Sharding | Cluster | Sharding |
| Persistence | Yes | Optional | Yes |
| Performance | Fast | Fastest | Fast (search) |

**When to use each**:
- **PostgreSQL/SQL Server**: Default choice, relational data, complex transactions
- **MongoDB**: Flexible schemas, hierarchical data, rapid development
- **Redis**: Caching, sessions, real-time features, temporary data
- **Elasticsearch**: Full-text search, log analytics, complex aggregations

Remember: Use the right tool for the job. Often the best solution is a combination of databases.
