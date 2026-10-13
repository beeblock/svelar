/**
 * Svelar Audit Logging
 * Track user actions across the application for compliance and debugging.
 */

import { randomUUID } from 'crypto';
import { isDeepStrictEqual } from 'node:util';
import { singleton } from '../support/singleton.js';
import { assertSqlIdentifier, Connection } from '../database/Connection.js';
import { QueryBuilder } from '../orm/QueryBuilder.js';
import { ApplicationContext } from '../support/Context.js';
import { Model, isModelClass } from '../orm/Model.js';
import { auditRecord, auditValues, type AuditValueOptions } from './Values.js';

export interface AuditEntry {
  id: string;
  userId: string | number | null;
  action: string; // 'created' | 'updated' | 'deleted' | 'viewed' | custom
  modelType: string; // 'User' | 'Post' | etc
  modelId: string | number;
  oldValues?: Record<string, unknown>;
  newValues?: Record<string, unknown>;
  metadata?: Record<string, unknown>; // Actor, tenant, request, integration, etc.
  ipAddress?: string;
  userAgent?: string;
  timestamp: number;
}

export interface AuditFilter {
  userId?: string | number;
  action?: string;
  modelType?: string;
  modelId?: string | number;
  since?: number;
  until?: number;
  limit?: number;
  offset?: number;
}

export type AuditDriver = 'database' | 'memory' | 'log';

export interface AuditConfig {
  driver: AuditDriver;
  table?: string;
  enabled?: boolean;
  exclude?: string[]; // model types to exclude
  redact?: string[];
  ignore?: string[];
}

class AuditManager {
  private config: AuditConfig = { driver: 'memory', enabled: true };
  private entries: AuditEntry[] = []; // memory driver
  private maxEntries = 10000;

  configure(config: AuditConfig): void {
    this.config = { ...this.config, ...config };
  }

  private table(): string {
    return assertSqlIdentifier(this.config.table ?? 'audit_logs', 'Audit table name');
  }

  private tableQuery(): QueryBuilder<any> {
    return new QueryBuilder(this.table());
  }

  private rowToEntry(row: any): AuditEntry {
    const oldValues = row.old_values ?? row.oldValues ?? row.oldvalues;
    const newValues = row.new_values ?? row.newValues ?? row.newvalues;
    return {
      id: row.id,
      userId: row.user_id ?? row.userId ?? row.userid ?? null,
      action: row.action,
      modelType: row.model_type ?? row.modelType ?? row.modeltype,
      modelId: row.model_id ?? row.modelId ?? row.modelid,
      oldValues: oldValues ? JSON.parse(oldValues) : undefined,
      newValues: newValues ? JSON.parse(newValues) : undefined,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      ipAddress: row.ip_address ?? row.ipAddress ?? row.ipaddress ?? undefined,
      userAgent: row.user_agent ?? row.userAgent ?? row.useragent ?? undefined,
      timestamp: row.timestamp,
    };
  }

  async log(entry: Omit<AuditEntry, 'id' | 'timestamp'>): Promise<void> {
    if (!this.config.enabled) return;
    if (this.config.exclude?.includes(entry.modelType)) return;

    const normalized = this.normalizeEntry(entry);
    const auditEntry: AuditEntry = {
      ...normalized,
      id: randomUUID(),
      timestamp: Date.now(),
    };

    if (this.config.driver === 'memory') {
      const append = () => {
        this.entries.push(auditEntry);
        if (this.entries.length > this.maxEntries) this.entries.shift();
      };
      if (Connection.inTransaction()) await Connection.afterCommit(append);
      else append();
    } else if (this.config.driver === 'log') {
      await Connection.afterCommit(() => { console.log('[Audit]', JSON.stringify(auditEntry)); });
    } else if (this.config.driver === 'database') {
      await this.tableQuery().insert({
        id: auditEntry.id,
        user_id: auditEntry.userId == null ? null : String(auditEntry.userId),
        action: auditEntry.action,
        model_type: auditEntry.modelType,
        model_id: String(auditEntry.modelId),
        old_values: auditEntry.oldValues ? JSON.stringify(auditEntry.oldValues) : null,
        new_values: auditEntry.newValues ? JSON.stringify(auditEntry.newValues) : null,
        metadata: auditEntry.metadata ? JSON.stringify(auditEntry.metadata) : null,
        ip_address: auditEntry.ipAddress ?? null,
        user_agent: auditEntry.userAgent ?? null,
        timestamp: auditEntry.timestamp,
      });
    }
  }

  normalizeEntry(entry: Omit<AuditEntry, 'id' | 'timestamp'>): Omit<AuditEntry, 'id' | 'timestamp'> {
    const context = ApplicationContext.snapshot();
    const userId = entry.userId ?? context.userId ?? null;
    return {
      ...entry,
      userId,
      oldValues: entry.oldValues ? auditRecord(entry.oldValues, this.config) : undefined,
      newValues: entry.newValues ? auditRecord(entry.newValues, this.config) : undefined,
      ipAddress: entry.ipAddress ?? context.ipAddress ?? context.ip,
      userAgent: entry.userAgent ?? context.userAgent,
      metadata: auditRecord({
        ...(entry.metadata ?? {}),
        actorType: context.actorType ?? (userId == null ? 'system' : 'user'),
        actorId: context.actorId ?? userId,
        ...(context.teamId !== undefined && context.teamId !== null ? { teamId: context.teamId } : {}),
        ...(context.tenantId !== undefined && context.tenantId !== null ? { tenantId: context.tenantId } : context.teamId != null ? { tenantId: context.teamId } : {}),
        ...Object.fromEntries(['actorId', 'actorType', 'apiKeyId', 'serviceAccountId', 'requestId'].filter((key) => context[key] != null).map((key) => [key, context[key]])),
        ...(context.correlationId ?? context.requestId ? { correlationId: context.correlationId ?? context.requestId } : {}),
      }, this.config),
    };
  }

  async query(filter: AuditFilter): Promise<AuditEntry[]> {
    if (this.config.driver === 'database') {
      const query = this.tableQuery();

      if (filter.userId !== undefined) {
        query.where('user_id', String(filter.userId));
      }
      if (filter.action) {
        query.where('action', filter.action);
      }
      if (filter.modelType) {
        query.where('model_type', filter.modelType);
      }
      if (filter.modelId !== undefined) {
        query.where('model_id', String(filter.modelId));
      }
      if (filter.since !== undefined) {
        query.where('timestamp', '>=', filter.since);
      }
      if (filter.until !== undefined) {
        query.where('timestamp', '<=', filter.until);
      }

      const limit = filter.limit || 100;
      const offset = filter.offset || 0;
      const rows = await query.orderBy('timestamp', 'desc').limit(limit).offset(offset).get();
      return rows.map((row: any) => this.rowToEntry(row));
    }

    let results = [...this.entries];

    if (filter.userId !== undefined) {
      results = results.filter((e) => String(e.userId) === String(filter.userId));
    }
    if (filter.action) {
      results = results.filter((e) => e.action === filter.action);
    }
    if (filter.modelType) {
      results = results.filter((e) => e.modelType === filter.modelType);
    }
    if (filter.modelId !== undefined) {
      results = results.filter((e) => String(e.modelId) === String(filter.modelId));
    }
    if (filter.since !== undefined) {
      results = results.filter((e) => e.timestamp >= filter.since!);
    }
    if (filter.until !== undefined) {
      results = results.filter((e) => e.timestamp <= filter.until!);
    }

    // Sort by timestamp descending
    results.sort((a, b) => b.timestamp - a.timestamp);

    const offset = filter.offset || 0;
    const limit = filter.limit || 100;

    return results.slice(offset, offset + limit).map((entry) => structuredClone(entry));
  }

  async forModel(
    type: string,
    id: string | number
  ): Promise<AuditEntry[]> {
    return this.query({ modelType: type, modelId: id, limit: 1000 });
  }

  async byUser(
    userId: string | number,
    limit?: number
  ): Promise<AuditEntry[]> {
    return this.query({ userId, limit: limit || 100 });
  }

  async getStats(): Promise<{
    total: number;
    byAction: Record<string, number>;
    byModel: Record<string, number>;
  }> {
    if (this.config.driver === 'database') {
      const total = await this.tableQuery().count();
      const actions = await this.tableQuery().select('action').selectRaw('COUNT(*) AS total').groupBy('action').get();
      const models = await this.tableQuery().select('model_type').selectRaw('COUNT(*) AS total').groupBy('model_type').get();
      return { total,
        byAction: Object.fromEntries(actions.map((row) => [row.action, Number(row.total)])),
        byModel: Object.fromEntries(models.map((row) => [row.model_type, Number(row.total)])),
      };
    }

    const byAction = new Map<string, number>();
    const byModel = new Map<string, number>();

    for (const entry of this.entries) {
      byAction.set(entry.action, (byAction.get(entry.action) ?? 0) + 1);
      byModel.set(entry.modelType, (byModel.get(entry.modelType) ?? 0) + 1);
    }

    return {
      total: this.entries.length,
      byAction: Object.fromEntries(byAction),
      byModel: Object.fromEntries(byModel),
    };
  }

  valueOptions(options: AuditValueOptions = {}): AuditValueOptions {
    return { ignore: [...(this.config.ignore ?? []), ...(options.ignore ?? [])],
      redact: [...(this.config.redact ?? []), ...(options.redact ?? [])] };
  }
}

// Helper: auditable() decorator/mixin for models
// Usage: const User = auditable(BaseUser);
export function auditable<T extends typeof Model>(target: T, options: AuditValueOptions = {}): T {
  if (!isModelClass(target)) throw new TypeError('auditable() requires a Svelar Model class.');
  const forcing = new WeakSet<Model>();
  const forceDelete = target.prototype.forceDelete;
  target.prototype.forceDelete = async function (this: Model): Promise<void> {
    forcing.add(this);
    try { await forceDelete.call(this); }
    finally { forcing.delete(this); }
  };
  const values = (attributes: Record<string, unknown>): Record<string, unknown> => auditRecord(attributes,
    Audit.valueOptions({ ...options, ignore: [target.createdAt, target.updatedAt, ...(options.ignore ?? [])] }));
  target.observe({
      async created(model) {
        await Audit.log({
          userId: null,
          action: 'created',
          modelType: target.name,
          modelId: model.getAttribute(target.primaryKey),
          newValues: values(model.getAttributes()),
        });
      },
      async updated(model) {
        const changes = model.getChanges();
        const previous = model.getPreviousOriginal();
        const before = target.hydrate(previous);
        const valueOptions = Audit.valueOptions({ ...options, ignore: [target.createdAt, target.updatedAt, ...(options.ignore ?? [])] });
        const keys = Object.keys(changes).filter((key) => !isDeepStrictEqual(
          auditValues({ [key]: before.getAttribute(key) }, valueOptions, false),
          auditValues({ [key]: model.getAttribute(key) }, valueOptions, false),
        ));
        if (!keys.length) return;
        await Audit.log({
          userId: null,
          action: 'updated',
          modelType: target.name,
          modelId: model.getAttribute(target.primaryKey),
          oldValues: values(Object.fromEntries(keys.map((key) => [key, previous[key]]))),
          newValues: values(Object.fromEntries(keys.map((key) => [key, changes[key]]))),
        });
      },
      async deleted(model) {
        if (forcing.has(model)) return;
        await Audit.log({
          userId: null,
          action: 'deleted',
          modelType: target.name,
          modelId: model.getAttribute(target.primaryKey),
          oldValues: values(model.getPreviousOriginal()),
        });
      },
      async restored(model) {
        await Audit.log({
          userId: null,
          action: 'restored',
          modelType: target.name,
          modelId: model.getAttribute(target.primaryKey),
          oldValues: values(model.getPreviousOriginal()),
          newValues: values(model.getChanges()),
        });
      },
      async forceDeleted(model) {
        forcing.delete(model);
        await Audit.log({
          userId: null,
          action: 'forceDeleted',
          modelType: target.name,
          modelId: model.getAttribute(target.primaryKey),
          oldValues: values(model.getPreviousOriginal()),
        });
      },
    });
  return target;
}

export const Audit = singleton('svelar.audit', () => new AuditManager());
