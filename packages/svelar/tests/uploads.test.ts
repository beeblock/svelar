import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Storage } from '../src/storage/index.js';
import { Uploads } from '../src/uploads/index.js';

describe('Uploads', () => {
  async function withLocalUploads<T>(callback: (root: string) => Promise<T>): Promise<T> {
    const root = await mkdtemp(join(tmpdir(), 'svelar-uploads-'));
    Uploads.configure({ driver: 'memory', defaultDisk: 'local' });
    Storage.configure({
      default: 'local',
      disks: {
        local: { driver: 'local', root, urlPrefix: '/storage' },
      },
    });

    try {
      return await callback(root);
    } finally {
      await rm(root, { recursive: true, force: true });
      Uploads.configure({ driver: 'memory', defaultDisk: 'local' });
      Storage.configure({ default: 'local', disks: {} });
    }
  }

  it('stores file content and metadata through the configured storage disk', async () => {
    await withLocalUploads(async () => {
      const userId = `uploads-user-${Date.now()}`;
      const upload = await Uploads.store(
        { name: 'avatar.png', data: Buffer.from('avatar'), type: 'image/png' },
        { directory: 'avatars', userId }
      );

      expect(upload.originalName).toBe('avatar.png');
      expect(upload.path).toMatch(/^avatars\/.+\.png$/);
      expect(upload.publicUrl).toBe(`/storage/${upload.path}`);
      await expect(Storage.getText(upload.path)).resolves.toBe('avatar');
      await expect(Uploads.listForUser(userId)).resolves.toEqual([upload]);
    });
  });

  it('throws storage configuration errors instead of creating metadata-only uploads', async () => {
    Uploads.configure({ driver: 'memory', defaultDisk: 'local' });
    Storage.configure({ default: 'local', disks: {} });

    await expect(
      Uploads.store({ name: 'avatar.png', data: Buffer.from('avatar'), type: 'image/png' })
    ).rejects.toThrow('Storage disk "local" is not defined');
  });

  it('does not delete upload metadata when file deletion fails', async () => {
    await withLocalUploads(async () => {
      const upload = await Uploads.store(
        { name: 'avatar.png', data: Buffer.from('avatar'), type: 'image/png' },
        { userId: 1 }
      );

      Storage.configure({ default: 'local', disks: {} });

      await expect(Uploads.delete(upload.id)).rejects.toThrow('Storage disk "local" is not defined');
      await expect(Uploads.get(upload.id)).resolves.not.toBeNull();
    });
  });

  it('throws storage errors when resolving non-public upload URLs', async () => {
    await withLocalUploads(async () => {
      const upload = await Uploads.store(
        { name: 'private.txt', data: Buffer.from('secret'), type: 'text/plain' },
        { userId: 1 }
      );
      upload.publicUrl = undefined;
      Storage.configure({ default: 'local', disks: {} });

      await expect(Uploads.getUrl(upload.id)).rejects.toThrow('Storage disk "local" is not defined');
    });
  });
});
