# Authentication

Learn how to authenticate users in Svelar using sessions, JWT tokens, or API tokens.

## Configuration

Authentication is configured in `src/app.ts`:

```typescript
import { AuthManager } from '@beeblock/svelar/auth';
import { User } from './lib/models/User.js';

export const auth = new AuthManager({
  guard: 'session',  // 'session', 'jwt', 'api'
  model: User,
});

export { AuthManager };
```

## Session-Based Authentication

Session-based auth is the default and recommended approach for web apps. Users log in once and receive a signed session cookie.

### Setup

In `src/hooks.server.ts`:

```typescript
import { createSvelarHooks } from '@beeblock/svelar/hooks';
import { SessionMiddleware, MemorySessionStore } from '@beeblock/svelar/session';
import { AuthenticateMiddleware } from '@beeblock/svelar/auth';
import { auth } from './app.js';

const sessionStore = new MemorySessionStore();

export const handle = createSvelarHooks({
  middleware: [
    new SessionMiddleware({
      store: sessionStore,
      secret: process.env.APP_KEY || 'dev-secret',
      lifetime: 60 * 60 * 24, // 24 hours
    }),
    new AuthenticateMiddleware(auth),
  ],
});
```

### User Model

Your User model must have a method to find by a unique identifier (usually email):

```typescript
import { Model } from '@beeblock/svelar/orm';

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

### Registration

```typescript
import { User } from '../models/User.js';
import { Hash } from '@beeblock/svelar/hashing';

export class AuthService extends Service {
  async register(data: { name: string; email: string; password: string }) {
    // Check if email already exists
    const existing = await User.where('email', data.email).first();
    if (existing) {
      return this.fail('Email already registered');
    }

    // Hash password
    const hashedPassword = await Hash.make(data.password);

    // Create user
    const user = await User.create({
      name: data.name,
      email: data.email,
      password: hashedPassword,
    });

    return this.ok(user);
  }
}
```

Register controller:

```typescript
import { RegisterRequest } from '../dtos/RegisterRequest.js';
import { RegisterUserAction } from '../actions/RegisterUserAction.js';

export class AuthController extends Controller {
  async register(event: any) {
    const data = await RegisterRequest.validate(event);

    const result = await registerAction.run({
      name: data.name,
      email: data.email,
      password: data.password,
    });

    if (!result.success) {
      return this.json({ message: result.error }, 422);
    }

    const user = result.data!;

    // Log user in by setting session
    event.locals.session.set('auth_user_id', (user as any).id);
    event.locals.session.regenerateId();

    return this.created({
      message: 'Registration successful',
      user: { id: (user as any).id, name: (user as any).name, email: (user as any).email },
    });
  }
}
```

### Login

```typescript
export class AuthService extends Service {
  async login(email: string, password: string) {
    const user = await User.where('email', email).first();
    if (!user) {
      return this.fail('Invalid credentials');
    }

    const valid = await Hash.verify(password, (user as any).password);
    if (!valid) {
      return this.fail('Invalid credentials');
    }

    return this.ok(user);
  }
}
```

Login controller:

```typescript
import { LoginRequest } from '../dtos/LoginRequest.js';

export class AuthController extends Controller {
  async login(event: any) {
    const data = await LoginRequest.validate(event);

    const result = await authService.login(data.email, data.password);

    if (!result.success) {
      return this.json({ message: result.error }, 401);
    }

    const user = result.data!;

    // Log user in
    event.locals.session.set('auth_user_id', (user as any).id);
    event.locals.session.regenerateId();

    return this.json({
      message: 'Login successful',
      user: { id: (user as any).id, name: (user as any).name, email: (user as any).email },
    });
  }
}
```

### Logout

```typescript
export class AuthController extends Controller {
  async logout(event: any) {
    event.locals.session.forget('auth_user_id');
    event.locals.session.regenerateId();

    return this.json({ message: 'Logged out successfully' });
  }
}
```

### Get Current User

The `AuthenticateMiddleware` automatically resolves the logged-in user and attaches it to `event.locals.user`:

```typescript
export class AuthController extends Controller {
  async me(event: any) {
    const user = event.locals.user;

    if (!user) {
      return this.json({ message: 'Unauthenticated' }, 401);
    }

    return this.json({
      id: user.id,
      name: user.name,
      email: user.email,
      created_at: user.created_at,
    });
  }
}
```

## JWT Authentication

For stateless APIs, use JWT (JSON Web Tokens). Each request includes a token in the Authorization header.

### Configuration

In `src/app.ts`:

```typescript
import { AuthManager } from '@beeblock/svelar/auth';
import { User } from './lib/models/User.js';

export const auth = new AuthManager({
  guard: 'jwt',
  model: User,
  jwt: {
    secret: process.env.JWT_SECRET || 'dev-secret',
    expiresIn: '24h',
    algorithm: 'HS256',
  },
});
```

In `src/hooks.server.ts`, use `AuthenticateMiddleware` (it handles both session and JWT):

```typescript
import { AuthenticateMiddleware } from '@beeblock/svelar/auth';

export const handle = createSvelarHooks({
  middleware: [
    new AuthenticateMiddleware(auth),
  ],
});
```

### Issuing Tokens

```typescript
import { signJwt } from '@beeblock/svelar/auth';

export class AuthController extends Controller {
  async login(event: any) {
    const result = await authService.login(data.email, data.password);

    if (!result.success) {
      return this.json({ message: result.error }, 401);
    }

    const user = result.data!;

    // Generate JWT token
    const token = signJwt({
      sub: (user as any).id,
      email: (user as any).email,
      name: (user as any).name,
    }, process.env.JWT_SECRET || 'dev-secret');

    return this.json({
      message: 'Login successful',
      token,
      user: { id: (user as any).id, name: (user as any).name, email: (user as any).email },
    });
  }
}
```

### Using Tokens

Clients send the token in the Authorization header:

```bash
curl -H "Authorization: Bearer eyJhbGc..." http://localhost:5173/api/auth/me
```

The `AuthenticateMiddleware` automatically validates the token and sets `event.locals.user`.

## API Token Authentication

For machine-to-machine authentication, generate API tokens per user.

### Database Migration

Create an `api_tokens` table:

```typescript
import { Migration } from '@beeblock/svelar/database';

export default class CreateApiTokensTable extends Migration {
  async up() {
    await this.schema.createTable('api_tokens', (table) => {
      table.increments('id');
      table.integer('user_id').references('id', 'users').onDelete('cascade');
      table.string('name');
      table.string('token').unique();
      table.dateTime('last_used_at').nullable();
      table.timestamps();
    });
  }

  async down() {
    await this.schema.dropTable('api_tokens');
  }
}
```

### Generate Token

```typescript
import { crypto } from 'node:crypto';

export class AuthController extends Controller {
  async generateToken(event: any) {
    const user = event.locals.user;

    if (!user) {
      return this.json({ message: 'Unauthenticated' }, 401);
    }

    const token = crypto.randomBytes(32).toString('hex');

    await ApiToken.create({
      user_id: (user as any).id,
      name: event.request.body.name || 'API Token',
      token: token,
    });

    return this.created({ token });
  }
}
```

### Use Token

Clients send the token in the Authorization header:

```bash
curl -H "Authorization: Bearer <api-token>" http://localhost:5173/api/posts
```

Middleware resolves the token and sets `event.locals.user`.

## Middleware

### AuthenticateMiddleware

Resolves the authenticated user from session, JWT, or API token:

```typescript
import { AuthenticateMiddleware } from '@beeblock/svelar/auth';

export const handle = createSvelarHooks({
  middleware: [
    new AuthenticateMiddleware(auth),
  ],
});
```

After this middleware, `event.locals.user` is either the User model or null.

### RequireAuthMiddleware

Ensures a user is authenticated. Returns 401 if not:

```typescript
import { RequireAuthMiddleware } from '@beeblock/svelar/auth';

export const handle = createSvelarHooks({
  middleware: [
    new AuthenticateMiddleware(auth),
    new RequireAuthMiddleware(), // Require auth for all routes
  ],
});
```

## Protecting Routes

### With Middleware

Apply `RequireAuthMiddleware` to specific routes:

```typescript
export class DashboardController extends Controller {
  constructor() {
    super();
    this.middleware('auth').only(['dashboard', 'settings']);
  }

  async dashboard(event: any) {
    // User is guaranteed to be authenticated
    const user = event.locals.user;
    return this.json({ message: `Welcome ${user.name}` });
  }

  async settings(event: any) {
    const user = event.locals.user;
    return this.json({ user });
  }

  async home(event: any) {
    // No auth required
    return this.json({ message: 'Public endpoint' });
  }
}
```

### In Controllers

Check `event.locals.user` manually:

```typescript
export class PostController extends Controller {
  async store(event: any) {
    const data = await CreatePostRequest.validate(event);

    if (!event.locals.user) {
      return this.json({ message: 'Unauthenticated' }, 401);
    }

    const post = await Post.create({
      ...data,
      user_id: event.locals.user.id,
    });

    return this.created(post);
  }
}
```

## Hashing

Svelar provides multiple hashing drivers for password security.

### Configuration

In `src/app.ts`:

```typescript
import { Hash } from '@beeblock/svelar/hashing';

Hash.configure({
  driver: 'scrypt', // 'bcrypt', 'argon2'
});
```

### Hashing Passwords

```typescript
import { Hash } from '@beeblock/svelar/hashing';

// Hash password
const hashedPassword = await Hash.make('user-password');

// Verify password
const isValid = await Hash.verify('user-password', hashedPassword);
```

### Hash Drivers

- **scrypt** (default) - Zero dependencies, fast, secure
- **bcrypt** - Popular, battle-tested
- **argon2** - Modern, memory-hard

## Session Store

### Memory Store (Development)

```typescript
import { MemorySessionStore } from '@beeblock/svelar/session';

const sessionStore = new MemorySessionStore();

export const handle = createSvelarHooks({
  middleware: [
    new SessionMiddleware({
      store: sessionStore,
      secret: process.env.APP_KEY || 'dev-secret',
      lifetime: 60 * 60 * 24,
    }),
  ],
});
```

Sessions are stored in memory and lost on restart. Great for development.

### Database Store (Production)

```typescript
import { DatabaseSessionStore } from '@beeblock/svelar/session';

const sessionStore = new DatabaseSessionStore('sessions');

export const handle = createSvelarHooks({
  middleware: [
    new SessionMiddleware({
      store: sessionStore,
      secret: process.env.APP_KEY || 'dev-secret',
      lifetime: 60 * 60 * 24,
    }),
  ],
});
```

Sessions are persisted to the database and survive restarts.

## Complete Auth Example

Here's the complete authentication flow from the svelar-example app:

### Routes

```typescript
// src/routes/api/auth/register/+server.ts
import { AuthController } from '$lib/controllers/AuthController.js';

const ctrl = new AuthController();
export const POST = ctrl.handle('register');

// src/routes/api/auth/login/+server.ts
export const POST = ctrl.handle('login');

// src/routes/api/auth/logout/+server.ts
export const POST = ctrl.handle('logout');

// src/routes/api/auth/me/+server.ts
export const GET = ctrl.handle('me');
```

### Controller

```typescript
// src/lib/controllers/AuthController.ts
export class AuthController extends Controller {
  async register(event: any) {
    const data = await RegisterRequest.validate(event);
    const result = await registerAction.run(data);

    if (!result.success) {
      return this.json({ message: result.error }, 422);
    }

    const user = result.data!;
    event.locals.session.set('auth_user_id', (user as any).id);
    event.locals.session.regenerateId();

    return this.created({
      message: 'Registration successful',
      user: { id: (user as any).id, name: (user as any).name, email: (user as any).email },
    });
  }

  async login(event: any) {
    const data = await LoginRequest.validate(event);
    const result = await authService.login(data.email, data.password);

    if (!result.success) {
      return this.json({ message: result.error }, 401);
    }

    const user = result.data!;
    event.locals.session.set('auth_user_id', (user as any).id);
    event.locals.session.regenerateId();

    return this.json({
      message: 'Login successful',
      user: { id: (user as any).id, name: (user as any).name, email: (user as any).email },
    });
  }

  async logout(event: any) {
    event.locals.session.forget('auth_user_id');
    event.locals.session.regenerateId();

    return this.json({ message: 'Logged out successfully' });
  }

  async me(event: any) {
    const user = event.locals.user;

    if (!user) {
      return this.json({ message: 'Unauthenticated' }, 401);
    }

    return this.json({
      id: user.id,
      name: user.name,
      email: user.email,
      created_at: user.created_at,
    });
  }
}
```

## Best Practices

1. **Use sessions for web apps** - Simpler, more familiar to users
2. **Use JWT for APIs** - Stateless, easier to scale
3. **Always hash passwords** - Never store plain text passwords
4. **Regenerate session IDs after login/logout** - Prevents session fixation attacks
5. **Use HTTPS in production** - Protect tokens and cookies in transit
6. **Set appropriate token lifetimes** - Balance security and convenience
7. **Validate tokens on every request** - Don't trust client claims

## Next Steps

- Learn [Middleware](./07-middleware.md) to protect routes
- Explore [Services & Actions](./08-services-actions-repositories.md) for auth logic
- Check [Controllers & Routing](./04-controllers-routing.md) to handle auth requests

---

**Svelar Authentication Guide** © 2026
