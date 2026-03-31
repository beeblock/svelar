import { describe, it, expect, vi } from 'vitest';
import { Service, type ServiceResult } from '../src/services/index.js';

class TestService extends Service {
  // Expose protected methods for testing
  public testOk<T>(data?: T) { return this.ok(data); }
  public testFail(error: string, errors?: Record<string, string[]>) { return this.fail(error, errors); }
  public testAttempt<T>(fn: () => Promise<T>) { return this.attempt(fn); }
  public testEmit(event: any) { return this.emit(event); }
}

describe('Service', () => {
  describe('ok()', () => {
    it('should return success result with data', () => {
      const svc = new TestService();
      const result = svc.testOk({ id: 1 });
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ id: 1 });
    });

    it('should return success without data', () => {
      const svc = new TestService();
      const result = svc.testOk();
      expect(result.success).toBe(true);
      expect(result.data).toBeUndefined();
    });
  });

  describe('fail()', () => {
    it('should return failure result', () => {
      const svc = new TestService();
      const result = svc.testFail('Something went wrong');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Something went wrong');
    });

    it('should include validation errors', () => {
      const svc = new TestService();
      const result = svc.testFail('Validation failed', {
        email: ['Required'],
        name: ['Too short'],
      });
      expect(result.errors?.email).toEqual(['Required']);
      expect(result.errors?.name).toEqual(['Too short']);
    });
  });

  describe('attempt()', () => {
    it('should return success on successful execution', async () => {
      const svc = new TestService();
      const result = await svc.testAttempt(async () => 42);
      expect(result.success).toBe(true);
      expect(result.data).toBe(42);
    });

    it('should return failure on error', async () => {
      const svc = new TestService();
      const result = await svc.testAttempt(async () => {
        throw new Error('DB error');
      });
      expect(result.success).toBe(false);
      expect(result.error).toBe('DB error');
    });
  });

  describe('event dispatching', () => {
    it('should dispatch events when dispatcher is set', async () => {
      const svc = new TestService();
      const dispatcher = vi.fn();
      svc.setEventDispatcher(dispatcher);

      await svc.testEmit({ type: 'user:created', userId: 1 });
      expect(dispatcher).toHaveBeenCalledWith({ type: 'user:created', userId: 1 });
    });

    it('should silently skip when no dispatcher', async () => {
      const svc = new TestService();
      // Should not throw
      await svc.testEmit({ type: 'test' });
    });
  });
});
