import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import lockfile from 'proper-lockfile';
import { serializeFileCache } from '../src/cache/FileSerialization';

describe('file-cache lock failure handling', () => {
  let root: string;
  beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'svelar-cache-atomic-lock-')); });
  afterEach(async () => { vi.restoreAllMocks(); await rm(root, { recursive: true, force: true }); });

  it('releases on operation errors and lets subsequent operations acquire the lock', async () => {
    const release = vi.fn(async () => {});
    const lock = vi.spyOn(lockfile, 'lock').mockResolvedValue(release);
    await expect(serializeFileCache(root, async () => { throw new Error('operation failed'); })).rejects.toThrow('operation failed');
    expect(release).toHaveBeenCalledTimes(1);
    expect(await serializeFileCache(root, async (guard) => { guard(); return 'next'; })).toBe('next');
    expect(release).toHaveBeenCalledTimes(2);
    expect(lock).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ stale: 30_000, update: 5000, lockfilePath: expect.stringMatching(/\.lock$/) }));
  });

  it('fails closed when proper-lockfile reports ownership compromise', async () => {
    const release = vi.fn(async () => {});
    vi.spyOn(lockfile, 'lock').mockImplementation(async (_path, options) => {
      options?.onCompromised?.(new Error('owner compromised'));
      return release;
    });
    const mutation = vi.fn();
    await expect(serializeFileCache(root, async (guard) => { guard(); mutation(); })).rejects.toThrow('owner compromised');
    expect(mutation).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('preserves both operation and release failures', async () => {
    vi.spyOn(lockfile, 'lock').mockResolvedValue(async () => { throw new Error('release failed'); });
    let caught: unknown;
    try { await serializeFileCache(root, async () => { throw new Error('operation failed'); }); } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(AggregateError);
    expect((caught as AggregateError).errors.map(String)).toEqual(['Error: operation failed', 'Error: release failed']);
  });

  it('rejects an overlong critical section before allowing a mutation', async () => {
    const release = vi.fn(async () => {});
    vi.spyOn(lockfile, 'lock').mockResolvedValue(release);
    const clock = vi.spyOn(performance, 'now').mockReturnValue(0);
    const mutation = vi.fn();
    await expect(serializeFileCache(root, async (guard) => { clock.mockReturnValue(11_000); guard(); mutation(); })).rejects.toThrow('safe lock duration');
    expect(mutation).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledTimes(1);
  });
});
