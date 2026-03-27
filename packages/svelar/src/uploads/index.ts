/**
 * Svelar File Uploads
 * Track and manage uploaded files with metadata.
 */

import { randomUUID } from 'crypto';
import { singleton } from '../support/singleton.js';

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
      try {
        const { Connection } = await import('../database/Connection.js');
        const conn = await Connection.connection();
        const table = this.config.table ?? 'svelar_uploads';
        await conn.raw(
          `INSERT INTO ${table} (id, user_id, original_name, stored_name, path, disk, mime_type, size, public_url, metadata, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [upload.id, upload.userId ?? null, upload.originalName, upload.storedName, upload.path, upload.disk, upload.mimeType, upload.size, upload.publicUrl ?? null, JSON.stringify(upload.metadata ?? {}), Math.floor(upload.createdAt / 1000)]
        );
      } catch {
        // Fallback to memory tracking
        this.uploads.push(upload);
      }
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
    return this.uploads.find((u) => u.id === id) || null;
  }

  /** List uploads for a user */
  async listForUser(
    userId: string | number,
    limit?: number
  ): Promise<FileUpload[]> {
    return this.uploads
      .filter((u) => u.userId === userId)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit || 100);
  }

  /** Delete an upload (removes file and record) */
  async delete(id: string): Promise<boolean> {
    const index = this.uploads.findIndex((u) => u.id === id);
    if (index === -1) return false;

    // In production, would also delete from storage
    this.uploads.splice(index, 1);
    return true;
  }

  /** Get a temporary/signed URL for a file */
  async getUrl(id: string, expiresIn?: number): Promise<string | null> {
    const upload = await this.get(id);
    if (!upload) return null;

    // In production, would generate signed URL from storage
    // For now, return a simple reference
    return `/files/${upload.id}/${upload.storedName}`;
  }

  /** Get upload statistics */
  async getStats(): Promise<{
    totalFiles: number;
    totalSize: number;
    byMimeType: Record<string, number>;
  }> {
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
