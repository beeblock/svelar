import { describe, it, expect, beforeEach } from 'vitest';
import { Container } from '../src/container/Container';

describe('Container', () => {
  let container: Container;

  beforeEach(() => {
    container = new Container();
  });

  describe('bind', () => {
    it('should register a binding', () => {
      container.bind('service', () => ({ name: 'test' }));
      expect(container.has('service')).toBe(true);
    });

    it('should create a new instance each time for non-singletons', async () => {
      const factory = () => ({ id: Math.random() });
      container.bind('service', factory);

      const instance1 = await container.make('service');
      const instance2 = await container.make('service');

      expect(instance1.id).not.toBe(instance2.id);
    });

    it('should support async factories', async () => {
      container.bind('asyncService', async () => {
        return new Promise((resolve) => {
          setTimeout(() => resolve({ value: 'async' }), 10);
        });
      });

      const instance = await container.make('asyncService');
      expect(instance.value).toBe('async');
    });
  });

  describe('singleton', () => {
    it('should register a singleton binding', () => {
      container.singleton('config', () => ({ debug: true }));
      expect(container.has('config')).toBe(true);
    });

    it('should return the same instance every time', async () => {
      container.singleton('db', () => ({ connected: true }));

      const instance1 = await container.make('db');
      const instance2 = await container.make('db');

      expect(instance1).toBe(instance2);
    });

    it('should cache the resolved singleton instance', async () => {
      let callCount = 0;
      container.singleton('counter', () => {
        callCount++;
        return { count: callCount };
      });

      await container.make('counter');
      await container.make('counter');
      await container.make('counter');

      expect(callCount).toBe(1);
    });
  });

  describe('instance', () => {
    it('should register an existing instance as a singleton', async () => {
      const instance = { id: 123, name: 'test' };
      container.instance('user', instance);

      const retrieved = await container.make('user');
      expect(retrieved).toBe(instance);
    });

    it('should always return the same instance', async () => {
      const instance = { value: 'fixed' };
      container.instance('fixed', instance);

      const r1 = await container.make('fixed');
      const r2 = await container.make('fixed');

      expect(r1).toBe(r2);
      expect(r1).toBe(instance);
    });
  });

  describe('alias', () => {
    it('should create an alias for a binding', async () => {
      container.bind('database', () => ({ driver: 'sqlite' }));
      container.alias('db', 'database');

      const via_alias = await container.make('db');
      const via_original = await container.make('database');

      expect(via_alias).toEqual(via_original);
    });

    it('should resolve the alias transparently', async () => {
      container.singleton('config', () => ({ env: 'test' }));
      container.alias('cfg', 'config');

      const instance = await container.make('cfg');
      expect(instance.env).toBe('test');
    });

    it('should throw if binding does not exist', async () => {
      container.alias('missing', 'nonexistent');

      await expect(container.make('missing')).rejects.toThrow(
        /No binding found/
      );
    });
  });

  describe('make', () => {
    it('should resolve a binding', async () => {
      container.bind('service', () => ({ name: 'myService' }));

      const instance = await container.make('service');
      expect(instance.name).toBe('myService');
    });

    it('should throw if binding does not exist', async () => {
      await expect(container.make('unknown')).rejects.toThrow(
        /No binding found/
      );
    });

    it('should support dependency injection via container', async () => {
      container.singleton('logger', () => ({ log: (msg: string) => console.log(msg) }));
      container.bind('service', (c) => {
        const logger = c.makeSync('logger');
        return { logger, name: 'service' };
      });

      const instance = await container.make('service');
      expect(instance.logger).toBeDefined();
      expect(instance.name).toBe('service');
    });
  });

  describe('makeSync', () => {
    it('should synchronously resolve a binding', () => {
      container.bind('sync', () => ({ data: 'sync' }));

      const instance = container.makeSync('sync');
      expect(instance.data).toBe('sync');
    });

    it('should throw for async factories', () => {
      container.bind('async', async () => ({ data: 'async' }));

      expect(() => container.makeSync('async')).toThrow(
        /has an async factory/
      );
    });

    it('should return cached singletons synchronously', async () => {
      container.singleton('cached', () => ({ cached: true }));

      // Resolve once to cache it
      await container.make('cached');

      // Now sync access should work
      const instance = container.makeSync('cached');
      expect(instance.cached).toBe(true);
    });
  });

  describe('has', () => {
    it('should return true if binding exists', () => {
      container.bind('service', () => ({}));
      expect(container.has('service')).toBe(true);
    });

    it('should return false if binding does not exist', () => {
      expect(container.has('unknown')).toBe(false);
    });

    it('should return true for aliases', () => {
      container.bind('original', () => ({}));
      container.alias('alias', 'original');

      expect(container.has('alias')).toBe(true);
    });
  });

  describe('isResolved', () => {
    it('should return false for unresolved bindings', async () => {
      container.bind('service', () => ({}));
      expect(container.isResolved('service')).toBe(false);
    });

    it('should return true after resolving a singleton', async () => {
      container.singleton('service', () => ({}));
      await container.make('service');
      expect(container.isResolved('service')).toBe(true);
    });

    it('should return true for resolved non-singletons', async () => {
      container.bind('service', () => ({}));
      await container.make('service');
      expect(container.isResolved('service')).toBe(true);
    });
  });

  describe('tag', () => {
    it('should tag bindings', () => {
      container.bind('service1', () => ({}));
      container.bind('service2', () => ({}));

      container.tag(['service1', 'service2'], 'providers');
      expect(container.has('service1')).toBe(true);
    });

    it('should allow tagging multiple bindings with the same tag', () => {
      container.bind('cache', () => ({}));
      container.bind('log', () => ({}));

      container.tag(['cache', 'log'], 'services');
      container.tag(['cache'], 'storage');

      // Both tags should apply to cache
      expect(container.has('cache')).toBe(true);
    });
  });

  describe('tagged', () => {
    it('should resolve all bindings with a tag', async () => {
      container.bind('provider1', () => ({ name: 'p1' }));
      container.bind('provider2', () => ({ name: 'p2' }));
      container.bind('other', () => ({ name: 'other' }));

      container.tag(['provider1', 'provider2'], 'providers');

      const providers = await container.tagged('providers');
      expect(providers).toHaveLength(2);
      expect(providers.map((p) => p.name)).toEqual(['p1', 'p2']);
    });

    it('should return empty array if no bindings match tag', async () => {
      container.bind('service', () => ({}));

      const results = await container.tagged('nonexistent');
      expect(results).toEqual([]);
    });

    it('should resolve instances for tagged bindings', async () => {
      container.instance('db', { driver: 'sqlite' });
      container.singleton('cache', () => ({ type: 'memory' }));

      container.tag(['db', 'cache'], 'storage');

      const storage = await container.tagged('storage');
      expect(storage).toHaveLength(2);
      expect(storage[0].driver).toBe('sqlite');
      expect(storage[1].type).toBe('memory');
    });
  });

  describe('flush', () => {
    it('should clear all resolved singletons', async () => {
      container.singleton('service', () => ({ id: 1 }));

      const before = await container.make('service');
      container.flush();
      const after = await container.make('service');

      expect(before).not.toBe(after);
    });

    it('should not remove bindings, only clear cached instances', () => {
      container.singleton('service', () => ({}));

      container.flush();
      expect(container.has('service')).toBe(true);
    });

    it('should clear the resolved set', async () => {
      container.singleton('service', () => ({}));
      await container.make('service');

      expect(container.isResolved('service')).toBe(true);
      container.flush();
      expect(container.isResolved('service')).toBe(false);
    });
  });

  describe('forget', () => {
    it('should remove a binding entirely', () => {
      container.bind('service', () => ({}));
      expect(container.has('service')).toBe(true);

      container.forget('service');
      expect(container.has('service')).toBe(false);
    });

    it('should allow re-binding after forget', () => {
      container.bind('service', () => ({ version: 1 }));
      container.forget('service');
      container.bind('service', () => ({ version: 2 }));

      const instance = container.makeSync('service');
      expect(instance.version).toBe(2);
    });

    it('should also clear from resolved set', async () => {
      container.singleton('service', () => ({}));
      await container.make('service');

      container.forget('service');
      expect(container.isResolved('service')).toBe(false);
      expect(container.has('service')).toBe(false);
    });
  });

  describe('getBindings', () => {
    it('should return array of all binding names', () => {
      container.bind('service1', () => ({}));
      container.bind('service2', () => ({}));
      container.instance('service3', {});

      const bindings = container.getBindings();
      expect(bindings).toContain('service1');
      expect(bindings).toContain('service2');
      expect(bindings).toContain('service3');
    });

    it('should return empty array initially', () => {
      const bindings = container.getBindings();
      expect(bindings).toEqual([]);
    });

    it('should not include aliases in bindings', () => {
      container.bind('original', () => ({}));
      container.alias('alias', 'original');

      const bindings = container.getBindings();
      expect(bindings).toContain('original');
      expect(bindings).not.toContain('alias');
    });
  });

  describe('integration', () => {
    it('should support complex dependency chains', async () => {
      container.singleton('logger', () => ({ log: (msg: string) => {} }));
      container.singleton('db', (c) => {
        const logger = c.makeSync('logger');
        return { logger, connect: () => {} };
      });
      container.bind('userService', (c) => {
        const db = c.makeSync('db');
        const logger = c.makeSync('logger');
        return { db, logger, getUsers: () => [] };
      });

      const service = await container.make('userService');
      expect(service.db).toBeDefined();
      expect(service.logger).toBeDefined();
    });

    it('should work with flush and re-resolution', async () => {
      let instanceCount = 0;

      container.singleton('counter', () => {
        instanceCount++;
        return { id: instanceCount };
      });

      const first = await container.make('counter');
      expect(first.id).toBe(1);
      expect(instanceCount).toBe(1);

      container.flush();

      const second = await container.make('counter');
      expect(second.id).toBe(2);
      expect(instanceCount).toBe(2);
    });

    it('should handle multiple aliases for the same binding', async () => {
      container.singleton('original', () => ({ value: 'test' }));
      container.alias('alias1', 'original');
      container.alias('alias2', 'original');

      const v1 = await container.make('original');
      const v2 = await container.make('alias1');
      const v3 = await container.make('alias2');

      expect(v1).toBe(v2);
      expect(v2).toBe(v3);
    });
  });
});
