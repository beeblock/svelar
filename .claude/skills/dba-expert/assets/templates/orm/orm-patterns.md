# ORM Patterns and Anti-Patterns

## Anti-Pattern 1: N+1 Query Problem

The most common and expensive ORM anti-pattern.

### Problem

```python
# Fetches 1 + N queries
users = User.query.all()  # 1 query
for user in users:
    print(user.orders)     # N queries (one per user)
```

### Solutions

**Eager Loading (JOIN)**:
```python
# SQLAlchemy
users = User.query.options(joinedload(User.orders)).all()

# Django
users = User.objects.select_related('profile').all()  # ForeignKey
users = User.objects.prefetch_related('orders').all()  # Reverse FK, M2M

# Entity Framework
users = context.Users.Include(u => u.Orders).ToList();

# TypeORM
users = await userRepository.find({ relations: ['orders'] });

# Prisma
users = await prisma.user.findMany({ include: { orders: true } });
```

**Batch Loading**:
```python
# Load users first
users = User.query.all()

# Batch load orders
user_ids = [u.id for u in users]
orders = Order.query.filter(Order.user_id.in_(user_ids)).all()

# Group by user_id
orders_by_user = {}
for order in orders:
    orders_by_user.setdefault(order.user_id, []).append(order)
```

## Anti-Pattern 2: SELECT * Abuse

### Problem

```csharp
// Fetches all columns
var users = context.Users.ToList();
```

### Solution: Projection

```csharp
// C# - Select specific columns
var users = context.Users
    .Select(u => new { u.Id, u.Name, u.Email })
    .ToList();

// Python SQLAlchemy
users = session.query(User.id, User.name, User.email).all()

// JavaScript TypeORM
users = await userRepository.find({
    select: ['id', 'name', 'email']
});
```

## Anti-Pattern 3: No Batching for Bulk Operations

### Problem

```python
# 1000 individual inserts
for i in range(1000):
    user = User(name=f"User {i}")
    session.add(user)
    session.commit()  # 1000 commits!
```

### Solution: Batch Operations

```python
# SQLAlchemy - bulk insert
users = [User(name=f"User {i}") for i in range(1000)]
session.bulk_save_objects(users)
session.commit()  # 1 commit

# Or use bulk_insert_mappings
session.bulk_insert_mappings(User, [
    {'name': f"User {i}"} for i in range(1000)
])

# Django
User.objects.bulk_create([
    User(name=f"User {i}") for i in range(1000)
])

# Entity Framework
context.Users.AddRange(users);
context.SaveChanges();
```

## Anti-Pattern 4: Lazy Loading Pitfall

### Problem

```java
// Hibernate - lazy loading by default
List<User> users = session.createQuery("from User", User.class).list();

for (User user : users) {
    user.getOrders().size();  // N+1! Lazy load per user
}
```

### Solution: Eager Loading

```java
// Hibernate HQL with JOIN FETCH
List<User> users = session.createQuery(
    "SELECT DISTINCT u FROM User u LEFT JOIN FETCH u.orders",
    User.class
).list();
```

## Anti-Pattern 5: Missing Database Constraints

### Problem

Relying only on ORM validation.

```python
# Only application-level validation
class User(Model):
    email = StringField(required=True, unique=True)
```

### Solution: Database Constraints

```python
# Migration - add database constraint
def upgrade():
    op.create_unique_constraint('uq_users_email', 'users', ['email'])
    op.alter_column('users', 'email', nullable=False)
    op.create_check_constraint('ck_users_age_positive', 'users', 'age > 0')
```

## Anti-Pattern 6: Inefficient Pagination

### Problem: Offset Pagination

```python
# Slow for large offsets
page = 1000
per_page = 10
users = session.query(User).offset(page * per_page).limit(per_page).all()
# Scans 10,000 rows to skip them!
```

### Solution: Cursor-Based Pagination

```python
# Keyset pagination
last_id = 9999  # From previous page
users = session.query(User).filter(User.id > last_id).limit(per_page).all()

# Time-based pagination
last_created = datetime(2024, 1, 15)
users = session.query(User).filter(
    User.created_at > last_created
).order_by(User.created_at).limit(per_page).all()
```

## Pattern 1: Repository Pattern

Encapsulate data access logic.

```python
class UserRepository:
    def __init__(self, session):
        self.session = session

    def find_by_id(self, user_id):
        return self.session.query(User).get(user_id)

    def find_active_users(self):
        return self.session.query(User).filter(
            User.status == 'active'
        ).all()

    def save(self, user):
        self.session.add(user)
        self.session.commit()
```

## Pattern 2: Query Object Pattern

Encapsulate complex queries.

```python
class ActiveUsersQuery:
    def __init__(self, session):
        self.session = session

    def execute(self):
        return self.session.query(User).filter(
            User.status == 'active',
            User.last_login > datetime.now() - timedelta(days=30)
        ).order_by(User.created_at.desc()).all()
```

## Pattern 3: Use Raw SQL for Complex Queries

When ORM becomes limiting, use raw SQL.

```python
# Complex analytics query
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
    total_sales / order_count as avg_order_value
FROM monthly_sales
ORDER BY month DESC
"""

results = session.execute(query).fetchall()
```

## Pattern 4: Read-Only Queries

Disable change tracking for read-only operations.

```csharp
// Entity Framework - AsNoTracking
var users = context.Users
    .AsNoTracking()
    .Where(u => u.Status == "active")
    .ToList();
```

## Pattern 5: Transactions

Wrap related operations in transactions.

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

## ORM Performance Checklist

- [ ] No N+1 queries (use eager loading)
- [ ] Select only needed columns (projection)
- [ ] Batch bulk operations
- [ ] Use database constraints
- [ ] Cursor-based pagination for large datasets
- [ ] Disable change tracking for read-only queries
- [ ] Use transactions for related operations
- [ ] Monitor generated SQL (enable query logging)
- [ ] Use raw SQL for complex queries
- [ ] Connection pooling configured
- [ ] Indexes on foreign keys and queried columns

## Monitoring ORM Performance

Enable query logging to see generated SQL:

```python
# SQLAlchemy
import logging
logging.basicConfig()
logging.getLogger('sqlalchemy.engine').setLevel(logging.INFO)

# Django
LOGGING = {
    'loggers': {
        'django.db.backends': {
            'level': 'DEBUG',
        },
    },
}
```

Use database query analysis tools:
- Django Debug Toolbar
- Flask-DebugToolbar
- MiniProfiler (ASP.NET)
- APM solutions (New Relic, Datadog)

## Summary

Common pitfalls:
1. **N+1 queries** → Eager loading
2. **SELECT *** → Projection
3. **Individual saves** → Batch operations
4. **Lazy loading** → Configure eager loading
5. **No constraints** → Add database constraints
6. **Offset pagination** → Cursor-based pagination

Best practices:
- Understand generated SQL
- Profile and optimize
- Use raw SQL when needed
- Monitor performance continuously
- Test with realistic data volumes
