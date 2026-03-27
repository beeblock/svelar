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
  /** S3 / RustFS configuration */
  bucket?: string;
  region?: string;
  /** S3-compatible endpoint URL (e.g. http://rustfs:9000 for RustFS/MinIO) */
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  /** Force path-style addressing (required for RustFS/MinIO, default: true) */
  forcePathStyle?: boolean;
  /** Optional prefix/directory within the bucket */
  prefix?: string;
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

// ── S3-Compatible Disk (RustFS / MinIO / AWS S3) ──────────

/**
 * S3-compatible storage disk using @aws-sdk/client-s3.
 * Works with RustFS, MinIO, AWS S3, and any S3-compatible service.
 * Requires: npm install @aws-sdk/client-s3 (peer dependency, loaded dynamically)
 */
class S3Disk implements Disk {
  private config: DiskConfig;
  private _client: any = null;
  private _s3Module: any = null;

  constructor(config: DiskConfig) {
    if (!config.bucket) {
      throw new Error('S3 disk requires a "bucket" name.');
    }
    this.config = config;
  }

  private async getS3(): Promise<any> {
    if (this._s3Module) return this._s3Module;
    try {
      this._s3Module = await (Function('return import("@aws-sdk/client-s3")')() as Promise<any>);
      return this._s3Module;
    } catch {
      throw new Error(
        'S3 storage driver requires @aws-sdk/client-s3. Install it with: npm install @aws-sdk/client-s3'
      );
    }
  }

  private async getClient(): Promise<any> {
    if (this._client) return this._client;
    const s3 = await this.getS3();

    this._client = new s3.S3Client({
      region: this.config.region ?? 'us-east-1',
      endpoint: this.config.endpoint,
      forcePathStyle: this.config.forcePathStyle ?? true,
      credentials: {
        accessKeyId: this.config.accessKeyId ?? '',
        secretAccessKey: this.config.secretAccessKey ?? '',
      },
    });

    return this._client;
  }

  private key(path: string): string {
    const prefix = this.config.prefix;
    return prefix ? `${prefix}/${path}` : path;
  }

  async get(path: string): Promise<Buffer> {
    const s3 = await this.getS3();
    const client = await this.getClient();

    const response = await client.send(
      new s3.GetObjectCommand({
        Bucket: this.config.bucket,
        Key: this.key(path),
      })
    );

    // Read the stream into a Buffer
    const bytes = await response.Body.transformToByteArray();
    return Buffer.from(bytes);
  }

  async getText(path: string): Promise<string> {
    const buffer = await this.get(path);
    return buffer.toString('utf-8');
  }

  async put(path: string, content: string | Buffer): Promise<void> {
    const s3 = await this.getS3();
    const client = await this.getClient();

    const body = typeof content === 'string' ? Buffer.from(content, 'utf-8') : content;

    await client.send(
      new s3.PutObjectCommand({
        Bucket: this.config.bucket,
        Key: this.key(path),
        Body: body,
      })
    );
  }

  async append(path: string, content: string | Buffer): Promise<void> {
    // S3 doesn't support append natively — read + concat + write
    let existing: Buffer | null = null;
    try {
      existing = await this.get(path);
    } catch {
      // File doesn't exist yet, that's fine
    }

    const appendBuffer = typeof content === 'string' ? Buffer.from(content, 'utf-8') : content;
    const combined = existing ? Buffer.concat([existing, appendBuffer] as any) : appendBuffer;
    await this.put(path, combined);
  }

  async exists(path: string): Promise<boolean> {
    const s3 = await this.getS3();
    const client = await this.getClient();

    try {
      await client.send(
        new s3.HeadObjectCommand({
          Bucket: this.config.bucket,
          Key: this.key(path),
        })
      );
      return true;
    } catch {
      return false;
    }
  }

  async delete(path: string): Promise<boolean> {
    const s3 = await this.getS3();
    const client = await this.getClient();

    try {
      await client.send(
        new s3.DeleteObjectCommand({
          Bucket: this.config.bucket,
          Key: this.key(path),
        })
      );
      return true;
    } catch {
      return false;
    }
  }

  async copy(from: string, to: string): Promise<void> {
    const s3 = await this.getS3();
    const client = await this.getClient();

    await client.send(
      new s3.CopyObjectCommand({
        Bucket: this.config.bucket,
        CopySource: `${this.config.bucket}/${this.key(from)}`,
        Key: this.key(to),
      })
    );
  }

  async move(from: string, to: string): Promise<void> {
    await this.copy(from, to);
    await this.delete(from);
  }

  async files(directory: string = ''): Promise<string[]> {
    const s3 = await this.getS3();
    const client = await this.getClient();
    const prefix = this.key(directory ? `${directory}/` : '');

    try {
      const response = await client.send(
        new s3.ListObjectsV2Command({
          Bucket: this.config.bucket,
          Prefix: prefix,
          Delimiter: '/',
        })
      );

      return (response.Contents ?? [])
        .map((obj: any) => obj.Key)
        .filter((key: string) => key !== prefix)
        .map((key: string) => {
          // Strip the disk prefix to return relative paths
          const p = this.config.prefix;
          return p ? key.slice(p.length + 1) : key;
        });
    } catch {
      return [];
    }
  }

  async allFiles(directory: string = ''): Promise<string[]> {
    const s3 = await this.getS3();
    const client = await this.getClient();
    const prefix = this.key(directory ? `${directory}/` : '');

    const results: string[] = [];
    let continuationToken: string | undefined;

    do {
      const response: any = await client.send(
        new s3.ListObjectsV2Command({
          Bucket: this.config.bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        })
      );

      for (const obj of response.Contents ?? []) {
        const p = this.config.prefix;
        const key = p ? obj.Key.slice(p.length + 1) : obj.Key;
        if (key) results.push(key);
      }

      continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
    } while (continuationToken);

    return results;
  }

  async directories(directory: string = ''): Promise<string[]> {
    const s3 = await this.getS3();
    const client = await this.getClient();
    const prefix = this.key(directory ? `${directory}/` : '');

    try {
      const response = await client.send(
        new s3.ListObjectsV2Command({
          Bucket: this.config.bucket,
          Prefix: prefix,
          Delimiter: '/',
        })
      );

      return (response.CommonPrefixes ?? [])
        .map((cp: any) => {
          const p = this.config.prefix;
          const key = p ? cp.Prefix.slice(p.length + 1) : cp.Prefix;
          return key.replace(/\/$/, ''); // strip trailing slash
        })
        .filter((d: string) => d.length > 0);
    } catch {
      return [];
    }
  }

  async makeDirectory(_path: string): Promise<void> {
    // S3 doesn't have directories — they're implicit from object key prefixes.
    // No-op, but we keep the interface consistent.
  }

  async deleteDirectory(path: string): Promise<void> {
    // Delete all objects under this prefix
    const allFiles = await this.allFiles(path);
    for (const file of allFiles) {
      await this.delete(file);
    }
  }

  async size(path: string): Promise<number> {
    const s3 = await this.getS3();
    const client = await this.getClient();

    const response = await client.send(
      new s3.HeadObjectCommand({
        Bucket: this.config.bucket,
        Key: this.key(path),
      })
    );

    return response.ContentLength ?? 0;
  }

  async lastModified(path: string): Promise<Date> {
    const s3 = await this.getS3();
    const client = await this.getClient();

    const response = await client.send(
      new s3.HeadObjectCommand({
        Bucket: this.config.bucket,
        Key: this.key(path),
      })
    );

    return response.LastModified ?? new Date();
  }

  url(path: string): string {
    const urlPrefix = this.config.urlPrefix;
    if (urlPrefix) {
      return `${urlPrefix}/${path}`;
    }
    // Build S3/RustFS URL from endpoint
    const endpoint = this.config.endpoint ?? `https://s3.${this.config.region ?? 'us-east-1'}.amazonaws.com`;
    if (this.config.forcePathStyle !== false) {
      return `${endpoint}/${this.config.bucket}/${this.key(path)}`;
    }
    return `${endpoint.replace('://', `://${this.config.bucket}.`)}/${this.key(path)}`;
  }

  /**
   * Generate a pre-signed URL for temporary access to a file.
   * Requires: npm install @aws-sdk/s3-request-presigner
   */
  async temporaryUrl(path: string, expiresInSeconds: number = 3600): Promise<string> {
    try {
      const presigner = await (Function('return import("@aws-sdk/s3-request-presigner")')() as Promise<any>);
      const s3 = await this.getS3();
      const client = await this.getClient();

      const command = new s3.GetObjectCommand({
        Bucket: this.config.bucket,
        Key: this.key(path),
      });

      return await presigner.getSignedUrl(client, command, { expiresIn: expiresInSeconds });
    } catch {
      throw new Error(
        'Pre-signed URLs require @aws-sdk/s3-request-presigner. Install it with: npm install @aws-sdk/s3-request-presigner'
      );
    }
  }

  /**
   * Ensure the bucket exists, creating it if not.
   * Useful for initial setup with RustFS/MinIO.
   */
  async ensureBucket(): Promise<void> {
    const s3 = await this.getS3();
    const client = await this.getClient();

    try {
      await client.send(
        new s3.HeadBucketCommand({ Bucket: this.config.bucket })
      );
    } catch {
      // Bucket doesn't exist — create it
      await client.send(
        new s3.CreateBucketCommand({ Bucket: this.config.bucket })
      );
    }
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
        return new S3Disk(config);
      default:
        throw new Error(`Unknown storage driver: ${config.driver}`);
    }
  }

  /**
   * Get the S3 disk instance with extended S3 methods (temporaryUrl, ensureBucket).
   * Throws if the named disk is not an S3 disk.
   */
  s3Disk(name?: string): S3Disk {
    const d = this.disk(name);
    if (!(d instanceof S3Disk)) {
      throw new Error(`Disk "${name ?? this.config?.default}" is not an S3 disk.`);
    }
    return d;
  }
}

import { singleton } from '../support/singleton.js';

/**
 * Global Storage singleton
 */
export const Storage = singleton('svelar.storage', () => new StorageManager());

export type { Disk, StorageManager };
export { S3Disk };
