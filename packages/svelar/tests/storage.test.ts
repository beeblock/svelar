import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { Storage } from '../src/storage/index.js';

describe('Storage', () => {
  async function withLocalStorage<T>(callback: (root: string) => Promise<T>): Promise<T> {
    const root = await mkdtemp(join(tmpdir(), 'svelar-storage-'));
    Storage.configure({
      default: 'local',
      disks: {
        local: { driver: 'local', root },
      },
    });

    try {
      return await callback(root);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }

  it('rejects local paths that escape the disk root', async () => {
    await withLocalStorage(async () => {
      await expect(Storage.put('../escape.txt', 'nope')).rejects.toThrow(/escapes disk root/);
      await expect(Storage.put('/tmp/escape.txt', 'nope')).rejects.toThrow(/escapes disk root/);
    });
  });

  it('uses the latest disk config after reconfigure', async () => {
    const first = await mkdtemp(join(tmpdir(), 'svelar-storage-first-'));
    const second = await mkdtemp(join(tmpdir(), 'svelar-storage-second-'));

    try {
      Storage.configure({
        default: 'local',
        disks: {
          local: { driver: 'local', root: first },
        },
      });
      await Storage.put('one.txt', 'first');

      Storage.configure({
        default: 'local',
        disks: {
          local: { driver: 'local', root: second },
        },
      });
      await Storage.put('two.txt', 'second');

      expect(await Storage.exists('one.txt')).toBe(false);
      expect(await Storage.getText('two.txt')).toBe('second');
    } finally {
      await rm(first, { recursive: true, force: true });
      await rm(second, { recursive: true, force: true });
    }
  });
});
