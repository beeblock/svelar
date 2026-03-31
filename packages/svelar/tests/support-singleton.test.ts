import { describe, it, expect, afterEach } from 'vitest';
import { singleton } from '../src/support/singleton.js';

describe('singleton', () => {
  afterEach(() => {
    // Clean up test singletons from globalThis
    const keys = ['test.singleton.1', 'test.singleton.2', 'test.singleton.counter'];
    for (const key of keys) {
      delete (globalThis as any)[Symbol.for(key)];
    }
  });

  it('should create a new instance on first call', () => {
    const instance = singleton('test.singleton.1', () => ({ value: 42 }));
    expect(instance.value).toBe(42);
  });

  it('should return the same instance on subsequent calls', () => {
    const first = singleton('test.singleton.2', () => ({ value: Math.random() }));
    const second = singleton('test.singleton.2', () => ({ value: Math.random() }));
    expect(first).toBe(second);
    expect(first.value).toBe(second.value);
  });

  it('should only call factory once', () => {
    let callCount = 0;
    singleton('test.singleton.counter', () => {
      callCount++;
      return {};
    });
    singleton('test.singleton.counter', () => {
      callCount++;
      return {};
    });
    expect(callCount).toBe(1);
  });

  it('should create separate instances for different keys', () => {
    const a = singleton('test.singleton.1', () => ({ name: 'a' }));
    const b = singleton('test.singleton.2', () => ({ name: 'b' }));
    expect(a.name).toBe('a');
    expect(b.name).toBe('b');
    expect(a).not.toBe(b);
  });
});
