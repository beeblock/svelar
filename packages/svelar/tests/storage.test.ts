import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { S3Disk, Storage } from '../src/storage/index.js';

class HeadObjectCommand { constructor(_input?: any) {} }
class DeleteObjectCommand { constructor(_input?: any) {} }
class ListObjectsV2Command { constructor(_input?: any) {} }
class HeadBucketCommand { constructor(_input?: any) {} }
class CreateBucketCommand { constructor(_input?: any) {} }
class PutObjectCommand { constructor(_input?: any) {} }
class GetObjectCommand { constructor(_input?: any) {} }
class CopyObjectCommand { constructor(_input?: any) {} }

function createS3Disk(send: (command: any) => Promise<any>): S3Disk {
  const disk = new S3Disk({ driver: 's3', bucket: 'svelar' });
  (disk as any)._s3Module = {
    HeadObjectCommand,
    DeleteObjectCommand,
    ListObjectsV2Command,
    HeadBucketCommand,
    CreateBucketCommand,
    PutObjectCommand,
    GetObjectCommand,
    CopyObjectCommand,
    S3Client: class {},
  };
  (disk as any)._client = { send };
  return disk;
}

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

  it('returns missing semantics for absent local files and directories', async () => {
    await withLocalStorage(async () => {
      expect(await Storage.exists('missing.txt')).toBe(false);
      expect(await Storage.delete('missing.txt')).toBe(false);
      expect(await Storage.files('missing-directory')).toEqual([]);
      expect(await Storage.allFiles('missing-directory')).toEqual([]);
      expect(await Storage.directories('missing-directory')).toEqual([]);
    });
  });

  it('throws local storage errors that are not normal missing paths', async () => {
    await withLocalStorage(async (root) => {
      await writeFile(join(root, 'not-a-directory'), 'file');
      await mkdir(join(root, 'not-a-file'));

      await expect(Storage.files('not-a-directory')).rejects.toThrow();
      await expect(Storage.allFiles('not-a-directory')).rejects.toThrow();
      await expect(Storage.directories('not-a-directory')).rejects.toThrow();
      await expect(Storage.delete('not-a-file')).rejects.toThrow();
    });
  });

  it('only treats S3 not-found errors as missing objects', async () => {
    const notFoundDisk = createS3Disk(async () => {
      const error: any = new Error('missing');
      error.$metadata = { httpStatusCode: 404 };
      throw error;
    });
    await expect(notFoundDisk.exists('missing.txt')).resolves.toBe(false);

    const failingDisk = createS3Disk(async () => {
      throw new Error('s3 credentials are invalid');
    });
    await expect(failingDisk.exists('private.txt')).rejects.toThrow('s3 credentials are invalid');
  });

  it('throws S3 listing errors instead of returning empty arrays', async () => {
    const disk = createS3Disk(async () => {
      throw new Error('bucket is unavailable');
    });

    await expect(disk.files('reports')).rejects.toThrow('bucket is unavailable');
    await expect(disk.directories('reports')).rejects.toThrow('bucket is unavailable');
  });

  it('only creates S3 buckets when the existing bucket is missing', async () => {
    const commands: string[] = [];
    const missingBucketDisk = createS3Disk(async (command) => {
      commands.push(command.constructor.name);
      if (command instanceof HeadBucketCommand) {
        const error: any = new Error('bucket missing');
        error.name = 'NotFound';
        throw error;
      }
      return {};
    });

    await missingBucketDisk.ensureBucket();
    expect(commands).toEqual(['HeadBucketCommand', 'CreateBucketCommand']);

    const authFailureDisk = createS3Disk(async () => {
      throw new Error('s3 auth failed');
    });
    await expect(authFailureDisk.ensureBucket()).rejects.toThrow('s3 auth failed');
  });
});
