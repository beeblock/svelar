/**
 * Svelar Audit Logging
 * Track user actions across the application for compliance and debugging.
 */

import { randomUUID } from 'crypto';
import { singleton } from '../support/singleton.js';
import { assertSqlIdentifier } from '../database/Connection.js';
import { QueryBuilder } from '../orm/QueryBuilder.js';

export interface AuditEntry {
  id: string;
  userId: string | number | null;
  action: string; // 'created' | 'updated' | 'deleted' | 'viewed' | custom
  modelType: string; // 'User' | 'Post' | etc
  modelId: string | number;
  oldValues?: Record<string, any>;
  newValues?: Record<string, any>;
  metadata?: Record<string, any>; // IP, user agent, etc.
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
}

class AuditManager {
  private config: AuditConfig = { driver: 'memory', enabled: true };
  private entries: AuditEntry[] = []; // memory driver
  private maxEntries = 10000;

  configure(config: AuditConfig): void {
    this.config = config;
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

    const auditEntry: AuditEntry = {
      ...entry,
      id: randomUUID(),
      timestamp: Date.now(),
    };

    if (this.config.driver === 'memory') {
      this.entries.push(auditEntry);
      // Keep ring buffer size manageable
      if (this.entries.length > this.maxEntries) {
        this.entries.shift();
      }
    } else if (this.config.driver === 'log') {
      console.log('[Audit]', JSON.stringify(auditEntry));
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
      if (filter.since) {
        query.where('timestamp', '>=', filter.since);
      }
      if (filter.until) {
        query.where('timestamp', '<=', filter.until);
      }

      const limit = filter.limit || 100;
      const offset = filter.offset || 0;
      const rows = await query.orderBy('timestamp', 'desc').limit(limit).offset(offset).get();
      return rows.map((row: any) => this.rowToEntry(row));
    }

    let results = [...this.entries];

    if (filter.userId !== undefined) {
      results = results.filter((e) => e.userId === filter.userId);
    }
    if (filter.action) {
      results = results.filter((e) => e.action === filter.action);
    }
    if (filter.modelType) {
      results = results.filter((e) => e.modelType === filter.modelType);
    }
    if (filter.modelId !== undefined) {
      results = results.filter((e) => e.modelId === filter.modelId);
    }
    if (filter.since) {
      results = results.filter((e) => e.timestamp >= filter.since!);
    }
    if (filter.until) {
      results = results.filter((e) => e.timestamp <= filter.until!);
    }

    // Sort by timestamp descending
    results.sort((a, b) => b.timestamp - a.timestamp);

    const offset = filter.offset || 0;
    const limit = filter.limit || 100;

    return results.slice(offset, offset + limit);
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
      const rows = await this.tableQuery().select('action', 'model_type').get();
      const byAction: Record<string, number> = {};
      const byModel: Record<string, number> = {};

      for (const row of rows) {
        const action = row.action;
        const model = row.model_type ?? row.modelType ?? row.modeltype;
        byAction[action] = (byAction[action] || 0) + 1;
        byModel[model] = (byModel[model] || 0) + 1;
      }

      return { total: rows.length, byAction, byModel };
    }

    const byAction: Record<string, number> = {};
    const byModel: Record<string, number> = {};

    for (const entry of this.entries) {
      byAction[entry.action] = (byAction[entry.action] || 0) + 1;
      byModel[entry.modelType] = (byModel[entry.modelType] || 0) + 1;
    }

    return {
      total: this.entries.length,
      byAction,
      byModel,
    };
  }
}

// Helper: auditable() decorator/mixin for models
// Usage: const User = auditable(BaseUser);
export function auditable(target: any): any {
  // Returns a proxy class that auto-logs create/update/delete via hooks
  const originalCreate = target.create || target.insert;
  const originalUpdate = target.update;
  const originalDelete = target.delete;

  if (originalCreate) {
    target.create = async function (data: any) {
      const instance = await originalCreate.call(this, data);
      await Audit.log({
        userId: null,
        action: 'created',
        modelType: target.name,
        modelId: instance.id,
        newValues: data,
      });
      return instance;
    };
  }

  if (originalUpdate) {
    target.update = async function (id: any, data: any) {
      const instance = await originalUpdate.call(this, id, data);
      await Audit.log({
        userId: null,
        action: 'updated',
        modelType: target.name,
        modelId: id,
        newValues: data,
      });
      return instance;
    };
  }

  if (originalDelete) {
    target.delete = async function (id: any) {
      const result = await originalDelete.call(this, id);
      await Audit.log({
        userId: null,
        action: 'deleted',
        modelType: target.name,
        modelId: id,
      });
      return result;
    };
  }

  return target;
}

export const Audit = singleton('svelar.audit', () => new AuditManager());
