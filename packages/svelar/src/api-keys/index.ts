/**
 * Svelar API Key Management
 * Generate, validate, and revoke API keys for programmatic access.
 */

import { randomBytes, createHash, timingSafeEqual } from 'crypto';
import { randomUUID } from 'crypto';
import { singleton } from '../support/singleton.js';
import { assertSqlIdentifier, Connection } from '../database/Connection.js';
import { QueryBuilder } from '../orm/QueryBuilder.js';
import { Cache } from '../cache/index.js';
import { ApplicationContext } from '../support/Context.js';

export type ApiKeyActorType = 'user' | 'service_account' | 'system';

export interface ApiKeyRateLimit {
  limit: number;
  window: number;
}

export interface ApiKeyRecord {
  id: string;
  userId?: string | number;
  teamId?: string | number;
  actorType?: ApiKeyActorType;
  actorId?: string | number;
  serviceAccountId?: string;
  name: string;
  key: string; // The hashed key (stored)
  prefix: string; // First 8 chars for identification (e.g., "sk_live_")
  lastUsedAt?: number;
  lastUsedIp?: string;
  expiresAt?: number;
  permissions?: string[];
  allowedIps?: string[];
  rateLimit?: ApiKeyRateLimit;
  metadata?: Record<string, any>;
  createdAt: number;
  revokedAt?: number;
  disabledAt?: number;
}

export interface CreateKeyOptions {
  name: string;
  userId?: string | number;
  teamId?: string | number;
  actorType?: ApiKeyActorType;
  actorId?: string | number;
  serviceAccountId?: string;
  prefix?: string; // default: 'sk_'
  permissions?: string[];
  allowedIps?: string[];
  rateLimit?: ApiKeyRateLimit;
  expiresIn?: number; // seconds
  metadata?: Record<string, any>;
}

export interface CreateServiceAccountOptions extends Omit<CreateKeyOptions, 'actorType' | 'actorId' | 'serviceAccountId'> {
  teamId: string | number;
  actorId?: string | number;
  serviceAccountId?: string;
}

export interface ApiKeyValidationContext {
  ip?: string;
  now?: number;
  consumeRateLimit?: boolean;
}

export interface ApiKeyConfig {
  driver: 'database' | 'memory';
  table?: string;
  prefix?: string;
  hashAlgorithm?: string;
}

export class ApiKeyRateLimitError extends Error {
  constructor(
    message: string,
    public readonly record: ApiKeyRecord,
    public readonly retryAfter: number,
  ) {
    super(message);
    this.name = 'ApiKeyRateLimitError';
  }
}

export class ApiKeyAccessDeniedError extends Error {
  constructor(message: string, public readonly record: ApiKeyRecord) {
    super(message);
    this.name = 'ApiKeyAccessDeniedError';
  }
}

class ApiKeyManager {
  private config: ApiKeyConfig = { driver: 'memory', prefix: 'sk_' };
  private keys: ApiKeyRecord[] = []; // memory driver
  private sqliteRotationTail: Promise<void> = Promise.resolve();

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

  private databaseTimestamp(value: unknown, field: string): number | undefined {
    if (value == null) return undefined;
    if (typeof value !== 'number' && typeof value !== 'bigint' &&
      (typeof value !== 'string' || !/^-?\d+$/.test(value))) {
      throw new Error(`Invalid API key ${field} timestamp.`);
    }
    const timestamp = Number(value);
    if (!Number.isSafeInteger(timestamp)) throw new Error(`Invalid API key ${field} timestamp.`);
    return timestamp;
  }

  private rowToRecord(row: any): ApiKeyRecord {
    const createdAt = this.databaseTimestamp(row.created_at ?? row.createdAt ?? row.createdat, 'created_at');
    if (createdAt === undefined) throw new Error('Missing API key created_at timestamp.');
    return {
      id: row.id,
      userId: (row.user_id ?? row.userId ?? row.userid) || undefined,
      teamId: row.team_id ?? row.teamId ?? row.teamid ?? undefined,
      actorType: row.actor_type ?? row.actorType ?? row.actortype ?? undefined,
      actorId: row.actor_id ?? row.actorId ?? row.actorid ?? undefined,
      serviceAccountId: row.service_account_id ?? row.serviceAccountId ?? row.serviceaccountid ?? undefined,
      name: row.name,
      key: row.key,
      prefix: row.prefix,
      lastUsedAt: this.databaseTimestamp(row.last_used_at ?? row.lastUsedAt ?? row.lastusedat, 'last_used_at'),
      lastUsedIp: row.last_used_ip ?? row.lastUsedIp ?? row.lastusedip ?? undefined,
      expiresAt: this.databaseTimestamp(row.expires_at ?? row.expiresAt ?? row.expiresat, 'expires_at'),
      permissions: row.permissions ? JSON.parse(row.permissions) : [],
      allowedIps: row.allowed_ips ? JSON.parse(row.allowed_ips) : [],
      rateLimit: row.rate_limit ? JSON.parse(row.rate_limit) : undefined,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      createdAt,
      revokedAt: this.databaseTimestamp(row.revoked_at ?? row.revokedAt ?? row.revokedat, 'revoked_at'),
      disabledAt: this.databaseTimestamp(row.disabled_at ?? row.disabledAt ?? row.disabledat, 'disabled_at'),
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
    const generated = this.generateKey(options);
    await this.persistKey(generated.record);
    return generated;
  }

  private generateKey(options: CreateKeyOptions): { record: ApiKeyRecord; plainTextKey: string } {
    if (options.actorType !== 'service_account' && options.userId === undefined) {
      throw new Error('API keys require userId unless actorType is service_account.');
    }
    if (options.actorType === 'service_account' && options.teamId === undefined) {
      throw new Error('Service account API keys require teamId.');
    }

    const prefix = options.prefix || this.config.prefix || 'sk_';
    const plainTextKey = `${prefix}${this.generateRandomKey(32)}`;
    const hashedKey = this.hashKey(plainTextKey);
    const serviceAccountId = options.serviceAccountId ?? (options.actorType === 'service_account' ? randomUUID() : undefined);

    const record: ApiKeyRecord = {
      id: randomUUID(),
      userId: options.userId,
      teamId: options.teamId,
      actorType: options.actorType ?? 'user',
      actorId: options.actorId ?? options.userId ?? serviceAccountId,
      serviceAccountId,
      name: options.name,
      key: hashedKey,
      prefix: prefix,
      permissions: options.permissions || [],
      allowedIps: options.allowedIps ?? [],
      rateLimit: options.rateLimit,
      metadata: options.metadata,
      createdAt: Date.now(),
      expiresAt: options.expiresIn
        ? Date.now() + options.expiresIn * 1000
        : undefined,
    };

    return { record, plainTextKey };
  }

  private async persistKey(record: ApiKeyRecord): Promise<void> {
    if (this.config.driver === 'memory') {
      this.keys.push(record);
    } else if (this.config.driver === 'database') {
      await this.query().insert({
        id: record.id,
        user_id: record.userId == null ? '' : String(record.userId),
        team_id: record.teamId == null ? null : String(record.teamId),
        actor_type: record.actorType ?? null,
        actor_id: record.actorId == null ? null : String(record.actorId),
        service_account_id: record.serviceAccountId ?? null,
        name: record.name,
        key: record.key,
        prefix: record.prefix,
        last_used_at: record.lastUsedAt ?? null,
        last_used_ip: record.lastUsedIp ?? null,
        expires_at: record.expiresAt ?? null,
        permissions: JSON.stringify(record.permissions ?? []),
        allowed_ips: JSON.stringify(record.allowedIps ?? []),
        rate_limit: record.rateLimit ? JSON.stringify(record.rateLimit) : null,
        metadata: record.metadata ? JSON.stringify(record.metadata) : null,
        created_at: record.createdAt,
        revoked_at: record.revokedAt ?? null,
        disabled_at: record.disabledAt ?? null,
      });
    }
  }

  /** Generate a tenant-bound service account API key. */
  async createServiceAccount(
    options: CreateServiceAccountOptions,
  ): Promise<{ record: ApiKeyRecord; plainTextKey: string }> {
    return this.create({
      ...options,
      actorType: 'service_account',
      actorId: options.actorId ?? options.serviceAccountId ?? randomUUID(),
      serviceAccountId: options.serviceAccountId,
    });
  }

  /** Validate a key and return the associated record */
  async validate(plainTextKey: string, context: ApiKeyValidationContext = {}): Promise<ApiKeyRecord | null> {
    const hashedKey = this.hashKey(plainTextKey);

    if (this.config.driver === 'database') {
      const row = await this.query().where('key', hashedKey).whereNull('revoked_at').first();
      if (!row) return null;

      const record = this.rowToRecord(row);
      if (!await this.isUsable(record, context)) return null;

      record.lastUsedAt = context.now ?? Date.now();
      record.lastUsedIp = context.ip ?? record.lastUsedIp;
      await this.query().where('id', record.id).update({
        last_used_at: record.lastUsedAt,
        last_used_ip: record.lastUsedIp ?? null,
      });
      this.applyContext(record);
      return record;
    }

    for (const record of this.keys) {
      if (record.revokedAt != null) continue;

      // Use timing-safe comparison to prevent timing attacks
      try {
        if (
          timingSafeEqual(
            Buffer.from(record.key),
            Buffer.from(hashedKey)
          )
        ) {
          if (!await this.isUsable(record, context)) {
            return null;
          }
          // Update lastUsedAt
          record.lastUsedAt = context.now ?? Date.now();
          record.lastUsedIp = context.ip ?? record.lastUsedIp;
          this.applyContext(record);
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
      if (!existing || existing.revokedAt != null) return false;

      await this.query().where('id', keyId).whereNull('revoked_at').update({ revoked_at: Date.now() });
      return true;
    }

    const key = this.keys.find((k) => k.id === keyId);
    if (!key) return false;

    key.revokedAt = Date.now();
    return true;
  }

  /** Revoke an active key only when it belongs to the authenticated user. */
  async revokeForUser(keyId: string, userId: string | number): Promise<boolean> {
    if (this.config.driver === 'database') {
      const affected = await this.query().where('id', keyId)
        .where('user_id', String(userId)).whereNull('revoked_at')
        .update({ revoked_at: Date.now() });
      return affected > 0;
    }

    const key = this.keys.find((record) => record.id === keyId && String(record.userId) === String(userId) && record.revokedAt == null);
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
      .filter((k) => k.userId === userId && k.revokedAt == null)
      .map((k) => ({ ...k })); // Return copies without plaintext
  }

  /** Atomically replace a key without extending expiry or clearing disabled state. */
  async rotate(
    keyId: string
  ): Promise<{ record: ApiKeyRecord; plainTextKey: string } | null> {
    if (this.config.driver === 'memory') {
      const oldKey = this.keys.find((key) => key.id === keyId);
      if (!oldKey || oldKey.revokedAt != null) return null;
      const generated = this.generateRotation(oldKey);
      // Prepare both changes before publishing a new memory snapshot, with no await in between.
      this.keys = this.keys.map((key) => key === oldKey ? { ...key, revokedAt: Date.now() } : key)
        .concat(generated.record);
      return generated;
    }

    const replace = () => Connection.transaction(async () => {
      // The conditional write locks/claims the old row before reading its current controls.
      const claimed = await this.query().where('id', keyId).whereNull('revoked_at')
        .update({ revoked_at: Date.now() });
      if (claimed === 0) return null;
      const oldKey = await this.findById(keyId);
      if (!oldKey) throw new Error('API key disappeared during rotation.');
      const generated = this.generateRotation(oldKey);
      await this.persistKey(generated.record);
      return generated;
    });

    if (Connection.getDriver() !== 'sqlite') return replace();
    // SQLite uses one connection; overlapping BEGIN statements must not share a transaction.
    const pending = this.sqliteRotationTail.then(replace);
    this.sqliteRotationTail = pending.then(() => {}, () => {});
    return pending;
  }

  private generateRotation(oldKey: ApiKeyRecord): { record: ApiKeyRecord; plainTextKey: string } {
    const generated = this.generateKey({
      name: `${oldKey.name} (rotated)`,
      userId: oldKey.userId,
      teamId: oldKey.teamId,
      actorType: oldKey.actorType,
      actorId: oldKey.actorId,
      serviceAccountId: oldKey.serviceAccountId,
      prefix: oldKey.prefix,
      permissions: oldKey.permissions,
      allowedIps: oldKey.allowedIps,
      rateLimit: oldKey.rateLimit,
      metadata: oldKey.metadata,
    });
    generated.record.expiresAt = oldKey.expiresAt;
    generated.record.disabledAt = oldKey.disabledAt;
    return generated;
  }

  /** Check if a key has a specific permission */
  async hasPermission(
    plainTextKey: string,
    permission: string
  ): Promise<boolean> {
    const record = await this.validate(plainTextKey, { consumeRateLimit: false });
    if (!record) return false;

    if (!record.permissions || record.permissions.length === 0) return false;
    if (record.permissions.includes('*')) return true;

    return record.permissions.includes(permission);
  }

  /** Disable a key without deleting audit history. */
  async disable(keyId: string): Promise<boolean> {
    const disabledAt = Date.now();
    if (this.config.driver === 'database') {
      const existing = await this.findById(keyId);
      if (!existing || existing.disabledAt != null || existing.revokedAt != null) return false;
      await this.query().where('id', keyId).whereNull('revoked_at').update({ disabled_at: disabledAt });
      return true;
    }

    const key = this.keys.find((k) => k.id === keyId);
    if (!key || key.disabledAt != null || key.revokedAt != null) return false;
    key.disabledAt = disabledAt;
    return true;
  }

  /** Re-enable a disabled key. Revoked keys cannot be enabled. */
  async enable(keyId: string): Promise<boolean> {
    if (this.config.driver === 'database') {
      const existing = await this.findById(keyId);
      if (!existing || existing.revokedAt != null) return false;
      await this.query().where('id', keyId).whereNull('revoked_at').update({ disabled_at: null });
      return true;
    }

    const key = this.keys.find((k) => k.id === keyId);
    if (!key || key.revokedAt != null) return false;
    key.disabledAt = undefined;
    return true;
  }

  private async isUsable(record: ApiKeyRecord, context: ApiKeyValidationContext): Promise<boolean> {
    const now = context.now ?? Date.now();
    if (record.disabledAt != null) return false;
    if (record.expiresAt != null && record.expiresAt < now) return false;

    if (record.allowedIps?.length) {
      if (!context.ip || !record.allowedIps.includes(context.ip)) {
        throw new ApiKeyAccessDeniedError('API key is not allowed from this IP address.', record);
      }
    }

    if (context.consumeRateLimit !== false && record.rateLimit) {
      const ttl = Math.max(1, record.rateLimit.window);
      const bucket = Math.floor(now / (ttl * 1000));
      const counter = await Cache.incrementWithTtl(`svelar:api-key:${record.id}:rate:${bucket}`, ttl);
      if (counter.value > record.rateLimit.limit) {
        const retryAfter = counter.expiresAt ? Math.max(1, Math.ceil((counter.expiresAt - now) / 1000)) : ttl;
        throw new ApiKeyRateLimitError('API key rate limit exceeded.', record, retryAfter);
      }
    }

    return true;
  }

  private applyContext(record: ApiKeyRecord): void {
    if (record.teamId != null) {
      ApplicationContext.set('teamId', record.teamId);
      ApplicationContext.set('tenantId', record.teamId);
    }
    if (record.userId != null) {
      ApplicationContext.set('userId', record.userId);
    }
    if (record.actorId != null) {
      ApplicationContext.set('actorId', record.actorId);
    }
    if (record.actorType) {
      ApplicationContext.set('actorType', record.actorType);
    }
    ApplicationContext.set('apiKeyId', record.id);
    if (record.serviceAccountId) {
      ApplicationContext.set('serviceAccountId', record.serviceAccountId);
    }
  }
}

export const ApiKeys = singleton(
  'svelar.apiKeys',
  () => new ApiKeyManager()
);
