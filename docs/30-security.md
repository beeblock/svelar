# Security

This guide covers the security features built into Svelar and best practices for hardening your application.

---

## Environment & Secrets

### APP_KEY

The `APP_KEY` is used to encrypt sessions and sign tokens. It must be a strong, random string.

```bash
npx svelar key:generate
```

This generates a 64-character hex key and writes it to `.env`. Never commit your `.env` file to version control.

### Accessing Secrets in Svelar Apps

Generated Svelar apps target adapter-node and read runtime configuration from `process.env`, including `src/hooks.server.ts`. This keeps the web server, CLI commands, workers, scheduler, and tests on the same environment contract:

```typescript
// hooks.server.ts
export const { handle } = createSvelarApp({
  auth,
  secret: process.env.APP_KEY,
});
```

In production, set secrets as real environment variables on the Node process. For local development and CLI commands, keep them in `.env`.

### Secret Rotation

When rotating `APP_KEY`:

1. Set the new key in `.env`
2. Restart the application
3. All existing sessions will be invalidated (users must re-login)

---

## Authentication

### Session Security

Svelar sessions use `DatabaseSessionStore` by default (persists across restarts). Session cookies are configured with:

- `httpOnly: true` — not accessible via JavaScript
- `secure: true` in production — only sent over HTTPS
- `sameSite: 'lax'` — CSRF protection for cross-origin requests
- Configurable lifetime (default: 2 hours)

### Password Hashing

Svelar supports three hashing drivers:

| Driver | When to use |
|--------|------------|
| `scrypt` | Default, built into Node.js, no native deps |
| `bcrypt` | Industry standard, requires `bcrypt` package |
| `argon2` | Strongest, requires `argon2` package |

```typescript
Hash.configure({ driver: 'scrypt' });
```

All drivers use safe defaults (salt generation, appropriate work factors). Never store passwords in plain text.

### JWT & Refresh Tokens

- Access tokens are short-lived (default: 15 minutes)
- Refresh tokens are long-lived and stored in the database
- Refresh tokens are single-use (rotated on each refresh)
- Revoked tokens are rejected immediately
- Password reset, email verification, and OTP tokens are HMAC-hashed at rest and checked with constant-time comparisons after scoped lookup
- OTP codes use unbiased numeric randomness, are single-use, and must be 4-12 digits

### API Token Security

- API keys are hashed before storage (only the prefix is stored in plain text for lookup)
- Tokens can be scoped to specific permissions
- Tokens can have expiration dates
- Use `Authorization: Bearer <token>` header

---

## Middleware Pipeline

The default middleware stack provides layered security:

### 1. Origin Validation (`OriginMiddleware`)

Rejects requests from unauthorized origins. Prevents DNS rebinding attacks.

### 2. Rate Limiting (`RateLimitMiddleware`)

Prevents brute-force and abuse:

```typescript
new RateLimitMiddleware({
  maxRequests: 100,
  windowMs: 60_000, // 100 requests per minute
  store: 'cache',   // use Redis via Cache for multi-instance production apps
  cacheStore: 'redis',
})
```

For single-process development the default in-memory limiter is fine. In production, configure `CACHE_DRIVER=redis` and set `RATE_LIMIT_STORE=cache` in scaffolded apps so global rate limits and auth throttles are shared across all Node instances.

### 3. CSRF Protection (`CsrfMiddleware`)

Validates CSRF tokens on state-changing requests (POST, PUT, DELETE). Automatically excluded for:

- API routes using Bearer token auth
- Internal API paths (`/api/internal/`)

### 4. Request Signatures (`SignatureMiddleware`)

For API-to-API communication, verify request integrity with HMAC signatures:

```typescript
new SignatureMiddleware({
  secret: env.INTERNAL_SECRET,
  paths: ['/api/internal/'],
})
```

---

## CORS

Configure CORS headers in your middleware:

```typescript
new CorsMiddleware({
  origins: ['https://yourdomain.com'],
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true,
})
```

Never use `origins: ['*']` in production with `credentials: true`.

---

## Permissions & Authorization

Svelar includes a Spatie-inspired permission system:

- **Roles** group permissions (e.g., `admin`, `editor`)
- **Permissions** define granular access (e.g., `manage-users`, `edit-posts`)
- Roles can be assigned to users via pivot tables
- Direct permissions can be granted to individual users
- Gate checks enforce authorization at the controller level
- Policies keep model-specific authorization in dedicated classes

```typescript
// Check in controllers
if (!await user.hasPermission('manage-users')) {
  return json({ error: 'Forbidden' }, { status: 403 });
}
```

Policies must be checked with an explicit model target:

```typescript
Gate.policy('Post', new PostPolicy());

await Gate.forUser(user).allows('create', Post);
await Gate.forUser(user).authorize('update', post);
```

---

## Docker & Infrastructure Security

### Port Exposure

Only the application port should be public. Backing service APIs (database, Redis, Gotenberg, RustFS S3) communicate over the internal Docker network. Generated Docker files expose Soketi and Meilisearch on non-default host ports for browser WebSocket clients and local dashboard/API access; put those behind HTTPS/firewall rules before production traffic.

| Service | Exposed to host? | Notes |
|---------|-------------------|-------|
| **app** | Yes (port 3000) | The only public-facing service |
| **postgres/mysql** | No | Internal only |
| **redis** | No | Internal only, password required |
| **soketi** | Yes (port 5334 by default) | Needed when browser clients connect directly; protect with HTTPS/firewall rules |
| **gotenberg** | No | Internal only |
| **rustfs S3 API** | No | Internal only (app connects via Docker network) |
| **rustfs console** | Yes (port 9001) | Admin dashboard — protect with firewall |
| **meilisearch** | Yes (port 5333 by default) | Protect the dashboard/API with firewall rules and a strong `MEILI_MASTER_KEY`; disable with `--no-meilisearch` if unused |

### Redis Authentication

Redis is configured with password authentication by default:

```yaml
redis:
  command: redis-server --requirepass ${REDIS_PASSWORD:-svelarsecret}
```

Change `REDIS_PASSWORD` in `.env` before deploying to production.

### Database Credentials

Default credentials in `docker-compose.yml` are for development only. Before deploying:

1. Set strong passwords in `.env` for `DB_PASSWORD`, `REDIS_PASSWORD`, `RUSTFS_SECRET_KEY`
2. Never use default passwords in production
3. Consider using Docker secrets or a vault for sensitive values

### RustFS Console

The RustFS admin console (port 9001) provides full access to object storage. In production:

- Restrict access via firewall rules (allow only admin IPs)
- Or remove the port mapping entirely and use the CLI for administration
- Change `RUSTFS_ACCESS_KEY` and `RUSTFS_SECRET_KEY` from defaults

---

## Input Validation

Always validate input at the boundary using Zod schemas:

```typescript
import { z } from 'zod';

export const CreatePostSchema = z.object({
  title: z.string().min(1).max(255),
  content: z.string().min(1),
  published: z.boolean().default(false),
});
```

Use `FormRequest` classes for automatic validation in controllers. Never trust client-side validation alone.

---

## SQL Injection Prevention

The Svelar ORM uses parameterized queries by default. All query builder methods automatically escape values:

```typescript
// Safe — values are parameterized
const user = await User.query().where('email', email).first();

// If using raw queries, always use parameters
const results = await Connection.raw('SELECT * FROM users WHERE email = ?', [email]);
```

Never interpolate user input into raw SQL strings.

---

## Dependency Vulnerability Management

Svelar keeps dependency security checks in the normal release loop:

```bash
npm run security:audit       # Fails on non-allowed high/critical findings
npm run security:audit:all   # Prints the full npm audit report
npm run certify              # Includes the high/critical security gate
```

The repository also ships:

- `.github/dependabot.yml` for weekly dependency update PRs.
- `.github/workflows/security.yml` for pull request, push, weekly, and manual audit runs.
- `.security-audit-allowlist.json` for explicit temporary exceptions.

Every allowlisted advisory must include a reason and an expiration date. Use it only when the upstream fix path is unsafe or unavailable, such as npm suggesting a downgrade or unrelated major break. New high or critical findings that are not allowlisted fail the security gate.

Do not run `npm audit fix --force` blindly. Review the proposed dependency changes, run `npm run build`, `npm run test`, and the relevant smoke/certification checks before publishing.

---

## Production Checklist

Before deploying to production:

- [ ] Generate a strong `APP_KEY` with `npx svelar key:generate`
- [ ] Set unique `JWT_SECRET` and `INTERNAL_SECRET`
- [ ] Change all default passwords (`DB_PASSWORD`, `REDIS_PASSWORD`, `RUSTFS_SECRET_KEY`, `MEILI_MASTER_KEY`)
- [ ] Set `NODE_ENV=production`
- [ ] Enable HTTPS (use a reverse proxy like Traefik or Nginx)
- [ ] Restrict CORS origins to your domain
- [ ] Configure rate limiting appropriate for your traffic
- [ ] Remove or firewall admin/service host ports (`SOKETI_PORT`, `MEILI_PORT`, `RUSTFS_CONSOLE_PORT`)
- [ ] Review exposed Docker ports — only intentionally public app/realtime endpoints should be reachable
- [ ] Set up log rotation to prevent disk exhaustion
- [ ] Enable database backups
- [ ] Never commit `.env` files to version control

---

## Reporting Vulnerabilities

If you discover a security vulnerability in Svelar, please report it responsibly by opening a private issue on GitHub. Do not disclose security issues publicly until a fix is available.
