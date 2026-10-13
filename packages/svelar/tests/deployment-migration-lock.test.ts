import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Connection } from '../src/database/Connection.js';
import { CreateDeploymentLocksTable } from '../src/database/core/00000000_000049_create_deployment_locks_table.js';
import { MigrationLock, MigrationLockBusyError, MigrationLockFoundationError } from '../src/deployment/MigrationLock.js';
import { QueryBuilder } from '../src/orm/QueryBuilder.js';
import { LockedMigrateCommand } from '../src/deployment/LockedMigrateCommand.js';

beforeEach(async () => {
  Connection.configure({ default: 'one', connections: { one: { driver: 'sqlite', filename: ':memory:' }, two: { driver: 'sqlite', filename: ':memory:' } } });
});
afterEach(async () => { vi.restoreAllMocks(); await Connection.disconnect(); });
async function foundation(name = 'one') { await Connection.usingConnection(name, () => new CreateDeploymentLocksTable().up()); }
describe('Persisted deployment migration ownership', () => {
  it('fails before any DDL when the foundation is absent', async () => {
    const raw = vi.spyOn(Connection, 'raw'); let called = false;
    await expect(MigrationLock.run(async () => { called = true; })).rejects.toBeInstanceOf(MigrationLockFoundationError);
    expect(called).toBe(false); expect(raw.mock.calls.some(([sql]) => /^(CREATE|ALTER|INSERT|UPDATE|DELETE)/.test(sql))).toBe(false);
  });
  it('admits one concurrent owner and does not expire ownership while its DDL could still be running', async () => {
    await foundation(); let done!: () => void; let started!: () => void;
    const active = new Promise<void>(resolve => { started = resolve; });
    const running = MigrationLock.run(async () => { started(); await new Promise<void>(resolve => { done = resolve; }); return 42; });
    await active; expect(Connection.inTransaction()).toBe(false);
    const owner = await MigrationLock.inspect(); expect(owner?.owner).toMatch(/^[0-9a-f-]{36}$/);
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 365 * 86400000);
    await expect(MigrationLock.run(async () => 1)).rejects.toBeInstanceOf(MigrationLockBusyError);
    done(); expect(await running).toBe(42); expect(await MigrationLock.inspect()).toEqual({ owner: null, acquiredAt: null });
  });
  it('releases only its exact owner token and preserves callback errors', async () => {
    await foundation(); const original = new Error('DDL failure');
    await expect(MigrationLock.run(async () => {
      expect(await MigrationLock.release(crypto.randomUUID())).toBe(false); throw original;
    })).rejects.toBe(original);
    expect((await MigrationLock.inspect())?.owner).toBeNull();
    expect(await MigrationLock.run(async () => 'next')).toBe('next');
  });
  it('requires explicit recovery for a persisted orphan and never assumes a stale timestamp means a dead process', async () => {
    await foundation(); const owner = crypto.randomUUID();
    await new QueryBuilder('svelar_deployment_locks').insert({ name: 'migrations', owner, acquired_at: 0 });
    await expect(MigrationLock.check()).rejects.toBeInstanceOf(MigrationLockBusyError);
    expect(await MigrationLock.inspect()).toEqual({ owner, acquiredAt: 0 });
    expect(await MigrationLock.release(owner)).toBe(true); await expect(MigrationLock.check()).resolves.toBeUndefined();
  });
  it('keeps named database ownership independent and refuses an uncommitted outer transaction', async () => {
    await foundation('one'); await foundation('two');
    await MigrationLock.run(async () => {
      expect(await MigrationLock.run(async () => 'two', { connectionName: 'two' })).toBe('two');
      await expect(MigrationLock.run(async () => 'one')).rejects.toBeInstanceOf(MigrationLockBusyError);
    });
    await expect(Connection.transaction(() => MigrationLock.run(async () => 1))).rejects.toThrow('outside an existing transaction');
  });
  it('does not silently drop cleanup failures or invalid ownership names', async () => {
    await foundation(); const original = new Error('original');
    const release = vi.spyOn(MigrationLock, 'release').mockRejectedValue(new Error('release failure'));
    await expect(MigrationLock.run(async () => { throw original; })).rejects.toMatchObject({ errors: [original, expect.any(Error)] });
    release.mockRestore(); await expect(MigrationLock.check({ name: 'x\0y' })).rejects.toThrow('name');
    await expect(MigrationLock.release('unknown')).rejects.toThrow('UUID');
  });
  it('preflights the exact CLI connection without running migrations or accepting destructive flags', async () => {
    const command = new LockedMigrateCommand();
    await expect(command.handle([], { check: true })).rejects.toBeInstanceOf(MigrationLockFoundationError);
    await foundation(); await expect(command.handle([], { check: true })).resolves.toBeUndefined();
    await expect(command.handle([], { check: true, connection: 'two' })).rejects.toBeInstanceOf(MigrationLockFoundationError);
    await expect(command.handle([], { fresh: true })).rejects.toThrow('forward');
  });
});
