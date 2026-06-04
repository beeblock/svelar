# Svelar — Development Guidelines

## Project Structure

Monorepo with packages:
- `packages/svelar` — Core framework (Laravel-inspired on SvelteKit 2)
- Project scaffolding is part of core through `npx svelar new`

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

## CSRF

- Svelar uses double-submit cookie pattern: cookie `XSRF-TOKEN` (readable by JS) + header `X-CSRF-Token`.
- **NEVER disable CSRF by adding paths to `csrfExcludePaths`** as a fix. That is a security hole, not a solution.
- Use `apiFetch()` from `@beeblock/svelar/http` for client-side API calls — it reads the CSRF cookie and sets the header automatically.
- Alternatively, read the token manually: `getCsrfToken()` from `@beeblock/svelar/http` and set `X-CSRF-Token` header.
- Requests with `Authorization: Bearer ...` header are exempt from CSRF (API key/JWT auth).

## Building Svelar Plugins (`packages/svelar-*`)

Plugins are separate npm packages in the monorepo. Every plugin MUST follow these conventions — no exceptions.

### Package Structure

```
packages/svelar-{name}/
├── package.json          # name: @beeblock/svelar-{name}, exports: ., ./plugin, ./server, ./types
├── tsconfig.json
├── tsup.config.ts        # entry: index, plugin, types, server/index — externalize all @beeblock/svelar/*, node:*
├── src/
│   ├── index.ts          # client-safe barrel (stores, types, services — NO node: imports, NO Plugin class)
│   ├── plugin.ts          # server-only entry: default export of Plugin class (for plugin:install discovery)
│   ├── types.ts          # interfaces + Zod schemas
│   ├── server/
│   │   └── index.ts      # barrel for controllers, form requests, resources
│   └── publishable/      # files copied into user projects on plugin:install
│       ├── migrations/
│       └── routes/
```

### UI Component Exports (CRITICAL for plugins with Svelte components)

Plugins that ship `.svelte` source files MUST use `svelte` + `import` export conditions in `package.json`. A bare string (`"./ui": "./src/ui/index.ts"`) will NOT work when installed from npm — SvelteKit's Vite plugin needs the `svelte` condition to process the files.

```json
{
  "svelte": "./src/ui/index.ts",
  "exports": {
    "./ui": {
      "types": "./src/ui/index.ts",
      "svelte": "./src/ui/index.ts",
      "import": "./src/ui/index.ts"
    },
    "./ui/*": {
      "svelte": "./src/ui/*",
      "import": "./src/ui/*"
    }
  },
  "files": ["dist", "src/ui", "src/state", "src/export", "src/types.ts", "src/index.ts", "src/publishable"]
}
```

**CRITICAL**: The `files` field MUST include ALL source directories and files that UI components transitively import from via relative paths (e.g., `../state/`, `../export/`, `../types.js`). Only `src/ui/` is not enough — if Svelte components use `import { Store } from '../state/Store.js'`, then `src/state/` must also be in `files`. Verify by tracing every `../` import from `src/ui/` and its dependencies. Missing entries work with local `file:` installs but break on npm registry installs.

**CRITICAL**: Relative imports in `.svelte` files MUST use `.ts` extensions (e.g., `from '../state/DataTableStore.ts'`), NOT `.js`. Vite does NOT resolve `.js` → `.ts` for files inside `node_modules`. The `.ts` source files themselves should keep `.js` extensions (required by tsc). Only `.svelte` files need `.ts` import paths.

**Testing before publish**: Always run `npm pack` then `npm install /path/to/tarball.tgz` in a test app to simulate a real npm registry install before publishing. This catches `files` field omissions and import resolution issues that `file:` installs mask.

Match the pattern used by `@beeblock/svelar` core's `./ui` export. Without the `svelte` export condition, local `file:` installs work but npm registry installs break.

### Plugin Class (CRITICAL)

- MUST extend `Plugin` from `@beeblock/svelar/plugins`
- MUST live in a **separate `src/plugin.ts` entry** — NOT in `index.ts`. The main barrel is reachable from client bundles, and `node:url`/`node:path` (needed for `publishables()`) crash in the browser. The plugin system loads from `packageName/plugin` first.
- `src/plugin.ts` does: `import { MyPlugin } from './MyPlugin.js'; export default MyPlugin; export { MyPlugin };`
- Add `plugin` as a tsup entry and `./plugin` to package.json exports
- `publishables()` MUST be **sync** (not async) — returns `{ migrations: [...], routes: [...] }`
- Path resolution: use top-level `dirname(fileURLToPath(import.meta.url))` to find `src/publishable/` relative to `dist/`
- **NEVER export the Plugin class from the main `index.ts`** — that pulls `node:` imports into client bundles
- Each publishable entry: `{ source: absolutePath, dest: relativePathInProject, type: 'migration' | 'asset' }`

```typescript
import { Plugin } from '@beeblock/svelar/plugins';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const distDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = dirname(distDir);
const pub = join(packageRoot, 'src', 'publishable');

export class MyPlugin extends Plugin {
  readonly name = 'svelar-myplugin';
  readonly version = '0.1.0';
  readonly description = '...';

  publishables() {
    return {
      migrations: [
        { source: join(pub, 'migrations/create_foo.ts'), dest: 'src/lib/database/migrations/create_foo.ts', type: 'migration' as const },
      ],
      routes: [
        { source: join(pub, 'routes/foo-webhook.ts'), dest: 'src/routes/api/webhooks/foo/+server.ts', type: 'asset' as const },
      ],
    };
  }
}
```

### Models — ALWAYS extend `Model`

- Import from `@beeblock/svelar/orm`
- **NEVER use `Connection.raw()` for CRUD** — use Model static/instance methods
- Required statics: `table`, `fillable`, `timestamps`
- `casts` type MUST be `Record<string, 'string' | 'number' | 'boolean' | 'date' | 'json'>` — not `Record<string, string>`
- Model uses Proxy for attribute access — TS doesn't know dynamic attrs, use `(instance as any).myField`
- No static `update(id, data)` — use `const record = await Model.find(id); await record.update(data);`
- Query methods: `Model.find(id)`, `Model.where(col, val).first()`, `Model.where(col, val).get()`, `Model.create(data)`
- Instance methods: `record.update(data)`, `record.delete()`
- Chain: `.where()`, `.whereNull()`, `.whereNotNull()`, `.orderBy()`, `.limit()`

### Controllers — ALWAYS extend `Controller`

- Import from `@beeblock/svelar/routing`
- Use `.handle('methodName')` to create SvelteKit request handlers
- Use `this.json(data, status)`, `this.noContent()`, `this.created(data)`
- Use `this.validate(event, schema)` or FormRequest classes for validation
- Auto error handling: ValidationError→422, NotFoundError→404, UnauthorizedError→401, ForbiddenError→403

### Resources — ALWAYS extend `Resource<TModel, TShape>`

- Import from `@beeblock/svelar/routing`
- Implement `toJSON(): TShape` — return a plain object with the shape
- Static helpers: `Resource.make(model)`, `Resource.collection(models)`, `Resource.paginate(result)`
- Response: `.toResponse()`, `.status(code)`, `.additional(data)`, `.with(extra)`

### Form Requests — ALWAYS extend `FormRequest`

- Import from `@beeblock/svelar/routing`
- Implement `rules()` — return a Zod schema
- Optional `authorize(event)` for auth checks
- Usage: `const data = await MyRequest.validate(event)`

### Logging — ALWAYS use `Log` with per-plugin toggle

- Import from `@beeblock/svelar/logging`
- **NEVER use `console.log`, `console.error`, etc.**
- `Log.info(message, context)`, `Log.error(message, context)` where context is `Record<string, any>`
- For errors: `Log.error('msg', { error: err.message, stack: err.stack })` — NOT `Log.error('msg', err)`
- Every plugin that logs MUST support a `logging: boolean` config option (default `true`)
- Guard every `Log.*` call: `if (Manager.logging) { Log.info(...); }`
- This lets users disable plugin-specific logs without touching global log config

### Singleton Pattern

```typescript
const KEY = Symbol.for('svelar.myplugin');
const g = globalThis as any;
if (!g[KEY]) g[KEY] = new MyManager();
export const MyPlugin: MyManager = g[KEY];
```

### Polymorphic Patterns (for multi-model support)

- Use `billable_type` + `billable_id` columns (not `user_id`)
- Maintain a model registry on the manager: `registerBillable(Model)` maps `Model.table` → Model class
- Resolve models at runtime: `getBillableModel(tableName)` — throws if not registered
- Race-safe updates: `Model.where('id', id).whereNull('field').update({ field: value })` returns affected count

### Plugin Install Flow

`npx svelar plugin:install @beeblock/svelar-{name}` does:
1. `npm install @beeblock/svelar-{name}`
2. `PluginRegistry.discover()` — imports the package, reads `mod.default` (the Plugin class)
3. `registry.enable(name)` — adds to `svelar.plugins.json`
4. `PluginPublisher.publish()` — calls `publishables()`, copies files to user project

### Checklist Before Shipping a Plugin

- [ ] Plugin class extends `Plugin`, is default-exported
- [ ] `publishables()` is sync, paths resolve from dist/ to src/publishable/
- [ ] All models extend `Model` — zero `Connection.raw()`
- [ ] All controllers extend `Controller`
- [ ] All resources extend `Resource<T, S>`
- [ ] All form requests extend `FormRequest`
- [ ] All logging uses `Log` — zero `console.*`
- [ ] `npm run build` succeeds in plugin package
- [ ] `npm run build` succeeds in svelar core (no dangling imports)
- [ ] Docs updated in both `docs/` and `svelar-site/docs/`
- [ ] Search index in `svelar-site/src/routes/api/search/+server.ts` includes new pages
- [ ] `svelar-site/src/lib/docs.ts` has correct section (Official Plugins, not Features)
- [ ] Homepage features array does NOT list plugin as core feature
- [ ] CHANGELOG.md updated
- [ ] README.md updated

## Code Style

- No emojis in code unless explicitly requested.
- No trailing summaries after completing work.
- **ALWAYS propose production-grade fixes. Never take shortcuts that weaken security, disable protections, or bypass validation.**
- Keep solutions simple — no over-engineering.
- Prefer editing existing files over creating new ones.
