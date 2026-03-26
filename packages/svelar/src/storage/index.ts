/**
 * Svelar Storage / Filesystem
 *
 * Laravel-inspired filesystem abstraction with local and S3-compatible drivers.
 *
 * @example
 * ```ts
 * import { Storage } from 'svelar/storage';
 *
 * // Configure
 * Storage.configure({
 *   default: 'local',
 *   disks: {
 *     local: { driver: 'local', root: './storage' },
 *     public: { driver: 'local', root: './storage/public', urlPrefix: '/storage' },
 *   },
 * });
 *
 * // Usage
 * await Storage.put('avatars/user-1.png', buffer);
 * const content = await Storage.get('avatars/user-1.png');
 * const exists = await Storage.exists('avatars/user-1.png');
 * await Storage.delete('avatars/user-1.png');
 * const files = await Storage.files('avatars');
 * ```
 */

import { readFile, writeFile, unlink, mkdir, readdir, stat, copyFile, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname, extname, basename } from 'node:path';

// ── Types ──────────────────────────────────────────────────

export type StorageDriver = 'local' | 's3';

export interface DiskConfig {
  driver: StorageDriver;
  /** Root path for local driver */
  root?: string;
  /** URL prefix for public files */
  urlPrefix?: string;
  /** S3 configuration */
  bucket?: string;
  region?: string;
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
}

export interface StorageConfig {
  default: string;
  disks: Record<string, DiskConfig>;
}

export interface FileInfo {
  path: string;
  name: string;
  extension: string;
  size: number;
  lastModified: Date;
}

// ── Storage Disk Interface ─────────────────────────────────

interface Disk {
  get(path: string): Promise<Buffer>;
  getText(path: string): Promise<string>;
  put(path: string, content: string | Buffer): Promise<void>;
  append(path: string, content: string | Buffer): Promise<void>;
  exists(path: string): Promise<boolean>;
  delete(path: string): Promise<boolean>;
  copy(from: string, to: string): Promise<void>;
  move(from: string, to: string): Promise<void>;
  files(directory?: string): Promise<string[]>;
  allFiles(directory?: string): Promise<string[]>;
  directories(directory?: string): Promise<string[]>;
  makeDirectory(path: string): Promise<void>;
  deleteDirectory(path: string): Promise<void>;
  size(path: string): Promise<number>;
  lastModified(path: string): Promise<Date>;
  url(path: string): string;
}

// ── Local Disk ─────────────────────────────────────────────

class LocalDisk implements Disk {
  constructor(private config: DiskConfig) {
    if (!config.root) {
      throw new Error('Local disk requires a "root" path.');
    }
  }

  private resolve(path: string): string {
    return join(this.config.root!, path);
  }

  async get(path: string): Promise<Buffer> {
    return readFile(this.resolve(path));
  }

  async getText(path: string): Promise<string> {
    return readFile(this.resolve(path), 'utf-8');
  }

  async put(path: string, content: string | Buffer): Promise<void> {
    const fullPath = this.resolve(path);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, content);
  }

  async append(path: string, content: string | Buffer): Promise<void> {
    const { appendFile } = await import('node:fs/promises');
    const fullPath = this.resolve(path);
    await mkdir(dirname(fullPath), { recursive: true });
    await appendFile(fullPath, content);
  }

  async exists(path: string): Promise<boolean> {
    return existsSync(this.resolve(path));
  }

  async delete(path: string): Promise<boolean> {
    try {
      await unlink(this.resolve(path));
      return true;
    } catch {
      return false;
    }
  }

  async copy(from: string, to: string): Promise<void> {
    const destPath = this.resolve(to);
    await mkdir(dirname(destPath), { recursive: true });
    await copyFile(this.resolve(from), destPath);
  }

  async move(from: string, to: string): Promise<void> {
    const destPath = this.resolve(to);
    await mkdir(dirname(destPath), { recursive: true });
    await rename(this.resolve(from), destPath);
  }

  async files(directory: string = ''): Promise<string[]> {
    const dir = this.resolve(directory);
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      return entries.filter((e) => e.isFile()).map((e) => (directory ? `${directory}/${e.name}` : e.name));
    } catch {
      return [];
    }
  }

  async allFiles(directory: string = ''): Promise<string[]> {
    const results: string[] = [];
    const dir = this.resolve(directory);

    try {
      const entries = await readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const path = directory ? `${directory}/${entry.name}` : entry.name;
        if (entry.isFile()) {
          results.push(path);
        } else if (entry.isDirectory()) {
          results.push(...(await this.allFiles(path)));
        }
      }
    } catch {
      // Directory doesn't exist
    }

    return results;
  }

  async directories(directory: string = ''): Promise<string[]> {
    const dir = this.resolve(directory);
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      return entries.filter((e) => e.isDirectory()).map((e) => (directory ? `${directory}/${e.name}` : e.name));
    } catch {
      return [];
    }
  }

  async makeDirectory(path: string): Promise<void> {
    await mkdir(this.resolve(path), { recursive: true });
  }

  async deleteDirectory(path: string): Promise<void> {
    const { rm } = await import('node:fs/promises');
    await rm(this.resolve(path), { recursive: true, force: true });
  }

  async size(path: string): Promise<number> {
    const stats = await stat(this.resolve(path));
    return stats.size;
  }

  async lastModified(path: string): Promise<Date> {
    const stats = await stat(this.resolve(path));
    return stats.mtime;
  }

  url(path: string): string {
    const prefix = this.config.urlPrefix ?? '';
    return `${prefix}/${path}`;
  }
}

// ── Storage Manager ────────────────────────────────────────

class StorageManager {
  private config: StorageConfig | null = null;
  private disks = new Map<string, Disk>();

  /**
   * Configure the storage manager
   */
  configure(config: StorageConfig): void {
    this.config = config;
  }

  /**
   * Get a disk instance by name (or default)
   */
  disk(name?: string): Disk {
    const diskName = name ?? this.config?.default ?? 'local';

    if (this.disks.has(diskName)) {
      return this.disks.get(diskName)!;
    }

    if (!this.config) {
      throw new Error('Storage not configured. Call Storage.configure() first.');
    }

    const diskConfig = this.config.disks[diskName];
    if (!diskConfig) {
      throw new Error(`Storage disk "${diskName}" is not defined.`);
    }

    const disk = this.createDisk(diskConfig);
    this.disks.set(diskName, disk);
    return disk;
  }

  // Proxy methods to default disk
  async get(path: string): Promise<Buffer> { return this.disk().get(path); }
  async getText(path: string): Promise<string> { return this.disk().getText(path); }
  async put(path: string, content: string | Buffer): Promise<void> { return this.disk().put(path, content); }
  async append(path: string, content: string | Buffer): Promise<void> { return this.disk().append(path, content); }
  async exists(path: string): Promise<boolean> { return this.disk().exists(path); }
  async delete(path: string): Promise<boolean> { return this.disk().delete(path); }
  async copy(from: string, to: string): Promise<void> { return this.disk().copy(from, to); }
  async move(from: string, to: string): Promise<void> { return this.disk().move(from, to); }
  async files(directory?: string): Promise<string[]> { return this.disk().files(directory); }
  async allFiles(directory?: string): Promise<string[]> { return this.disk().allFiles(directory); }
  async directories(directory?: string): Promise<string[]> { return this.disk().directories(directory); }
  async makeDirectory(path: string): Promise<void> { return this.disk().makeDirectory(path); }
  async deleteDirectory(path: string): Promise<void> { return this.disk().deleteDirectory(path); }
  async size(path: string): Promise<number> { return this.disk().size(path); }
  async lastModified(path: string): Promise<Date> { return this.disk().lastModified(path); }
  url(path: string): string { return this.disk().url(path); }

  private createDisk(config: DiskConfig): Disk {
    switch (config.driver) {
      case 'local':
        return new LocalDisk(config);
      case 's3':
        throw new Error('S3 driver requires an adapter. Install: npm install @aws-sdk/client-s3');
      default:
        throw new Error(`Unknown storage driver: ${config.driver}`);
    }
  }
}

import { singleton } from '../support/singleton.js';

/**
 * Global Storage singleton
 */
export const Storage = singleton('svelar.storage', () => new StorageManager());

export type { Disk, StorageManager };
