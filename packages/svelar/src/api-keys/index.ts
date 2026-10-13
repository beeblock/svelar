/**
 * Svelar API Key Management
 * Generate, validate, and revoke API keys for programmatic access.
 */

import { randomBytes, createHash, timingSafeEqual } from 'crypto';
import { randomUUID } from 'crypto';
import { isIP } from 'node:net';
import { singleton } from '../support/singleton.js';
import { assertSqlIdentifier, Connection } from '../database/Connection.js';
import { QueryBuilder } from '../orm/QueryBuilder.js';
import { Cache } from '../cache/index.js';
import { ApplicationContext } from '../support/Context.js';
import { Audit } from '../audit/index.js';

export type ApiKeyActorType = 'user' | 'service_account' | 'system';

export interface ApiKeyRateLimit {
  limit: number;
  window: number;
}

export interface ApiKeyRecord<TAbility extends string = string> {
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
  permissions?: TAbility[];
  abilities?: TAbility[];
  allowedIps?: string[];
  rateLimit?: ApiKeyRateLimit;
  metadata?: Record<string, any>;
  createdAt: number;
  revokedAt?: number;
  disabledAt?: number;
  rotationId?: string;
  rotatedAt?: number;
  overlapUntil?: number;
}

export interface CreateKeyOptions<TAbility extends string = string> {
  name: string;
  userId?: string | number;
  teamId?: string | number;
  actorType?: ApiKeyActorType;
  actorId?: string | number;
  serviceAccountId?: string;
  prefix?: string; // default: 'sk_'
  permissions?: readonly TAbility[];
  abilities?: readonly TAbility[];
  allowedIps?: string[];
  rateLimit?: ApiKeyRateLimit;
  expiresIn?: number; // seconds
  metadata?: Record<string, any>;
}

export interface CreateServiceAccountOptions<TAbility extends string = string> extends Omit<CreateKeyOptions<TAbility>, 'actorType' | 'actorId' | 'serviceAccountId'> {
  teamId: string | number;
  actorId?: string | number;
  serviceAccountId?: string;
}

export interface ApiKeyValidationContext {
  ip?: string;
  now?: number;
  consumeRateLimit?: boolean;
  tenantId?: string | number;
  teamId?: string | number;
  userAgent?: string;
  correlationId?: string;
}

export interface ApiKeyRotationOptions { overlapSeconds?: number; }

export interface ApiKeyPolicyContext {
  apiKeyId?: string;
  teamId?: string | number | null;
  tenantId?: string | number | null;
  actorId?: string | number | null;
  actorType?: string;
  serviceAccountId?: string;
  userId?: string | number | null;
  platform?: boolean;
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
  private memoryTail: Promise<void> = Promise.resolve();
  private validatedRecords = new WeakMap<ApiKeyRecord, ApiKeyRecord>();

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
      abilities: row.permissions ? JSON.parse(row.permissions) : [],
      allowedIps: row.allowed_ips ? JSON.parse(row.allowed_ips) : [],
      rateLimit: row.rate_limit ? JSON.parse(row.rate_limit) : undefined,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      createdAt,
      revokedAt: this.databaseTimestamp(row.revoked_at ?? row.revokedAt ?? row.revokedat, 'revoked_at'),
      disabledAt: this.databaseTimestamp(row.disabled_at ?? row.disabledAt ?? row.disabledat, 'disabled_at'),
      rotationId: row.rotation_id ?? row.id,
      rotatedAt: this.databaseTimestamp(row.rotated_at, 'rotated_at'),
      overlapUntil: this.databaseTimestamp(row.overlap_until, 'overlap_until'),
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
  async create<TAbility extends string = string>(
    options: CreateKeyOptions<TAbility>
  ): Promise<{ record: ApiKeyRecord<TAbility>; plainTextKey: string }> {
    const generated = this.generateKey(options);
    await this.mutate(async () => {
      await this.persistKey(generated.record);
      await this.auditControl('created', generated.record);
    });
    return { ...generated, record: structuredClone(generated.record) };
  }

  private generateKey<TAbility extends string = string>(options: CreateKeyOptions<TAbility>): { record: ApiKeyRecord<TAbility>; plainTextKey: string } {
    if (options.actorType !== 'service_account' && options.userId === undefined) {
      throw new Error('API keys require userId unless actorType is service_account.');
    }
    if (options.actorType === 'service_account' && !validIdentity(options.teamId)) {
      throw new Error('Service account API keys require teamId.');
    }
    if (options.userId !== undefined && !validIdentity(options.userId)) throw new TypeError('Invalid API key userId.');
    if (options.teamId !== undefined && !validIdentity(options.teamId)) throw new TypeError('Invalid API key teamId.');
    if (options.actorId !== undefined && !validIdentity(options.actorId)) throw new TypeError('Invalid API key actorId.');
    if (options.serviceAccountId !== undefined && !validIdentity(options.serviceAccountId)) throw new TypeError('Invalid API key serviceAccountId.');
    if (!options.name.trim()) throw new TypeError('API key name is required.');
    if (options.actorType !== undefined && !['user', 'service_account', 'system'].includes(options.actorType)) throw new TypeError('Invalid API key actorType.');
    if (options.permissions !== undefined && !Array.isArray(options.permissions)
      || options.abilities !== undefined && !Array.isArray(options.abilities)) throw new TypeError('API key abilities must be an array.');
    const permissions = [...(options.abilities ?? options.permissions ?? [])];
    if (permissions.some((ability) => typeof ability !== 'string' || !/^(\*|[A-Za-z0-9_.:-]+)$/.test(ability))) throw new TypeError('API key abilities must be nonempty capability names.');
    if (options.abilities && options.permissions && JSON.stringify(options.abilities) !== JSON.stringify(options.permissions)) throw new TypeError('API key abilities and permissions must agree.');
    if (options.allowedIps?.some((ip) => typeof ip !== 'string' || !isIP(ip))) throw new TypeError('API key allowedIps must contain exact IP addresses.');
    if (options.rateLimit && !validRateLimit(options.rateLimit)) throw new TypeError('Invalid API key rate limit.');
    if (options.expiresIn !== undefined && !Number.isSafeInteger(options.expiresIn * 1000)) throw new TypeError('Invalid API key expiry.');

    const prefix = options.prefix || this.config.prefix || 'sk_';
    const plainTextKey = `${prefix}${this.generateRandomKey(32)}`;
    const hashedKey = this.hashKey(plainTextKey);
    const serviceAccountId = options.serviceAccountId ?? (options.actorType === 'service_account' ? randomUUID() : undefined);

    const id = randomUUID();
    const record: ApiKeyRecord<TAbility> = {
      id,
      rotationId: id,
      userId: options.userId,
      teamId: options.teamId,
      actorType: options.actorType ?? 'user',
      actorId: options.actorId ?? options.userId ?? serviceAccountId,
      serviceAccountId,
      name: options.name,
      key: hashedKey,
      prefix: prefix,
      permissions,
      abilities: [...permissions],
      allowedIps: [...(options.allowedIps ?? [])],
      rateLimit: options.rateLimit ? { ...options.rateLimit } : undefined,
      metadata: options.metadata ? structuredClone(options.metadata) : undefined,
      createdAt: Date.now(),
      expiresAt: options.expiresIn !== undefined
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
        rotation_id: record.rotationId ?? record.id,
        rotated_at: record.rotatedAt ?? null,
        overlap_until: record.overlapUntil ?? null,
      });
    }
  }

  /** Generate a tenant-bound service account API key. */
  async createServiceAccount<TAbility extends string = string>(
    options: CreateServiceAccountOptions<TAbility>,
  ): Promise<{ record: ApiKeyRecord<TAbility>; plainTextKey: string }> {
    const serviceAccountId = options.serviceAccountId ?? randomUUID();
    return this.create({
      ...options,
      actorType: 'service_account',
      actorId: options.actorId ?? serviceAccountId,
      serviceAccountId,
    });
  }

  /** Validate a key and return the associated record */
  async validate(plainTextKey: string, context: ApiKeyValidationContext = {}): Promise<ApiKeyRecord | null> {
    context = { ...context };
    this.clearCredentialContext();
    const hashedKey = this.hashKey(plainTextKey);
    const found = this.config.driver === 'memory'
      ? this.keys.find((record) => equalHash(record.key, hashedKey))
      : await this.query().where('key', hashedKey).first().then((row) => row ? this.rowToRecord(row) : null);
    if (!found) return null;
    const validated = await this.withRecord(found.id, async (record) => {
      if (!equalHash(record.key, hashedKey) || !await this.isUsable(record, context)) return null;
      record.lastUsedAt = Math.max(record.lastUsedAt ?? 0, context.now ?? Date.now());
      record.lastUsedIp = context.ip ?? record.lastUsedIp;
      if (this.config.driver === 'database') await this.query().where('id', record.id).update({
        last_used_at: record.lastUsedAt, last_used_ip: record.lastUsedIp ?? null,
      });
      return structuredClone(record);
    });
    if (validated) {
      this.validatedRecords.set(validated, structuredClone(validated));
      this.applyContext(validated, context);
    }
    return validated;
  }

  /** Revoke a key */
  async revoke(keyId: string): Promise<boolean> {
    return await this.control(keyId, 'revoked') ?? false;
  }

  /** Revoke an active key only when it belongs to the authenticated user. */
  async revokeForUser(keyId: string, userId: string | number): Promise<boolean> {
    if (!validIdentity(userId)) return false;
    return await this.control(keyId, 'revoked', userId) ?? false;
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
      .filter((k) => String(k.userId) === String(userId) && k.revokedAt == null)
      .map((key) => structuredClone(key));
  }

  /** Atomically replace a key without extending expiry or clearing disabled state. */
  async rotate(
    keyId: string,
    options: ApiKeyRotationOptions = {},
  ): Promise<{ record: ApiKeyRecord; plainTextKey: string } | null> {
    const overlapSeconds = options.overlapSeconds ?? 0;
    if (!Number.isSafeInteger(overlapSeconds) || overlapSeconds < 0 || !Number.isSafeInteger(overlapSeconds * 1000)) throw new TypeError('Rotation overlapSeconds must be a nonnegative safe integer.');
    return this.withRecord(keyId, async (oldKey) => {
      if (oldKey.revokedAt != null || oldKey.rotatedAt != null) return null;
      const generated = this.generateRotation(oldKey);
      const rotatedAt = Date.now();
      const deadline = rotatedAt + overlapSeconds * 1000;
      if (!Number.isSafeInteger(deadline)) throw new TypeError('Invalid rotation overlap deadline.');
      const overlapUntil = Math.min(deadline, oldKey.expiresAt ?? deadline);
      const prior = structuredClone(oldKey);
      if (this.config.driver === 'database') {
        const claimed = await this.query().where('id', keyId).whereNull('revoked_at').whereNull('rotated_at')
          .update({ revoked_at: rotatedAt, rotated_at: rotatedAt, overlap_until: overlapUntil });
        if (claimed === 0) return null;
      } else Object.assign(oldKey, { revokedAt: rotatedAt, rotatedAt, overlapUntil });
      await this.persistKey(generated.record);
      await this.auditControl('rotated', generated.record, prior, { replacementKeyId: generated.record.id, overlapUntil });
      await this.invalidateAuthorizationSnapshots();
      return { ...generated, record: structuredClone(generated.record) };
    });
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
    generated.record.rotationId = oldKey.rotationId ?? oldKey.id;
    return generated;
  }

  /** Check if a key has a specific permission */
  async hasPermission(
    plainTextKey: string,
    permission: string,
    context: ApiKeyValidationContext = {},
  ): Promise<boolean> {
    const record = await this.validate(plainTextKey, { ...context, consumeRateLimit: false });
    if (!record) return false;

    return this.hasAbility(record, permission);
  }

  /** Disable a key without deleting audit history. */
  async disable(keyId: string): Promise<boolean> {
    return await this.control(keyId, 'disabled') ?? false;
  }

  /** Re-enable a disabled key. Revoked keys cannot be enabled. */
  async enable(keyId: string): Promise<boolean> {
    return await this.control(keyId, 'enabled') ?? false;
  }

  private async isUsable(record: ApiKeyRecord, context: ApiKeyValidationContext): Promise<boolean> {
    const now = context.now ?? Date.now();
    if (!Number.isSafeInteger(now) || now < 0) throw new TypeError('Invalid API key validation timestamp.');
    if (!this.isActive(record, now)) return false;
    if (record.disabledAt != null) return false;
    if (record.expiresAt != null && record.expiresAt <= now) return false;
    if (record.actorType === 'service_account' && (!validIdentity(record.teamId) || !validIdentity(record.actorId) || !validIdentity(record.serviceAccountId))) return false;
    if (record.actorType !== undefined && !['user', 'service_account', 'system'].includes(record.actorType)) return false;
    if (record.actorType !== 'service_account' && !validIdentity(record.userId)) return false;
    if (!Array.isArray(record.permissions) || record.permissions.some((ability) => typeof ability !== 'string' || !/^(\*|[A-Za-z0-9_.:-]+)$/.test(ability))) return false;
    if (!Array.isArray(record.allowedIps) || record.allowedIps.some((ip) => typeof ip !== 'string' || !isIP(ip))) return false;
    if (context.tenantId !== undefined && !sameIdentity(record.teamId, context.tenantId)
      || context.teamId !== undefined && !sameIdentity(record.teamId, context.teamId)) throw new ApiKeyAccessDeniedError('API key does not belong to the requested tenant.', record);

    if (record.allowedIps?.length) {
      if (!context.ip || !record.allowedIps.includes(context.ip)) {
        throw new ApiKeyAccessDeniedError('API key is not allowed from this IP address.', record);
      }
    }

    if (record.rateLimit && !validRateLimit(record.rateLimit)) throw new ApiKeyAccessDeniedError('API key has an invalid rate limit.', record);
    if (context.consumeRateLimit !== false && record.rateLimit) {
      const ttl = Math.max(1, record.rateLimit.window);
      const bucket = Math.floor(now / (ttl * 1000));
      const counter = await Cache.incrementWithTtl(`svelar:api-key:${record.rotationId ?? record.id}:rate:${bucket}`, ttl);
      if (counter.value > record.rateLimit.limit) {
        const retryAfter = counter.expiresAt ? Math.max(1, Math.ceil((counter.expiresAt - now) / 1000)) : ttl;
        throw new ApiKeyRateLimitError('API key rate limit exceeded.', record, retryAfter);
      }
    }

    return true;
  }

  private applyContext(record: ApiKeyRecord, context: ApiKeyValidationContext): void {
    if (record.teamId != null) {
      ApplicationContext.set('teamId', record.teamId);
      ApplicationContext.set('tenantId', record.teamId);
    }
    if (record.userId != null && record.actorType !== 'service_account') {
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
    ApplicationContext.set('abilities', [...(record.permissions ?? [])]);
    if (context.ip) ApplicationContext.set('ipAddress', context.ip);
    if (context.userAgent) ApplicationContext.set('userAgent', context.userAgent);
    if (context.correlationId) ApplicationContext.set('correlationId', context.correlationId);
  }

  hasAbility<TAbility extends string>(record: ApiKeyRecord<TAbility>, ability: TAbility, context: ApiKeyPolicyContext = ApplicationContext.snapshot()): boolean {
    const trusted = this.validatedRecords.get(record);
    if (!trusted) return false;
    if (!this.isActive(trusted, Date.now()) || trusted.disabledAt != null || trusted.expiresAt != null && trusted.expiresAt <= Date.now()) return false;
    if (context.apiKeyId !== trusted.id || !sameIdentity(context.actorId, trusted.actorId) || context.actorType !== (trusted.actorType ?? 'user')) return false;
    if (trusted.teamId != null && (!sameIdentity(context.teamId, trusted.teamId) || !sameIdentity(context.tenantId, trusted.teamId))) return false;
    if (trusted.teamId == null && (context.teamId != null || context.tenantId != null)) return false;
    if (trusted.teamId != null && context.platform === true) return false;
    if (trusted.actorType === 'service_account' && (context.serviceAccountId !== trusted.serviceAccountId || context.userId != null || !validIdentity(trusted.teamId))) return false;
    return trusted.permissions?.some((permission) => permission === '*' || permission === ability) ?? false;
  }

  async runWithKey<T>(plainTextKey: string, context: ApiKeyValidationContext, callback: (record: ApiKeyRecord) => T | Promise<T>): Promise<T | null> {
    return await ApplicationContext.runIsolated({}, async () => {
      const record = await this.validate(plainTextKey, context);
      return record ? await callback(record) : null;
    });
  }

  private isActive(record: ApiKeyRecord, now: number): boolean {
    return record.revokedAt == null || record.rotatedAt === record.revokedAt && record.overlapUntil != null && now < record.overlapUntil;
  }

  private clearCredentialContext(): void {
    for (const field of ['teamId', 'tenantId', 'userId', 'actorId', 'actorType', 'apiKeyId', 'serviceAccountId', 'abilities']) ApplicationContext.set(field, undefined);
  }

  private async mutate<T>(callback: () => Promise<T>): Promise<T> {
    if (this.config.driver === 'database') return Connection.transaction(callback);
    const pending = this.memoryTail.then(async () => {
      const snapshot = structuredClone(this.keys);
      try { return await callback(); }
      catch (error) { this.keys = snapshot; throw error; }
    });
    this.memoryTail = pending.then(() => {}, () => {});
    return pending;
  }

  private async withRecord<T>(keyId: string, callback: (record: ApiKeyRecord) => Promise<T>): Promise<T | null> {
    return this.mutate(async () => {
      const record = await this.findById(keyId);
      if (!record) return null;
      if (this.config.driver === 'database') {
        const anchor = await this.query().where('id', record.rotationId ?? record.id).forUpdate().first();
        if (!anchor) throw new Error('API key rotation lineage is missing.');
        const latest = await this.findById(keyId);
        if (!latest) return null;
        return callback(latest);
      }
      return callback(record);
    });
  }

  private async control(keyId: string, action: 'revoked' | 'disabled' | 'enabled', owner?: string | number): Promise<boolean | null> {
    return this.withRecord(keyId, async (record) => {
      if (!this.isActive(record, Date.now()) || owner !== undefined && !sameIdentity(owner, record.userId)) return false;
      if (action === 'disabled' && record.disabledAt != null || action === 'enabled' && record.disabledAt == null) return false;
      const prior = structuredClone(record);
      const now = Date.now();
      const rotationId = record.rotationId ?? record.id;
      if (this.config.driver === 'database') {
        await this.query().where('rotation_id', rotationId).update(action === 'revoked'
          ? { revoked_at: now, overlap_until: null } : { disabled_at: action === 'disabled' ? now : null });
      } else {
        for (const key of this.keys.filter((item) => (item.rotationId ?? item.id) === rotationId)) {
          if (action === 'revoked') { key.revokedAt = now; key.overlapUntil = undefined; }
          else key.disabledAt = action === 'disabled' ? now : undefined;
        }
      }
      const updated = action === 'revoked' ? { ...record, revokedAt: now, overlapUntil: undefined }
        : { ...record, disabledAt: action === 'disabled' ? now : undefined };
      await this.auditControl(action, updated, prior);
      await this.invalidateAuthorizationSnapshots();
      return true;
    });
  }

  private async invalidateAuthorizationSnapshots(): Promise<void> {
    // Synchronous policy checks are request-scoped; committed control changes require revalidation.
    await Connection.afterCommit(() => { this.validatedRecords = new WeakMap(); });
  }

  private async auditControl(action: string, record: ApiKeyRecord, previous?: ApiKeyRecord, metadata: Record<string, unknown> = {}): Promise<void> {
    const controls = (key: ApiKeyRecord): Record<string, unknown> => ({
      name: key.name, teamId: key.teamId, actorType: key.actorType, actorId: key.actorId,
      serviceAccountId: key.serviceAccountId, permissions: key.permissions,
      allowedIps: key.allowedIps, rateLimit: key.rateLimit, expiresAt: key.expiresAt,
      disabledAt: key.disabledAt, revokedAt: key.revokedAt,
    });
    await Audit.log({ userId: null, action: `api_key.${action}`, modelType: 'ApiKey', modelId: previous?.id ?? record.id,
      oldValues: previous ? controls(previous) : undefined, newValues: controls(record),
      metadata: { targetTenantId: record.teamId, rotationId: record.rotationId ?? record.id, ...metadata } });
  }
}

function validIdentity(value: unknown): value is string | number {
  return typeof value === 'string' ? value.trim().length > 0 && value.length <= 255 : typeof value === 'number' && Number.isSafeInteger(value);
}
function sameIdentity(left: unknown, right: unknown): boolean { return validIdentity(left) && validIdentity(right) && String(left) === String(right); }
function validRateLimit(value: ApiKeyRateLimit): boolean {
  return Number.isSafeInteger(value.limit) && value.limit > 0 && Number.isSafeInteger(value.window) && value.window > 0;
}
function equalHash(left: string, right: string): boolean {
  const a = Buffer.from(left); const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const ApiKeys = singleton(
  'svelar.apiKeys',
  () => new ApiKeyManager()
);
