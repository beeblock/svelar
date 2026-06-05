import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeEach } from 'vitest';
import { config, env } from '../src/config/Config';

describe('ConfigManager', () => {
  beforeEach(() => {
    // Reset config state
    config.clear();
  });

  describe('load', () => {
    it('should load a configuration object', () => {
      config.load({
        app: {
          name: 'MyApp',
          debug: true,
        },
        database: {
          driver: 'sqlite',
        },
      });

      expect(config.get('app.name')).toBe('MyApp');
      expect(config.get('app.debug')).toBe(true);
      expect(config.get('database.driver')).toBe('sqlite');
    });

    it('should overwrite existing config on load', () => {
      config.load({ key: 'value1' });
      expect(config.get('key')).toBe('value1');

      config.load({ key: 'value2' });
      expect(config.get('key')).toBe('value2');
    });

    it('should handle nested objects', () => {
      config.load({
        services: {
          cache: {
            default: 'memory',
            stores: {
              memory: { ttl: 3600 },
              redis: { ttl: 7200 },
            },
          },
        },
      });

      expect(config.get('services.cache.default')).toBe('memory');
      expect(config.get('services.cache.stores.memory.ttl')).toBe(3600);
    });

    it('should handle empty object', () => {
      config.load({});

      expect(config.all()).toEqual({});
    });
  });

  describe('loadFromDirectory', () => {
    it('loads configuration files from a directory', async () => {
      const root = await mkdtemp(join(tmpdir(), 'svelar-config-'));

      try {
        await writeFile(join(root, 'app.js'), 'export default { name: "Svelar", debug: true };', 'utf-8');
        await writeFile(join(root, 'database.js'), 'export const config = { default: "sqlite" };', 'utf-8');

        await expect(config.loadFromDirectory(root)).resolves.toEqual(['app', 'database']);
        expect(config.get('app.name')).toBe('Svelar');
        expect(config.get('app.debug')).toBe(true);
        expect(config.get('database.default')).toBe('sqlite');
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });

    it('keeps missing config directories as a no-op', async () => {
      const root = await mkdtemp(join(tmpdir(), 'svelar-config-missing-'));
      const missing = join(root, 'config');

      try {
        await expect(config.loadFromDirectory(missing)).resolves.toEqual([]);
        expect(config.all()).toEqual({});
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });

    it('throws when a config file does not export an object', async () => {
      const root = await mkdtemp(join(tmpdir(), 'svelar-config-invalid-'));

      try {
        await writeFile(join(root, 'app.js'), 'export default "not config";', 'utf-8');

        await expect(config.loadFromDirectory(root)).rejects.toThrow('must export a configuration object');
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });

    it('throws when a config file fails to import', async () => {
      const root = await mkdtemp(join(tmpdir(), 'svelar-config-broken-'));

      try {
        await writeFile(join(root, 'app.js'), 'export default { name: ;', 'utf-8');

        await expect(config.loadFromDirectory(root)).rejects.toThrow();
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  });

  describe('get with dot notation', () => {
    beforeEach(() => {
      config.load({
        app: {
          name: 'TestApp',
          env: 'testing',
          debug: true,
          providers: ['auth', 'database'],
          database: {
            default: 'sqlite',
            connections: {
              sqlite: { file: ':memory:' },
              postgres: { host: 'localhost' },
            },
          },
        },
      });
    });

    it('should get top-level values', () => {
      const app = config.get('app');
      expect(app.name).toBe('TestApp');
      expect(app.env).toBe('testing');
    });

    it('should get nested values with dot notation', () => {
      expect(config.get('app.name')).toBe('TestApp');
      expect(config.get('app.env')).toBe('testing');
      expect(config.get('app.debug')).toBe(true);
    });

    it('should get deeply nested values', () => {
      expect(config.get('app.database.default')).toBe('sqlite');
      expect(config.get('app.database.connections.sqlite.file')).toBe(':memory:');
      expect(config.get('app.database.connections.postgres.host')).toBe('localhost');
    });

    it('should return default value if key not found', () => {
      expect(config.get('nonexistent')).toBeUndefined();
      expect(config.get('nonexistent', 'default')).toBe('default');
    });

    it('should return default for missing nested key', () => {
      expect(config.get('app.missing', 'fallback')).toBe('fallback');
      expect(config.get('app.database.missing.key', null)).toBeNull();
    });

    it('should handle null/undefined in path', () => {
      expect(config.get('app.nonexistent.deep')).toBeUndefined();
      expect(config.get('app.nonexistent.deep', 'default')).toBe('default');
    });

    it('should handle array values', () => {
      expect(config.get('app.providers')).toEqual(['auth', 'database']);
    });
  });

  describe('set with dot notation', () => {
    it('should set top-level value', () => {
      config.set('appName', 'MyApp');

      expect(config.get('appName')).toBe('MyApp');
    });

    it('should set nested value', () => {
      config.set('database.driver', 'postgres');

      expect(config.get('database.driver')).toBe('postgres');
    });

    it('should create nested structure if not exists', () => {
      config.set('new.deep.nested.value', 'data');

      expect(config.get('new.deep.nested.value')).toBe('data');
    });

    it('should overwrite existing nested value', () => {
      config.load({ app: { env: 'production' } });

      config.set('app.env', 'testing');

      expect(config.get('app.env')).toBe('testing');
    });

    it('should handle multiple sets to same branch', () => {
      config.set('cache.default', 'memory');
      config.set('cache.ttl', 3600);
      config.set('cache.stores.memory.type', 'in-memory');

      expect(config.get('cache.default')).toBe('memory');
      expect(config.get('cache.ttl')).toBe(3600);
      expect(config.get('cache.stores.memory.type')).toBe('in-memory');
    });

    it('should handle primitive and complex values', () => {
      config.set('values.string', 'text');
      config.set('values.number', 42);
      config.set('values.boolean', true);
      config.set('values.array', [1, 2, 3]);
      config.set('values.object', { nested: 'value' });

      expect(config.get('values.string')).toBe('text');
      expect(config.get('values.number')).toBe(42);
      expect(config.get('values.boolean')).toBe(true);
      expect(config.get('values.array')).toEqual([1, 2, 3]);
      expect(config.get('values.object')).toEqual({ nested: 'value' });
    });

    it('should overwrite non-object values with objects', () => {
      config.set('config', 'string-value');
      config.set('config.nested', 'new-value');

      expect(config.get('config.nested')).toBe('new-value');
    });
  });

  describe('has', () => {
    beforeEach(() => {
      config.load({
        app: {
          name: 'App',
          enabled: true,
        },
      });
    });

    it('should return true if key exists', () => {
      expect(config.has('app')).toBe(true);
      expect(config.has('app.name')).toBe(true);
      expect(config.has('app.enabled')).toBe(true);
    });

    it('should return false if key does not exist', () => {
      expect(config.has('missing')).toBe(false);
      expect(config.has('app.missing')).toBe(false);
      expect(config.has('app.name.missing')).toBe(false);
    });

    it('should return true even for falsy values', () => {
      config.set('falsy.zero', 0);
      config.set('falsy.empty', '');
      config.set('falsy.false', false);
      config.set('falsy.null', null);

      expect(config.has('falsy.zero')).toBe(true);
      expect(config.has('falsy.empty')).toBe(true);
      expect(config.has('falsy.false')).toBe(true);
      // null is treated as missing
      expect(config.has('falsy.null')).toBe(false);
    });
  });

  describe('all', () => {
    it('should return all configuration as object', () => {
      config.load({
        app: { name: 'MyApp' },
        database: { driver: 'sqlite' },
      });

      const all = config.all();

      expect(all).toHaveProperty('app');
      expect(all).toHaveProperty('database');
      expect(all.app.name).toBe('MyApp');
      expect(all.database.driver).toBe('sqlite');
    });

    it('should return a plain object (not a reference)', () => {
      config.load({ app: { name: 'Original' } });

      const all1 = config.all();
      const all2 = config.all();

      expect(all1).not.toBe(all2); // Different objects
      expect(all1).toEqual(all2); // But equal content
    });

    it('should return empty object when config is empty', () => {
      config.load({});

      expect(config.all()).toEqual({});
    });

    it('should reflect current state', () => {
      config.load({ key: 'initial' });

      const before = config.all();
      expect(before.key).toBe('initial');

      config.set('key', 'updated');

      const after = config.all();
      expect(after.key).toBe('updated');
    });
  });

  describe('env helper', () => {
    beforeEach(() => {
      // Clear environment variables used in tests
      delete process.env.TEST_STRING;
      delete process.env.TEST_NUMBER;
      delete process.env.TEST_BOOL;
      delete process.env.TEST_MISSING;
    });

    it('should get environment variable', () => {
      process.env.TEST_STRING = 'hello';

      expect(env('TEST_STRING')).toBe('hello');
    });

    it('should return default if env var not set', () => {
      expect(env('TEST_MISSING', 'default')).toBe('default');
    });

    it('should auto-cast "true" to boolean', () => {
      process.env.TEST_BOOL = 'true';

      const result = env<boolean>('TEST_BOOL');
      expect(result).toBe(true);
      expect(typeof result).toBe('boolean');
    });

    it('should auto-cast "false" to boolean', () => {
      process.env.TEST_BOOL = 'false';

      const result = env<boolean>('TEST_BOOL');
      expect(result).toBe(false);
      expect(typeof result).toBe('boolean');
    });

    it('should auto-cast numeric strings', () => {
      process.env.TEST_NUMBER = '42';

      const result = env<number>('TEST_NUMBER');
      expect(result).toBe(42);
      expect(typeof result).toBe('number');
    });

    it('should auto-cast "null" to null', () => {
      process.env.TEST_NULL = 'null';

      const result = env('TEST_NULL', 'default');
      expect(result).toBeNull();
    });

    it('should handle strings that look like numbers but should stay string', () => {
      process.env.TEST_STRING = '123abc';

      const result = env('TEST_STRING');
      expect(result).toBe('123abc');
      expect(typeof result).toBe('string');
    });

    it('should return empty string when env var not set and no default', () => {
      const result = env('NONEXISTENT');

      expect(result).toBe('');
    });

    it('should handle special characters in values', () => {
      process.env.TEST_SPECIAL = '!@#$%^&*()';

      expect(env('TEST_SPECIAL')).toBe('!@#$%^&*()');
    });
  });

  describe('integration', () => {
    it('should work with real application config', () => {
      config.load({
        app: {
          name: 'Svelar',
          env: 'production',
          debug: false,
          port: 3000,
        },
        database: {
          default: 'postgres',
          connections: {
            postgres: {
              driver: 'postgres',
              host: 'localhost',
              port: 5432,
              database: 'svelar',
            },
            sqlite: {
              driver: 'sqlite',
              database: ':memory:',
            },
          },
        },
        cache: {
          default: 'redis',
          stores: {
            redis: {
              driver: 'redis',
              ttl: 3600,
            },
            memory: {
              driver: 'memory',
              ttl: 600,
            },
          },
        },
      });

      // Verify multiple levels
      expect(config.get('app.name')).toBe('Svelar');
      expect(config.get('app.port')).toBe(3000);
      expect(config.get('database.default')).toBe('postgres');
      expect(config.get('database.connections.postgres.host')).toBe('localhost');
      expect(config.get('database.connections.sqlite.database')).toBe(':memory:');
      expect(config.get('cache.stores.redis.ttl')).toBe(3600);

      // Update runtime config
      config.set('app.debug', true);
      expect(config.get('app.debug')).toBe(true);

      // Check existence
      expect(config.has('app.name')).toBe(true);
      expect(config.has('app.missing')).toBe(false);
    });

    it('should combine env and config', () => {
      process.env.DB_HOST = 'db.example.com';
      process.env.DB_PORT = '5432';

      config.load({
        database: {
          host: env('DB_HOST', 'localhost'),
          port: env<number>('DB_PORT', 3306),
          user: env('DB_USER', 'root'),
        },
      });

      expect(config.get('database.host')).toBe('db.example.com');
      expect(config.get('database.port')).toBe(5432);
      expect(config.get('database.user')).toBe('root');
    });
  });
});
