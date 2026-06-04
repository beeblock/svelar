/**
 * Svelar File Uploads
 * Track and manage uploaded files with metadata.
 */

import { randomUUID } from 'crypto';
import { singleton } from '../support/singleton.js';
import { assertSqlIdentifier } from '../database/Connection.js';
import { QueryBuilder } from '../orm/QueryBuilder.js';

export interface FileUpload {
  id: string;
  userId?: string | number;
  originalName: string;
  storedName: string;
  path: string;
  disk: string;
  mimeType: string;
  size: number;
  metadata?: Record<string, any>;
  publicUrl?: string;
  createdAt: number;
}

export interface UploadOptions {
  userId?: string | number;
  disk?: string;
  directory?: string;
  maxSize?: number; // bytes
  allowedMimes?: string[];
  generateThumbnail?: boolean;
  public?: boolean;
}

export interface UploadsConfig {
  driver: 'database' | 'memory';
  table?: string;
  maxFileSize?: number;
  allowedMimeTypes?: string[];
  defaultDisk?: string;
}

class UploadManager {
  private config: UploadsConfig = {
    driver: 'memory',
    maxFileSize: 10 * 1024 * 1024,
  };
  private uploads: FileUpload[] = [];

  configure(config: UploadsConfig): void {
    this.config = { ...this.config, ...config };
  }

  private table(): string {
    return assertSqlIdentifier(this.config.table ?? 'svelar_uploads', 'Uploads table name');
  }

  private query(): QueryBuilder<any> {
    return new QueryBuilder(this.table());
  }

  private rowToUpload(row: any): FileUpload {
    return {
      id: row.id,
      userId: row.user_id ?? row.userId ?? row.userid ?? undefined,
      originalName: row.original_name ?? row.originalName ?? row.originalname,
      storedName: row.stored_name ?? row.storedName ?? row.storedname,
      path: row.path,
      disk: row.disk,
      mimeType: row.mime_type ?? row.mimeType ?? row.mimetype,
      size: row.size,
      publicUrl: row.public_url ?? row.publicUrl ?? row.publicurl ?? undefined,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      createdAt: typeof row.created_at === 'number'
        ? row.created_at * 1000
        : row.createdAt ?? row.createdat,
    };
  }

  /** Store an uploaded file */
  async store(
    file: { name: string; data: Buffer | Uint8Array; type: string },
    options?: UploadOptions
  ): Promise<FileUpload> {
    // Validate mime type
    const allowedMimes =
      options?.allowedMimes || this.config.allowedMimeTypes;
    if (allowedMimes && !allowedMimes.includes(file.type)) {
      throw new Error(
        `File type ${file.type} not allowed. Allowed: ${allowedMimes.join(', ')}`
      );
    }

    // Validate size
    const maxSize = options?.maxSize || this.config.maxFileSize || 10 * 1024 * 1024;
    const fileData = Buffer.isBuffer(file.data)
      ? file.data
      : Buffer.from(file.data);

    if (fileData.length > maxSize) {
      throw new Error(
        `File size exceeds maximum of ${maxSize / 1024 / 1024}MB`
      );
    }

    // Generate unique stored name
    const extension = this.getExtension(file.name);
    const storedName = `${randomUUID()}${extension ? `.${extension}` : ''}`;

    // Build path
    const directory = options?.directory || '';
    const disk = options?.disk || this.config.defaultDisk || 'local';
    const path = directory ? `${directory}/${storedName}` : storedName;

    // Create upload record
    const upload: FileUpload = {
      id: randomUUID(),
      userId: options?.userId,
      originalName: file.name,
      storedName,
      path,
      disk,
      mimeType: file.type,
      size: fileData.length,
      metadata: options?.public ? { public: true } : undefined,
      createdAt: Date.now(),
    };

    // Store the actual file via the Storage facade
    try {
      const { Storage } = await import('../storage/index.js');
      await Storage.disk(disk).put(path, fileData);
      upload.publicUrl = Storage.disk(disk).url(path);
    } catch {
      // Storage not configured — metadata-only mode (development)
    }

    // Track the upload record
    if (this.config.driver === 'memory') {
      this.uploads.push(upload);
    } else if (this.config.driver === 'database') {
      await this.query().insert({
        id: upload.id,
        user_id: upload.userId == null ? null : String(upload.userId),
        original_name: upload.originalName,
        stored_name: upload.storedName,
        path: upload.path,
        disk: upload.disk,
        mime_type: upload.mimeType,
        size: upload.size,
        public_url: upload.publicUrl ?? null,
        metadata: JSON.stringify(upload.metadata ?? {}),
        created_at: Math.floor(upload.createdAt / 1000),
      });
    }

    return upload;
  }

  /** Store from a SvelteKit request */
  async storeFromRequest(
    formData: FormData,
    fieldName: string,
    options?: UploadOptions
  ): Promise<FileUpload | null> {
    const fileData = formData.get(fieldName);

    if (!(fileData instanceof File)) {
      return null;
    }

    const buffer = await fileData.arrayBuffer();

    return this.store(
      {
        name: fileData.name,
        data: Buffer.from(buffer),
        type: fileData.type,
      },
      options
    );
  }

  /** Get upload by ID */
  async get(id: string): Promise<FileUpload | null> {
    if (this.config.driver === 'database') {
      const row = await this.query().where('id', id).first();
      return row ? this.rowToUpload(row) : null;
    }

    return this.uploads.find((u) => u.id === id) || null;
  }

  /** List uploads for a user */
  async listForUser(
    userId: string | number,
    limit?: number
  ): Promise<FileUpload[]> {
    if (this.config.driver === 'database') {
      const rows = await this.query()
        .where('user_id', String(userId))
        .orderBy('created_at', 'desc')
        .limit(limit || 100)
        .get();
      return rows.map((row: any) => this.rowToUpload(row));
    }

    return this.uploads
      .filter((u) => u.userId === userId)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit || 100);
  }

  /** Delete an upload (removes file and record) */
  async delete(id: string): Promise<boolean> {
    const upload = await this.get(id);
    if (!upload) return false;

    try {
      const { Storage } = await import('../storage/index.js');
      await Storage.disk(upload.disk).delete(upload.path);
    } catch {
      // Storage may be unconfigured; still delete the tracking record.
    }

    if (this.config.driver === 'database') {
      await this.query().where('id', id).delete();
      return true;
    }

    const index = this.uploads.findIndex((u) => u.id === id);
    this.uploads.splice(index, 1);
    return true;
  }

  /** Get a temporary/signed URL for a file */
  async getUrl(id: string, expiresIn?: number): Promise<string | null> {
    const upload = await this.get(id);
    if (!upload) return null;

    if (upload.publicUrl) return upload.publicUrl;

    try {
      const { Storage } = await import('../storage/index.js');
      const disk = Storage.disk(upload.disk) as any;
      if (typeof disk.temporaryUrl === 'function' && expiresIn) {
        return disk.temporaryUrl(upload.path, expiresIn);
      }
      return disk.url(upload.path);
    } catch {
      // Storage may be unconfigured; return a stable reference.
    }

    return `/files/${upload.id}/${upload.storedName}`;
  }

  /** Get upload statistics */
  async getStats(): Promise<{
    totalFiles: number;
    totalSize: number;
    byMimeType: Record<string, number>;
  }> {
    if (this.config.driver === 'database') {
      const rows = await this.query().select('mime_type', 'size').get();
      const byMimeType: Record<string, number> = {};
      let totalSize = 0;

      for (const row of rows) {
        const mime = row.mime_type ?? row.mimeType ?? row.mimetype;
        byMimeType[mime] = (byMimeType[mime] || 0) + 1;
        totalSize += row.size;
      }

      return { totalFiles: rows.length, totalSize, byMimeType };
    }

    const byMimeType: Record<string, number> = {};
    let totalSize = 0;

    for (const upload of this.uploads) {
      byMimeType[upload.mimeType] = (byMimeType[upload.mimeType] || 0) + 1;
      totalSize += upload.size;
    }

    return {
      totalFiles: this.uploads.length,
      totalSize,
      byMimeType,
    };
  }

  /** Helper: Extract file extension */
  private getExtension(filename: string): string {
    const parts = filename.split('.');
    return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : '';
  }
}

export const Uploads = singleton('svelar.uploads', () => new UploadManager());
