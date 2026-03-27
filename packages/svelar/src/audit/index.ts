/**
 * Svelar Audit Logging
 * Track user actions across the application for compliance and debugging.
 */

import { randomUUID } from 'crypto';
import { singleton } from '../support/singleton.js';

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
      try {
        const { Connection } = await import('../database/Connection.js');
        await Connection.connection();
        // Would insert into audit table
        // Implementation depends on your database schema
      } catch {
        // Fallback to memory if database not available
        this.entries.push(auditEntry);
      }
    }
  }

  async query(filter: AuditFilter): Promise<AuditEntry[]> {
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
