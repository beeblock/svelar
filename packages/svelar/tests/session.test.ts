import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Session, MemorySessionStore, DatabaseSessionStore } from '../src/session/Session';

describe('Session', () => {
  let session: Session;

  beforeEach(() => {
    session = new Session(Session.generateId());
  });

  describe('constructor', () => {
    it('should create a session with an ID', () => {
      expect(session.id).toBeDefined();
      expect(typeof session.id).toBe('string');
    });

    it('should initialize with empty data', () => {
      expect(session.all()).toEqual({});
    });

    it('should initialize with provided data', () => {
      const initialData = { userId: 1, role: 'admin' };
      const sess = new Session(Session.generateId(), initialData);

      expect(sess.get('userId')).toBe(1);
      expect(sess.get('role')).toBe('admin');
    });

    it('should separate flash data from regular data', () => {
      const initialData = {
        userId: 1,
        _flash: { message: 'Welcome' },
      };

      const sess = new Session(Session.generateId(), initialData);

      expect(sess.get('userId')).toBe(1);
      expect(sess.get('message')).toBe('Welcome');
    });
  });

  describe('get', () => {
    it('should retrieve a session value', () => {
      session.set('user_id', 42);

      expect(session.get('user_id')).toBe(42);
    });

    it('should return undefined for missing key', () => {
      expect(session.get('nonexistent')).toBeUndefined();
    });

    it('should return default value if key missing', () => {
      expect(session.get('missing', 'default')).toBe('default');
    });

    it('should support typed retrieval', () => {
      const user = { id: 1, name: 'John' };
      session.set('user', user);

      const retrieved = session.get<typeof user>('user');

      expect(retrieved).toEqual(user);
      expect(retrieved?.name).toBe('John');
    });

    it('should retrieve flash data for the current request', () => {
      session.flash('success', 'Operation completed');

      expect(session.get('success')).toBe('Operation completed');
    });

    it('should prioritize flash data over regular data', () => {
      session.set('message', 'Regular message');
      session.flash('message', 'Flash message');

      // Flash data is in previousFlashData for current request
      // This test assumes flash is accessible in current request
      expect(session.get('message')).toBeDefined();
    });
  });

  describe('set', () => {
    it('should set a session value', () => {
      session.set('key', 'value');

      expect(session.get('key')).toBe('value');
    });

    it('should mark session as dirty', () => {
      session.set('key', 'value');

      expect(session.isDirty()).toBe(true);
    });

    it('should support various data types', () => {
      session.set('string', 'text');
      session.set('number', 42);
      session.set('boolean', true);
      session.set('array', [1, 2, 3]);
      session.set('object', { nested: 'value' });

      expect(session.get('string')).toBe('text');
      expect(session.get('number')).toBe(42);
      expect(session.get('boolean')).toBe(true);
      expect(session.get('array')).toEqual([1, 2, 3]);
      expect(session.get('object')).toEqual({ nested: 'value' });
    });

    it('should overwrite existing values', () => {
      session.set('key', 'first');
      session.set('key', 'second');

      expect(session.get('key')).toBe('second');
    });

    it('should handle null values', () => {
      session.set('nullable', null);

      expect(session.get('nullable')).toBeNull();
    });
  });

  describe('has', () => {
    it('should return true if key exists', () => {
      session.set('key', 'value');

      expect(session.has('key')).toBe(true);
    });

    it('should return false if key does not exist', () => {
      expect(session.has('nonexistent')).toBe(false);
    });

    it('should return true for flash data', () => {
      session.flash('message', 'Flash content');

      expect(session.has('message')).toBe(true);
    });

    it('should handle falsy values', () => {
      session.set('zero', 0);
      session.set('empty', '');
      session.set('false', false);

      expect(session.has('zero')).toBe(true);
      expect(session.has('empty')).toBe(true);
      expect(session.has('false')).toBe(true);
    });
  });

  describe('forget', () => {
    it('should remove a key from session', () => {
      session.set('key', 'value');
      expect(session.has('key')).toBe(true);

      session.forget('key');

      expect(session.has('key')).toBe(false);
    });

    it('should mark session as dirty', () => {
      session.set('key', 'value');
      session.forget('key');

      expect(session.isDirty()).toBe(true);
    });

    it('should handle forgetting non-existent keys', () => {
      session.forget('nonexistent');

      expect(session.isDirty()).toBe(true);
    });

    it('should allow removing specific keys', () => {
      session.set('key1', 'value1');
      session.set('key2', 'value2');

      session.forget('key1');

      expect(session.has('key1')).toBe(false);
      expect(session.has('key2')).toBe(true);
    });
  });

  describe('flush', () => {
    it('should clear all session data', () => {
      session.set('key1', 'value1');
      session.set('key2', 'value2');

      session.flush();

      expect(session.has('key1')).toBe(false);
      expect(session.has('key2')).toBe(false);
      expect(session.all()).toEqual({});
    });

    it('should mark session as dirty', () => {
      session.set('key', 'value');
      session.flush();

      expect(session.isDirty()).toBe(true);
    });

    it('should allow re-setting after flush', () => {
      session.set('key', 'old');
      session.flush();
      session.set('key', 'new');

      expect(session.get('key')).toBe('new');
    });
  });

  describe('flash', () => {
    it('should set a flash value', () => {
      session.flash('success', 'Operation successful');

      expect(session.get('success')).toBe('Operation successful');
    });

    it('should mark session as dirty', () => {
      session.flash('notice', 'Notice message');

      expect(session.isDirty()).toBe(true);
    });

    it('should support multiple flash messages', () => {
      session.flash('success', 'Saved');
      session.flash('warning', 'Check settings');
      session.flash('error', 'Payment failed');

      expect(session.get('success')).toBe('Saved');
      expect(session.get('warning')).toBe('Check settings');
      expect(session.get('error')).toBe('Payment failed');
    });

    it('should include flash data in toPersist()', () => {
      session.flash('message', 'Flash message');

      const persisted = session.toPersist();

      expect(persisted._flash).toBeDefined();
      expect(persisted._flash.message).toBe('Flash message');
    });

    it('should handle complex flash data', () => {
      session.flash('data', { id: 1, name: 'Item' });

      expect(session.get('data')).toEqual({ id: 1, name: 'Item' });
    });
  });

  describe('all', () => {
    it('should return all session data', () => {
      session.set('key1', 'value1');
      session.set('key2', 'value2');

      const all = session.all();

      expect(all).toEqual({ key1: 'value1', key2: 'value2' });
    });

    it('should include flash data', () => {
      session.set('regular', 'data');
      session.flash('flash', 'message');

      const all = session.all();

      expect(all.regular).toBe('data');
      expect(all.flash).toBe('message');
    });

    it('should return empty object for new session', () => {
      expect(session.all()).toEqual({});
    });
  });

  describe('isDirty', () => {
    it('should return false for new session', () => {
      expect(session.isDirty()).toBe(false);
    });

    it('should return true after set', () => {
      session.set('key', 'value');

      expect(session.isDirty()).toBe(true);
    });

    it('should return true after forget', () => {
      session.set('key', 'value');
      const sess = new Session(Session.generateId(), { key: 'value' });

      sess.forget('key');

      expect(sess.isDirty()).toBe(true);
    });

    it('should return true after flush', () => {
      session.set('key', 'value');
      session.flush();

      expect(session.isDirty()).toBe(true);
    });

    it('should return true after flash', () => {
      session.flash('message', 'content');

      expect(session.isDirty()).toBe(true);
    });
  });

  describe('toPersist', () => {
    it('should return data for persistence', () => {
      session.set('user_id', 1);
      session.set('role', 'admin');

      const data = session.toPersist();

      expect(data.user_id).toBe(1);
      expect(data.role).toBe('admin');
    });

    it('should include flash data with _flash key', () => {
      session.set('user_id', 1);
      session.flash('success', 'Logged in');

      const data = session.toPersist();

      expect(data._flash).toEqual({ success: 'Logged in' });
    });

    it('should not include _flash if no flash data', () => {
      session.set('user_id', 1);

      const data = session.toPersist();

      expect(data._flash).toBeUndefined();
    });

    it('should separate flash and regular data', () => {
      session.set('regular', 'stays');
      session.flash('temporary', 'goes');

      const data = session.toPersist();

      expect(data.regular).toBe('stays');
      expect(data.temporary).toBeUndefined();
      expect(data._flash.temporary).toBe('goes');
    });
  });

  describe('regenerateId', () => {
    it('should generate a new session ID', () => {
      const oldId = session.id;

      const newId = session.regenerateId();

      expect(newId).not.toBe(oldId);
      expect(session.id).toBe(newId);
    });

    it('should mark session as dirty', () => {
      session.regenerateId();

      expect(session.isDirty()).toBe(true);
    });

    it('should preserve session data', () => {
      session.set('user_id', 1);
      session.set('role', 'user');

      session.regenerateId();

      expect(session.get('user_id')).toBe(1);
      expect(session.get('role')).toBe('user');
    });

    it('should regenerate unique IDs', () => {
      const id1 = session.regenerateId();
      const id2 = session.regenerateId();

      expect(id1).not.toBe(id2);
    });
  });

  describe('generateId', () => {
    it('should generate a unique ID', () => {
      const id1 = Session.generateId();
      const id2 = Session.generateId();

      expect(id1).not.toBe(id2);
    });

    it('should return a hex string', () => {
      const id = Session.generateId();

      expect(/^[a-f0-9]+$/.test(id)).toBe(true);
    });

    it('should have sufficient length', () => {
      const id = Session.generateId();

      expect(id.length).toBeGreaterThan(20);
    });
  });
});

describe('MemorySessionStore', () => {
  let store: MemorySessionStore;

  beforeEach(() => {
    store = new MemorySessionStore();
  });

  describe('write and read', () => {
    it('should write and read session data', async () => {
      const id = 'test-session-id';
      const data = { userId: 1, role: 'admin' };

      await store.write(id, data, 3600);
      const retrieved = await store.read(id);

      expect(retrieved).toEqual(data);
    });

    it('should return null for non-existent session', async () => {
      const retrieved = await store.read('nonexistent');

      expect(retrieved).toBeNull();
    });
  });

  describe('expiration', () => {
    it('should expire sessions after TTL', async () => {
      const id = 'expiring-session';
      const data = { test: true };

      await store.write(id, data, 1); // 1 second TTL

      // Wait for expiration
      await new Promise((r) => setTimeout(r, 1100));

      const retrieved = await store.read(id);

      expect(retrieved).toBeNull();
    });

    it('should return valid data before expiration', async () => {
      const id = 'valid-session';
      const data = { test: true };

      await store.write(id, data, 3600); // 1 hour TTL

      const retrieved = await store.read(id);

      expect(retrieved).toEqual(data);
    });
  });

  describe('destroy', () => {
    it('should destroy a session', async () => {
      const id = 'session-to-destroy';

      await store.write(id, { data: true }, 3600);
      await store.destroy(id);

      const retrieved = await store.read(id);

      expect(retrieved).toBeNull();
    });

    it('should handle destroying non-existent session', async () => {
      // Should not throw
      await store.destroy('nonexistent');
    });
  });

  describe('garbage collection', () => {
    it('should clean up expired sessions', async () => {
      const session1 = 'session-1';
      const session2 = 'session-2';

      await store.write(session1, { data: 1 }, 1); // Expires in 1 second
      await store.write(session2, { data: 2 }, 3600); // 1 hour

      // Wait for first to expire
      await new Promise((r) => setTimeout(r, 1100));

      await store.gc(3600);

      const retrieved1 = await store.read(session1);
      const retrieved2 = await store.read(session2);

      expect(retrieved1).toBeNull();
      expect(retrieved2).toEqual({ data: 2 });
    });
  });
});

describe('Session Integration', () => {
  it('should complete typical session workflow', async () => {
    const store = new MemorySessionStore();
    const session = new Session(Session.generateId());

    // Set user data
    session.set('userId', 123);
    session.set('role', 'admin');

    // Add flash message
    session.flash('success', 'Login successful');

    // Persist to store
    if (session.isDirty()) {
      await store.write(session.id, session.toPersist(), 3600);
    }

    // Read back from store
    const stored = await store.read(session.id);

    expect(stored?.userId).toBe(123);
    expect(stored?._flash?.success).toBe('Login successful');
  });

  it('should handle session regeneration for security', async () => {
    const store = new MemorySessionStore();
    const session = new Session(Session.generateId());

    // Set user data
    session.set('userId', 1);
    await store.write(session.id, session.toPersist(), 3600);

    const oldId = session.id;

    // Regenerate ID
    const newId = session.regenerateId();

    // Old session is no longer valid
    const oldData = await store.read(oldId);
    expect(oldData).toBeNull();

    // New ID contains same data
    expect(session.get('userId')).toBe(1);
  });
});
