import { describe, it, expect, vi } from 'vitest';
import { Action, ChainableAction, inlineAction, type ActionResult } from '../src/actions/index.js';

class DoubleAction extends Action<number, number> {
  async execute(input: number): Promise<number> {
    return input * 2;
  }
}

class FailingAction extends Action<string, string> {
  async execute(_input: string): Promise<string> {
    throw new Error('Action failed');
  }
}

describe('Action', () => {
  describe('run()', () => {
    it('should execute the action', async () => {
      const action = new DoubleAction();
      const result = await action.run(5);
      expect(result).toBe(10);
    });
  });

  describe('runSafe()', () => {
    it('should return success result', async () => {
      const action = new DoubleAction();
      const result = await action.runSafe(5);
      expect(result.success).toBe(true);
      expect(result.data).toBe(10);
    });

    it('should catch errors and return failure result', async () => {
      const action = new FailingAction();
      const result = await action.runSafe('test');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Action failed');
    });
  });

  describe('before/after hooks', () => {
    it('should run before hooks', async () => {
      const order: string[] = [];
      const action = new DoubleAction();
      action.before(() => { order.push('before'); });

      await action.run(5);
      expect(order).toEqual(['before']);
    });

    it('should run after hooks with input and output', async () => {
      const afterSpy = vi.fn();
      const action = new DoubleAction();
      action.after(afterSpy);

      await action.run(5);
      expect(afterSpy).toHaveBeenCalledWith(5, 10);
    });

    it('should run multiple hooks in order', async () => {
      const order: number[] = [];
      const action = new DoubleAction();
      action.before(() => { order.push(1); });
      action.before(() => { order.push(2); });
      action.after(() => { order.push(3); });
      action.after(() => { order.push(4); });

      await action.run(5);
      expect(order).toEqual([1, 2, 3, 4]);
    });
  });

  describe('middleware', () => {
    it('should run through middleware pipeline', async () => {
      const action = new DoubleAction();
      action.through(async (input, next) => {
        // Add 10 before executing
        return next(input + 10);
      });

      const result = await action.run(5);
      expect(result).toBe(30); // (5 + 10) * 2
    });

    it('should chain multiple middleware', async () => {
      const action = new DoubleAction();
      action
        .through(async (input, next) => next(input + 1))
        .through(async (input, next) => next(input + 2));

      const result = await action.run(0);
      expect(result).toBe(6); // (0 + 1 + 2) * 2
    });
  });
});

describe('ChainableAction', () => {
  class AddOne extends ChainableAction<number, number> {
    async execute(input: number) { return input + 1; }
  }

  class MultiplyByThree extends ChainableAction<number, number> {
    async execute(input: number) { return input * 3; }
  }

  class NumberToString extends ChainableAction<number, string> {
    async execute(input: number) { return `Result: ${input}`; }
  }

  it('should chain actions together', async () => {
    const pipeline = new AddOne().then(new MultiplyByThree());
    const result = await pipeline.run(5);
    expect(result).toBe(18); // (5 + 1) * 3
  });

  it('should chain with type transformation', async () => {
    const pipeline = new AddOne().then(new NumberToString());
    const result = await pipeline.run(9);
    expect(result).toBe('Result: 10');
  });
});

describe('inlineAction()', () => {
  it('should create an action from a function', async () => {
    const greet = inlineAction(async (name: string) => `Hello, ${name}!`);
    const result = await greet.run('Alice');
    expect(result).toBe('Hello, Alice!');
  });

  it('should support hooks on inline actions', async () => {
    const action = inlineAction(async (n: number) => n * 2);
    const afterSpy = vi.fn();
    action.after(afterSpy);

    await action.run(5);
    expect(afterSpy).toHaveBeenCalledWith(5, 10);
  });

  it('should support runSafe on inline actions', async () => {
    const action = inlineAction(async (_: string) => {
      throw new Error('oops');
    });
    const result = await action.runSafe('test');
    expect(result.success).toBe(false);
    expect(result.error).toBe('oops');
  });
});
