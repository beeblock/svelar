import { describe, it, expect } from 'vitest';
import { Pipeline, type Pipe, type PipeFunction } from '../src/support/Pipeline.js';

describe('Pipeline', () => {
  describe('thenReturn()', () => {
    it('should pass data through pipes and return result', async () => {
      const result = await Pipeline.send(10)
        .through([
          async (n, next) => next(n + 5),
          async (n, next) => next(n * 2),
        ])
        .thenReturn();

      expect(result).toBe(30); // (10 + 5) * 2
    });

    it('should handle empty pipeline', async () => {
      const result = await Pipeline.send('hello')
        .through([])
        .thenReturn();

      expect(result).toBe('hello');
    });

    it('should handle single pipe', async () => {
      const result = await Pipeline.send(5)
        .through([
          async (n, next) => next(n * 10),
        ])
        .thenReturn();

      expect(result).toBe(50);
    });
  });

  describe('pipe()', () => {
    it('should add individual pipes', async () => {
      const result = await Pipeline.send(1)
        .pipe(async (n, next) => next(n + 1))
        .pipe(async (n, next) => next(n + 1))
        .pipe(async (n, next) => next(n + 1))
        .thenReturn();

      expect(result).toBe(4);
    });
  });

  describe('then()', () => {
    it('should run pipeline with destination callback', async () => {
      const result = await Pipeline.send(5)
        .through([
          async (n, next) => next(n + 5),
        ])
        .then((n) => `Result: ${n}`);

      expect(result).toBe('Result: 10');
    });
  });

  describe('class-based pipes', () => {
    it('should handle class pipe with handle() method', async () => {
      class AddTen implements Pipe<number> {
        async handle(n: number, next: (n: number) => Promise<number>): Promise<number> {
          return next(n + 10);
        }
      }

      class Double implements Pipe<number> {
        async handle(n: number, next: (n: number) => Promise<number>): Promise<number> {
          return next(n * 2);
        }
      }

      const result = await Pipeline.send(5)
        .through([AddTen, Double])
        .thenReturn();

      expect(result).toBe(30); // (5 + 10) * 2
    });
  });

  describe('mixed pipes', () => {
    it('should handle both class and function pipes', async () => {
      class AddFive implements Pipe<number> {
        async handle(n: number, next: (n: number) => Promise<number>) {
          return next(n + 5);
        }
      }

      const result = await Pipeline.send(10)
        .through([
          AddFive,
          async (n, next) => next(n * 3),
        ])
        .thenReturn();

      expect(result).toBe(45); // (10 + 5) * 3
    });
  });

  describe('onCatch()', () => {
    it('should catch errors with recovery handler', async () => {
      const result = await Pipeline.send(5)
        .through([
          async (_n, _next) => {
            throw new Error('pipe failed');
          },
        ])
        .onCatch((_error, passable) => passable * -1)
        .thenReturn();

      expect(result).toBe(-5);
    });

    it('should propagate errors without catch handler', async () => {
      await expect(
        Pipeline.send(5)
          .through([
            async () => {
              throw new Error('boom');
            },
          ])
          .thenReturn()
      ).rejects.toThrow('boom');
    });
  });

  describe('complex scenarios', () => {
    it('should pipe objects through transformation chain', async () => {
      interface Order {
        items: { price: number }[];
        total: number;
        discount: number;
        tax: number;
      }

      const calculateTotal: PipeFunction<Order> = async (order, next) => {
        order.total = order.items.reduce((sum, item) => sum + item.price, 0);
        return next(order);
      };

      const applyDiscount: PipeFunction<Order> = async (order, next) => {
        if (order.total > 100) {
          order.discount = order.total * 0.1;
          order.total -= order.discount;
        }
        return next(order);
      };

      const calculateTax: PipeFunction<Order> = async (order, next) => {
        order.tax = order.total * 0.08;
        order.total += order.tax;
        return next(order);
      };

      const order: Order = {
        items: [{ price: 50 }, { price: 75 }],
        total: 0,
        discount: 0,
        tax: 0,
      };

      const result = await Pipeline.send(order)
        .through([calculateTotal, applyDiscount, calculateTax])
        .thenReturn();

      expect(result.discount).toBe(12.5); // 10% of 125
      expect(result.tax).toBeCloseTo(9); // 8% of 112.5
      expect(result.total).toBeCloseTo(121.5); // 112.5 + 9
    });

    it('should short-circuit when pipe does not call next', async () => {
      const result = await Pipeline.send(10)
        .through([
          async (n, _next) => n * 100, // Does NOT call next
          async (n, next) => next(n + 1), // Should never run
        ])
        .thenReturn();

      expect(result).toBe(1000);
    });
  });
});
