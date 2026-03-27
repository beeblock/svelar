/**
 * Svelar API Key Management
 * Generate, validate, and revoke API keys for programmatic access.
 */

import { randomBytes, createHash, timingSafeEqual } from 'crypto';
import { randomUUID } from 'crypto';
import { singleton } from '../support/singleton.js';

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
    return createHash('sha256').update(key).digest('hex');
  }

  private generateRandomKey(length: number = 32): string {
    return randomBytes(length).toString('base64url');
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
      try {
        const { Connection } = await import('../database/Connection.js');
        await Connection.connection();
        // Would insert into api_keys table
      } catch {
        // Fallback to memory
        this.keys.push(record);
      }
    }

    return { record, plainTextKey };
  }

  /** Validate a key and return the associated record */
  async validate(plainTextKey: string): Promise<ApiKeyRecord | null> {
    const hashedKey = this.hashKey(plainTextKey);

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
    const key = this.keys.find((k) => k.id === keyId);
    if (!key) return false;

    key.revokedAt = Date.now();
    return true;
  }

  /** List keys for a user */
  async listForUser(userId: string | number): Promise<ApiKeyRecord[]> {
    return this.keys
      .filter((k) => k.userId === userId && !k.revokedAt)
      .map((k) => ({ ...k })); // Return copies without plaintext
  }

  /** Rotate a key (revoke old, create new with same settings) */
  async rotate(
    keyId: string
  ): Promise<{ record: ApiKeyRecord; plainTextKey: string } | null> {
    const oldKey = this.keys.find((k) => k.id === keyId);
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

    if (!record.permissions || record.permissions.length === 0) {
      return true; // No permissions = all allowed
    }

    return record.permissions.includes(permission);
  }
}

export const ApiKeys = singleton(
  'svelar.apiKeys',
  () => new ApiKeyManager()
);
