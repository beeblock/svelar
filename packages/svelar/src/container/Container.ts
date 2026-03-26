/**
 * Svelar IoC Container
 *
 * Laravel-inspired service container with dependency injection,
 * singleton support, and service provider lifecycle.
 */

// ── Types ──────────────────────────────────────────────────

export type Factory<T = any> = (container: Container) => T;
export type AsyncFactory<T = any> = (container: Container) => T | Promise<T>;

interface Binding<T = any> {
  factory: AsyncFactory<T>;
  singleton: boolean;
  instance?: T;
  tags: string[];
}

// ── Container ──────────────────────────────────────────────

export class Container {
  private bindings = new Map<string, Binding>();
  private aliases = new Map<string, string>();
  private resolved = new Set<string>();

  /**
   * Register a binding in the container
   */
  bind<T>(name: string, factory: AsyncFactory<T>): void {
    this.bindings.set(name, {
      factory,
      singleton: false,
      tags: [],
    });
  }

  /**
   * Register a singleton binding (resolved once, then cached)
   */
  singleton<T>(name: string, factory: AsyncFactory<T>): void {
    this.bindings.set(name, {
      factory,
      singleton: true,
      tags: [],
    });
  }

  /**
   * Register an existing instance as a singleton
   */
  instance<T>(name: string, value: T): void {
    this.bindings.set(name, {
      factory: () => value,
      singleton: true,
      instance: value,
      tags: [],
    });
  }

  /**
   * Create an alias for a binding
   */
  alias(alias: string, target: string): void {
    this.aliases.set(alias, target);
  }

  /**
   * Resolve a binding from the container
   */
  async make<T = any>(name: string): Promise<T> {
    // Resolve alias
    const resolvedName = this.resolveAlias(name);
    const binding = this.bindings.get(resolvedName);

    if (!binding) {
      throw new Error(`No binding found for "${name}" in the container.`);
    }

    // Return cached singleton
    if (binding.singleton && binding.instance !== undefined) {
      return binding.instance as T;
    }

    // Resolve
    const instance = await binding.factory(this);

    // Cache singleton
    if (binding.singleton) {
      binding.instance = instance;
    }

    this.resolved.add(resolvedName);
    return instance as T;
  }

  /**
   * Synchronous resolve (only works for already-resolved singletons or sync factories)
   */
  makeSync<T = any>(name: string): T {
    const resolvedName = this.resolveAlias(name);
    const binding = this.bindings.get(resolvedName);

    if (!binding) {
      throw new Error(`No binding found for "${name}" in the container.`);
    }

    if (binding.singleton && binding.instance !== undefined) {
      return binding.instance as T;
    }

    const instance = binding.factory(this);
    if (instance instanceof Promise) {
      throw new Error(
        `Binding "${name}" has an async factory. Use container.make() instead of container.makeSync().`
      );
    }

    if (binding.singleton) {
      binding.instance = instance;
    }

    this.resolved.add(resolvedName);
    return instance as T;
  }

  /**
   * Check if a binding exists
   */
  has(name: string): boolean {
    const resolvedName = this.resolveAlias(name);
    return this.bindings.has(resolvedName);
  }

  /**
   * Check if a binding has been resolved
   */
  isResolved(name: string): boolean {
    return this.resolved.has(this.resolveAlias(name));
  }

  /**
   * Tag bindings for group resolution
   */
  tag(names: string[], tag: string): void {
    for (const name of names) {
      const binding = this.bindings.get(name);
      if (binding) {
        binding.tags.push(tag);
      }
    }
  }

  /**
   * Resolve all bindings with a given tag
   */
  async tagged<T = any>(tag: string): Promise<T[]> {
    const results: T[] = [];
    for (const [name, binding] of this.bindings) {
      if (binding.tags.includes(tag)) {
        results.push(await this.make<T>(name));
      }
    }
    return results;
  }

  /**
   * Flush all resolved singletons (useful for testing)
   */
  flush(): void {
    for (const binding of this.bindings.values()) {
      if (binding.singleton) {
        binding.instance = undefined;
      }
    }
    this.resolved.clear();
  }

  /**
   * Remove a binding entirely
   */
  forget(name: string): void {
    this.bindings.delete(name);
    this.resolved.delete(name);
  }

  /**
   * Get all binding names
   */
  getBindings(): string[] {
    return [...this.bindings.keys()];
  }

  // ── Private ──

  private resolveAlias(name: string): string {
    return this.aliases.get(name) ?? name;
  }
}

import { singleton } from '../support/singleton.js';

/**
 * Global application container
 */
export const container = singleton('svelar.container', () => new Container());
