# ORM, QueryBuilder & Database Schema

Full docs: https://svelar.dev/docs/models-orm, https://svelar.dev/docs/database

## Table of Contents
- [Model API](#model-api)
- [QueryBuilder API](#querybuilder-api)
- [Schema & Migrations](#schema--migrations)
- [Relationships](#relationships)

## Model API

Import: `import { Model } from '@beeblock/svelar/orm';`

### Static Configuration
```typescript
class Post extends Model {
  static table = 'posts';                    // table name
  static primaryKey = 'id';                  // default: 'id'
  static incrementing = true;                // auto-increment
  static timestamps = true;                  // manage created_at/updated_at
  static fillable = ['title', 'content'];    // mass-assignable columns
  static hidden = ['password'];              // hidden from serialization
  static casts = {                           // type casting
    published: 'boolean' as const,
    metadata: 'json' as const,
    count: 'number' as const,
    birthday: 'date' as const,
  };
}
```

### Static Query Methods
```typescript
await Post.find(1)                          // find by primary key
await Post.findOrFail(1)                    // find or throw
await Post.all()                            // get all records
await Post.first()                          // get first record
await Post.firstOrFail()                    // first or throw
await Post.count()                          // count records
await Post.create({ title: 'Hello' })       // create & save
Post.where('status', 'published')           // returns QueryBuilder
Post.whereIn('id', [1, 2, 3])
Post.whereNull('deleted_at')
Post.whereNotNull('email')
Post.orderBy('created_at', 'desc')
Post.latest()                               // orderBy created_at desc
Post.oldest()                               // orderBy created_at asc
Post.with('author', 'comments')             // eager load
Post.query()                                // model-aware QueryBuilder
```

### Instance Methods
```typescript
const post = new Post({ title: 'Hello' });
await post.save();                          // insert or update
await post.update({ title: 'Updated' });    // update & save
await post.delete();                        // delete record
await post.refresh();                       // reload from DB

post.fill({ title: 'New' });               // fill (respects fillable)
post.getAttribute('title');
post.setAttribute('title', 'New');
post.getOriginal('title');                  // before changes
post.getDirty();                            // changed attributes
post.isDirty('title');                      // check if changed
post.isClean('title');

post.toJSON();                              // serialize (excludes hidden)
```

### Model Hooks & Observers
```typescript
Post.boot({
  creating: async (model) => { /* before insert */ },
  created: async (model) => { /* after insert */ },
  updating: async (model) => { /* before update */ },
  updated: async (model) => { /* after update */ },
  deleting: async (model) => { /* before delete */ },
  deleted: async (model) => { /* after delete */ },
  saving: async (model) => { /* before save (insert or update) */ },
  saved: async (model) => { /* after save */ },
});

// Observer class
class PostObserver {
  creating(post) { post.slug = slugify(post.title); }
  created(post) { console.log('Post created:', post.id); }
}
Post.observe(new PostObserver());
```

## QueryBuilder API

All Model static query methods return a QueryBuilder. Chain methods:

### WHERE
```typescript
Post.where('status', 'published')
Post.where('views', '>', 100)
Post.where('title', 'LIKE', '%hello%')
  .orWhere('content', 'LIKE', '%hello%')
  .whereIn('category_id', [1, 2])
  .whereNotIn('status', ['draft', 'archived'])
  .whereNull('deleted_at')
  .whereNotNull('published_at')
  .whereBetween('created_at', [startDate, endDate])
  .whereRaw('LOWER(title) = ?', ['hello'])
  .whereNested((q) => {
    q.where('role', 'admin').orWhere('role', 'editor');
  })
  .whereColumn('updated_at', '>', 'created_at')
  .whereExists((q) => {
    q.from('comments').whereColumn('comments.post_id', '=', 'posts.id');
  })
```

### JOIN / ORDER / GROUP
```typescript
  .join('users', 'posts.user_id', '=', 'users.id')
  .leftJoin('comments', 'posts.id', '=', 'comments.post_id')
  .orderBy('created_at', 'desc')
  .orderByRaw('FIELD(status, "active", "pending", "closed")')
  .groupBy('category_id')
  .having('count', '>', '5')
  .limit(10).offset(20)
  .latest()                              // orderBy created_at desc
  .oldest()                              // orderBy created_at asc
```

### SELECT
```typescript
  .select('id', 'title', 'content')
  .addSelect('user_id')
  .selectRaw('COUNT(*) as total')
  .distinct()
```

### EXECUTION
```typescript
await query.get()                        // all results
await query.first()                      // first result
await query.firstOrFail()                // first or throw
await query.find(1)                      // by ID
await query.findOrFail(1)                // by ID or throw
await query.exists()                     // boolean
await query.doesntExist()                // boolean
await query.count()                      // COUNT
await query.sum('amount')                // SUM
await query.avg('rating')                // AVG
await query.max('price')                 // MAX
await query.min('price')                 // MIN
await query.pluck('email')               // single column array
await query.value('name')                // single value
```

### PAGINATION
```typescript
const result = await Post.query().paginate(1, 20);
// { data: Post[], total, page, perPage, lastPage, hasMore }

await Post.query().chunk(100, async (posts, page) => {
  // process in batches
  return true; // return false to stop
});
```

### INSERT / UPSERT / UPDATE / DELETE
```typescript
await Post.query().insert({ title: 'New' })
await Post.query().insertGetId({ title: 'New' })
await Post.query().insertMany([{ title: 'A' }, { title: 'B' }])
await Post.query().upsert({ email: 'x@y.com', name: 'X' }, ['email'], ['name'])
await Post.query().firstOrCreate({ email: 'x@y.com' }, { name: 'New User' })
await Post.query().updateOrCreate({ email: 'x@y.com' }, { name: 'Updated' })
await Post.query().where('status', 'draft').update({ status: 'published' })
await Post.query().where('id', 1).delete()
await Post.query().increment('views', 1)
await Post.query().decrement('stock', 5)
```

### Find-Or-Create Contracts

- Model-aware `firstOrCreate` and `updateOrCreate` return full Model instances, even after `select(...)`. Clone builders to preserve caller filters, connection, tenant scope, and soft-delete scope; do not append lookup criteria to the caller.
- Keep automatic tenant and soft-delete guards outside grouped user predicates, including OR/raw OR. Helpers also group caller predicates before adding search criteria and the row primary key, so OR cannot widen a lookup or single-record update beyond those guards.
- Delegate model writes to the full `Model.create` / `fill` / `save` lifecycle: respect `fillable`, generated IDs, timestamps, JSON casts, observers, audit, and configured Searchable synchronization. An existing `firstOrCreate` match is read-only.
- Seed new records only from the passed search plus create/update attributes, not inferred `where` defaults. Use SQL `IS NULL` for null search attributes and reject undefined search attributes.
- `Model.forTenant(teamId)` and a plain builder's `.forTenant(teamId)` establish real explicit tenant scopes, preserved by clone. They guard reads/writes, auto-assign the selected tenant during helper creation, and guard upsert without ambient context; conflicting tenant values are rejected. Arbitrary `where('team_id', teamId)` is not a creation default. Authorize `withoutTenantScope()` as an administrative bypass; unscoped tenant-model creation still requires an explicit tenant attribute.
- Require matching database unique constraints in migrations. Recover only a recognized unique violation from the INSERT, then re-read the winner using the same visible, filtered, scoped search. In an active PostgreSQL transaction, isolate the INSERT with a savepoint before recovery.
- Propagate unrelated storage and observer errors; do not treat lifecycle failures as duplicate-insert success or retry the whole lifecycle. If a scoped update target is missing, throw before updated/saved post-hooks, including no-dirty updates.
- These helpers are not atomic; concurrent updates to an existing record are last-writer-wins. Use database `upsert` or transaction/locking when atomicity is needed; `upsert` is eventless and does not run the full Model lifecycle.
- Tenant-scoped `upsert` requires the tenant column in `conflictColumns` and a matching composite unique constraint; ambient or explicit `forTenant()` scope assigns tenant values and rejects conflicts. Upsert rejects all row predicates and soft-delete scopes: consciously use `withTrashed().upsert(...)` for table identity, or eventful helpers for scoped row writes. PostgreSQL/SQLite guard target/excluded tenant equality; MySQL guards each assignment against any unique/PK collision. A foreign collision can throw on PostgreSQL/SQLite or no-op on MySQL; metadata is not Model success. Upsert stays eventless: supply IDs/timestamps and authorize the tenant-only `withoutTenantScope()` admin bypass. MySQL's empty-update self-assignment is not `INSERT IGNORE`; unrelated validation/storage errors propagate.
- A raw `QueryBuilder` without a model class is eventless and returns plain rows. Its helpers require stable unique row identity through an `id` column, not a custom model primary key. Both model and raw helpers require a single-table write target and reject joined, grouped/HAVING, CTE, and union queries.

### CONDITIONAL & UTILITY
```typescript
Post.query()
  .when(hasSearch, (q) => q.where('title', 'LIKE', `%${search}%`))
  .when(categoryId, (q) => q.where('category_id', categoryId))
  .get();

const { sql, bindings } = Post.query().where('id', 1).toSQL();
const cloned = query.clone();
```

### CTE / UNION
```typescript
Post.query()
  .withCTE('recent', (q) => q.from('posts').where('created_at', '>', date))
  .from('recent')
  .get();

Post.query().where('type', 'a')
  .union((q) => q.from('posts').where('type', 'b'))
  .get();
```

## Schema & Migrations

Import: `import { Migration } from '@beeblock/svelar/database';`

### Migration Class
```typescript
export default class CreatePostsTable extends Migration {
  async up() {
    await this.schema.createTable('posts', (table) => {
      table.increments();              // auto-increment id
      table.string('title', 200);      // VARCHAR(200)
      table.text('content');           // TEXT
      table.integer('user_id').unsigned().references('id', 'users').onDelete('CASCADE');
      table.boolean('published').default(false);
      table.json('metadata').nullable();
      table.timestamps();              // created_at + updated_at
    });
  }
  async down() {
    await this.schema.dropTableIfExists('posts');
  }
}
```

### Schema Methods
```typescript
this.schema.createTable(name, callback)     // create table
this.schema.dropTable(name)                 // drop table
this.schema.dropTableIfExists(name)         // drop if exists
this.schema.renameTable(from, to)           // rename
this.schema.hasTable(name)                  // check existence
this.schema.addColumn(table, callback)      // add columns (NOT alterTable!)
this.schema.dropColumn(table, columnName)   // drop column
```

**CRITICAL: There is NO `alterTable` method. Use `addColumn` and `dropColumn` instead.**

### Column Types
```typescript
table.increments(name?)          // AUTO INCREMENT INTEGER PRIMARY KEY
table.bigIncrements(name?)       // AUTO INCREMENT BIGINT PRIMARY KEY
table.string(name, length?)      // VARCHAR (default 255)
table.text(name)                 // TEXT
table.integer(name)              // INTEGER
table.bigInteger(name)           // BIGINT
table.float(name)                // FLOAT
table.decimal(name, precision?, scale?)  // DECIMAL (default 8,2)
table.boolean(name)              // BOOLEAN
table.date(name)                 // DATE
table.datetime(name)             // DATETIME
table.timestamp(name)            // TIMESTAMP
table.timestamps()               // created_at + updated_at
table.json(name)                 // JSON
table.jsonb(name)                // JSONB (PostgreSQL)
table.blob(name)                 // BLOB
table.enum(name, values)         // ENUM
table.uuid(name?)                // UUID
table.ulid(name?)                // ULID
```

### Column Modifiers
```typescript
.nullable()                      // allow NULL
.notNullable()                   // disallow NULL
.default(value)                  // set default (NOT .defaultTo()!)
.primary()                       // PRIMARY KEY
.unique()                        // UNIQUE constraint
.unsigned()                      // UNSIGNED integer
.references(column, table)       // foreign key -> returns ForeignKeyBuilder
  .onDelete('CASCADE' | 'SET NULL' | 'RESTRICT' | 'NO ACTION')
  .onUpdate('CASCADE' | 'SET NULL' | 'RESTRICT' | 'NO ACTION')
```

### Table Constraints
```typescript
table.primary(['col1', 'col2'])           // composite PK
table.index('email')                       // index
table.index(['first', 'last'], 'name_idx') // named index
table.uniqueIndex('email')                 // unique index
```

### Adding Columns to Existing Table
```typescript
// CORRECT way to add columns:
async up() {
  await this.schema.addColumn('users', (table) => {
    table.string('stripe_customer_id').nullable();
    table.string('stripe_subscription_id').nullable();
  });
}
async down() {
  await this.schema.dropColumn('users', 'stripe_customer_id');
  await this.schema.dropColumn('users', 'stripe_subscription_id');
}
```

## Relationships

```typescript
class User extends Model {
  static table = 'users';

  // One-to-one
  profile() { return this.hasOne(Profile, 'user_id'); }

  // One-to-many
  posts() { return this.hasMany(Post, 'user_id'); }

  // Belongs-to (inverse)
  // In Post model:
  author() { return this.belongsTo(User, 'user_id'); }

  // Many-to-many
  roles() {
    return this.belongsToMany(
      Role,           // related model
      'user_roles',   // pivot table
      'user_id',      // foreign pivot key
      'role_id',      // related pivot key
    );
  }
}

// Eager loading
const users = await User.with('posts', 'profile').get();
const post = await Post.with('author').find(1);

// Check if relation loaded
post.relationLoaded('author'); // boolean
post.getRelation('author');    // get loaded relation
```
