/**
 * Svelar Plugin System
 *
 * Extensible plugin architecture inspired by Laravel packages.
 * Plugins can register service providers, middleware, commands,
 * routes, migrations, and configuration.
 *
 * @example
 * ```ts
 * import { Plugin, PluginManager } from 'svelar/plugins';
 *
 * // Define a plugin
 * class StripePlugin extends Plugin {
 *   name = 'svelar-stripe';
 *   version = '1.0.0';
 *
 *   async register(app) {
 *     app.singleton('stripe', () => new Stripe(process.env.STRIPE_KEY));
 *   }
 *
 *   async boot(app) {
 *     // Register routes, middleware, etc.
 *   }
 *
 *   migrations() {
 *     return ['create_payments_table', 'create_subscriptions_table'];
 *   }
 *
 *   config() {
 *     return {
 *       key: 'stripe',
 *       defaults: { currency: 'usd', webhook_secret: '' },
 *     };
 *   }
 * }
 *
 * // Register plugins
 * const plugins = new PluginManager(app);
 * plugins.use(new StripePlugin());
 * await plugins.boot();
 * ```
 */

import type { Container } from '../container/Container.js';
import type { Middleware } from '../middleware/Middleware.js';

// ── Types ──────────────────────────────────────────────────

export interface PluginConfig {
  key: string;
  defaults: Record<string, any>;
}

export interface PluginMigration {
  name: string;
  up: () => Promise<void>;
  down: () => Promise<void>;
}

export interface PluginRoute {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  handler: (event: any) => Promise<Response>;
  middleware?: string[];
}

export interface PluginCommand {
  name: string;
  description: string;
  handler: (args: string[]) => Promise<void>;
}

export type PluginHook =
  | 'app:boot'
  | 'app:shutdown'
  | 'request:before'
  | 'request:after'
  | 'model:creating'
  | 'model:created'
  | 'model:updating'
  | 'model:updated'
  | 'model:deleting'
  | 'model:deleted'
  | string;

// ── Plugin Base Class ──────────────────────────────────────

export abstract class Plugin {
  /** Unique plugin identifier (e.g., 'svelar-stripe') */
  abstract readonly name: string;

  /** Plugin version (semver) */
  abstract readonly version: string;

  /** Human-readable description */
  description?: string;

  /** Plugin dependencies (other plugin names) */
  dependencies?: string[];

  /**
   * Register services, bindings, and configuration.
   * Called before boot.
   */
  async register(app: Container): Promise<void> {}

  /**
   * Bootstrap the plugin after all plugins are registered.
   * Use for setup that depends on other services.
   */
  async boot(app: Container): Promise<void> {}

  /**
   * Clean up when the plugin is unloaded
   */
  async shutdown(): Promise<void> {}

  /**
   * Return migration files this plugin provides
   */
  migrations(): string[] {
    return [];
  }

  /**
   * Return default configuration for this plugin
   */
  config(): PluginConfig | null {
    return null;
  }

  /**
   * Return middleware this plugin provides
   */
  middleware(): Array<{ name: string; handler: Middleware | ((ctx: any, next: any) => Promise<any>) }> {
    return [];
  }

  /**
   * Return CLI commands this plugin provides
   */
  commands(): PluginCommand[] {
    return [];
  }

  /**
   * Return API routes this plugin provides
   */
  routes(): PluginRoute[] {
    return [];
  }

  /**
   * Return event listeners this plugin registers
   */
  listeners(): Array<{ event: string; handler: (...args: any[]) => void | Promise<void> }> {
    return [];
  }

  /**
   * Return publishable files (configs, migrations, assets)
   * Map of type -> array of { source, dest, type }
   */
  publishables?(): Record<
    string,
    Array<{ source: string; dest: string; type: 'config' | 'migration' | 'asset' }>
  > {
    return {};
  }
}

// ── Plugin Manager ─────────────────────────────────────────

export class PluginManager {
  private plugins = new Map<string, Plugin>();
  private registered = new Set<string>();
  private booted = new Set<string>();
  private hooks = new Map<PluginHook, Array<(...args: any[]) => Promise<void> | void>>();

  constructor(private app: Container) {}

  /**
   * Register a plugin
   */
  use(plugin: Plugin): this {
    if (this.plugins.has(plugin.name)) {
      throw new Error(`Plugin "${plugin.name}" is already registered.`);
    }
    this.plugins.set(plugin.name, plugin);
    return this;
  }

  /**
   * Register multiple plugins
   */
  useMany(plugins: Plugin[]): this {
    for (const plugin of plugins) {
      this.use(plugin);
    }
    return this;
  }

  /**
   * Register and boot all plugins (respects dependency order)
   */
  async boot(): Promise<void> {
    // Register phase (dependency order)
    const order = this.resolveDependencyOrder();
    for (const name of order) {
      await this.registerPlugin(name);
    }

    // Boot phase
    for (const name of order) {
      await this.bootPlugin(name);
    }

    await this.triggerHook('app:boot');
  }

  /**
   * Shutdown all plugins (reverse order)
   */
  async shutdown(): Promise<void> {
    await this.triggerHook('app:shutdown');

    const order = [...this.booted].reverse();
    for (const name of order) {
      const plugin = this.plugins.get(name);
      if (plugin) {
        await plugin.shutdown();
      }
    }
  }

  /**
   * Get a registered plugin by name
   */
  get<T extends Plugin>(name: string): T | undefined {
    return this.plugins.get(name) as T;
  }

  /**
   * Check if a plugin is registered
   */
  has(name: string): boolean {
    return this.plugins.has(name);
  }

  /**
   * Get all registered plugin names
   */
  names(): string[] {
    return [...this.plugins.keys()];
  }

  /**
   * Get all plugins
   */
  all(): Plugin[] {
    return [...this.plugins.values()];
  }

  /**
   * Register a hook listener
   */
  on(hook: PluginHook, handler: (...args: any[]) => Promise<void> | void): void {
    if (!this.hooks.has(hook)) {
      this.hooks.set(hook, []);
    }
    this.hooks.get(hook)!.push(handler);
  }

  /**
   * Trigger a hook
   */
  async triggerHook(hook: PluginHook, ...args: any[]): Promise<void> {
    const handlers = this.hooks.get(hook);
    if (handlers) {
      for (const handler of handlers) {
        await handler(...args);
      }
    }
  }

  /**
   * Get all routes from all plugins
   */
  getRoutes(): PluginRoute[] {
    const routes: PluginRoute[] = [];
    for (const plugin of this.plugins.values()) {
      routes.push(...plugin.routes());
    }
    return routes;
  }

  /**
   * Get all commands from all plugins
   */
  getCommands(): PluginCommand[] {
    const commands: PluginCommand[] = [];
    for (const plugin of this.plugins.values()) {
      commands.push(...plugin.commands());
    }
    return commands;
  }

  /**
   * Get all middleware from all plugins
   */
  getMiddleware(): Array<{ name: string; handler: any }> {
    const middleware: Array<{ name: string; handler: any }> = [];
    for (const plugin of this.plugins.values()) {
      middleware.push(...plugin.middleware());
    }
    return middleware;
  }

  /**
   * Get all migrations from all plugins
   */
  getMigrations(): string[] {
    const migrations: string[] = [];
    for (const plugin of this.plugins.values()) {
      migrations.push(...plugin.migrations());
    }
    return migrations;
  }

  /**
   * Get all configurations from all plugins
   */
  getConfigs(): PluginConfig[] {
    const configs: PluginConfig[] = [];
    for (const plugin of this.plugins.values()) {
      const config = plugin.config();
      if (config) configs.push(config);
    }
    return configs;
  }

  // ── Private ──────────────────────────────────────────────

  private async registerPlugin(name: string): Promise<void> {
    if (this.registered.has(name)) return;

    const plugin = this.plugins.get(name);
    if (!plugin) throw new Error(`Plugin "${name}" not found.`);

    // Register config defaults
    const config = plugin.config();
    if (config) {
      this.app.instance(`config.${config.key}`, config.defaults);
    }

    // Register event listeners
    for (const { event, handler } of plugin.listeners()) {
      this.on(event, handler);
    }

    await plugin.register(this.app);
    this.registered.add(name);
  }

  private async bootPlugin(name: string): Promise<void> {
    if (this.booted.has(name)) return;

    const plugin = this.plugins.get(name);
    if (!plugin) return;

    await plugin.boot(this.app);
    this.booted.add(name);
  }

  private resolveDependencyOrder(): string[] {
    const visited = new Set<string>();
    const order: string[] = [];

    const visit = (name: string, stack: Set<string>) => {
      if (visited.has(name)) return;
      if (stack.has(name)) {
        throw new Error(`Circular plugin dependency detected: ${[...stack, name].join(' -> ')}`);
      }

      stack.add(name);

      const plugin = this.plugins.get(name);
      if (plugin?.dependencies) {
        for (const dep of plugin.dependencies) {
          if (!this.plugins.has(dep)) {
            throw new Error(
              `Plugin "${name}" requires "${dep}" which is not registered.`
            );
          }
          visit(dep, stack);
        }
      }

      stack.delete(name);
      visited.add(name);
      order.push(name);
    };

    for (const name of this.plugins.keys()) {
      visit(name, new Set());
    }

    return order;
  }
}

// ── Plugin Discovery ───────────────────────────────────────

/**
 * Load plugins from a directory (for auto-discovery)
 */
export async function discoverPlugins(
  pluginDir: string,
): Promise<Plugin[]> {
  const { readdir } = await import('node:fs/promises');
  const { join } = await import('node:path');

  const plugins: Plugin[] = [];

  try {
    const entries = await readdir(pluginDir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        // Look for index.ts or index.js
        try {
          const mod = await import(join(pluginDir, entry.name, 'index.js'));
          const PluginClass = mod.default || mod[Object.keys(mod)[0]];
          if (PluginClass && PluginClass.prototype instanceof Plugin) {
            plugins.push(new PluginClass());
          }
        } catch {
          // Skip directories without valid plugin exports
        }
      } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.js'))) {
        try {
          const mod = await import(join(pluginDir, entry.name));
          const PluginClass = mod.default || mod[Object.keys(mod)[0]];
          if (PluginClass && PluginClass.prototype instanceof Plugin) {
            plugins.push(new PluginClass());
          }
        } catch {
          // Skip files that aren't plugins
        }
      }
    }
  } catch {
    // Directory doesn't exist — no plugins to discover
  }

  return plugins;
}
