import { describe, expect, it } from 'vitest';
import { ApplicationContext } from '../src/support/Context';
import { assertApplicationContext, createContextRequestEvent, runWithContext, withActor, withTenant } from '../src/testing/context';

describe('explicit testing context', () => {
  it('isolates the tenant, actor and correlation while retaining the outer context', async () => {
    await ApplicationContext.runIsolated({ teamId: 'outer', actorId: 'outer-actor', userId: 99, jobId: 'unrelated' }, async () => {
      await withTenant('selected', async () => {
        assertApplicationContext({ tenantId: 'selected', teamId: 'selected', actorId: 7, userId: undefined });
        expect(ApplicationContext.get('jobId')).toBeUndefined();
        await Promise.resolve();
        expect(ApplicationContext.get('correlationId')).toBe('request');
      }, { actorId: 7, correlationId: 'request' });
      expect(ApplicationContext.snapshot()).toEqual({ teamId: 'outer', actorId: 'outer-actor', userId: 99, jobId: 'unrelated' });
    });
  });

  it('actor scope does not invent an authenticated user or inherit a tenant', async () => {
    await ApplicationContext.runIsolated({ teamId: 8, userId: 1 }, async () => {
      await withActor('system', () => { expect(ApplicationContext.snapshot()).toEqual({ actorId: 'system' }); });
      expect(ApplicationContext.snapshot()).toEqual({ teamId: 8, userId: 1 });
    });
  });

  it('restores origin on sync and async callback failures', async () => {
    const failure = new Error('expected');
    await ApplicationContext.runIsolated({ teamId: 'origin' }, async () => {
      await expect(runWithContext({ teamId: 'inner' }, () => { throw failure; })).rejects.toBe(failure);
      await expect(withActor(4, async () => { await Promise.resolve(); throw failure; })).rejects.toBe(failure);
      expect(ApplicationContext.snapshot()).toEqual({ teamId: 'origin' });
    });
  });

  it('supports nested and concurrent isolated callbacks without cross-tenant leaks', async () => {
    await runWithContext({ tenantId: 'outer', actorId: 1 }, async () => {
      await Promise.all(['one', 'two', 'three'].map((tenantId) => withTenant(tenantId, async () => {
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(ApplicationContext.get('teamId')).toBe(tenantId);
        expect(ApplicationContext.get('actorId')).toBeUndefined();
      })));
      expect(ApplicationContext.snapshot()).toEqual({ teamId: 'outer', tenantId: 'outer', actorId: 1 });
    });
  });

  it('builds the existing request fake with context but does not change caller authentication', async () => {
    await withActor(17, () => {
      const user = { id: 2 };
      const event = createContextRequestEvent({ url: '/api/test', method: 'POST', locals: { user, extra: true } });
      expect(event.locals).toEqual({ user, extra: true, context: { actorId: 17 } });
      expect(event.request.method).toBe('POST');
      event.locals.context.actorId = 99;
      expect(ApplicationContext.get('actorId')).toBe(17);
      expect(createContextRequestEvent().locals.user).toBeUndefined();
    });
  });

  it('explicit null tenant and empty context do not merge ambient identity', async () => {
    await ApplicationContext.runIsolated({ teamId: 9, actorId: 12 }, async () => {
      await withTenant(null, () => { expect(ApplicationContext.snapshot()).toEqual({ teamId: null, tenantId: null }); });
      await runWithContext({}, () => { expect(ApplicationContext.snapshot()).toEqual({}); });
    });
  });

  it('rejects mismatched tenant aliases and malformed scalar IDs', async () => {
    await expect(runWithContext({ teamId: 1, tenantId: 2 }, () => {})).rejects.toThrow('same tenant');
    for (const tenantId of ['', 'x'.repeat(256), NaN, Infinity, 0.1]) await expect(withTenant(tenantId, () => {})).rejects.toThrow('bounded');
    await expect(runWithContext({ correlationId: 'x'.repeat(256) }, () => {})).rejects.toThrow('bounded');
    await expect(runWithContext(null!, () => {})).rejects.toThrow('explicit context');
  });

  it('assertions fail without exposing actual actor/tenant identifiers', async () => {
    await withActor('secret', () => {
      expect(() => assertApplicationContext({ actorId: 'expected' })).toThrow('actorId does not match');
      expect(() => assertApplicationContext({ actorId: 'expected' })).not.toThrow('secret');
    });
  });
});
