# Models & ORM

Learn how to use Svelar's Eloquent-like ORM to model your data and interact with your database.

## Creating Models

Models represent database tables and provide an object-oriented interface to query and manipulate data.

```bash
npx svelar make:model User
```

This creates `src/lib/models/User.ts`:

```typescript
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
}
```

## Model Properties

### Table

The table name that the model maps to. Defaults to the lowercase plural of the class name:

```typescript
export class User extends Model {
  static table = 'users'; // Explicit table name
}
```

### Fillable

Properties that can be mass-assigned with `create()` or `update()`:

```typescript
static fillable = ['name', 'email', 'password'];

// This works
await User.create({ name: 'John', email: 'john@example.com', password: 'secret' });

// This is safe - id is not in fillable, so it's ignored
await User.create({ id: 999, name: 'John', email: 'john@example.com' });
```

### Hidden

Properties that are excluded from serialization (when converting to JSON):

```typescript
static hidden = ['password'];

const user = await User.find(1);
console.log(user); // { id: 1, name: 'John', email: 'john@example.com' }
// password is not included
```

### Timestamps

Automatically manage `created_at` and `updated_at` columns:

```typescript
static timestamps = true;

const user = await User.create({ name: 'John' });
console.log(user.created_at); // Current date/time
console.log(user.updated_at); // Current date/time

await user.update({ name: 'Jane' });
console.log(user.updated_at); // Updated to current time
```

Disable timestamps:

```typescript
static timestamps = false;
```

### Casts

Cast attribute values to specific types:

```typescript
static casts = {
  published: 'boolean' as const,
  created_at: 'date' as const,
  updated_at: 'date' as const,
  metadata: 'json' as const,
};

const post = await Post.find(1);
console.log(post.published); // boolean, not 0/1
console.log(post.created_at); // Date object, not string
console.log(post.metadata); // Object, not JSON string
```

Supported cast types: `string`, `integer`, `float`, `boolean`, `date`, `json`

## Query Builder

The query builder provides a fluent API for building and executing queries.

### Basic Queries

```typescript
import { User } from './models/User.js';

// Get all users
const users = await User.all();

// Get a single user by primary key
const user = await User.find(1);

// Get first user
const user = await User.first();

// Get or throw
const user = await User.findOrFail(1); // Throws ModelNotFoundError if not found

// Count rows
const count = await User.count();

// Check existence
const exists = await User.where('email', 'john@example.com').exists();
```

### Where Clauses

```typescript
// Equality
const users = await User.where('active', true).get();

// Operators
const users = await User.where('age', '>=', 18).get();
const users = await User.where('name', 'like', '%John%').get();

// Multiple conditions (AND)
const users = await User
  .where('active', true)
  .where('role', 'admin')
  .get();

// OR conditions
const users = await User
  .where('role', 'admin')
  .orWhere('role', 'moderator')
  .get();

// IN clause
const users = await User.whereIn('id', [1, 2, 3]).get();
const users = await User.whereNotIn('status', ['banned', 'inactive']).get();

// NULL checks
const users = await User.whereNull('deleted_at').get();
const users = await User.whereNotNull('verified_at').get();

// Between
const users = await User.whereBetween('age', [18, 65]).get();
```

### Ordering

```typescript
// Order by single column
const users = await User.orderBy('name').get();
const users = await User.orderBy('name', 'desc').get();

// Multiple columns
const users = await User
  .orderBy('role')
  .orderBy('name')
  .get();

// Random
const randomUser = await User.inRandomOrder().first();
```

### Limiting

```typescript
// Limit
const topUsers = await User.limit(10).get();

// Offset
const page2 = await User.offset(10).limit(10).get();

// Get first
const user = await User.first();

// Get last
const user = await User.orderBy('id', 'desc').first();
```

### Pagination

```typescript
const page = 1;
const perPage = 15;

const result = await User.paginate(page, perPage);

console.log(result.data);        // Array of users
console.log(result.total);       // Total count
console.log(result.perPage);     // Per page
console.log(result.currentPage); // Current page
console.log(result.lastPage);    // Last page number
console.log(result.from);        // First record number
console.log(result.to);          // Last record number
console.log(result.hasMorePages); // Whether more pages exist
```

### Selecting Columns

```typescript
// Select specific columns
const users = await User.select('id', 'name', 'email').get();

// Add additional columns
const users = await User.select('id', 'name').addSelect('email').get();

// Select all except certain columns
const users = await User.selectRaw('* EXCEPT password').get();
```

## CRUD Operations

### Create

```typescript
// Create with attributes
const user = await User.create({
  name: 'John Doe',
  email: 'john@example.com',
  password: 'secret',
});

// Create multiple
const users = await User.createMany([
  { name: 'John', email: 'john@example.com', password: 'secret' },
  { name: 'Jane', email: 'jane@example.com', password: 'secret' },
]);

// Create or get
const user = await User.firstOrCreate(
  { email: 'john@example.com' },  // Find by these
  { name: 'John Doe', password: 'secret' }  // Create with these if not found
);
```

### Read

```typescript
// Get all
const users = await User.all();

// Get with conditions
const activeUsers = await User.where('active', true).get();

// Get single
const user = await User.find(1);
const user = await User.where('email', 'john@example.com').first();

// Get or throw
const user = await User.findOrFail(1);

// Count
const count = await User.count();
```

### Update

```typescript
// Update single model
const user = await User.find(1);
await user.update({ name: 'Jane', email: 'jane@example.com' });

// Update with query
await User.where('active', false).update({ active: true });

// Increment/Decrement
await Post.where('id', 1).increment('views');
await Post.where('id', 1).decrement('views', 5);
```

### Delete

```typescript
// Delete single model
const user = await User.find(1);
await user.delete();

// Delete with query
await User.where('active', false).delete();

// Delete all (use with caution!)
await User.delete();
```

## Relationships

Models can have relationships to other models.

### Defining Relationships

```typescript
// src/lib/models/User.ts
import { Model } from 'svelar/orm';

export class User extends Model {
  static table = 'users';

  // One-to-many: A user has many posts
  posts() {
    return this.hasMany(Post, 'user_id');
  }
}

// src/lib/models/Post.ts
import { Model } from 'svelar/orm';

export class Post extends Model {
  static table = 'posts';

  // Many-to-one: A post belongs to a user
  author() {
    return this.belongsTo(User, 'user_id');
  }
}
```

### Relationship Types

#### HasOne

A model has one related model:

```typescript
export class User extends Model {
  profile() {
    return this.hasOne(Profile, 'user_id');
  }
}

// Usage
const user = await User.find(1);
const profile = await user.profile().first();
```

#### HasMany

A model has many related models:

```typescript
export class User extends Model {
  posts() {
    return this.hasMany(Post, 'user_id');
  }
}

// Usage
const user = await User.find(1);
const posts = await user.posts().get();
```

#### BelongsTo

A model belongs to another model:

```typescript
export class Post extends Model {
  author() {
    return this.belongsTo(User, 'user_id');
  }
}

// Usage
const post = await Post.find(1);
const author = await post.author().first();
```

#### BelongsToMany

A model has many of another model through a pivot table:

```typescript
export class User extends Model {
  roles() {
    return this.belongsToMany(Role, 'user_roles', 'user_id', 'role_id');
  }
}

export class Role extends Model {
  users() {
    return this.belongsToMany(User, 'user_roles', 'role_id', 'user_id');
  }
}

// Usage
const user = await User.find(1);
const roles = await user.roles().get();
```

### Eager Loading

Load relationships efficiently to avoid N+1 queries:

```typescript
// Bad: N+1 queries
const users = await User.all();
for (const user of users) {
  const posts = await user.posts().get(); // Extra query for each user!
}

// Good: Eager loading
const users = await User.with('posts').get();
for (const user of users) {
  const posts = user.posts; // No extra queries, data is already loaded
}

// Multiple relationships
const users = await User.with('posts', 'profile').get();

// Nested relationships
const users = await User.with('posts.comments').get();
```

## Model Hooks

Execute code at specific points in a model's lifecycle:

```typescript
export class User extends Model {
  // Before operations
  static async creating(user: User) {
    // Called before insert
    user.email = user.email?.toLowerCase();
  }

  static async updating(user: User) {
    // Called before update
    console.log('User being updated:', user.id);
  }

  static async deleting(user: User) {
    // Called before delete
    console.log('User being deleted:', user.id);
  }

  // After operations
  static async created(user: User) {
    // Called after insert
    console.log('User created:', user.id);
    // Dispatch event, send welcome email, etc.
  }

  static async updated(user: User) {
    // Called after update
    console.log('User updated:', user.id);
  }

  static async deleted(user: User) {
    // Called after delete
    console.log('User deleted:', user.id);
  }
}
```

## Practical Example: Blog App

Here's a complete example of models with relationships:

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
}

import { Post } from './Post.js';
import { Comment } from './Comment.js';
```

```typescript
// src/lib/models/Post.ts
import { Model } from 'svelar/orm';

export class Post extends Model {
  static table = 'posts';
  static timestamps = true;
  static fillable = ['title', 'slug', 'body', 'published', 'user_id'];

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
}

import { User } from './User.js';
import { Comment } from './Comment.js';
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

Usage:

```typescript
// Get user with all posts
const user = await User.with('posts').find(1);
console.log(user.name);
console.log(user.posts); // Array of posts

// Get posts with author and comments
const posts = await Post.with('author', 'comments').get();
for (const post of posts) {
  console.log(post.title, 'by', post.author.name);
  console.log('Comments:', post.comments.length);
}

// Query through relationships
const activeUserPosts = await Post
  .where('published', true)
  .with('author')
  .orderBy('created_at', 'desc')
  .get();
```

## Best Practices

1. **Define relationships in both directions** - If User hasMany Posts, Post belongsTo User
2. **Use eager loading** - Prevent N+1 queries with `.with()`
3. **Use fillable wisely** - Only allow mass-assignment of safe attributes
4. **Hide sensitive data** - Use the `hidden` property to exclude passwords and tokens
5. **Leverage timestamps** - Use `created_at` and `updated_at` for auditing
6. **Use model hooks for side effects** - Send emails, dispatch events, clear caches in hooks
7. **Keep models thin** - Move business logic to services and repositories

## Next Steps

- Learn [Validation](./05-validation-dtos.md) to validate data before saving
- Explore [Repositories](./08-services-actions-repositories.md) for data access patterns
- Check [Controllers](./04-controllers-routing.md) to use models in request handlers

---

**Svelar Models & ORM Guide** © 2026
