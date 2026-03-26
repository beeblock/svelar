# Database

Learn how to work with databases in Svelar, including migrations, seeders, schema building, and raw queries.

## Configuration

Database configuration happens in `src/app.ts`:

```typescript
import { Connection } from 'svelar/database';

Connection.configure({
  default: 'sqlite',
  connections: {
    sqlite: {
      driver: 'sqlite',
      filename: process.env.DB_PATH ?? 'database.db',
    },
    pgsql: {
      driver: 'postgresql',
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432'),
      database: process.env.DB_NAME || 'svelar',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || '',
    },
    mysql: {
      driver: 'mysql2',
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '3306'),
      database: process.env.DB_NAME || 'svelar',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
    },
  },
});

export { Connection };
```

## Migrations

Migrations are version-controlled database schema changes. Each migration is a file that defines `up()` and `down()` methods.

### Creating a Migration

```bash
npx svelar make:migration create_users_table
```

This creates `src/lib/database/migrations/[timestamp]_create_users_table.ts`:

```typescript
import { Migration } from 'svelar/database';

export default class CreateUsersTable extends Migration {
  async up() {
    await this.schema.createTable('users', (table) => {
      table.increments('id');
      table.string('name');
      table.string('email').unique();
      table.string('password');
      table.timestamps();
    });
  }

  async down() {
    await this.schema.dropTable('users');
  }
}
```

### Running Migrations

Run all pending migrations:

```bash
npx svelar migrate
```

This runs migrations in chronological order and logs completed ones to the `migrations` table.

### Migration Commands

All migration operations use the `migrate` command with flags:

```bash
npx svelar migrate                # Run pending migrations
npx svelar migrate --rollback     # Rollback the last batch
npx svelar migrate --reset        # Rollback ALL migrations (runs every down())
npx svelar migrate --refresh      # Reset + re-run all migrations
npx svelar migrate --fresh        # Drop ALL tables + re-run migrations (ignores down())
npx svelar migrate --status       # Show which migrations have run
npx svelar migrate --seed         # Run seeders after migrating
```

> **Production safety**: `--reset`, `--refresh`, and `--fresh` are blocked in production unless you also pass `--force`. Svelar checks `NODE_ENV` and `APP_ENV` to detect production.

```bash
# This fails in production:
npx svelar migrate --fresh

# This works in production:
npx svelar migrate --fresh --force
```

**fresh vs refresh**: `--refresh` calls every migration's `down()` method in reverse order, then runs all `up()` methods again. `--fresh` ignores migration files entirely — it drops every table in the database, then runs all `up()` methods. Use `--fresh` when your `down()` methods are broken or incomplete.

## Schema Builder

The Schema Builder provides a fluent API for defining tables and columns.

### Creating Tables

```typescript
await this.schema.createTable('posts', (table) => {
  table.increments('id');                    // Auto-incrementing primary key
  table.string('title', 255);                // VARCHAR(255)
  table.text('body');                        // TEXT
  table.string('slug').unique();             // VARCHAR with unique constraint
  table.boolean('published').default(false); // BOOLEAN with default
  table.integer('user_id');                  // INTEGER
  table.timestamps();                        // created_at, updated_at timestamps

  // Indexes
  table.index(['slug']);
  table.uniqueIndex(['email']);
  table.primary(['id']);

  // Foreign keys
  table.integer('user_id').references('id', 'users');
  table.integer('category_id').references('id', 'categories').onDelete('CASCADE');
});
```

### Adding Columns

```typescript
await this.schema.addColumn('users', (table) => {
  table.string('phone');
  table.string('avatar_url').nullable();
});
```

### Dropping Columns

```typescript
await this.schema.dropColumn('users', 'nickname');
```

### Dropping Tables

```typescript
await this.schema.dropTable('users');
await this.schema.dropTableIfExists('users'); // Safe drop
```

### Column Types

```typescript
// Numeric
table.increments('id');           // Auto-incrementing INTEGER primary key
table.bigIncrements('id');        // Auto-incrementing BIGINT primary key
table.integer('count');           // INTEGER
table.bigInteger('votes');        // BIGINT
table.decimal('price', 8, 2);    // DECIMAL(8, 2)
table.float('rating');            // FLOAT

// String
table.string('name', 100);       // VARCHAR(100), default 255
table.text('bio');                // TEXT
table.json('meta');               // JSON

// Boolean
table.boolean('active');          // BOOLEAN

// Dates & Times
table.date('birthday');           // DATE
table.datetime('created_at');     // DATETIME
table.timestamp('logged_at');     // TIMESTAMP
table.timestamps();               // created_at + updated_at

// Other
table.uuid('id');                 // UUID (CHAR(36))
table.blob('data');               // BLOB / binary data
table.enum('status', ['active', 'inactive']); // ENUM
```

### Column Modifiers

```typescript
table.string('email')
  .unique()                       // UNIQUE constraint
  .nullable()                     // Allow NULL
  .notNullable()                  // NOT NULL (default)
  .default('none')                // DEFAULT value
  .primary()                      // PRIMARY KEY
  .unsigned();                    // UNSIGNED (numeric columns)
```

### Indexes

```typescript
table.index('slug');                        // Simple index on one column
table.index(['slug', 'status']);            // Composite index
table.uniqueIndex('email');                // Unique index
table.uniqueIndex(['email', 'account_id']); // Composite unique index
table.primary(['id']);                      // Composite primary key
```

### Foreign Keys

```typescript
table.integer('user_id').references('id', 'users');
table.integer('category_id')
  .references('id', 'categories')
  .onDelete('CASCADE')    // CASCADE, SET NULL, RESTRICT, NO ACTION
  .onUpdate('CASCADE');   // CASCADE, SET NULL, RESTRICT, NO ACTION
```

## Seeders

Seeders populate your database with demo or test data.

### Creating a Seeder

```bash
npx svelar make:seeder DatabaseSeeder
```

This creates `src/lib/database/seeders/DatabaseSeeder.ts`:

```typescript
import { Seeder } from 'svelar/database';
import { User } from '../../models/User.js';
import { Post } from '../../models/Post.js';

export class DatabaseSeeder extends Seeder {
  async run(): Promise<void> {
    // Create 5 users
    for (let i = 1; i <= 5; i++) {
      await User.create({
        name: `User ${i}`,
        email: `user${i}@example.com`,
        password: await Hash.make('password'),
      });
    }

    // Create posts for each user
    const users = await User.all();
    for (const user of users) {
      for (let i = 1; i <= 3; i++) {
        await Post.create({
          title: `Post ${i} by ${user.name}`,
          slug: `post-${i}-${user.id}`,
          body: 'Lorem ipsum dolor sit amet...',
          user_id: user.id,
          published: true,
        });
      }
    }
  }
}
```

### Running Seeders

```bash
npx svelar seed:run
```

This runs the `run()` method of the seeder, populating your database.

## Raw Queries

For complex queries or when you need direct database access, use raw SQL:

```typescript
import { Connection } from 'svelar/database';

// Simple query
const users = await Connection.raw('SELECT * FROM users WHERE age > ?', [18]);

// Insert
await Connection.raw(
  'INSERT INTO users (name, email) VALUES (?, ?)',
  ['John Doe', 'john@example.com']
);

// Update
await Connection.raw(
  'UPDATE users SET email = ? WHERE id = ?',
  ['newemail@example.com', 1]
);

// Delete
await Connection.raw('DELETE FROM users WHERE id = ?', [1]);

// Use a specific named connection
const rows = await Connection.raw('SELECT * FROM logs', [], 'analytics');
```

## Practical Example: Blog Database

Here's a complete example of setting up a blog database with users, posts, and comments.

### Migrations

```typescript
// 20260325000001_create_users_table.ts
import { Migration } from 'svelar/database';

export default class CreateUsersTable extends Migration {
  async up() {
    await this.schema.createTable('users', (table) => {
      table.increments('id');
      table.string('name');
      table.string('email').unique();
      table.string('password');
      table.timestamps();
    });
  }

  async down() {
    await this.schema.dropTable('users');
  }
}
```

```typescript
// 20260325000002_create_posts_table.ts
import { Migration } from 'svelar/database';

export default class CreatePostsTable extends Migration {
  async up() {
    await this.schema.createTable('posts', (table) => {
      table.increments('id');
      table.string('title');
      table.string('slug').unique();
      table.text('body');
      table.boolean('published').default(false);
      table.integer('user_id').references('id', 'users').onDelete('cascade');
      table.timestamps();
    });
  }

  async down() {
    await this.schema.dropTable('posts');
  }
}
```

```typescript
// 20260325000003_create_comments_table.ts
import { Migration } from 'svelar/database';

export default class CreateCommentsTable extends Migration {
  async up() {
    await this.schema.createTable('comments', (table) => {
      table.increments('id');
      table.text('body');
      table.integer('user_id').references('id', 'users').onDelete('cascade');
      table.integer('post_id').references('id', 'posts').onDelete('cascade');
      table.timestamps();
    });
  }

  async down() {
    await this.schema.dropTable('comments');
  }
}
```

### Run Migrations

```bash
npx svelar migrate
```

This creates the users, posts, and comments tables in your database.

### Seed Data

```typescript
// src/lib/database/seeders/DatabaseSeeder.ts
import { Seeder } from 'svelar/database';
import { User } from '../../models/User.js';
import { Post } from '../../models/Post.js';
import { Hash } from 'svelar/hashing';

export class DatabaseSeeder extends Seeder {
  async run(): Promise<void> {
    // Create users
    const user1 = await User.create({
      name: 'Jane Doe',
      email: 'jane@example.com',
      password: await Hash.make('password'),
    });

    const user2 = await User.create({
      name: 'John Smith',
      email: 'john@example.com',
      password: await Hash.make('password'),
    });

    // Create posts
    await Post.create({
      title: 'Getting Started with Svelar',
      slug: 'getting-started-with-svelar',
      body: 'Svelar is a Laravel-inspired framework for SvelteKit...',
      user_id: user1.id,
      published: true,
    });

    await Post.create({
      title: 'Building APIs with Svelar',
      slug: 'building-apis-with-svelar',
      body: 'Learn how to build RESTful APIs with Svelar...',
      user_id: user2.id,
      published: true,
    });
  }
}
```

```bash
npx svelar seed:run
```

## Working with the Connection

The `Connection` class manages database drivers and provides raw SQL access:

```typescript
import { Connection } from 'svelar/database';

// Run raw queries with parameterized bindings (safe from SQL injection)
const results = await Connection.raw('SELECT * FROM users WHERE active = ?', [true]);

// Use a named connection
const logs = await Connection.raw('SELECT * FROM logs', [], 'analytics');

// Check the current driver
const driver = Connection.getDriver();         // 'sqlite' | 'postgres' | 'mysql'
const config = Connection.getConfig();          // full connection config object
const connected = Connection.isConnected();     // boolean

// Get the raw driver client (for advanced usage)
const client = await Connection.rawClient();

// Close connections when shutting down
await Connection.disconnect();                  // close default
await Connection.disconnect('analytics');       // close named connection
```

## Best Practices

1. **Always use migrations** - Never modify the database schema manually. Use migrations to version control your schema.

2. **One change per migration** - Keep migrations small and focused. Don't create multiple tables in one migration.

3. **Use meaningful names** - Migration names should describe what they do: `create_users_table`, `add_email_to_users`, `create_posts_comments_relationship`.

4. **Test seeders** - Seeders should be idempotent and work on a fresh database. Test them regularly.

5. **Use foreign keys** - Enforce referential integrity with foreign keys and cascade deletes when appropriate.

6. **Document schema** - Add comments to complex columns and tables to help team members understand your schema.

7. **Use transactions for complex operations** - When you need multiple operations to succeed or fail together, use database transactions.

## Next Steps

- Learn [Models & ORM](./03-models-orm.md) to query your data
- Explore [Validation](./05-validation-dtos.md) to validate data before storing
- Check [Controllers & Routing](./04-controllers-routing.md) to handle HTTP requests

---

**Svelar Database Guide** © 2026
