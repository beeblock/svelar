# Svelar — Development Guidelines

## Project Structure

Monorepo with packages:
- `packages/svelar` — Core framework (Laravel-inspired on SvelteKit 2)
- `packages/create-svelar` — `npx create-svelar` scaffolding

## Build & Run

```bash
# Build the core framework (must do after any change to packages/svelar)
cd packages/svelar && npm run build

# Test with a scaffolded app
npx svelar new test-app
cd test-app && npm run dev
```

## Svelte 5 Rules

- **No JSDoc block comments (`/** */`) inside `<script>` blocks** in `.svelte` files. Use `//` line comments only.
- Use Svelte 5 runes: `$state`, `$derived`, `$props`, `$effect`, `onMount`.
- Use `{@render children()}` instead of `<slot />`.
- Use `interface Props` with `$props()` for component props.
- Use `type { Snippet }` from svelte for slot-like children.

## Svelar UI Components (`packages/svelar/src/ui/`)

- Components are shipped as `.svelte` source (not compiled).
- **Do NOT use `$state` runes in `.ts` files inside `packages/svelar`** — they won't be compiled by the Svelte compiler when consumed by apps. Use callback/subscriber patterns instead. `$state` in `.svelte` files is fine.
- Icon support: use `<Icon icon={LucideComponent} />` with `lucide-svelte` or `@tabler/icons-svelte` as optional peer deps.
- **Always import lucide icons individually**: `import Users from 'lucide-svelte/icons/users'` — never use the barrel export `from 'lucide-svelte'` (causes SSR module resolution errors).

## Vite Aliases (Scaffolded Projects)

Scaffolded projects resolve `@beeblock/svelar/*` imports via the `exports` field in package.json. When adding a new svelar subpath:
1. Add the export in `packages/svelar/package.json` (`exports` field)
2. Add the tsup entry in `packages/svelar/tsup.config.ts`
3. Update the `viteConfig()` template in `NewCommandTemplates.ts`
4. UI/Svelte components point to `src/` (source), everything else points to `dist/` (built)

## CLI & Scheduler (`packages/svelar/src/cli/`)

- The CLI binary registers a TS resolve hook (`ts-resolve-hook.mjs`) so user `.ts` files can be dynamically imported.
- Scheduled tasks: one class per file in `src/lib/scheduler/`, each with a `default export` extending `ScheduledTask`.
- The hook rewrites `.js` → `.ts` for relative imports. Use `.ts` extensions in files that the CLI loads.

## Sessions

- Sessions use `DatabaseSessionStore` (SQLite) — not `MemorySessionStore` — so sessions persist across server restarts.
- The sessions table must exist (`npx svelar migrate`).

## Broadcasting (SSE)

- `Broadcast` is a singleton via `Symbol.for()` on `globalThis` — same instance across all imports.
- The scheduler runs in a separate process. To send SSE events, it POSTs to `/api/internal/broadcast` (internal HTTP bridge).
- CSRF is excluded for `/api/internal/` paths.

## Permissions

- Spatie-inspired: `PermissionManager`, `HasRoles` mixin, pivot tables.
- Admin API routes at `/api/admin/roles`, `/api/admin/permissions`, etc.

## i18n

- Paraglide with `$lib/paraglide/messages` for translations.
- Three locales: `en`, `pt`, `es`. Message files in `messages/*.json`.
- Always add translations to all three locale files when adding new messages.

## Code Style

- No emojis in code unless explicitly requested.
- No trailing summaries after completing work.
- Keep solutions simple — no over-engineering.
- Prefer editing existing files over creating new ones.
