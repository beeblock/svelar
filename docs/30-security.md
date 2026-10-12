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
- `ApiKeys.rotate()` preserves the absolute expiration, disabled state, tenant/actor identity, permissions, IP allowlist, and rate-limit configuration
- Rotation commits replacement and revocation atomically; failures leave the original key unchanged, and concurrent rotations produce at most one replacement
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
  trustedProxy: ['10.0.0.10'], // only these proxies may provide X-Forwarded-For
})
```

For single-process development the default in-memory limiter is fine. In production, configure `CACHE_DRIVER=redis` and set `RATE_LIMIT_STORE=cache` in scaffolded apps so global rate limits and auth throttles are shared across all Node instances. Redis-backed limits use atomic increments with TTLs. Svelar ignores `X-Forwarded-For` unless `trustedProxy` is configured, so clients cannot spoof rate-limit identities by sending proxy headers directly.

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

For app-defined RBAC, register a capability catalog in a provider or seeder and sync it to the permissions table. This keeps the code gates and the admin UI from drifting:

```typescript
import { Permissions } from '@beeblock/svelar/permissions';

Permissions.registerCapabilities([
  {
    name: 'boards.move-cards',
    description: 'Move cards between board columns',
    module: 'boards',
    screen: '/boards/:id',
    action: 'update',
  },
]);

await Permissions.syncCapabilities();
```

Policies must be checked with an explicit model target:

```typescript
Gate.policy('Post', new PostPolicy());

await Gate.forUser(user).allows('create', Post);
await Gate.forUser(user).authorize('update', post);
```

### Opt-In Team-Scoped RBAC

Application tenant/actor context is shared across the independently bundled public subpaths. `Teams.runWithTeam`, ORM tenant scopes, queued dispatch context, logging, and audit use the same `ApplicationContext` singleton with async-local request isolation. Importing them from separate package subpaths must not create separate context stores; release tests exercise that bundle boundary.

Existing `Permissions` calls and `HasRoles` model methods remain global, even inside `Teams.runWithTeam` or an application context. Use `Permissions.global()` to make a platform/admin check explicit. Global grants are never inherited by team checks, and team grants never satisfy global checks.

`Permissions.forTeam(teamId)` returns an immutable assignment facade. Role and permission definitions (names and guards) remain shared catalogues managed by `Permissions`. Model-role assignments, direct permissions, and role-permission links are independent per team. The same user can have different roles in two teams; even the same role can have different permission links in each team.

Choose a validated team from the request, authorize membership/resource access, and then pass its ID explicitly. The facade does not read ambient `Context`, does not switch the current team, and does not perform membership authorization. Missing/invalid IDs throw instead of selecting global access.

```typescript
import { Permissions } from '@beeblock/svelar/permissions';
import { Teams } from '@beeblock/svelar/teams';

// Inside a FormRequest or policy, after resolving the requested team:
if (!await Teams.isMember(team.id, user.id)) return false;
const grants = Permissions.forTeam(team.id);
return grants.modelHasPermission('User', user.id, 'boards.move-cards');
```

Use the same stable model type as the global `HasRoles` model (normally its class name). Seed or administer grants through the selected facade, using IDs from the shared catalogue:

```typescript
const grants = Permissions.forTeam(team.id);
await grants.assignRole('User', user.id, editor.id);
await grants.giveRolePermission(editor.id, moveCards.id);
await grants.giveModelPermission('User', user.id, exportBoards.id);

await grants.syncRoles('User', user.id, ['editor']);
await grants.syncPermissions('User', user.id, ['boards.export']);
await grants.syncRolePermissions(editor.id, ['boards.move-cards']);

await grants.revokeModelPermission('User', user.id, exportBoards.id);
await grants.removeRole('User', user.id, editor.id);
await grants.removeModelAssignments('User', user.id);
```

The assignment methods use the same signatures as global RBAC. Checks and sync methods accept a guard (default `web`). Role-permission links require matching guards. Role/direct-permission sync replaces only the selected scope and guard, rejects unknown names without deleting existing grants, and rolls back failed writes. `removeModelAssignments` atomically removes all roles and direct permissions for that model in the selected scope, across guards. Individual revocations are single atomic deletes. These operations do not modify another team or global grants.

Membership roles in `team_members.role` are not RBAC roles and are not converted automatically. Removing membership does not itself remove RBAC assignments: keep membership checks in policies/FormRequests and call `removeModelAssignments` when permanently clearing a user's team grants. Team deletion cascades team pivots; catalogue deletion removes links in every scope. The team facade cannot create/delete shared catalogue definitions.

Middleware remains global by default. For a team route, provide an explicit per-request resolver using a team already authorized by an earlier membership/resource check. A resolver returning `null`, `undefined`, or an invalid team ID denies with 403; it never falls back to global. Unauthenticated requests return 401.

```typescript
import { RequirePermissionMiddleware, RequireRoleMiddleware } from '@beeblock/svelar/permissions';

const scope = (ctx) => ctx.event.locals.authorizedTeam
  ? { teamId: ctx.event.locals.authorizedTeam.id }
  : null;

new RequirePermissionMiddleware('boards.move-cards', { scope });
new RequireRoleMiddleware('editor', { scope, guard: 'web' });
new RequirePermissionMiddleware('admin.manage', { scope: { global: true } });
```

#### Existing App Upgrade

New scaffolds include these additive core migrations:

| Migration | Export from `@beeblock/svelar/database` |
|-----------|----------------------------------------|
| `00000000_000031_create_team_role_has_permissions_table` | `CreateTeamRoleHasPermissionsTable` |
| `00000000_000032_create_team_model_has_roles_table` | `CreateTeamModelHasRolesTable` |
| `00000000_000033_create_team_model_has_permissions_table` | `CreateTeamModelHasPermissionsTable` |

Existing apps must add one app migration wrapper per exported class before using team grants. Use `npx svelar make:migration <name>` for each table, then replace the generated class with a wrapper like this (changing both class names for the other two tables):

```typescript
import { CreateTeamRoleHasPermissionsTable as CoreMigration } from '@beeblock/svelar/database';

export default class CreateTeamRoleHasPermissionsTable extends CoreMigration {}
```

Run `npx svelar migrate`. No runtime schema creation occurs. SQLite, PostgreSQL, and MySQL use non-null team IDs and composite primary keys including the team ID; foreign keys clean up team/catalogue deletions.

There is deliberately no automatic backfill from global assignments or membership role strings. Existing global records remain unchanged, and team pivots start empty. Seed explicit team grants after upgrading. Rolling back these three migrations drops only team grants and preserves global access.


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

### Compatible Transitive Overrides

The 0.8.0 candidate keeps SvelteKit 2 and ExcelJS 4.4 instead of accepting audit suggestions to upgrade Kit to 3 or downgrade ExcelJS to 3.4. Generated apps carry these narrowly scoped npm overrides:

```json
{
  "overrides": {
    "@sveltejs/kit": { "cookie": "^0.7.2" },
    "exceljs": { "uuid": "^11.1.1" },
    "esbuild@>=0.27.3 <0.28.1": "^0.28.2"
  }
}
```

- Cookie 0.7.2 retains Kit 2's parse/serialize APIs and rejects unsafe names, paths, and domains. See [GHSA-pxg6-pf52-xh8x](https://github.com/advisories/GHSA-pxg6-pf52-xh8x).
- UUID 11.1.1 fixes output-buffer bounds checks while preserving the CommonJS `require('uuid').v4()` API used by ExcelJS. Do not replace it with an ESM-only major without migrating the consumer. See [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq).
- The esbuild selector targets the affected Windows development-server versions. The repository separately pins its build tool through the existing `$esbuild` override. See [GHSA-g7r4-m6w7-qqqr](https://github.com/advisories/GHSA-g7r4-m6w7-qqqr).

Overrides must live in the consuming application's root `package.json`; an installed library cannot impose its own overrides on consumers. Existing apps must add the entries and refresh their lockfile. A manifest alone does not prove the dependency graph is patched: check `npm ls cookie uuid esbuild --all` and `npm audit`, including nested copies. Review a targeted lockfile diff and verify a clean `npm ci` before release rather than blindly regenerating the whole dependency graph.

Regression checks exercise real Kit session-cookie serialization and ExcelJS import/export, streaming, and UUID-backed conditional formatting. The high/critical release gate is not equivalent to a zero-finding full audit; audit the packed, installed application separately, and record its actual result.

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
