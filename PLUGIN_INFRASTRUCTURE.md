# Svelar Plugin Infrastructure

This document outlines the newly implemented plugin infrastructure for the Svelar framework.

## Overview

The plugin infrastructure provides a comprehensive system for discovering, installing, managing, and bootstrapping plugins in Svelar applications. It includes:

- **PluginRegistry** — Discovers and tracks installed plugins
- **PluginPublisher** — Publishes plugin assets (configs, migrations)
- **PluginInstaller** — Installs plugins from npm and wires them up
- **BootstrapPlugins** — Auto-discovers and boots plugins at startup
- **CLI Commands** — Tools for managing plugins via command line

## Architecture

### Core Services

All core services use the singleton pattern to ensure a single instance across the entire application.

#### PluginRegistry

Discovers plugins by scanning `node_modules` for packages matching either:
- Name pattern: `svelar-*` (e.g., `svelar-stripe`)
- Keyword: `svelar-plugin` in package.json

```typescript
import { PluginRegistry } from 'svelar/plugins/PluginRegistry';

const registry = PluginRegistry;
await registry.discover();

const plugins = registry.list();
const enabledPlugins = registry.listEnabled();

registry.enable('svelar-stripe');
registry.disable('svelar-stripe');
```

#### PluginPublisher

Publishes plugin assets (config files, migrations, assets) to the user's application.

```typescript
import { PluginPublisher } from 'svelar/plugins/PluginPublisher';

const publisher = PluginPublisher;
const result = await publisher.publish(pluginInstance, {
  force: false,      // Overwrite existing files
  only: 'config'     // Or 'migrations', 'assets'
});

// Preview without publishing
const preview = await publisher.preview(pluginInstance);
```

#### PluginInstaller

Installs plugins from npm and registers them.

```typescript
import { PluginInstaller } from 'svelar/plugins/PluginInstaller';

const installer = PluginInstaller;
const result = await installer.install('svelar-stripe', {
  publish: true  // Auto-publish assets after install
});

if (result.success) {
  console.log(`Installed ${result.pluginName} v${result.version}`);
}
```

#### BootstrapPlugins

Auto-discovers enabled plugins and boots them at application startup, respecting dependency order.

```typescript
import { bootstrapPlugins } from 'svelar/plugins';
import { app } from './app';

// Auto-discover and boot enabled plugins
await bootstrapPlugins(app);

// Or specify explicit plugin list
await bootstrapPlugins(app, ['svelar-stripe', 'svelar-analytics']);
```

## CLI Commands

Three new CLI commands are available:

### plugin:list

Lists all discovered and enabled plugins with metadata.

```bash
svelar plugin:list
```

Output table shows:
- Plugin name
- Version
- Description
- Status (enabled/disabled)
- Config availability
- Migrations availability

### plugin:install

Installs a plugin from npm and optionally publishes its assets.

```bash
svelar plugin:install svelar-stripe
svelar plugin:install svelar-stripe --no-publish
```

### plugin:publish

Publishes a plugin's assets to the application.

```bash
svelar plugin:publish svelar-stripe
svelar plugin:publish svelar-stripe --force
svelar plugin:publish svelar-stripe --only=config
```

Flags:
- `--force` / `-f` — Overwrite existing published files
- `--only` / `-o` — Publish only specific type (config, migrations, assets)

## Plugin Development

### Creating a Plugin

Plugins extend the `Plugin` base class:

```typescript
import { Plugin } from 'svelar/plugins';

export class StripePlugin extends Plugin {
  name = 'svelar-stripe';
  version = '1.0.0';
  description = 'Stripe integration for Svelar';

  // Optional dependencies on other plugins
  dependencies = ['svelar-events'];

  // Register services
  async register(app) {
    app.singleton('stripe', () => new Stripe(process.env.STRIPE_KEY));
  }

  // Boot the plugin
  async boot(app) {
    // Setup routes, middleware, etc.
  }

  // Plugin configuration
  config() {
    return {
      key: 'stripe',
      defaults: {
        currency: 'usd',
        webhook_secret: ''
      }
    };
  }

  // Return publishable files
  publishables() {
    return {
      config: [
        {
          source: new URL('../stubs/config/stripe.ts', import.meta.url).pathname,
          dest: 'src/config/stripe.ts',
          type: 'config'
        }
      ],
      migrations: [
        {
          source: new URL('../stubs/migrations/create_payments_table.ts', import.meta.url).pathname,
          dest: 'src/database/migrations/2024_01_01_000000_create_payments_table.ts',
          type: 'migration'
        }
      ]
    };
  }

  // Return migrations
  migrations() {
    return ['create_payments_table', 'create_subscriptions_table'];
  }

  // Return CLI commands
  commands() {
    return [{
      name: 'stripe:test',
      description: 'Test Stripe connection',
      handler: async (args) => { /* ... */ }
    }];
  }

  // Return API routes
  routes() {
    return [{
      method: 'POST',
      path: '/webhooks/stripe',
      handler: async (event) => { /* ... */ }
    }];
  }

  // Return middleware
  middleware() {
    return [{
      name: 'stripe-auth',
      handler: async (ctx, next) => { /* ... */ }
    }];
  }

  // Return event listeners
  listeners() {
    return [{
      event: 'app:boot',
      handler: async () => { /* ... */ }
    }];
  }
}

export default StripePlugin;
```

### Package Setup

Plugins should be published to npm with:

1. Package name starting with `svelar-` OR
2. Keyword `svelar-plugin` in package.json

```json
{
  "name": "svelar-stripe",
  "version": "1.0.0",
  "keywords": ["svelar", "svelar-plugin", "stripe"],
  "main": "./dist/index.js",
  "exports": {
    ".": "./dist/index.js"
  }
}
```

## File Structure

```
packages/svelar/src/
├── plugins/
│   ├── index.ts                 (Plugin base class & PluginManager)
│   ├── PluginRegistry.ts        (Plugin discovery & management)
│   ├── PluginPublisher.ts       (Asset publishing)
│   ├── PluginInstaller.ts       (npm integration)
│   └── BootstrapPlugins.ts      (App startup bootstrapping)
│
└── cli/
    ├── bin.ts                   (Updated: register new commands)
    ├── index.ts                 (Updated: export new commands)
    └── commands/
        ├── PluginListCommand.ts
        ├── PluginPublishCommand.ts
        └── PluginInstallCommand.ts
```

## Usage Examples

### Installation Flow

```bash
# List available plugins
svelar plugin:list

# Install a plugin
svelar plugin:install svelar-stripe

# Publish its config/migrations
svelar plugin:publish svelar-stripe

# Or do both in one step
svelar plugin:install svelar-stripe  # auto-publishes by default
```

### Application Startup

```typescript
import { Container } from 'svelar/container';
import { bootstrapPlugins } from 'svelar/plugins';

const app = new Container();

// Boot enabled plugins
await bootstrapPlugins(app);

// Or specify explicit plugins
await bootstrapPlugins(app, ['svelar-stripe', 'svelar-analytics']);
```

### Programmatic Usage

```typescript
import { PluginRegistry } from 'svelar/plugins/PluginRegistry';
import { PluginManager } from 'svelar/plugins';

const registry = PluginRegistry;
await registry.discover();

// Get all plugins
const allPlugins = registry.list();

// Enable specific plugins
registry.enable('svelar-stripe');
registry.enable('svelar-analytics');

// Boot them
const manager = new PluginManager(app);
const plugins = allPlugins.filter(p => registry.isEnabled(p.name));

for (const plugin of plugins) {
  manager.use(plugin); // Load the actual plugin class
}

await manager.boot();
```

## Design Principles

1. **Discovery** — Automatic plugin detection from node_modules
2. **Isolation** — Each plugin is independent and properly scoped
3. **Ordering** — Plugins boot respecting declared dependencies
4. **Publishing** — Config/migrations safely copied to app
5. **CLI Integration** — Full command-line management
6. **Singleton Pattern** — One instance per core service across the app
7. **Modern Async** — Full async/await support throughout

## Next Steps

1. Create example plugins using the plugin structure
2. Add plugin scaffolding command: `make:plugin`
3. Write plugin development documentation
4. Create plugin template repository
5. Add plugin marketplace/registry
