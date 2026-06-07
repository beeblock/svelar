/**
 * Svelar API Key Management
 * Generate, validate, and revoke API keys for programmatic access.
 */

import { randomBytes, createHash, timingSafeEqual } from 'crypto';
import { randomUUID } from 'crypto';
import { singleton } from '../support/singleton.js';
import { assertSqlIdentifier } from '../database/Connection.js';
import { QueryBuilder } from '../orm/QueryBuilder.js';

export interface ApiKeyRecord {
  id: string;
  userId: string | number;
  name: string;
  key: string; // The hashed key (stored)
  prefix: string; // First 8 chars for identification (e.g., "sk_live_")
  lastUsedAt?: number;
  expiresAt?: number;
  permissions?: string[];
  metadata?: Record<string, any>;
  createdAt: number;
  revokedAt?: number;
}

export interface CreateKeyOptions {
  name: string;
  userId: string | number;
  prefix?: string; // default: 'sk_'
  permissions?: string[];
  expiresIn?: number; // seconds
  metadata?: Record<string, any>;
}

export interface ApiKeyConfig {
  driver: 'database' | 'memory';
  table?: string;
  prefix?: string;
  hashAlgorithm?: string;
}

class ApiKeyManager {
  private config: ApiKeyConfig = { driver: 'memory', prefix: 'sk_' };
  private keys: ApiKeyRecord[] = []; // memory driver

  configure(config: ApiKeyConfig): void {
    this.config = config;
  }

  private hashKey(key: string): string {
    return createHash(this.config.hashAlgorithm ?? 'sha256').update(key).digest('hex');
  }

  private generateRandomKey(length: number = 32): string {
    return randomBytes(length).toString('base64url');
  }

  private table(): string {
    return assertSqlIdentifier(this.config.table ?? 'api_keys', 'API keys table name');
  }

  private query(): QueryBuilder<any> {
    return new QueryBuilder(this.table());
  }

  private rowToRecord(row: any): ApiKeyRecord {
    return {
      id: row.id,
      userId: row.user_id ?? row.userId ?? row.userid,
      name: row.name,
      key: row.key,
      prefix: row.prefix,
      lastUsedAt: row.last_used_at ?? row.lastUsedAt ?? row.lastusedat ?? undefined,
      expiresAt: row.expires_at ?? row.expiresAt ?? row.expiresat ?? undefined,
      permissions: row.permissions ? JSON.parse(row.permissions) : [],
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      createdAt: row.created_at ?? row.createdAt ?? row.createdat,
      revokedAt: row.revoked_at ?? row.revokedAt ?? row.revokedat ?? undefined,
    };
  }

  private async findById(keyId: string): Promise<ApiKeyRecord | null> {
    if (this.config.driver === 'memory') {
      return this.keys.find((k) => k.id === keyId) ?? null;
    }

    const row = await this.query().where('id', keyId).first();
    return row ? this.rowToRecord(row) : null;
  }

  /** Generate a new API key. Returns the PLAIN TEXT key (only shown once!) */
  async create(
    options: CreateKeyOptions
  ): Promise<{ record: ApiKeyRecord; plainTextKey: string }> {
    const prefix = options.prefix || this.config.prefix || 'sk_';
    const plainTextKey = `${prefix}${this.generateRandomKey(32)}`;
    const hashedKey = this.hashKey(plainTextKey);

    const record: ApiKeyRecord = {
      id: randomUUID(),
      userId: options.userId,
      name: options.name,
      key: hashedKey,
      prefix: prefix,
      permissions: options.permissions || [],
      metadata: options.metadata,
      createdAt: Date.now(),
      expiresAt: options.expiresIn
        ? Date.now() + options.expiresIn * 1000
        : undefined,
    };

    if (this.config.driver === 'memory') {
      this.keys.push(record);
    } else if (this.config.driver === 'database') {
      await this.query().insert({
        id: record.id,
        user_id: String(record.userId),
        name: record.name,
        key: record.key,
        prefix: record.prefix,
        last_used_at: record.lastUsedAt ?? null,
        expires_at: record.expiresAt ?? null,
        permissions: JSON.stringify(record.permissions ?? []),
        metadata: record.metadata ? JSON.stringify(record.metadata) : null,
        created_at: record.createdAt,
        revoked_at: record.revokedAt ?? null,
      });
    }

    return { record, plainTextKey };
  }

  /** Validate a key and return the associated record */
  async validate(plainTextKey: string): Promise<ApiKeyRecord | null> {
    const hashedKey = this.hashKey(plainTextKey);

    if (this.config.driver === 'database') {
      const row = await this.query().where('key', hashedKey).whereNull('revoked_at').first();
      if (!row) return null;

      const record = this.rowToRecord(row);
      if (record.expiresAt && record.expiresAt < Date.now()) return null;

      record.lastUsedAt = Date.now();
      await this.query().where('id', record.id).update({ last_used_at: record.lastUsedAt });
      return record;
    }

    for (const record of this.keys) {
      if (record.revokedAt) continue;

      // Check expiry
      if (record.expiresAt && record.expiresAt < Date.now()) {
        continue;
      }

      // Use timing-safe comparison to prevent timing attacks
      try {
        if (
          timingSafeEqual(
            Buffer.from(record.key),
            Buffer.from(hashedKey)
          )
        ) {
          // Update lastUsedAt
          record.lastUsedAt = Date.now();
          return record;
        }
      } catch {
        // Timing safe equal throws if buffers are different lengths
        continue;
      }
    }

    return null;
  }

  /** Revoke a key */
  async revoke(keyId: string): Promise<boolean> {
    if (this.config.driver === 'database') {
      const existing = await this.findById(keyId);
      if (!existing || existing.revokedAt) return false;

      await this.query().where('id', keyId).whereNull('revoked_at').update({ revoked_at: Date.now() });
      return true;
    }

    const key = this.keys.find((k) => k.id === keyId);
    if (!key) return false;

    key.revokedAt = Date.now();
    return true;
  }

  /** List keys for a user */
  async listForUser(userId: string | number): Promise<ApiKeyRecord[]> {
    if (this.config.driver === 'database') {
      const rows = await this.query()
        .where('user_id', String(userId))
        .whereNull('revoked_at')
        .orderBy('created_at', 'desc')
        .get();
      return rows.map((row: any) => this.rowToRecord(row));
    }

    return this.keys
      .filter((k) => k.userId === userId && !k.revokedAt)
      .map((k) => ({ ...k })); // Return copies without plaintext
  }

  /** Rotate a key (revoke old, create new with same settings) */
  async rotate(
    keyId: string
  ): Promise<{ record: ApiKeyRecord; plainTextKey: string } | null> {
    const oldKey = await this.findById(keyId);
    if (!oldKey || oldKey.revokedAt) return null;

    // Revoke old key
    await this.revoke(keyId);

    // Create new key with same settings
    return this.create({
      name: `${oldKey.name} (rotated)`,
      userId: oldKey.userId,
      prefix: oldKey.prefix,
      permissions: oldKey.permissions,
      metadata: oldKey.metadata,
    });
  }

  /** Check if a key has a specific permission */
  async hasPermission(
    plainTextKey: string,
    permission: string
  ): Promise<boolean> {
    const record = await this.validate(plainTextKey);
    if (!record) return false;

    if (!record.permissions || record.permissions.length === 0) return false;
    if (record.permissions.includes('*')) return true;

    return record.permissions.includes(permission);
  }
}

export const ApiKeys = singleton(
  'svelar.apiKeys',
  () => new ApiKeyManager()
);
