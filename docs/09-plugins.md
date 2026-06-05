# Plugins

Learn how to create and use plugins to extend Svelar's functionality.

## What are Plugins?

Plugins are modular, self-contained packages that extend Svelar. They can register services, add middleware, create CLI commands, define configuration, provide routes, and listen to events.

## Plugin Lifecycle

Plugins go through these lifecycle stages:

```
1. register(app)  - Register dependencies and configuration
   ↓
2. boot(app)      - Resolve dependencies and initialize
   ↓
3. shutdown()     - Clean up resources
```

All plugins are registered first, then all are booted — so during `boot()` you can safely access services registered by other plugins.

Enabled plugins are required infrastructure. If an enabled plugin package cannot be loaded, does not expose the required `./plugin` export, or fails during register/boot, app startup fails instead of continuing with a partially booted plugin set.

## Creating a Plugin

```bash
npx svelar make:plugin AnalyticsPlugin
```

This creates `src/lib/shared/plugins/AnalyticsPlugin.ts`:

```typescript
import { Plugin } from '@beeblock/svelar/plugins';
import type { Container } from '@beeblock/svelar/container';

export class AnalyticsPlugin extends Plugin {
  readonly name = 'svelar-analytics';
  readonly version = '1.0.0';
  description = 'Analytics tracking for Svelar apps';

  async register(app: Container): Promise<void> {
    // Register services, bindings, etc.
    app.singleton('analytics', () => new AnalyticsService());
  }

  async boot(app: Container): Promise<void> {
    // Initialize after all plugins registered
    console.log('[AnalyticsPlugin] Booted successfully');
  }

  async shutdown(): Promise<void> {
    // Clean up resources (no arguments)
    console.log('[AnalyticsPlugin] Shutting down');
  }
}
```

## Plugin Methods

### register(app)

Register bindings in the service container. Called before any plugin is booted:

```typescript
async register(app: Container): Promise<void> {
  // Register singleton service
  app.singleton('analytics', () => new AnalyticsService());
}
```

### boot(app)

Initialize after all plugins are registered. Safe to resolve services from other plugins:

```typescript
async boot(app: Container): Promise<void> {
  const analytics = app.make('analytics');
  const config = app.make('config').get('analytics');

  if (config.enabled) {
    analytics.init();
  }
}
```

### shutdown()

Clean up resources when the application shuts down. Takes no arguments:

```typescript
async shutdown(): Promise<void> {
  // Flush pending data, close connections, etc.
}
```

## Plugin Capabilities

### Configuration

Return a `PluginConfig` from the `config()` method to register default configuration:

```typescript
export class AnalyticsPlugin extends Plugin {
  readonly name = 'svelar-analytics';
  readonly version = '1.0.0';

  config() {
    return {
      key: 'analytics',
      defaults: {
        enabled: true,
        trackPageViews: true,
        trackQueryParams: false,
      },
    };
  }
}
```

Users override the defaults by creating a config file:

```typescript
// config/analytics.ts
export default {
  enabled: true,
  trackPageViews: true,
  trackErrors: false,
  samplingRate: 0.1,
};
```

### Middleware

Register middleware that runs on every request:

```typescript
export class AnalyticsPlugin extends Plugin {
  readonly name = 'svelar-analytics';
  readonly version = '1.0.0';

  middleware() {
    return [
      {
        name: 'track-views',
        handler: async (ctx: any, next: any) => {
          // Track page view
          console.log('Page visited:', ctx.event.url.pathname);
          return next();
        },
      },
    ];
  }
}
```

### Routes

Register custom API routes. Every route requires a `method`, `path`, and `handler`:

```typescript
export class AnalyticsPlugin extends Plugin {
  readonly name = 'svelar-analytics';
  readonly version = '1.0.0';

  routes() {
    return [
      {
        method: 'GET' as const,
        path: '/api/analytics/stats',
        handler: async (event: any) => {
          return new Response(JSON.stringify({ views: 42 }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        },
      },
    ];
  }
}
```

### Migrations

Return paths to database migration files the plugin provides:

```typescript
export class AnalyticsPlugin extends Plugin {
  readonly name = 'svelar-analytics';
  readonly version = '1.0.0';

  migrations() {
    return [
      './database/migrations/create_events_table.ts',
      './database/migrations/create_page_views_table.ts',
    ];
  }
}
```

### Commands

Register CLI commands. Each command is a `PluginCommand` object with `name`, `description`, and `handler`:

```typescript
export class AnalyticsPlugin extends Plugin {
  readonly name = 'svelar-analytics';
  readonly version = '1.0.0';

  commands() {
    return [
      {
        name: 'analytics:clear',
        description: 'Clear all tracked analytics events',
        handler: async (args: string[]) => {
          console.log('Clearing analytics...');
          // Clear stored events
        },
      },
      {
        name: 'analytics:report',
        description: 'Generate analytics report',
        handler: async (args: string[]) => {
          const days = parseInt(args[0] ?? '7');
          console.log(`Generating ${days}-day report...`);
        },
      },
    ];
  }
}
```

### Listeners

Register event listeners. Each listener has an `event` name and a `handler` function:

```typescript
export class AnalyticsPlugin extends Plugin {
  readonly name = 'svelar-analytics';
  readonly version = '1.0.0';

  listeners() {
    return [
      {
        event: 'user:registered',
        handler: async (user: any) => {
          console.log(`[Analytics] User signed up: ${user.id}`);
        },
      },
      {
        event: 'order:completed',
        handler: async (order: any) => {
          console.log(`[Analytics] Order completed: ${order.id}`);
        },
      },
    ];
  }
}
```

### Publishable Assets

Declare files that can be published to the user's app via `npx svelar plugin:publish`:

```typescript
export class AnalyticsPlugin extends Plugin {
  readonly name = 'svelar-analytics';
  readonly version = '1.0.0';

  publishables() {
    return {
      analytics: [
        { source: './config/analytics.ts', dest: 'config/analytics.ts', type: 'config' as const },
        { source: './migrations/create_events.ts', dest: 'src/lib/database/migrations/create_events.ts', type: 'migration' as const },
      ],
    };
  }
}
```

## Complete Plugin Example

```typescript
// src/lib/shared/plugins/AnalyticsPlugin.ts
import { Plugin } from '@beeblock/svelar/plugins';
import type { Container } from '@beeblock/svelar/container';

export class AnalyticsPlugin extends Plugin {
  readonly name = 'svelar-analytics';
  readonly version = '1.0.0';
  description = 'Simple analytics tracking for page views';

  private pageViews = new Map<string, number>();

  async register(app: Container): Promise<void> {
    app.instance('analytics', this);
  }

  async boot(app: Container): Promise<void> {
    console.log('[AnalyticsPlugin] Booted successfully');
  }

  track(path: string): void {
    const current = this.pageViews.get(path) ?? 0;
    this.pageViews.set(path, current + 1);
  }

  getStats(): Record<string, number> {
    return Object.fromEntries(this.pageViews);
  }

  config() {
    return {
      key: 'analytics',
      defaults: {
        enabled: true,
        trackQueryParams: false,
      },
    };
  }

  middleware() {
    return [
      {
        name: 'analytics',
        handler: async (ctx: any, next: any) => {
          this.track(ctx.event.url.pathname);
          return next();
        },
      },
    ];
  }

  routes() {
    return [
      {
        method: 'GET' as const,
        path: '/api/analytics/stats',
        handler: async () => {
          return new Response(JSON.stringify(this.getStats()), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        },
      },
    ];
  }

  commands() {
    return [
      {
        name: 'analytics:clear',
        description: 'Clear tracked page views',
        handler: async () => {
          this.pageViews.clear();
          console.log('Analytics cleared.');
        },
      },
    ];
  }
}
```

## Using Plugins

### Registering Plugins

Register plugins in your application bootstrap. `PluginManager` requires a `Container` instance:

```typescript
import { container } from '@beeblock/svelar/container';
import { PluginManager } from '@beeblock/svelar/plugins';
import { AnalyticsPlugin } from '$lib/shared/plugins/AnalyticsPlugin.js';
import { SeoPlugin } from '$lib/shared/plugins/SeoPlugin.js';

const pluginManager = new PluginManager(container);

pluginManager.use(new AnalyticsPlugin());
pluginManager.use(new SeoPlugin());

await pluginManager.boot();
```

You can also register multiple plugins at once:

```typescript
pluginManager.useMany([
  new AnalyticsPlugin(),
  new SeoPlugin(),
]);
```

### Auto-Discovery

Discover plugins from a directory using the standalone `discoverPlugins` function:

```typescript
import { container } from '@beeblock/svelar/container';
import { discoverPlugins, PluginManager } from '@beeblock/svelar/plugins';

const plugins = await discoverPlugins('./src/lib/shared/plugins');
const pluginManager = new PluginManager(container);
pluginManager.useMany(plugins);
await pluginManager.boot();
```

### Accessing Plugin Services

Access services registered by plugins through the container:

```typescript
import { container } from '@beeblock/svelar/container';

const analytics = container.make('analytics');
const stats = analytics.getStats();
```

### Plugin Hooks

The PluginManager provides a hook system for cross-plugin communication:

```typescript
// Register a hook listener
pluginManager.on('app:boot', async () => {
  console.log('All plugins booted');
});

// Custom hooks
pluginManager.on('analytics:reset', async () => {
  console.log('Analytics data was reset');
});

// Trigger a hook
await pluginManager.triggerHook('analytics:reset');
```

Built-in hooks: `app:boot`, `app:shutdown`, `request:before`, `request:after`, `model:creating`, `model:created`, `model:updating`, `model:updated`, `model:deleting`, `model:deleted`.

## Plugin Dependencies

Plugins can declare dependencies on other plugins. The PluginManager resolves load order automatically via topological sort and detects circular dependencies:

```typescript
export class ExtendedAnalyticsPlugin extends Plugin {
  readonly name = 'extended-analytics';
  readonly version = '1.0.0';
  readonly dependencies = ['svelar-analytics'];

  async boot(app: Container): Promise<void> {
    // Safe — svelar-analytics is guaranteed to be registered and booted first
    const analytics = app.make('analytics');
    console.log('Extending analytics with advanced tracking');
  }
}
```

## CLI Commands

### List Plugins

```bash
npx svelar plugin:list
```

Discovers installed plugins (packages matching `svelar-*` or `@scope/svelar-*`, or with `svelar-plugin` keyword in package.json) and shows their status.

### Install a Plugin

```bash
npx svelar plugin:install @beeblock/svelar-tags
```

Runs `npm install`, discovers the plugin, registers it, and publishes migrations/routes. Use `--no-publish` to skip asset publishing.

### Publish Plugin Assets

```bash
npx svelar plugin:publish @beeblock/svelar-tags
npx svelar plugin:publish @beeblock/svelar-tags --only migrations
npx svelar plugin:publish @beeblock/svelar-tags --force
```

Copies plugin's publishable files (config, migrations, route stubs) to your app. Use `--force` to overwrite existing files.

Publishing is strict: if a declared publishable source file cannot be copied, `plugin:publish` fails. `plugin:install` also fails when automatic publishing fails unless you pass `--no-publish`.

### Official Plugins

All official plugins support `plugin:install` and `plugin:publish`:

| Plugin | Migrations | Routes | Tables |
|--------|:----------:|:------:|--------|
| `@beeblock/svelar-tags` | Yes | Yes | `tags`, `taggables` |
| `@beeblock/svelar-comments` | Yes | Yes | `comments`, `comment_reactions` |
| `@beeblock/svelar-settings` | Yes | Yes | `settings` |
| `@beeblock/svelar-media` | Yes | Yes | `media` |
| `@beeblock/svelar-backup` | Yes | Yes | `backups` |
| `@beeblock/svelar-activity-log` | Yes | No | `activity_log` |
| `@beeblock/svelar-impersonate` | No | Yes | — |
| `@beeblock/svelar-datatable` | No | Yes | — |
| `@beeblock/svelar-charts` | No | Yes | — |
| `@beeblock/svelar-sitemap` | No | Yes | — |
| `@beeblock/svelar-social-auth` | No | Yes | — |
| `@beeblock/svelar-stripe` | Yes | Yes | `stripe` |
| `@beeblock/svelar-two-factor` | No | Yes | — |

## Creating a Reusable Plugin Package

Package a plugin for publishing to npm:

```
svelar-analytics/
├── src/
│   ├── index.ts              # Public client-safe exports
│   ├── plugin.ts             # Default export: the Plugin class
│   ├── AnalyticsService.ts
│   └── middleware/
│       └── TrackingMiddleware.ts
├── config/
│   └── analytics.ts          # Default config (publishable)
├── package.json
└── README.md
```

```json
{
  "name": "svelar-analytics",
  "version": "1.0.0",
  "keywords": ["svelar-plugin"],
  "main": "dist/index.js",
  "exports": {
    ".": "./dist/index.js",
    "./plugin": {
      "default": "./dist/plugin.js"
    }
  },
  "peerDependencies": {
    "@beeblock/svelar": ">=0.4.0"
  }
}
```

The `svelar-plugin` keyword in package.json allows `npx svelar plugin:list` to auto-discover your plugin when installed. Packages may use a `svelar-*` name or any package name with the `svelar-plugin` keyword. `plugin:install` and app bootstrap require the dedicated `./plugin` export so server-only plugin code does not leak through the public package barrel.

Users install and register:

```bash
npx svelar plugin:install svelar-analytics
```

```typescript
import { AnalyticsPlugin } from 'svelar-analytics';

pluginManager.use(new AnalyticsPlugin());
```

## Best Practices

1. **One responsibility per plugin** — plugins should do one thing well
2. **Provide sensible defaults** — `config()` should return working defaults
3. **Use dependency declarations** — declare `dependencies` instead of hoping plugins load in order
4. **Clean up in shutdown()** — flush buffers, close connections, release resources
5. **Use clear naming** — prefix with `svelar-` for published packages
6. **Add `svelar-plugin` keyword** — enables auto-discovery via `plugin:list`
7. **Version your plugins** — use semantic versioning
8. **Handle missing dependencies** — check before accessing optional services

## Next Steps

- Learn about [Middleware](./07-middleware.md) to extend request handling
- Explore [Events & Listeners](./23-events.md) for event-driven architecture
- Check [Architecture & Modules](./20-architecture.md) for design patterns
- See [HTTP & Integrations](./14-http.md) for creating custom service integrations

---

**Svelar Plugins Guide** © 2026
