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

### Refresh Tokens

Access tokens are short-lived by design. When they expire, the client needs to re-authenticate. Refresh tokens solve this — they're long-lived tokens stored in the database that can be exchanged for a new access token without re-entering credentials.

#### Enable Refresh Tokens

```typescript
export const auth = new AuthManager({
  guard: 'jwt',
  model: User,
  jwt: {
    secret: process.env.JWT_SECRET,
    expiresIn: 900,              // Access token: 15 minutes
    algorithm: 'HS256',
    refreshTokens: true,         // Enable refresh tokens
    refreshExpiresIn: 604800,    // Refresh token: 7 days
    refreshTable: 'refresh_tokens', // Database table (default)
  },
});
```

#### Migration

Create the refresh tokens table:

```typescript
import { Migration } from '@beeblock/svelar/database';

export default class CreateRefreshTokensTable extends Migration {
  async up() {
    await this.schema.createTable('refresh_tokens', (table) => {
      table.increments('id');
      table.integer('user_id').references('id', 'users').onDelete('cascade');
      table.string('token').unique();         // SHA256 hash
      table.dateTime('expires_at');
      table.dateTime('revoked_at').nullable();
      table.timestamps();
    });
  }

  async down() {
    await this.schema.dropTable('refresh_tokens');
  }
}
```

#### Login — Returns Both Tokens

```typescript
export class AuthController extends Controller {
  async login(event: any) {
    const data = await LoginRequest.validate(event);

    const result = await auth.attemptJwt({
      email: data.email,
      password: data.password,
    });

    if (!result) {
      return this.json({ message: 'Invalid credentials' }, 401);
    }

    // result includes both tokens when refreshTokens is enabled
    return this.json({
      token: result.token,
      expires_at: result.expiresAt,
      refresh_token: result.refreshToken,
      refresh_expires_at: result.refreshExpiresAt,
    });
  }
}
```

#### Refresh — Exchange Refresh Token for New Pair

```typescript
export class AuthController extends Controller {
  async refresh(event: any) {
    const { refresh_token } = await event.request.json();

    // Exchanges the refresh token for a new access + refresh token pair
    // The old refresh token is automatically revoked (rotation)
    const result = await auth.refreshJwt(refresh_token);

    if (!result) {
      return this.json({ message: 'Invalid or expired refresh token' }, 401);
    }

    return this.json({
      token: result.token,
      expires_at: result.expiresAt,
      refresh_token: result.refreshToken,
      refresh_expires_at: result.refreshExpiresAt,
    });
  }
}
```

#### Logout — Revoke All Refresh Tokens

```typescript
export class AuthController extends Controller {
  async logout(event: any) {
    const user = event.locals.user;
    if (user) {
      // Revoke all refresh tokens for this user
      await auth.revokeRefreshTokens(user.id);
    }

    return this.json({ message: 'Logged out' });
  }
}
```

#### How Refresh Token Rotation Works

```
1. Login         → access_token (15min) + refresh_token_A (7 days)
2. Token expires → client sends refresh_token_A to /api/auth/refresh
3. Server        → revokes refresh_token_A, issues new access_token + refresh_token_B
4. Token expires → client sends refresh_token_B to /api/auth/refresh
5. ...and so on

If refresh_token_A is used again after step 3 → rejected (already revoked)
This detects token theft — if an attacker replays a stolen refresh token,
the legitimate user's next refresh also fails, alerting them.
```

#### Client-Side Example

```typescript
// Store tokens (e.g. in memory or secure storage)
let accessToken = '...';
let refreshToken = '...';

async function fetchWithAuth(url: string, options: RequestInit = {}) {
  let res = await fetch(url, {
    ...options,
    headers: { ...options.headers, Authorization: `Bearer ${accessToken}` },
  });

  // If 401, try refreshing
  if (res.status === 401 && refreshToken) {
    const refreshRes = await fetch('/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });

    if (refreshRes.ok) {
      const data = await refreshRes.json();
      accessToken = data.token;
      refreshToken = data.refresh_token;

      // Retry original request with new token
      res = await fetch(url, {
        ...options,
        headers: { ...options.headers, Authorization: `Bearer ${accessToken}` },
      });
    } else {
      // Refresh failed — redirect to login
      window.location.href = '/login';
    }
  }

  return res;
}
```

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

## API Request Signatures

Bearer tokens prove *who* is making the request. Request signatures prove the request *hasn't been tampered with*. For high-security APIs (payment processing, webhooks, partner integrations), you can require both.

### How It Works

The client signs each request by computing an HMAC-SHA256 over the timestamp, HTTP method, path, and body:

```
signature = HMAC-SHA256(secret, "timestamp.METHOD./path.body")
```

The server recomputes the signature and rejects requests where:
- The signature doesn't match (request was tampered with)
- The timestamp is too old (replay attack)
- The signature or timestamp header is missing

### Server Setup

Add `SignatureMiddleware` to your pipeline:

```typescript
import { SignatureMiddleware } from '@beeblock/svelar/middleware';

// Apply to specific paths only
new SignatureMiddleware({
  secret: process.env.API_SIGNING_SECRET!,
  tolerance: 300,           // Reject requests older than 5 minutes
  onlyPaths: ['/api/partner/'], // Only enforce on partner API routes
})

// Or with createSvelarHooks for the full pipeline
export const handle = createSvelarHooks({
  middleware: [
    new CorsMiddleware({ origin: ['https://partner.example.com'] }),
    new SignatureMiddleware({
      secret: process.env.API_SIGNING_SECRET!,
      tolerance: 300,
      onlyPaths: ['/api/partner/'],
    }),
    new AuthenticateMiddleware(auth),
  ],
});
```

### Client-Side Signing (Browser/Node.js)

Use the built-in `signedFetch` helper:

```typescript
import { signedFetch } from '@beeblock/svelar/http';

const res = await signedFetch('/api/partner/orders', {
  method: 'POST',
  body: JSON.stringify({ item: 'widget', quantity: 5 }),
  signingSecret: 'your-shared-secret',
});
```

### Client-Side Signing (Any Language)

The signing algorithm is simple enough to implement in any language:

```typescript
// 1. Get current Unix timestamp (seconds)
const timestamp = Math.floor(Date.now() / 1000);

// 2. Build the signing payload
const payload = `${timestamp}.POST./api/partner/orders.{"item":"widget"}`;

// 3. Compute HMAC-SHA256
const signature = hmacSHA256(secret, payload);

// 4. Send with headers
fetch('/api/partner/orders', {
  method: 'POST',
  headers: {
    'X-Signature': signature,
    'X-Timestamp': String(timestamp),
    'Content-Type': 'application/json',
  },
  body: '{"item":"widget"}',
});
```

```bash
# cURL example
TIMESTAMP=$(date +%s)
BODY='{"item":"widget"}'
PAYLOAD="${TIMESTAMP}.POST./api/partner/orders.${BODY}"
SIGNATURE=$(echo -n "$PAYLOAD" | openssl dgst -sha256 -hmac "your-secret" -hex | awk '{print $2}')

curl -X POST https://myapp.com/api/partner/orders \
  -H "Content-Type: application/json" \
  -H "X-Signature: $SIGNATURE" \
  -H "X-Timestamp: $TIMESTAMP" \
  -d "$BODY"
```

### Signature Options

| Option | Default | Description |
|--------|---------|-------------|
| `secret` | (required) | Shared signing secret |
| `tolerance` | `300` | Max request age in seconds (5 min) |
| `signatureHeader` | `'X-Signature'` | Header name for the HMAC signature |
| `timestampHeader` | `'X-Timestamp'` | Header name for the Unix timestamp |
| `onlyPaths` | `null` | Path prefixes to enforce (null = all) |

### Bearer Token + Signature (Double Protection)

For maximum security, combine both:

```typescript
// Client sends both
fetch('/api/partner/orders', {
  headers: {
    'Authorization': `Bearer sk_a1b2c3...`,   // Proves identity
    'X-Signature': signature,                  // Proves integrity
    'X-Timestamp': String(timestamp),
  },
  body: '...',
});
```

The `AuthenticateMiddleware` resolves the user from the Bearer token, while `SignatureMiddleware` verifies the request wasn't tampered with. Both must pass.

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

## Cookie Security

Session cookies are the primary mechanism for maintaining authentication state. Svelar configures secure defaults automatically.

### Default Cookie Settings

| Option | Default | Description |
|--------|---------|-------------|
| `cookieName` | `'svelar_session'` | Cookie name |
| `lifetime` | `7200` (2 hours) | Session lifetime in seconds |
| `httpOnly` | `true` | Prevents JavaScript access (XSS protection) |
| `secure` | `NODE_ENV === 'production'` | HTTPS-only in production |
| `sameSite` | `'lax'` | Prevents CSRF on cross-origin POST |
| `domain` | `undefined` | Cookie domain (defaults to current host) |
| `path` | `'/'` | Cookie path |

### Customizing Cookie Options

Override defaults in `createSvelarApp` or `SessionMiddleware`:

```typescript
// Using createSvelarApp (recommended)
export const { handle, handleError } = createSvelarApp({
  auth,
  secret: process.env.APP_KEY,
  sessionLifetime: 60 * 60 * 24 * 7, // 7 days
  sessionStore: new DatabaseSessionStore('sessions'),
});

// Using SessionMiddleware directly
new SessionMiddleware({
  store: new DatabaseSessionStore('sessions'),
  secret: process.env.APP_KEY || 'dev-secret',
  lifetime: 60 * 60 * 24 * 7,  // 7 days
  name: 'my_app_session',       // Custom cookie name
})
```

### Production Security Checklist

1. **Always set a strong `APP_KEY`** — generate a random 32+ character string (`openssl rand -hex 32`)
2. **Use `DatabaseSessionStore`** — `MemorySessionStore` loses all sessions on restart
3. **Use HTTPS** — `secure: true` is automatic when `NODE_ENV=production`
4. **`httpOnly: true`** is on by default — never disable it unless you have a very specific reason
5. **`sameSite: 'lax'`** blocks cross-origin POST with cookies — use `'strict'` for extra security if your app has no cross-origin navigation needs
6. **Regenerate session IDs** after login/logout to prevent session fixation:

```typescript
event.locals.session.set('auth_user_id', user.id);
event.locals.session.regenerateId(); // Always do this after login
```

## Hashing

Svelar provides multiple hashing drivers for password security with timing-safe comparison.

### Configuration

In `src/app.ts`:

```typescript
import { Hash } from '@beeblock/svelar/hashing';

Hash.configure({
  driver: 'scrypt',       // 'scrypt', 'bcrypt', 'argon2'
  scryptCost: 16384,      // scrypt N parameter (default: 16384)
  bcryptRounds: 12,       // bcrypt cost factor (default: 12)
});
```

### Hashing Passwords

```typescript
import { Hash } from '@beeblock/svelar/hashing';

// Hash password
const hashedPassword = await Hash.make('user-password');

// Verify password (timing-safe comparison)
const isValid = await Hash.verify('user-password', hashedPassword);
```

### Automatic Rehashing

When you change hash drivers or increase cost parameters, existing hashes still verify but may need upgrading. Use `needsRehash()` to detect this:

```typescript
async login(email: string, password: string) {
  const user = await User.where('email', email).first();
  if (!user) return this.fail('Invalid credentials');

  const valid = await Hash.verify(password, user.password);
  if (!valid) return this.fail('Invalid credentials');

  // Rehash if the algorithm or cost changed
  if (Hash.needsRehash(user.password)) {
    user.password = await Hash.make(password);
    await user.save();
  }

  return this.ok(user);
}
```

This lets you transparently migrate from bcrypt to argon2 (or increase cost) without forcing all users to reset passwords.

### Hash Drivers

| Driver | Dependencies | Best For |
|--------|-------------|----------|
| **scrypt** (default) | None (Node.js built-in) | Most apps — zero setup, strong security |
| **bcrypt** | `npm install bcrypt` | Apps migrating from other frameworks |
| **argon2** | `npm install argon2` | Maximum security — memory-hard, GPU-resistant |

### Cost Parameters

Higher cost = slower hashing = harder to brute force, but also slower login:

```typescript
// Increase scrypt cost (default 16384, must be power of 2)
Hash.configure({ driver: 'scrypt', scryptCost: 32768 });

// Increase bcrypt rounds (default 12, each +1 doubles the time)
Hash.configure({ driver: 'bcrypt', bcryptRounds: 14 });
```

> **Tip**: The defaults are secure for most applications. Only increase if you have specific compliance requirements or threat models that demand it.

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

## Choosing an Auth Strategy

Svelar supports three authentication methods. They can be used independently or combined — the `AuthenticateMiddleware` tries them all automatically.

### Comparison

| | **Session** | **JWT** | **API Token** |
|---|---|---|---|
| **How it works** | Signed cookie with session ID | Self-contained signed token | Opaque random string stored in DB |
| **Stateless** | No (server stores session) | Yes (no server storage) | No (database lookup) |
| **Expiration** | `lifetime` config (default: 2h) | Built-in `exp` claim (default: 1h) | Optional, can be permanent |
| **Revocation** | Destroy session instantly | Not possible without a blacklist | Instant via `revokedAt` flag |
| **Permissions** | Via roles/permissions on user | Custom claims possible | Built-in per-token granular permissions |
| **Rotation** | Automatic via `regenerateId()` | Generate a new token manually | Built-in `rotate()` method |
| **Audit trail** | Session store timestamps | None | `lastUsedAt`, `createdAt`, `revokedAt` |
| **DB lookups per request** | 1 (session store) | 1 (user by `sub` claim) | 1-2 (token + user lookup) |
| **CSRF protection needed** | Yes (browser sends cookies automatically) | No (token sent explicitly) | No (token sent explicitly) |

### When to Use What

**Session** — web apps where users log in via a browser:
- Default and recommended for most apps
- Cookie is `httpOnly` and `secure` in production — safe from XSS
- Works with `createSvelarApp` out of the box

**JWT** — stateless APIs, mobile apps, SPAs:
- No database hit to verify the token (HMAC signature check only)
- Token expires and cannot be revoked — keep lifetimes short
- Good for microservices and horizontal scaling

**API Token** — server-to-server, CI/CD, developer integrations:
- User generates a named token from their dashboard (e.g., "GitHub Deploy Key")
- Token can have scoped permissions (`['posts:read', 'posts:write']`)
- Can be revoked instantly if compromised
- Tracks when it was last used — great for audit logs

### How the Middleware Resolves Auth

The `AuthenticateMiddleware` tries all three strategies in order on every request:

```
1. Session     — checks event.locals.session for auth_user_id
2. JWT         — if Authorization: Bearer <token>, tries JWT verification (fast, no DB)
3. API Token   — if JWT fails, falls back to database token lookup
```

Both JWT and API tokens use the same `Authorization: Bearer` header — the middleware detects the type automatically. This means your API endpoints accept both without any extra configuration.

```typescript
// All three work against the same endpoint:

// Session (browser with cookie)
fetch('/api/posts', { credentials: 'include' });

// JWT
fetch('/api/posts', { headers: { Authorization: `Bearer ${jwtToken}` } });

// API token
fetch('/api/posts', { headers: { Authorization: `Bearer sk_a1b2c3d4...` } });
```

### Combining Strategies

A common pattern is session auth for the web UI + API tokens for integrations:

```typescript
// app.ts — session guard for web, API tokens handled automatically
export const auth = new AuthManager({
  guard: 'session',
  model: User,
});
```

If you also need JWT (e.g., for a mobile app), add the JWT config:

```typescript
export const auth = new AuthManager({
  guard: 'session',
  model: User,
  jwt: {
    secret: process.env.JWT_SECRET,
    expiresIn: 3600,
    algorithm: 'HS256',
  },
});
```

The middleware will try session first, then JWT, then API token — no route changes needed.

## Best Practices

1. **Use sessions for web apps** — simpler, revocable, CSRF-protected by default
2. **Use JWT for mobile/SPA APIs** — stateless, fast, but keep lifetimes short (1-24h)
3. **Use API tokens for integrations** — revocable, auditable, scoped permissions
4. **Always hash passwords** — never store plain text passwords
5. **Regenerate session IDs after login/logout** — prevents session fixation attacks
6. **Use HTTPS in production** — protect tokens and cookies in transit
7. **Set appropriate token lifetimes** — balance security and convenience
8. **Use `needsRehash()` on login** — transparently upgrade hash algorithms over time
9. **Scope API tokens narrowly** — give each token only the permissions it needs

## Next Steps

- Learn [Middleware](./07-middleware.md) to protect routes
- Explore [Services & Actions](./08-services-actions-repositories.md) for auth logic
- Check [Controllers & Routing](./04-controllers-routing.md) to handle auth requests

---

**Svelar Authentication Guide** © 2026
