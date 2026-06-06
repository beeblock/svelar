# ORM Optimization Guide

## Common ORM Anti-Patterns

### 1. N+1 Query Problem

The most common and expensive ORM anti-pattern.

**Problem**:
```python
# SQLAlchemy / Django ORM
users = User.query.all()  # 1 query
for user in users:
    print(user.orders)     # N queries (one per user)

# Total: 1 + N queries
# For 100 users: 101 queries!
```

**Solution 1: Eager Loading (Join)**:
```python
# SQLAlchemy
users = User.query.options(joinedload(User.orders)).all()

# Django
users = User.objects.prefetch_related('orders')

# Entity Framework (C#)
users = context.Users.Include(u => u.Orders).ToList();

# TypeORM (TypeScript)
users = await userRepository.find({ relations: ['orders'] });

# Total: 1-2 queries (depending on ORM strategy)
```

**Solution 2: Subquery Loading**:
```python
# SQLAlchemy - separate query, better for large collections
users = User.query.options(subqueryload(User.orders)).all()

# Generates 2 queries:
# 1. SELECT * FROM users
# 2. SELECT * FROM orders WHERE user_id IN (...)
```

**Solution 3: Batch Loading**:
```python
# For scattered access patterns
users = User.query.all()

# Later, when accessing orders
user_ids = [u.id for u in users]
orders = Order.query.filter(Order.user_id.in_(user_ids)).all()

# Group orders by user_id manually
orders_by_user = {}
for order in orders:
    orders_by_user.setdefault(order.user_id, []).append(order)
```

### 2. SELECT * Abuse

**Problem**:
```csharp
// Entity Framework - fetches all columns
var users = context.Users.ToList();

// Even if you only need name and email
// Fetches: id, name, email, password_hash, created_at, updated_at, ...
```

**Solution: Projection**:
```csharp
// C# - Select specific columns
var users = context.Users
    .Select(u => new { u.Id, u.Name, u.Email })
    .ToList();

// Python SQLAlchemy
users = session.query(User.id, User.name, User.email).all()

// TypeORM
users = await userRepository.find({
    select: ['id', 'name', 'email']
});

// Prisma
users = await prisma.user.findMany({
    select: { id: true, name: true, email: true }
});
```

### 3. Lazy Loading Trap

**Problem**:
```java
// Hibernate - lazy loading by default
List<User> users = session.createQuery("from User", User.class).list();

for (User user : users) {
    System.out.println(user.getName());        // OK - already loaded
    System.out.println(user.getOrders().size()); // N+1! Lazy load per user
}
```

**Solution: Configure Eager Loading**:
```java
// Hibernate HQL with JOIN FETCH
List<User> users = session.createQuery(
    "SELECT DISTINCT u FROM User u LEFT JOIN FETCH u.orders",
    User.class
).list();

// Criteria API
CriteriaQuery<User> criteria = builder.createQuery(User.class);
Root<User> root = criteria.from(User.class);
root.fetch("orders", JoinType.LEFT);
List<User> users = session.createQuery(criteria).list();
```

### 4. No Batching for Bulk Operations

**Problem**:
```python
# Insert 1000 records one at a time
for i in range(1000):
    user = User(name=f"User {i}", email=f"user{i}@example.com")
    session.add(user)
    session.commit()  # 1000 transactions!
```

**Solution: Batch Insert**:
```python
# SQLAlchemy - bulk insert
users = [
    User(name=f"User {i}", email=f"user{i}@example.com")
    for i in range(1000)
]
session.bulk_save_objects(users)
session.commit()  # 1 transaction

# Or use bulk_insert_mappings for better performance
session.bulk_insert_mappings(User, [
    {'name': f"User {i}", 'email': f"user{i}@example.com"}
    for i in range(1000)
])
session.commit()

# Django
User.objects.bulk_create([
    User(name=f"User {i}", email=f"user{i}@example.com")
    for i in range(1000)
])

# Entity Framework
context.Users.AddRange(users);
context.SaveChanges();

# TypeORM
await userRepository.save(users);  // Batches automatically
```

**Bulk Update**:
```python
# SQLAlchemy
session.query(User).filter(User.status == 'pending').update(
    {'status': 'active'},
    synchronize_session=False
)

# Django
User.objects.filter(status='pending').update(status='active')

# Entity Framework (use raw SQL or BulkUpdate library)
context.Database.ExecuteSqlRaw(
    "UPDATE Users SET Status = 'active' WHERE Status = 'pending'"
);
```

### 5. Missing Database Constraints

**Problem**: Relying only on ORM validation
```python
# Only application-level validation
class User(Model):
    email = StringField(required=True, unique=True)

# What if another process inserts directly?
# What if concurrent requests?
# Race condition!
```

**Solution: Database Constraints**:
```python
# Migration - add database constraint
def upgrade():
    op.create_unique_constraint('uq_users_email', 'users', ['email'])
    op.alter_column('users', 'email', nullable=False)
    op.create_check_constraint('ck_users_age_positive', 'users', 'age > 0')

# Now you have:
# - Application validation (fast, user-friendly errors)
# - Database constraints (data integrity guarantee)
```

### 6. Over-fetching Relations

**Problem**:
```typescript
// TypeORM - loading unnecessary relations
const users = await userRepository.find({
    relations: ['orders', 'orders.items', 'orders.items.product', 'addresses']
});

// Massive JOIN query
// 90% of data not used
```

**Solution: Load Only What's Needed**:
```typescript
// Load users first
const users = await userRepository.find();

// Load relations selectively
const userId = users[0].id;
const orders = await orderRepository.find({
    where: { userId },
    relations: ['items']
});
```

### 7. Not Using Transactions

**Problem**:
```python
# Create order and update inventory separately
order = Order(user_id=user_id, total=100)
session.add(order)
session.commit()

product = session.query(Product).get(product_id)
product.stock -= 1
session.commit()

# If second commit fails, order exists but stock unchanged!
```

**Solution: Use Transactions**:
```python
# SQLAlchemy
from sqlalchemy import exc

try:
    with session.begin():  # Transaction
        order = Order(user_id=user_id, total=100)
        session.add(order)

        product = session.query(Product).get(product_id)
        product.stock -= 1

        # Both committed together or both rolled back
except exc.IntegrityError:
    session.rollback()
    raise

# Django
from django.db import transaction

with transaction.atomic():
    order = Order.objects.create(user_id=user_id, total=100)
    product = Product.objects.get(id=product_id)
    product.stock -= 1
    product.save()
```

### 8. Inefficient Pagination

**Problem**:
```python
# Offset pagination - slow for large offsets
page = 1000
per_page = 10

users = session.query(User).offset(page * per_page).limit(per_page).all()

# Database still scans first 10,000 rows to skip them!
```

**Solution: Cursor-Based Pagination**:
```python
# Keyset pagination
last_id = 9999  # From previous page

users = session.query(User).filter(User.id > last_id).limit(per_page).all()

# Or use created_at for time-based pagination
last_created = datetime(2024, 1, 15, 10, 0, 0)

users = session.query(User).filter(
    User.created_at > last_created
).order_by(User.created_at).limit(per_page).all()

# Much faster for large datasets
```

## ORM-Specific Best Practices

### SQLAlchemy (Python)

```python
# 1. Use relationship loading strategies
from sqlalchemy.orm import joinedload, subqueryload, selectinload

# joinedload - LEFT OUTER JOIN (one query)
users = session.query(User).options(joinedload(User.orders)).all()

# subqueryload - separate SELECT with IN (two queries)
users = session.query(User).options(subqueryload(User.orders)).all()

# selectinload - SELECT with IN, better than subquery (two queries)
users = session.query(User).options(selectinload(User.orders)).all()

# 2. Defer loading large columns
users = session.query(User).options(defer(User.large_blob)).all()

# 3. Use Core for complex queries
from sqlalchemy import select, func

stmt = select(
    User.id,
    func.count(Order.id).label('order_count')
).select_from(User).join(Order).group_by(User.id)

results = session.execute(stmt).all()

# 4. Bulk operations
session.bulk_insert_mappings(User, user_dicts)
session.bulk_update_mappings(User, updated_user_dicts)

# 5. Disable autoflush for read-heavy operations
with session.no_autoflush:
    users = session.query(User).all()
    # Process users without triggering flushes
```

### Django ORM (Python)

```python
# 1. select_related for ForeignKey (JOIN)
users = User.objects.select_related('profile').all()

# 2. prefetch_related for reverse ForeignKey and ManyToMany (separate query)
users = User.objects.prefetch_related('orders').all()

# 3. only() and defer()
users = User.objects.only('id', 'name', 'email').all()
users = User.objects.defer('large_blob').all()

# 4. values() and values_list() for dictionaries/tuples
users = User.objects.values('id', 'name')  # List of dicts
user_ids = User.objects.values_list('id', flat=True)  # List of IDs

# 5. Aggregation
from django.db.models import Count, Sum, Avg

user_stats = User.objects.annotate(
    order_count=Count('orders'),
    total_spent=Sum('orders__total')
).filter(order_count__gt=10)

# 6. Bulk operations
User.objects.bulk_create(users)
User.objects.bulk_update(users, ['status'])

# 7. Use iterator() for large querysets
for user in User.objects.iterator(chunk_size=1000):
    process_user(user)

# 8. Raw SQL when needed
users = User.objects.raw('SELECT * FROM users WHERE status = %s', ['active'])
```

### Entity Framework (C#)

```csharp
// 1. Include for eager loading
var users = context.Users
    .Include(u => u.Orders)
    .ThenInclude(o => o.Items)
    .ToList();

// 2. AsNoTracking for read-only queries (faster)
var users = context.Users
    .AsNoTracking()
    .Where(u => u.Status == "active")
    .ToList();

// 3. Projection with Select
var userSummaries = context.Users
    .Select(u => new {
        u.Id,
        u.Name,
        OrderCount = u.Orders.Count()
    })
    .ToList();

// 4. Split queries for large includes (EF Core 5+)
var users = context.Users
    .Include(u => u.Orders)
    .AsSplitQuery()  // Separate queries instead of JOIN
    .ToList();

// 5. Bulk operations (use EFCore.BulkExtensions)
context.BulkInsert(users);
context.BulkUpdate(users);
context.BulkDelete(users);

// 6. Compiled queries for repeated queries
private static readonly Func<MyDbContext, int, User> GetUserById =
    EF.CompileQuery((MyDbContext context, int id) =>
        context.Users.FirstOrDefault(u => u.Id == id));

var user = GetUserById(context, 123);

// 7. Use FromSqlRaw for complex queries
var users = context.Users
    .FromSqlRaw(@"
        SELECT u.*
        FROM users u
        INNER JOIN orders o ON u.id = o.user_id
        WHERE o.total > {0}
        GROUP BY u.id
        HAVING COUNT(o.id) > {1}
    ", 100, 5)
    .ToList();
```

### TypeORM (TypeScript)

```typescript
// 1. Eager loading with relations
const users = await userRepository.find({
    relations: ['orders', 'profile']
});

// 2. Query builder for complex queries
const users = await userRepository
    .createQueryBuilder('user')
    .leftJoinAndSelect('user.orders', 'order')
    .where('user.status = :status', { status: 'active' })
    .andWhere('order.total > :total', { total: 100 })
    .getMany();

// 3. Select specific columns
const users = await userRepository.find({
    select: ['id', 'name', 'email']
});

// 4. Streaming for large results
const stream = await userRepository
    .createQueryBuilder('user')
    .where('user.status = :status', { status: 'active' })
    .stream();

stream.on('data', (user) => {
    console.log(user);
});

// 5. Batch operations
await userRepository.save(users);  // Batches automatically
await userRepository.insert(users);  // Direct INSERT (faster)

// 6. Raw queries
const users = await userRepository.query(
    'SELECT * FROM users WHERE status = $1',
    ['active']
);

// 7. Transaction
await connection.transaction(async (manager) => {
    const user = await manager.save(User, userData);
    await manager.save(Order, { userId: user.id, total: 100 });
});
```

### Prisma (TypeScript)

```typescript
// 1. Include relations
const users = await prisma.user.findMany({
    include: {
        orders: true,
        profile: true
    }
});

// 2. Select specific fields
const users = await prisma.user.findMany({
    select: {
        id: true,
        name: true,
        email: true,
        orders: {
            select: {
                id: true,
                total: true
            }
        }
    }
});

// 3. Batch operations
await prisma.user.createMany({
    data: users,
    skipDuplicates: true
});

await prisma.user.updateMany({
    where: { status: 'pending' },
    data: { status: 'active' }
});

// 4. Transactions
await prisma.$transaction([
    prisma.user.create({ data: userData }),
    prisma.order.create({ data: orderData })
]);

// 5. Raw queries
const users = await prisma.$queryRaw`
    SELECT * FROM users WHERE status = ${status}
`;

// 6. Aggregation
const result = await prisma.order.aggregate({
    where: { status: 'completed' },
    _sum: { total: true },
    _avg: { total: true },
    _count: true
});
```

## When to Bypass the ORM

Use raw SQL for:

1. **Complex Analytics Queries**:
```python
# ORM would be extremely complex
query = """
WITH monthly_sales AS (
    SELECT
        DATE_TRUNC('month', created_at) as month,
        SUM(total) as total_sales,
        COUNT(*) as order_count
    FROM orders
    WHERE created_at >= NOW() - INTERVAL '12 months'
    GROUP BY DATE_TRUNC('month', created_at)
)
SELECT
    month,
    total_sales,
    order_count,
    total_sales / order_count as avg_order_value,
    LAG(total_sales) OVER (ORDER BY month) as prev_month_sales
FROM monthly_sales
ORDER BY month DESC
"""

results = session.execute(query).fetchall()
```

2. **Bulk Operations**:
```python
# Direct SQL is faster
session.execute("""
    UPDATE users
    SET status = 'active'
    WHERE last_login > NOW() - INTERVAL '30 days'
      AND status = 'pending'
""")
```

3. **Database-Specific Features**:
```python
# PostgreSQL full-text search
results = session.execute("""
    SELECT *
    FROM articles
    WHERE search_vector @@ to_tsquery('english', :query)
    ORDER BY ts_rank(search_vector, to_tsquery('english', :query)) DESC
    LIMIT 10
""", {'query': search_term})
```

4. **Performance-Critical Queries**:
```python
# Hand-optimized query
query = """
    SELECT DISTINCT ON (customer_id)
        customer_id,
        total,
        created_at
    FROM orders
    WHERE status = 'completed'
    ORDER BY customer_id, created_at DESC
"""
```

## ORM Performance Checklist

- [ ] No N+1 queries (use eager loading)
- [ ] Select only needed columns (projection)
- [ ] Batch bulk operations (no loops with individual saves)
- [ ] Use transactions for related operations
- [ ] Database constraints for data integrity
- [ ] Cursor-based pagination for large datasets
- [ ] Raw SQL for complex or performance-critical queries
- [ ] Monitor generated SQL (enable query logging)
- [ ] Use indexes on foreign keys and queried columns
- [ ] Disable change tracking for read-only queries
- [ ] Connection pooling configured
- [ ] Test with realistic data volumes

## Monitoring ORM Performance

**Enable Query Logging**:

```python
# SQLAlchemy
import logging
logging.basicConfig()
logging.getLogger('sqlalchemy.engine').setLevel(logging.INFO)

# Django
LOGGING = {
    'version': 1,
    'handlers': {
        'console': {'class': 'logging.StreamHandler'},
    },
    'loggers': {
        'django.db.backends': {
            'handlers': ['console'],
            'level': 'DEBUG',
        },
    },
}

# Entity Framework
protected override void OnConfiguring(DbContextOptionsBuilder optionsBuilder)
{
    optionsBuilder.LogTo(Console.WriteLine, LogLevel.Information);
}
```

**Use Debug Toolbar**:
- Django Debug Toolbar
- Flask-DebugToolbar
- MiniProfiler (ASP.NET)

**Monitor in Production**:
- Application Performance Monitoring (APM)
- Database query logs
- Slow query alerts

## Summary

Common ORM pitfalls:
1. **N+1 queries** → Eager loading
2. **SELECT *** → Projection/Select specific columns
3. **Lazy loading** → Configure eager loading
4. **Individual saves** → Batch operations
5. **No constraints** → Add database constraints
6. **Over-fetching** → Load only needed relations
7. **No transactions** → Wrap related operations
8. **Offset pagination** → Cursor-based pagination

Best practices:
- Understand what SQL your ORM generates
- Profile and optimize based on actual queries
- Use raw SQL when ORM is limiting
- Monitor query performance continuously
- Test with realistic data volumes
