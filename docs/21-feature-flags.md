# Feature Flags

Database-backed feature flags with per-user, per-team, and percentage rollout support.

## What Are Feature Flags?

Feature flags let you turn features on or off without deploying new code. Use them to:

- **Gradual rollouts** — ship to 5% of users, then 20%, then 100%
- **Beta testing** — enable a feature for specific users or teams
- **Kill switches** — instantly disable a broken feature in production
- **A/B testing** — show different experiences to different segments
- **Enterprise features** — unlock paid features per-team

## Setup

```typescript
// src/app.ts
import { Features } from '@beeblock/svelar/feature-flags';

Features.configure({ driver: 'database' });
```

Tables (`feature_flags` and `feature_flag_overrides`) are managed by Svelar core migrations. Supports SQLite, PostgreSQL, and MySQL.

For development or testing, use the in-memory driver:

```typescript
Features.configure({ driver: 'memory' });
```

## Defining Flags

Define flags in `src/app.ts` (or wherever you bootstrap). Safe to call multiple times — existing flags are updated, not duplicated:

```typescript
import { Features } from '@beeblock/svelar/feature-flags';

// Simple on/off flag (disabled by default)
await Features.define('new-dashboard', {
  description: 'Redesigned dashboard UI',
});

// Flag enabled by default
await Features.define('dark-mode', {
  description: 'Dark mode theme',
  enabled: true,
});

// Percentage rollout — 20% of users see this
await Features.define('beta-api', {
  description: 'API v2 with new response format',
  percentage: 20,
});
```

## Checking Flags

### Global Check

```typescript
if (await Features.enabled('new-dashboard')) {
  // Feature is globally enabled
}
```

### Per-User Check

Resolution order: **user override > percentage rollout > global state**.

```typescript
// In a +page.server.ts or API route
const user = event.locals.user;

if (await Features.enabledFor('beta-api', user.id)) {
  // This user gets the beta API
  return json(newApiResponse);
}

// Fallback to old API
return json(oldApiResponse);
```

### Per-Team Check

Resolution order: **team override > percentage rollout > global state**.

```typescript
import { Teams } from '@beeblock/svelar/teams';

const teams = await Teams.getUserTeams(user.id);
const currentTeam = teams[0];

if (await Features.enabledForTeam('enterprise-sso', currentTeam.id)) {
  // This team has SSO enabled
}
```

## Enabling & Disabling

### Global

```typescript
// Turn on for everyone
await Features.enable('new-dashboard');

// Turn off for everyone
await Features.disable('new-dashboard');
```

### Per-User Overrides

```typescript
// Force-enable for a beta tester (overrides percentage and global state)
await Features.enableFor('beta-api', userId);

// Force-disable for a user reporting bugs
await Features.disableFor('beta-api', userId);

// Remove the override (user falls back to percentage/global)
await Features.removeOverride('beta-api', 'user', userId);
```

### Per-Team Overrides

```typescript
// Enable an enterprise feature for a paying team
await Features.enableForTeam('enterprise-sso', teamId);

// Disable for a team
await Features.disableForTeam('enterprise-sso', teamId);

// Remove override
await Features.removeOverride('enterprise-sso', 'team', teamId);
```

## Percentage Rollouts

When a flag has a `percentage`, the check is **deterministic** — the same user always gets the same result. This uses consistent hashing on `flagName + userId`, so:

- User A might be in the 20% bucket for `beta-api` but not for `new-ui`
- The result is stable across requests (no flickering)
- Increasing the percentage from 20% to 40% adds new users without removing existing ones

```typescript
// Enable for 10% of users
await Features.define('experimental-search', {
  description: 'New search algorithm',
  percentage: 10,
});

// Ramp up to 50%
await Features.updateFlag('experimental-search', { percentage: 50 });

// Full rollout
await Features.updateFlag('experimental-search', { percentage: 100 });
// Or just enable globally:
await Features.enable('experimental-search');
```

## Managing Flags

### List All Flags

```typescript
const flags = await Features.allFlags();
// [{ name, description, enabled, percentage, createdAt, updatedAt }, ...]
```

### Update a Flag

```typescript
await Features.updateFlag('beta-api', {
  description: 'Updated description',
  percentage: 50,
  metadata: { owner: 'backend-team', ticket: 'PROJ-123' },
});
```

### Delete a Flag

Removes the flag and all its overrides:

```typescript
await Features.deleteFlag('old-experiment');
```

### List Overrides

```typescript
const overrides = await Features.getOverrides('beta-api');
// [{ flagName, scopeType: 'user'|'team', scopeId, enabled, createdAt }, ...]
```

## Usage in Svelte Pages

Pass flags from `+page.server.ts` to the page:

```typescript
// src/routes/dashboard/+page.server.ts
import { Features } from '@beeblock/svelar/feature-flags';

export async function load({ locals }) {
  const user = locals.user;

  return {
    showNewDashboard: await Features.enabledFor('new-dashboard', user.id),
    showBetaSearch: await Features.enabledFor('beta-search', user.id),
  };
}
```

```svelte
<!-- src/routes/dashboard/+page.svelte -->
<script>
  let { data } = $props();
</script>

{#if data.showNewDashboard}
  <NewDashboard />
{:else}
  <ClassicDashboard />
{/if}
```

## Admin API Example

Build an admin API to manage flags from your admin panel:

```typescript
// src/routes/api/admin/feature-flags/+server.ts
import { Features } from '@beeblock/svelar/feature-flags';
import { json, error } from '@sveltejs/kit';

export async function GET({ locals }) {
  if (locals.user?.role !== 'admin') throw error(403);
  const flags = await Features.allFlags();
  return json(flags);
}

export async function POST({ request, locals }) {
  if (locals.user?.role !== 'admin') throw error(403);
  const { name, description, enabled, percentage } = await request.json();
  const flag = await Features.define(name, { description, enabled, percentage });
  return json(flag, { status: 201 });
}

export async function PUT({ request, locals }) {
  if (locals.user?.role !== 'admin') throw error(403);
  const { name, enabled, percentage } = await request.json();
  const flag = await Features.updateFlag(name, { enabled, percentage });
  if (!flag) throw error(404, 'Flag not found');
  return json(flag);
}

export async function DELETE({ request, locals }) {
  if (locals.user?.role !== 'admin') throw error(403);
  const { name } = await request.json();
  await Features.deleteFlag(name);
  return json({ ok: true });
}
```

## Configuration Reference

```typescript
Features.configure({
  driver: 'database',        // 'database' or 'memory'
  table: 'feature_flags',    // custom table name (default: feature_flags)
  overridesTable: 'feature_flag_overrides', // custom overrides table name
});
```

## API Reference

| Method | Description |
|--------|-------------|
| `Features.configure(config)` | Set driver and table names |
| `Features.define(name, opts?)` | Create or update a flag |
| `Features.enabled(name)` | Check global flag state |
| `Features.enabledFor(name, userId)` | Check flag for a user (override > percentage > global) |
| `Features.enabledForTeam(name, teamId)` | Check flag for a team |
| `Features.enable(name)` | Globally enable a flag |
| `Features.disable(name)` | Globally disable a flag |
| `Features.enableFor(name, userId)` | Force-enable for a user |
| `Features.disableFor(name, userId)` | Force-disable for a user |
| `Features.enableForTeam(name, teamId)` | Force-enable for a team |
| `Features.disableForTeam(name, teamId)` | Force-disable for a team |
| `Features.removeOverride(name, scope, id)` | Remove a specific override |
| `Features.allFlags()` | List all defined flags |
| `Features.getFlag(name)` | Get a single flag |
| `Features.updateFlag(name, data)` | Update flag properties |
| `Features.deleteFlag(name)` | Delete a flag and its overrides |
| `Features.getOverrides(name)` | List all overrides for a flag |

## Best Practices

1. **Define all flags at startup** — Call `Features.define()` in `app.ts` so flags exist before any checks
2. **Use descriptive names** — `new-checkout-flow` not `flag1`
3. **Clean up old flags** — Delete flags after full rollout to avoid bloat
4. **Start with low percentages** — Ramp up gradually: 5% -> 20% -> 50% -> 100%
5. **Use overrides for testing** — Force-enable on staging/dev users before rolling out
6. **Add metadata** — Track who owns each flag and the related ticket
7. **Use the database driver in production** — The memory driver loses state on restart

## Next Steps

- [Teams](./12-additional-features.md) — Multi-tenancy for team-scoped flags
- [SaaS Guide](./17-saas-guide.md) — Full SaaS architecture overview
- [Authentication](./06-authentication.md) — User identification for per-user flags

---

**Svelar Feature Flags Guide** &copy; 2026
