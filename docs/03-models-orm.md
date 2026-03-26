# Models & ORM

Svelar's Eloquent-like ORM provides an expressive, fluent interface for working with your database. Each database table has a corresponding Model class used to query and manipulate data.

## Creating Models

```bash
npx svelar make:model Post
```

This generates `src/lib/models/Post.ts`:

```typescript
import { Model } from 'svelar/orm';

export class Post extends Model {
  static table = 'posts';
  static timestamps = true;
  static fillable = ['title', 'slug', 'body', 'published', 'user_id'];
  static hidden = [];

  declare id: number;
  declare title: string;
  declare slug: string;
  declare body: string;
  declare published: boolean;
  declare user_id: number;
  declare created_at: Date;
  declare updated_at: Date;
}
```

## Model Configuration

### Table Name

```typescript
export class User extends Model {
  static table = 'users';
}
```

### Primary Key

```typescript
export class User extends Model {
  static primaryKey = 'id';       // default
  static incrementing = true;      // auto-increment (default: true)
}

// UUID primary keys
export class Order extends Model {
  static primaryKey = 'uuid';
  static incrementing = false;     // disable auto-increment for UUIDs
}
```

### Timestamps

Svelar automatically manages `created_at` and `updated_at` when `timestamps` is enabled:

```typescript
export class Post extends Model {
  static timestamps = true;        // default

  // Custom column names
  static createdAt = 'created_at'; // default
  static updatedAt = 'updated_at'; // default
}

// Disable timestamps
export class Log extends Model {
  static timestamps = false;
}
```

### Fillable (Mass Assignment Protection)

Only columns listed in `fillable` can be set via `create()`, `update()`, or `fill()`:

```typescript
export class User extends Model {
  static fillable = ['name', 'email', 'password'];
}

// Only name, email, password are set — id is ignored
await User.create({ id: 999, name: 'John', email: 'john@example.com', password: 'secret' });
```

### Hidden (Serialization)

Columns in `hidden` are excluded from `toJSON()` and `toObject()`:

```typescript
export class User extends Model {
  static hidden = ['password', 'remember_token'];
}

const user = await User.find(1);
console.log(user.toJSON()); // { id: 1, name: 'John', email: '...' } — no password
```

### Attribute Casting

Cast raw database values to TypeScript types automatically:

```typescript
export class Post extends Model {
  static casts = {
    published: 'boolean' as const,   // 0/1 → true/false
    views: 'number' as const,        // string → number
    created_at: 'date' as const,     // string → Date object
    metadata: 'json' as const,       // JSON string → object
  };
}

const post = await Post.find(1);
typeof post.published; // boolean
typeof post.views;     // number
post.created_at;       // Date instance
post.metadata;         // parsed object
```

Supported cast types: `string`, `number`, `boolean`, `date`, `json`.

### Multiple Database Connections

```typescript
export class Analytics extends Model {
  static connection = 'analytics'; // use the 'analytics' connection
  static table = 'page_views';
}
```

## Retrieving Models

### Basic Retrieval

```typescript
// Get all users
const users = await User.all();

// Find by primary key
const user = await User.find(1);

// Find or throw an error
const user = await User.findOrFail(1); // throws if not found

// Get the first result
const user = await User.first();
const user = await User.firstOrFail(); // throws if no results

// Count records
const total = await User.count();
```

### Where Clauses

```typescript
// Simple equality
const admins = await User.where('role', 'admin').get();

// With operator
const adults = await User.where('age', '>=', 18).get();

// LIKE
const johns = await User.where('name', 'LIKE', '%John%').get();

// NOT LIKE
const noGmail = await User.where('email', 'NOT LIKE', '%@gmail.com').get();

// Chaining (AND)
const activeAdmins = await User
  .where('role', 'admin')
  .where('active', true)
  .get();

// OR
const moderators = await User
  .where('role', 'admin')
  .orWhere('role', 'moderator')
  .get();
```

Supported operators: `=`, `!=`, `<>`, `>`, `>=`, `<`, `<=`, `LIKE`, `NOT LIKE`, `IN`, `NOT IN`, `IS`, `IS NOT`, `BETWEEN`.

### WhereIn / WhereNotIn

```typescript
// Get users with specific IDs
const users = await User.whereIn('id', [1, 2, 3]).get();

// Exclude specific statuses
const active = await User.whereNotIn('status', ['banned', 'suspended']).get();
```

### WhereNull / WhereNotNull

```typescript
// Users who haven't verified their email
const unverified = await User.whereNull('email_verified_at').get();

// Users who have verified
const verified = await User.whereNotNull('email_verified_at').get();
```

### WhereBetween

```typescript
// Users created in the last 30 days
const recent = await User.whereBetween('created_at', ['2026-02-24', '2026-03-26']).get();

// Products in a price range
const mid = await Product.whereBetween('price', [10, 50]).get();
```

### WhereRaw

For complex conditions the builder doesn't cover directly:

```typescript
// Raw SQL condition with bindings
const users = await User.query()
  .whereRaw('LOWER(email) = ?', ['john@example.com'])
  .get();

// Date functions
const today = await Order.query()
  .whereRaw('DATE(created_at) = DATE(?)', [new Date().toISOString()])
  .get();
```

## Selecting Columns

```typescript
// Select specific columns
const users = await User.query().select('id', 'name', 'email').get();

// Add more columns to an existing select
const users = await User.query()
  .select('id', 'name')
  .addSelect('email')
  .get();

// Distinct values
const cities = await User.query().distinct().select('city').get();
```

## Ordering

```typescript
// Ascending (default)
const users = await User.orderBy('name').get();

// Descending
const users = await User.orderBy('created_at', 'desc').get();

// Multiple columns
const users = await User
  .orderBy('role')
  .orderBy('name', 'asc')
  .get();

// Shorthand: latest (ORDER BY column DESC)
const newest = await User.latest().get();               // by created_at
const newest = await User.latest('registered_at').get(); // by custom column

// Shorthand: oldest (ORDER BY column ASC)
const oldest = await User.oldest().get();
```

## Limiting & Offset

```typescript
// Get first 10
const users = await User.query().limit(10).get();

// Pagination style: skip 20, take 10
const page3 = await User.query().offset(20).limit(10).get();

// Aliases
const users = await User.query().take(10).get();   // same as limit(10)
const users = await User.query().skip(20).get();   // same as offset(20)
```

## Pagination

Built-in pagination with metadata:

```typescript
const result = await User.query().paginate(1, 15); // page 1, 15 per page

result.data;      // User[] — the records
result.total;     // number — total matching records
result.page;      // number — current page
result.perPage;   // number — items per page
result.lastPage;  // number — last page number
result.hasMore;   // boolean — whether more pages exist
```

With filters:

```typescript
const result = await Post
  .where('published', true)
  .orderBy('created_at', 'desc')
  .paginate(2, 10); // page 2, 10 per page
```

## Joins

### Inner Join

```typescript
// Posts with their author name
const posts = await Post.query()
  .select('posts.*', 'users.name as author_name')
  .join('users', 'posts.user_id', '=', 'users.id')
  .get();
```

### Left Join

```typescript
// All users, with their latest post (if any)
const users = await User.query()
  .select('users.*', 'posts.title as latest_post')
  .leftJoin('posts', 'users.id', '=', 'posts.user_id')
  .get();
```

### Right Join

```typescript
// All posts, including those by deleted users
const posts = await Post.query()
  .select('posts.*', 'users.name as author_name')
  .rightJoin('users', 'posts.user_id', '=', 'users.id')
  .get();
```

### Multiple Joins

```typescript
// Comments with post title and author name
const comments = await Comment.query()
  .select('comments.*', 'posts.title as post_title', 'users.name as author_name')
  .join('posts', 'comments.post_id', '=', 'posts.id')
  .join('users', 'comments.user_id', '=', 'users.id')
  .where('posts.published', true)
  .orderBy('comments.created_at', 'desc')
  .get();
```

## Group By & Having

```typescript
// Count posts per user
const stats = await Post.query()
  .select('user_id')
  .addSelect('COUNT(*) as post_count')
  .groupBy('user_id')
  .get();

// Only users with 5+ posts
const prolific = await Post.query()
  .select('user_id', 'COUNT(*) as post_count')
  .groupBy('user_id')
  .having('post_count', '>=', 5)
  .get();

// Revenue by category, only categories above $1000
const revenue = await Order.query()
  .select('category', 'SUM(total) as revenue')
  .groupBy('category')
  .having('revenue', '>', 1000)
  .orderBy('revenue', 'desc')
  .get();
```

## Aggregates

```typescript
// Count
const total = await User.count();
const activeCount = await User.where('active', true).query().count();

// Sum
const totalRevenue = await Order.query().sum('total');

// Average
const avgPrice = await Product.query().avg('price');

// Max / Min
const highest = await Product.query().max('price');
const lowest = await Product.query().min('price');

// With conditions
const avgAdminAge = await User.where('role', 'admin').query().avg('age');
```

## Existence Checks

```typescript
// Check if any matching records exist
const hasAdmin = await User.where('role', 'admin').exists();

// Inverse
const noAdmins = await User.where('role', 'admin').doesntExist();

// Common patterns
if (await User.where('email', email).exists()) {
  throw new Error('Email already taken');
}
```

## Pluck

Extract a single column as a flat array:

```typescript
// Get all user emails
const emails = await User.query().pluck('email');
// ['john@example.com', 'jane@example.com', ...]

// With conditions
const adminIds = await User.where('role', 'admin').query().pluck('id');
// [1, 5, 12]
```

## CRUD Operations

### Create

```typescript
// Create and save in one step
const user = await User.create({
  name: 'John Doe',
  email: 'john@example.com',
  password: await Hash.make('secret'),
});
console.log(user.id); // auto-assigned ID

// Create via instance
const post = new Post();
post.title = 'Hello World';
post.slug = 'hello-world';
post.body = 'My first post.';
post.user_id = user.id;
await post.save();
```

### Read

```typescript
const user = await User.find(1);
const user = await User.where('email', 'john@example.com').first();
const users = await User.where('active', true).orderBy('name').get();
```

### Update

```typescript
// Update a single model
const user = await User.findOrFail(1);
await user.update({ name: 'Jane Doe', email: 'jane@example.com' });

// Update via property assignment + save
user.name = 'Janet';
await user.save();

// Bulk update with query builder
await User.where('active', false).update({ active: true });

// Increment / Decrement
await Post.where('id', 1).increment('views');         // +1
await Post.where('id', 1).increment('views', 5);      // +5
await Product.where('id', 1).decrement('stock');       // -1
await Product.where('id', 1).decrement('stock', 3);   // -3
```

### Delete

```typescript
// Delete a single model
const user = await User.findOrFail(1);
await user.delete();

// Bulk delete
await User.where('active', false).delete();
```

### Refresh

Reload a model's attributes from the database:

```typescript
const user = await User.findOrFail(1);
user.name = 'temporary';

await user.refresh(); // re-reads from DB
console.log(user.name); // original name from database
```

## Dirty Checking

Track which attributes have changed since the model was loaded:

```typescript
const user = await User.findOrFail(1);

user.isDirty();         // false — nothing changed
user.isClean();         // true

user.name = 'New Name';

user.isDirty();         // true — something changed
user.isDirty('name');   // true — 'name' specifically changed
user.isDirty('email');  // false — email hasn't changed
user.isClean('email');  // true

// Get all changed attributes
const changes = user.getDirty();
// { name: 'New Name' }

// Get original value before changes
const original = user.getOriginal('name');
// 'Old Name'

// Save only writes dirty attributes to the database
await user.save();
```

## Debug: Inspect SQL

Use `toSQL()` to see what query the builder would generate without executing it:

```typescript
const { sql, bindings } = User.where('role', 'admin')
  .orderBy('name')
  .query()
  .toSQL();

console.log(sql);
// SELECT * FROM users WHERE role = ? ORDER BY name ASC
console.log(bindings);
// ['admin']
```

## Relationships

### Defining Relationships

Relationships are defined as methods on the model that return a relationship instance.

#### HasOne (One-to-One)

A user has one profile:

```typescript
import { Model } from 'svelar/orm';
import { Profile } from './Profile.js';

export class User extends Model {
  static table = 'users';

  profile() {
    return this.hasOne(Profile, 'user_id');
    // Profile.user_id → User.id
  }
}
```

Usage:

```typescript
const user = await User.findOrFail(1);
const profile = await user.profile().load(user);
console.log(profile.bio);
```

Create through the relationship (auto-sets foreign key):

```typescript
const profile = await user.profile().create({
  bio: 'Hello world',
  avatar_url: '/images/avatar.jpg',
});
// profile.user_id is automatically set to user.id
```

#### HasMany (One-to-Many)

A user has many posts:

```typescript
import { Model } from 'svelar/orm';
import { Post } from './Post.js';

export class User extends Model {
  static table = 'users';

  posts() {
    return this.hasMany(Post, 'user_id');
    // Post.user_id → User.id
  }
}
```

Usage:

```typescript
const user = await User.findOrFail(1);
const posts = await user.posts().load(user);

// Create a single post through the relationship
const post = await user.posts().create({
  title: 'New Post',
  body: 'Content here...',
});
// post.user_id is automatically set to user.id

// Create multiple posts at once
const posts = await user.posts().createMany([
  { title: 'Post 1', body: 'First post.' },
  { title: 'Post 2', body: 'Second post.' },
]);
```

#### BelongsTo (Inverse One-to-One / One-to-Many)

A post belongs to a user:

```typescript
import { Model } from 'svelar/orm';
import { User } from './User.js';

export class Post extends Model {
  static table = 'posts';

  author() {
    return this.belongsTo(User, 'user_id');
    // Post.user_id → User.id
  }
}
```

Usage:

```typescript
const post = await Post.findOrFail(1);
const author = await post.author().load(post);
console.log(author.name);
```

**Associate / Dissociate:**

```typescript
// Set the parent relationship
const user = await User.findOrFail(5);
post.author().associate(user);
await post.save();
// post.user_id is now 5

// Remove the parent relationship
post.author().dissociate();
await post.save();
// post.user_id is now null
```

#### BelongsToMany (Many-to-Many via Pivot Table)

A user has many roles, a role has many users — through a `user_roles` pivot table:

```typescript
// User.ts
export class User extends Model {
  static table = 'users';

  roles() {
    return this.belongsToMany(Role, 'user_roles', 'user_id', 'role_id');
    // pivot: user_roles.user_id → users.id
    // pivot: user_roles.role_id → roles.id
  }
}

// Role.ts
export class Role extends Model {
  static table = 'roles';

  users() {
    return this.belongsToMany(User, 'user_roles', 'role_id', 'user_id');
  }
}
```

**Loading:**

```typescript
const user = await User.findOrFail(1);
const roles = await user.roles().load(user);
console.log(roles.map(r => r.name)); // ['admin', 'editor']
```

**Attach** — add a record to the pivot table:

```typescript
// Assign role ID 3 to the user
await user.roles().attach(3);

// With extra pivot data
await user.roles().attach(3, { assigned_by: 'admin', assigned_at: new Date().toISOString() });
```

**Detach** — remove from the pivot table:

```typescript
// Remove a specific role
await user.roles().detach(3);

// Remove ALL roles from the user
await user.roles().detach();
```

**Sync** — replace all pivot records with the given IDs:

```typescript
// User will have exactly roles 1, 2, and 4 — all others are removed
await user.roles().sync([1, 2, 4]);
```

**Toggle** — attach if not attached, detach if already attached:

```typescript
// If user has role 2, remove it. If they don't have role 5, add it.
await user.roles().toggle([2, 5]);
```

### Eager Loading

Eager loading solves the N+1 query problem by loading relationships in bulk:

```typescript
// BAD: N+1 queries (1 query for users + N queries for posts)
const users = await User.all();
for (const user of users) {
  const posts = await user.posts().load(user); // query per user!
}

// GOOD: 2 queries total (1 for users + 1 for all posts)
const users = await User.with('posts').get();
for (const user of users) {
  console.log(user.getRelation('posts')); // already loaded, no extra query
}
```

**Multiple relationships:**

```typescript
const users = await User.with('posts', 'profile').get();
```

**Nested eager loading** — load relationships of relationships:

```typescript
// Load users → their posts → each post's comments
const users = await User.with('posts.comments').get();
```

**With query conditions:**

```typescript
const users = await User
  .where('active', true)
  .with('posts')
  .orderBy('name')
  .get();
```

## Model Hooks (Lifecycle Events)

Hooks let you run logic automatically before or after model operations:

```typescript
export class User extends Model {
  static table = 'users';

  // Runs before insert
  async creating() {
    this.setAttribute('email', this.getAttribute('email')?.toLowerCase());
  }

  // Runs after insert
  async created() {
    console.log('Welcome email for:', this.getAttribute('email'));
  }

  // Runs before update
  async updating() {
    console.log('User updating:', this.getAttribute('id'));
  }

  // Runs after update
  async updated() {
    console.log('User updated:', this.getAttribute('id'));
  }

  // Runs before any save (insert or update)
  async saving() {
    // validate, transform, etc.
  }

  // Runs after any save
  async saved() {
    // clear cache, etc.
  }

  // Runs before delete
  async deleting() {
    console.log('About to delete user:', this.getAttribute('id'));
  }

  // Runs after delete
  async deleted() {
    console.log('User deleted');
  }
}
```

You can also register hooks externally using `boot()`:

```typescript
User.boot({
  creating: (user) => {
    user.setAttribute('email', user.getAttribute('email')?.toLowerCase());
  },
  created: (user) => {
    console.log('User created:', user.getAttribute('id'));
  },
});
```

Available hooks: `creating`, `created`, `updating`, `updated`, `saving`, `saved`, `deleting`, `deleted`.

## Serialization

```typescript
const user = await User.with('posts').findOrFail(1);

// Convert to plain object (respects hidden, includes loaded relations)
const json = user.toJSON();
// { id: 1, name: 'John', email: '...', posts: [...] }
// password is excluded because it's in hidden

// toObject() is an alias for toJSON()
const obj = user.toObject();
```

## Relation Checks

```typescript
const user = await User.with('posts').findOrFail(1);

// Check if a relation has been loaded
user.relationLoaded('posts');   // true
user.relationLoaded('profile'); // false

// Get a loaded relation
const posts = user.getRelation('posts');

// Manually set a relation
user.setRelation('posts', []);
```

## Raw Queries

When the query builder isn't enough, use raw SQL directly:

```typescript
import { Connection } from 'svelar/database';

// Raw select
const rows = await Connection.raw(
  'SELECT users.*, COUNT(posts.id) as post_count FROM users LEFT JOIN posts ON posts.user_id = users.id GROUP BY users.id',
  []
);

// Raw with bindings (parameterized — safe from SQL injection)
const users = await Connection.raw(
  'SELECT * FROM users WHERE email = ? AND active = ?',
  ['john@example.com', true]
);
```

## Complete Example: Blog Application

### Models

```typescript
// src/lib/models/User.ts
import { Model } from 'svelar/orm';

export class User extends Model {
  static table = 'users';
  static timestamps = true;
  static fillable = ['name', 'email', 'password'];
  static hidden = ['password'];

  declare id: number;
  declare name: string;
  declare email: string;
  declare password: string;
  declare created_at: Date;
  declare updated_at: Date;

  posts() {
    return this.hasMany(Post, 'user_id');
  }

  comments() {
    return this.hasMany(Comment, 'user_id');
  }

  roles() {
    return this.belongsToMany(Role, 'user_roles', 'user_id', 'role_id');
  }

  profile() {
    return this.hasOne(Profile, 'user_id');
  }
}

import { Post } from './Post.js';
import { Comment } from './Comment.js';
import { Role } from './Role.js';
import { Profile } from './Profile.js';
```

```typescript
// src/lib/models/Post.ts
import { Model } from 'svelar/orm';

export class Post extends Model {
  static table = 'posts';
  static timestamps = true;
  static fillable = ['title', 'slug', 'body', 'published', 'user_id'];
  static casts = {
    published: 'boolean' as const,
    created_at: 'date' as const,
    updated_at: 'date' as const,
  };

  declare id: number;
  declare title: string;
  declare slug: string;
  declare body: string;
  declare published: boolean;
  declare user_id: number;
  declare created_at: Date;
  declare updated_at: Date;

  author() {
    return this.belongsTo(User, 'user_id');
  }

  comments() {
    return this.hasMany(Comment, 'post_id');
  }

  tags() {
    return this.belongsToMany(Tag, 'post_tags', 'post_id', 'tag_id');
  }
}

import { User } from './User.js';
import { Comment } from './Comment.js';
import { Tag } from './Tag.js';
```

```typescript
// src/lib/models/Comment.ts
import { Model } from 'svelar/orm';

export class Comment extends Model {
  static table = 'comments';
  static timestamps = true;
  static fillable = ['body', 'user_id', 'post_id'];

  declare id: number;
  declare body: string;
  declare user_id: number;
  declare post_id: number;
  declare created_at: Date;
  declare updated_at: Date;

  author() {
    return this.belongsTo(User, 'user_id');
  }

  post() {
    return this.belongsTo(Post, 'post_id');
  }
}

import { User } from './User.js';
import { Post } from './Post.js';
```

### Common Query Patterns

```typescript
// ── Dashboard Stats ──
const totalUsers = await User.count();
const totalPosts = await Post.where('published', true).count();
const avgPostsPerUser = await Post.query().avg('user_id'); // rough average

// ── Feed: recent published posts with author ──
const feed = await Post
  .where('published', true)
  .with('author')
  .orderBy('created_at', 'desc')
  .paginate(1, 20);

// ── User profile page ──
const user = await User.with('posts', 'profile').findOrFail(userId);
const postCount = await user.posts().query().where('user_id', user.id).count();

// ── Search ──
const results = await Post
  .where('published', true)
  .where('title', 'LIKE', `%${query}%`)
  .orWhere('body', 'LIKE', `%${query}%`)
  .orderBy('created_at', 'desc')
  .limit(50)
  .get();

// ── Posts by multiple authors ──
const teamPosts = await Post
  .whereIn('user_id', [1, 2, 3])
  .where('published', true)
  .latest()
  .get();

// ── Posts with comment count (using join) ──
const postsWithCounts = await Post.query()
  .select('posts.*', 'COUNT(comments.id) as comment_count')
  .leftJoin('comments', 'posts.id', '=', 'comments.post_id')
  .where('posts.published', true)
  .groupBy('posts.id')
  .having('comment_count', '>', 0)
  .orderBy('comment_count', 'desc')
  .get();

// ── Manage tags on a post (many-to-many) ──
const post = await Post.findOrFail(1);
await post.tags().sync([1, 3, 5]);        // replace all tags
await post.tags().attach(7);               // add one more
await post.tags().detach(3);               // remove one
await post.tags().toggle([1, 8]);          // flip: remove 1, add 8

// ── Assign a post to a different author ──
const newAuthor = await User.findOrFail(5);
const post = await Post.findOrFail(1);
post.author().associate(newAuthor);
await post.save();

// ── Create a comment through a relationship ──
const post = await Post.findOrFail(1);
const comment = await post.comments().create({
  body: 'Great article!',
  user_id: currentUser.id,
});

// ── Bulk check ──
const emailExists = await User.where('email', 'john@example.com').exists();
const noSpam = await Comment.where('flagged', true).doesntExist();

// ── Get just emails ──
const emails = await User.where('active', true).query().pluck('email');
```

## Best Practices

1. **Always define relationships in both directions** — if User `hasMany` Posts, Post should `belongsTo` User.
2. **Use eager loading** with `.with()` to prevent N+1 queries whenever you access relations in a loop.
3. **Use `fillable`** to protect against mass assignment of sensitive fields like `role` or `is_admin`.
4. **Use `hidden`** to keep passwords, tokens, and secrets out of API responses.
5. **Use attribute casting** so you work with proper TypeScript types instead of raw database strings.
6. **Use model hooks** for side effects like sending emails, clearing caches, or dispatching events.
7. **Use `toSQL()`** to debug complex queries — it shows the generated SQL without executing it.
8. **Keep models thin** — move business logic to services, actions, or repositories.

## Next Steps

- [Validation & DTOs](./05-validation-dtos.md) — validate data before saving
- [Controllers & Routing](./04-controllers-routing.md) — use models in request handlers
- [Services & Repositories](./08-services-actions-repositories.md) — data access patterns
- [Database & Migrations](./02-database.md) — schema management

---

**Svelar Models & ORM Guide** © 2026
