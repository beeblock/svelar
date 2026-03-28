# Plugins

Learn how to create and use plugins to extend Svelar's functionality.

## What are Plugins?

Plugins are modular, self-contained packages that extend Svelar. They can register routes, add middleware, create commands, define configurations, and more.

## Plugin Lifecycle

Plugins go through these lifecycle stages:

```
1. register()  - Register dependencies and configuration
   ↓
2. boot()      - Resolve dependencies and initialize
   ↓
3. shutdown()  - Clean up resources
```

## Creating a Plugin

```bash
npx svelar make:plugin AnalyticsPlugin
```

This creates `src/lib/plugins/AnalyticsPlugin.ts`:

```typescript
import { Plugin } from '@beeblock/svelar/plugins';
import type { Container } from '@beeblock/svelar/container';

export class AnalyticsPlugin extends Plugin {
  readonly name = 'svelar-analytics';
  readonly version = '1.0.0';
  description = 'Analytics tracking for Svelar apps';

  async register(app: Container): Promise<void> {
    // Register services, commands, config, etc.
    app.singleton('analytics', () => new AnalyticsService());
  }

  async boot(app: Container): Promise<void> {
    // Initialize after all plugins registered
    console.log('[AnalyticsPlugin] Booted successfully');
  }

  async shutdown(app: Container): Promise<void> {
    // Clean up resources
    console.log('[AnalyticsPlugin] Shutting down');
  }
}
```

## Plugin Methods

### register()

Register bindings in the service container:

```typescript
async register(app: Container): Promise<void> {
  // Register singleton service
  app.singleton('analytics', () => new AnalyticsService());

  // Register configuration
  this.publishConfig({
    key: 'analytics',
    defaults: {
      enabled: true,
      trackPageViews: true,
    },
  });

  // Register a command
  app.bind('commands', (commands) => {
    commands.push(new AnalyticsCommand());
    return commands;
  });
}
```

### boot()

Initialize after all plugins are registered:

```typescript
async boot(app: Container): Promise<void> {
  const analytics = app.make('analytics');
  const config = app.make('config').get('analytics');

  if (config.enabled) {
    console.log('[AnalyticsPlugin] Starting tracking');
    analytics.init();
  }
}
```

### shutdown()

Clean up resources when shutting down:

```typescript
async shutdown(app: Container): Promise<void> {
  const analytics = app.make('analytics');
  await analytics.flush();
  console.log('[AnalyticsPlugin] Flushed events');
}
```

## Plugin Capabilities

### Middleware

Register middleware that runs on every request:

```typescript
export class AnalyticsPlugin extends Plugin {
  middleware() {
    return [
      {
        name: 'track-views',
        handler: async (ctx: any, next: any) => {
          const analytics = ctx.event.app.make('analytics');
          analytics.track(ctx.event.url.pathname);
          return next();
        },
      },
    ];
  }
}
```

### Routes

Register custom routes:

```typescript
export class AnalyticsPlugin extends Plugin {
  routes() {
    return [
      {
        path: '/api/analytics/stats',
        handler: async (event: any) => {
          const analytics = event.app.make('analytics');
          return new Response(JSON.stringify(analytics.getStats()), {
            headers: { 'Content-Type': 'application/json' },
          });
        },
      },
    ];
  }
}
```

### Configuration

Register configuration that can be published:

```typescript
export class AnalyticsPlugin extends Plugin {
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

### Migrations

Register database migrations:

```typescript
export class AnalyticsPlugin extends Plugin {
  migrations() {
    return [
      './database/migrations/create_events_table.ts',
      './database/migrations/create_page_views_table.ts',
    ];
  }
}
```

### Commands

Register CLI commands:

```typescript
export class AnalyticsPlugin extends Plugin {
  commands() {
    return [
      new ClearEventsCommand(),
      new GenerateReportCommand(),
    ];
  }
}
```

### Listeners

Register event listeners:

```typescript
export class AnalyticsPlugin extends Plugin {
  listeners() {
    return [
      {
        event: 'user:registered',
        listener: async (user: User) => {
          const analytics = app.make('analytics');
          analytics.trackEvent('user_signup', { user_id: user.id });
        },
      },
    ];
  }
}
```

## Complete Plugin Example

Here's the analytics plugin from the svelar-example:

```typescript
// src/lib/plugins/AnalyticsPlugin.ts
import { Plugin } from '@beeblock/svelar/plugins';
import type { Container } from '@beeblock/svelar/container';

/**
 * Analytics Plugin
 *
 * Tracks page views and provides analytics data.
 * In production, integrate with a real analytics service.
 */
export class AnalyticsPlugin extends Plugin {
  readonly name = 'svelar-analytics';
  readonly version = '1.0.0';
  description = 'Simple analytics tracking for page views';

  private pageViews = new Map<string, number>();

  async register(app: Container): Promise<void> {
    // Register the analytics tracker as a singleton
    app.instance('analytics', this);
  }

  async boot(app: Container): Promise<void> {
    console.log('[AnalyticsPlugin] Booted successfully');
  }

  /**
   * Track a page view
   */
  track(path: string): void {
    const current = this.pageViews.get(path) ?? 0;
    this.pageViews.set(path, current + 1);
  }

  /**
   * Get analytics statistics
   */
  getStats(): Record<string, number> {
    return Object.fromEntries(this.pageViews);
  }

  /**
   * Register middleware for tracking
   */
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

  /**
   * Register configuration
   */
  config() {
    return {
      key: 'analytics',
      defaults: {
        enabled: true,
        trackQueryParams: false,
      },
    };
  }

  /**
   * Provide a stats API endpoint
   */
  routes() {
    return [
      {
        path: '/api/analytics/stats',
        handler: async (event: any) => {
          return new Response(JSON.stringify(this.getStats()), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        },
      },
    ];
  }
}
```

## Using Plugins

### Registering Plugins

Register plugins in your application:

```typescript
import { PluginManager } from '@beeblock/svelar/plugins';
import { AnalyticsPlugin } from './lib/plugins/AnalyticsPlugin.js';
import { SeoPlugin } from './lib/plugins/SeoPlugin.js';

const pluginManager = new PluginManager();

pluginManager.use(new AnalyticsPlugin());
pluginManager.use(new SeoPlugin());

await pluginManager.boot();
```

### Auto-Discovery

Or let plugins auto-discover:

```typescript
const pluginManager = new PluginManager();

await pluginManager.discoverPlugins('./src/lib/plugins');
await pluginManager.boot();
```

### Accessing Plugin Services

Access plugin services from the container:

```typescript
// In controllers
export class StatsController extends Controller {
  async index(event: any) {
    const analytics = event.app.make('analytics');
    const stats = analytics.getStats();

    return this.json(stats);
  }
}

// In middleware
export class TrackingMiddleware extends Middleware {
  async handle(ctx: MiddlewareContext, next: NextFunction) {
    const analytics = ctx.event.app.make('analytics');
    analytics.track(ctx.event.url.pathname);
    return next();
  }
}
```

## Plugin Configuration

### Publishing Configuration

Plugins can publish configuration files for users to customize:

```typescript
export class AnalyticsPlugin extends Plugin {
  async register(app: Container): Promise<void> {
    this.publishConfig({
      key: 'analytics',
      defaults: {
        enabled: true,
        trackPageViews: true,
        trackErrors: true,
        samplingRate: 1.0,
      },
    });
  }
}
```

Users can then override in their config:

```typescript
// config/analytics.ts
export default {
  enabled: true,
  trackPageViews: true,
  trackErrors: false,
  samplingRate: 0.1,
};
```

## Plugin Dependencies

Plugins can depend on other plugins:

```typescript
export class ExtendedAnalyticsPlugin extends Plugin {
  readonly name = 'extended-analytics';
  readonly dependencies = ['svelar-analytics'];

  async register(app: Container): Promise<void> {
    // This plugin requires AnalyticsPlugin to be registered first
    const analytics = app.make('analytics');
    app.bind('extended-analytics', () => new ExtendedAnalyticsService(analytics));
  }
}
```

## Creating a Reusable Plugin Package

Package a plugin for publishing to npm:

```
my-plugin/
├── src/
│   ├── AnalyticsPlugin.ts
│   ├── services/
│   │   └── AnalyticsService.ts
│   ├── middleware/
│   │   └── TrackingMiddleware.ts
│   └── commands/
│       └── GenerateReportCommand.ts
├── package.json
└── README.md
```

```json
{
  "name": "@myorg/svelar-analytics",
  "version": "1.0.0",
  "main": "dist/AnalyticsPlugin.js",
  "exports": {
    ".": "./dist/AnalyticsPlugin.js",
    "./service": "./dist/services/AnalyticsService.js"
  }
}
```

Users install and register:

```bash
npm install @myorg/svelar-analytics
```

```typescript
import { AnalyticsPlugin } from '@myorg/svelar-analytics';

pluginManager.use(new AnalyticsPlugin());
```

## Best Practices

1. **One responsibility per plugin** - Plugins should do one thing well
2. **Use clear naming** - Plugin names should clearly indicate purpose
3. **Document thoroughly** - Explain what the plugin does and how to use it
4. **Provide sensible defaults** - Configuration should work out of the box
5. **Use lifecycle hooks** - Clean up resources in shutdown()
6. **Version your plugins** - Use semantic versioning
7. **Test plugins** - Write tests for plugin functionality
8. **Handle missing dependencies** - Gracefully handle missing required services

## Next Steps

- Learn [Middleware](./07-middleware.md) to extend request handling
- Explore [Events](./12-additional-features.md) for event-driven architecture
- Check [Architecture](./README.md) for design patterns

---

**Svelar Plugins Guide** © 2026
