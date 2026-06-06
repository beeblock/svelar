# Auth, Gates, Middleware & Validation

Full docs: https://svelar.dev/docs/authentication, https://svelar.dev/docs/middleware, https://svelar.dev/docs/validation

## Table of Contents
- [Auth Configuration](#auth-configuration)
- [Auth Methods](#auth-methods)
- [Gates & Policies](#gates--policies)
- [Middleware](#middleware)
- [Validation](#validation)

## Auth Configuration

Import: `import { Auth } from '@beeblock/svelar/auth';`

```typescript
const auth = Auth.configure({
  guard: 'session',           // 'session' | 'jwt' | 'token'
  model: User,
  identifierColumn: 'email',
  passwordColumn: 'password',
  jwt: {
    secret: env.APP_KEY,
    expiresIn: 3600,           // 1 hour
    refreshTokens: true,
    refreshExpiresIn: 604800,  // 7 days
    refreshTable: 'refresh_tokens',
  },
  passwordResets: { table: 'password_resets', expiresIn: 3600 },
  emailVerification: { table: 'email_verifications', expiresIn: 86400, verifiedColumn: 'email_verified_at' },
  otp: { table: 'otp_codes', expiresIn: 600, length: 6 },
});
```

## Auth Methods

### Session Auth
```typescript
const user = await auth.attempt({ email, password }, session);  // login
await auth.logout(session);                                      // logout
const user = await auth.resolveFromSession(session);             // get user
```

### JWT Auth
```typescript
const tokens = await auth.attemptJwt({ email, password });
// { user, token, expiresAt, refreshToken, refreshExpiresAt }
const newTokens = await auth.refreshJwt(refreshToken);
const user = await auth.resolveFromToken(token);
await auth.revokeRefreshTokens(userId);
```

### Registration
```typescript
const user = await auth.register({ email, password, name });    // hashes password
```

### Password Reset
```typescript
await auth.sendPasswordReset(email);                            // send reset email
const ok = await auth.resetPassword(token, email, newPassword); // reset
```

### Email Verification
```typescript
await auth.sendVerificationEmail(user);
const ok = await auth.verifyEmail(token, userId);
auth.isEmailVerified(user);
```

### OTP Login
```typescript
await auth.sendOtp(email, 'login');
const user = await auth.attemptOtp(email, code, session, 'login');
const user = await auth.verifyOtp(email, code, 'login');  // without session
```

### Status Checks
```typescript
auth.check()   // boolean
auth.user()    // user or null
auth.id()      // user id or null
```

### Token Cleanup (run daily via scheduler)
```typescript
await auth.cleanupExpiredTokens();
// { passwordResets: n, verifications: n, otpCodes: n }
```

## Gates & Policies

Import: `import { Gate, Policy, GateMiddleware } from '@beeblock/svelar/auth';`

### Define Gates
```typescript
Gate.define('edit-post', (user, post) => user.id === post.user_id);
Gate.define('admin', (user) => user.role === 'admin');
Gate.defineSuperUser((user) => user.role === 'superadmin');
```

### Define Policies
```typescript
class PostPolicy extends Policy {
  before(user, ability) {
    if (user.role === 'admin') return true;  // allow all
    return null;  // continue to specific check
  }
  view(user, post) { return true; }
  create(user) { return !!user; }
  update(user, post) { return user.id === post.user_id; }
  delete(user, post) { return user.id === post.user_id; }
}
Gate.policy('Post', new PostPolicy());
```

### Check Authorization
```typescript
await Gate.allows('edit-post', user, post)    // boolean
await Gate.denies('admin', user)              // boolean
await Gate.authorize('delete', user, post)    // throws if denied
const response = await Gate.inspect('edit-post', user, post);  // GateResponse

// User-scoped
const gate = Gate.forUser(user);
await gate.allows('edit-post', post)
await gate.any(['edit', 'delete'], post)      // at least one
await gate.all(['view', 'update'], post)      // all required
```

### Gate Middleware
```typescript
// In controller constructor:
this.middleware(
  new GateMiddleware('update-post', (ctx) => Post.find(ctx.params.id)),
  { only: ['update', 'destroy'] }
);
```

## Middleware

Import: `import { Middleware } from '@beeblock/svelar/middleware';`

### Custom Middleware
```typescript
class AdminOnly extends Middleware {
  async handle(ctx, next) {
    if (ctx.locals.user?.role !== 'admin') {
      return new Response('Forbidden', { status: 403 });
    }
    return next();
  }
}
```

### Built-in Middleware

| Middleware | Import | Purpose |
|-----------|--------|---------|
| `CorsMiddleware` | `@beeblock/svelar/middleware` | CORS headers |
| `RateLimitMiddleware` | `@beeblock/svelar/middleware` | Global rate limiting (default: 60/min) |
| `ThrottleMiddleware` | `@beeblock/svelar/middleware` | Per-route throttle on failed attempts |
| `CsrfMiddleware` | `@beeblock/svelar/middleware` | Double-submit CSRF protection |
| `OriginMiddleware` | `@beeblock/svelar/middleware` | Block cross-origin mutations |
| `LoggingMiddleware` | `@beeblock/svelar/middleware` | Request logging |
| `SignatureMiddleware` | `@beeblock/svelar/middleware` | HMAC request signature verification |
| `AuthenticateMiddleware` | `@beeblock/svelar/auth` | Resolve user from session/JWT |
| `RequireAuthMiddleware` | `@beeblock/svelar/auth` | 401 if not authenticated |
| `RedirectIfNotAuthenticated` | `@beeblock/svelar/auth` | Redirect to login |
| `GateMiddleware` | `@beeblock/svelar/auth` | Authorization gate check |
| `RequireRoleMiddleware` | `@beeblock/svelar/permissions` | Role check |
| `RequirePermissionMiddleware` | `@beeblock/svelar/permissions` | Permission check |

### Controller Middleware
```typescript
class PostController extends Controller {
  constructor() {
    super();
    this.middleware(new RequireAuthMiddleware());
    this.middleware(new ThrottleMiddleware({ maxAttempts: 10 }), { only: ['store'] });
    this.middleware(new GateMiddleware('admin'), { except: ['index', 'show'] });
  }
}
```

## Validation

Import: `import { z, validate, rules } from '@beeblock/svelar/validation';`

Svelar re-exports Zod and adds convenience helpers:

### In Controllers
```typescript
const data = await this.validate(event, {
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(2).max(100),
});
// Throws ValidationError with 422 response on failure
```

### FormRequest (Dedicated Validation Class)
```typescript
import { FormRequest } from '@beeblock/svelar/forms';

class CreateUserRequest extends FormRequest {
  rules() {
    return z.object({
      name: z.string().min(2),
      email: z.string().email(),
      password: z.string().min(8),
      password_confirmation: z.string(),
    }).refine(d => d.password === d.password_confirmation, {
      message: 'Passwords must match',
      path: ['password_confirmation'],
    });
  }

  authorize(event) {
    return !!event.locals.user;
  }

  messages() {
    return { 'email.email': 'Please enter a valid email' };
  }
}

// In controller:
const data = await CreateUserRequest.validate(event);
```

### Helper Rules
```typescript
rules.required()           // z.string().min(1)
rules.email()              // z.string().email()
rules.string(min?, max?)   // z.string() with bounds
rules.number(min?, max?)   // z.number() with bounds
rules.integer()            // z.number().int()
rules.boolean()            // z.boolean()
rules.date()               // z.coerce.date()
rules.url()                // z.string().url()
rules.uuid()               // z.string().uuid()
rules.enum(values)         // z.enum(values)
rules.array(schema)        // z.array(schema)
rules.nullable(schema)     // schema.nullable()
rules.optional(schema)     // schema.optional()
```

### Standalone Validation
```typescript
const result = validate(z.object({ email: z.string().email() }), data);
if (result.success) {
  // result.data is typed
} else {
  // result.errors has field-level errors
}
```
