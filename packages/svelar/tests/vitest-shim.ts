/**
 * Lightweight vitest compatibility layer using node:test and node:assert
 * Allows running vitest-style tests with `node --experimental-strip-types --test`
 */

import { describe as nodeDescribe, it as nodeIt, before, beforeEach as nodeBefore, mock } from 'node:test';
import assert from 'node:assert/strict';

export { nodeDescribe as describe, nodeIt as it, nodeBefore as beforeEach };

// ---- expect() implementation ----

interface Matchers {
  toBe(expected: any): void;
  toEqual(expected: any): void;
  toStrictEqual(expected: any): void;
  toBeTruthy(): void;
  toBeFalsy(): void;
  toBeNull(): void;
  toBeUndefined(): void;
  toBeDefined(): void;
  toBeNaN(): void;
  toBeGreaterThan(n: number): void;
  toBeGreaterThanOrEqual(n: number): void;
  toBeLessThan(n: number): void;
  toBeLessThanOrEqual(n: number): void;
  toContain(item: any): void;
  toHaveLength(n: number): void;
  toMatch(pattern: string | RegExp): void;
  toHaveProperty(key: string, value?: any): void;
  toBeInstanceOf(cls: any): void;
  toThrow(expected?: string | RegExp | Error): void;
  toHaveBeenCalled(): void;
  toHaveBeenCalledTimes(n: number): void;
  toHaveBeenCalledWith(...args: any[]): void;
  resolves: AsyncMatchers;
  rejects: AsyncMatchers;
  not: Matchers;
}

interface AsyncMatchers {
  toBe(expected: any): Promise<void>;
  toEqual(expected: any): Promise<void>;
  toThrow(expected?: string | RegExp | Error): Promise<void>;
  toBeInstanceOf(cls: any): Promise<void>;
  toBeDefined(): Promise<void>;
  toBeTruthy(): Promise<void>;
}

function createMatchers(actual: any, negated = false): Matchers {
  const check = (condition: boolean, msg: string) => {
    if (negated) {
      if (condition) throw new assert.AssertionError({ message: `Expected NOT: ${msg}` });
    } else {
      if (!condition) throw new assert.AssertionError({ message: msg });
    }
  };

  const matchers: Matchers = {
    toBe(expected: any) {
      if (negated) {
        assert.notStrictEqual(actual, expected);
      } else {
        assert.strictEqual(actual, expected);
      }
    },
    toEqual(expected: any) {
      if (negated) {
        assert.notDeepStrictEqual(actual, expected);
      } else {
        assert.deepStrictEqual(actual, expected);
      }
    },
    toStrictEqual(expected: any) {
      if (negated) {
        assert.notDeepStrictEqual(actual, expected);
      } else {
        assert.deepStrictEqual(actual, expected);
      }
    },
    toBeTruthy() {
      check(!!actual, `Expected ${actual} to be truthy`);
    },
    toBeFalsy() {
      check(!actual, `Expected ${actual} to be falsy`);
    },
    toBeNull() {
      check(actual === null, `Expected ${actual} to be null`);
    },
    toBeUndefined() {
      check(actual === undefined, `Expected ${actual} to be undefined`);
    },
    toBeDefined() {
      check(actual !== undefined, `Expected value to be defined`);
    },
    toBeNaN() {
      check(Number.isNaN(actual), `Expected ${actual} to be NaN`);
    },
    toBeGreaterThan(n: number) {
      check(actual > n, `Expected ${actual} > ${n}`);
    },
    toBeGreaterThanOrEqual(n: number) {
      check(actual >= n, `Expected ${actual} >= ${n}`);
    },
    toBeLessThan(n: number) {
      check(actual < n, `Expected ${actual} < ${n}`);
    },
    toBeLessThanOrEqual(n: number) {
      check(actual <= n, `Expected ${actual} <= ${n}`);
    },
    toContain(item: any) {
      if (typeof actual === 'string') {
        check(actual.includes(item), `Expected "${actual}" to contain "${item}"`);
      } else if (Array.isArray(actual)) {
        check(actual.includes(item), `Expected array to contain ${item}`);
      } else {
        throw new Error('toContain requires string or array');
      }
    },
    toHaveLength(n: number) {
      check(actual.length === n, `Expected length ${actual.length} to be ${n}`);
    },
    toMatch(pattern: string | RegExp) {
      const re = typeof pattern === 'string' ? new RegExp(pattern) : pattern;
      check(re.test(actual), `Expected "${actual}" to match ${pattern}`);
    },
    toHaveProperty(key: string, value?: any) {
      const keys = key.split('.');
      let obj = actual;
      for (const k of keys) {
        check(obj != null && k in obj, `Expected object to have property "${key}"`);
        obj = obj[k];
      }
      if (arguments.length > 1) {
        assert.deepStrictEqual(obj, value);
      }
    },
    toBeInstanceOf(cls: any) {
      check(actual instanceof cls, `Expected ${actual} to be instance of ${cls.name}`);
    },
    toThrow(expected?: string | RegExp | Error) {
      let threw = false;
      let error: any;
      try {
        actual();
      } catch (e: any) {
        threw = true;
        error = e;
      }
      check(threw, 'Expected function to throw');
      if (threw && expected) {
        if (typeof expected === 'string') {
          check(error.message?.includes(expected), `Expected error message to contain "${expected}", got "${error.message}"`);
        } else if (expected instanceof RegExp) {
          check(expected.test(error.message), `Expected error message to match ${expected}`);
        } else if (expected instanceof Error) {
          check(error instanceof (expected as any).constructor, `Expected error to be instance of ${(expected as any).constructor.name}`);
        }
      }
    },
    toHaveBeenCalled() {
      const calls = (actual as any).mock?.calls ?? (actual as any)._calls ?? [];
      check(calls.length > 0, 'Expected function to have been called');
    },
    toHaveBeenCalledTimes(n: number) {
      const calls = (actual as any).mock?.calls ?? (actual as any)._calls ?? [];
      check(calls.length === n, `Expected ${n} calls, got ${calls.length}`);
    },
    toHaveBeenCalledWith(...args: any[]) {
      const calls = (actual as any).mock?.calls ?? (actual as any)._calls ?? [];
      const found = calls.some((call: any[]) => {
        try {
          assert.deepStrictEqual(call.arguments ?? call, args);
          return true;
        } catch {
          return false;
        }
      });
      check(found, `Expected function to have been called with ${JSON.stringify(args)}`);
    },
    get resolves() {
      return {
        async toBe(expected: any) {
          const result = await actual;
          if (negated) assert.notStrictEqual(result, expected);
          else assert.strictEqual(result, expected);
        },
        async toEqual(expected: any) {
          const result = await actual;
          if (negated) assert.notDeepStrictEqual(result, expected);
          else assert.deepStrictEqual(result, expected);
        },
        async toThrow() {
          try {
            await actual;
            if (!negated) throw new Error('Expected promise to reject');
          } catch {
            if (negated) throw new Error('Expected promise not to reject');
          }
        },
        async toBeInstanceOf(cls: any) {
          const result = await actual;
          check(result instanceof cls, `Expected result to be instance of ${cls.name}`);
        },
        async toBeDefined() {
          const result = await actual;
          check(result !== undefined, 'Expected result to be defined');
        },
        async toBeTruthy() {
          const result = await actual;
          check(!!result, 'Expected result to be truthy');
        },
      };
    },
    get rejects() {
      return {
        async toBe(expected: any) {
          try {
            await actual;
            throw new Error('Expected promise to reject');
          } catch (e: any) {
            if (negated) assert.notStrictEqual(e, expected);
            else assert.strictEqual(e, expected);
          }
        },
        async toEqual(expected: any) {
          try {
            await actual;
            throw new Error('Expected promise to reject');
          } catch (e: any) {
            if (negated) assert.notDeepStrictEqual(e, expected);
            else assert.deepStrictEqual(e, expected);
          }
        },
        async toThrow(expected?: string | RegExp) {
          try {
            await actual;
            if (!negated) throw new assert.AssertionError({ message: 'Expected promise to reject' });
          } catch (e: any) {
            if (negated) return;
            if (expected) {
              if (typeof expected === 'string') {
                check(e.message?.includes(expected), `Expected rejection message to contain "${expected}"`);
              } else if (expected instanceof RegExp) {
                check(expected.test(e.message), `Expected rejection message to match ${expected}`);
              }
            }
          }
        },
        async toBeInstanceOf(cls: any) {
          try {
            await actual;
            throw new Error('Expected promise to reject');
          } catch (e: any) {
            check(e instanceof cls, `Expected rejection to be instance of ${cls.name}`);
          }
        },
        async toBeDefined() {
          try {
            await actual;
            throw new Error('Expected promise to reject');
          } catch (e: any) {
            check(e !== undefined, 'Expected rejection to be defined');
          }
        },
        async toBeTruthy() {
          try {
            await actual;
            throw new Error('Expected promise to reject');
          } catch (e: any) {
            check(!!e, 'Expected rejection to be truthy');
          }
        },
      };
    },
    get not() {
      return createMatchers(actual, !negated);
    },
  };

  return matchers;
}

export function expect(actual: any): Matchers {
  return createMatchers(actual);
}

// ---- vi mock utilities ----

export const vi = {
  fn(impl?: (...args: any[]) => any) {
    const calls: any[][] = [];
    const results: any[] = [];
    const mockFn = (...args: any[]) => {
      calls.push(args);
      try {
        const result = impl ? impl(...args) : undefined;
        results.push({ type: 'return', value: result });
        return result;
      } catch (e) {
        results.push({ type: 'throw', value: e });
        throw e;
      }
    };
    mockFn.mock = { calls, results };
    mockFn._calls = calls.map((args) => ({ arguments: args }));
    mockFn.mockClear = () => { calls.length = 0; results.length = 0; };
    mockFn.mockReset = () => { calls.length = 0; results.length = 0; impl = undefined; };
    mockFn.mockImplementation = (newImpl: any) => { impl = newImpl; return mockFn; };
    mockFn.mockReturnValue = (val: any) => { impl = () => val; return mockFn; };
    mockFn.mockResolvedValue = (val: any) => { impl = () => Promise.resolve(val); return mockFn; };
    mockFn.mockRejectedValue = (val: any) => { impl = () => Promise.reject(val); return mockFn; };
    return mockFn;
  },

  spyOn(obj: any, method: string) {
    const original = obj[method];
    let impl = original.bind(obj);
    const calls: any[][] = [];
    const spy = (...args: any[]) => {
      calls.push(args);
      return impl(...args);
    };
    spy.mock = { calls };
    spy._calls = calls;
    spy.mockImplementation = (newImpl: any) => { impl = newImpl; return spy; };
    spy.mockReturnValue = (val: any) => { impl = () => val; return spy; };
    spy.mockRestore = () => { obj[method] = original; };
    spy.mockClear = () => { calls.length = 0; };
    obj[method] = spy;
    return spy;
  },

  useFakeTimers() {
    // Basic stub
    return { advanceTimersByTime: () => {}, useRealTimers: () => {} };
  },

  useRealTimers() {},
};
