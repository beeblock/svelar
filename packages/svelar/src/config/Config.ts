/**
 * Svelar Config
 *
 * Environment-aware configuration management.
 */

// ── Environment Helper ─────────────────────────────────────

/**
 * Get an environment variable with an optional default.
 * Similar to Laravel's env() helper.
 */
export function env<T extends string | number | boolean = string>(
  key: string,
  defaultValue?: T
): T {
  const value = process.env[key];

  if (value === undefined) {
    if (defaultValue !== undefined) return defaultValue;
    return '' as T;
  }

  // Auto-cast common types
  if (value === 'true') return true as T;
  if (value === 'false') return false as T;
  if (value === 'null') return null as any;
  if (/^\d+$/.test(value)) return Number(value) as T;

  return value as T;
}

// ── Config Manager ─────────────────────────────────────────

class ConfigManager {
  private items = new Map<string, any>();

  /**
   * Clear all configuration
   */
  clear(): void {
    this.items.clear();
  }

  /**
   * Load configuration from an object
   */
  load(config: Record<string, any>): void {
    for (const [key, value] of Object.entries(config)) {
      this.set(key, value);
    }
  }

  /**
   * Get a configuration value using dot notation
   * @example config.get('database.default') // 'sqlite'
   */
  get<T = any>(key: string, defaultValue?: T): T {
    const parts = key.split('.');
    let current: any = this.items.get(parts[0]);

    for (let i = 1; i < parts.length; i++) {
      if (current === undefined || current === null) {
        return defaultValue as T;
      }
      current = current[parts[i]];
    }

    return (current ?? defaultValue) as T;
  }

  /**
   * Set a configuration value using dot notation
   */
  set(key: string, value: any): void {
    const parts = key.split('.');

    if (parts.length === 1) {
      this.items.set(key, value);
      return;
    }

    // Nested set
    let root = this.items.get(parts[0]);
    if (root === undefined || typeof root !== 'object') {
      root = {};
      this.items.set(parts[0], root);
    }

    let current = root;
    for (let i = 1; i < parts.length - 1; i++) {
      if (current[parts[i]] === undefined || typeof current[parts[i]] !== 'object') {
        current[parts[i]] = {};
      }
      current = current[parts[i]];
    }

    current[parts[parts.length - 1]] = value;
  }

  /**
   * Check if a configuration key exists
   */
  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  /**
   * Get all configuration as a plain object
   */
  all(): Record<string, any> {
    const result: Record<string, any> = {};
    for (const [key, value] of this.items) {
      result[key] = value;
    }
    return result;
  }
}

import { singleton } from '../support/singleton.js';

/**
 * Global config singleton
 */
export const config = singleton('svelar.config', () => new ConfigManager());
