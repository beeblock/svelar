import { createHash, randomUUID } from 'node:crypto';
import { Connection } from '../database/Connection.js';
import { QueryBuilder } from '../orm/QueryBuilder.js';
import { ApplicationContext, type ApplicationContextSnapshot } from '../support/Context.js';
import { redactLogText } from '../logging/Redaction.js';
import type { SearchSyncOperation } from './index.js';

export interface SearchOutboxOptions {
  connection?: string;
  queue?: string;
  maxAttempts?: number;
  retrySeconds?: number;
  leaseSeconds?: number;
}

export class SearchOutbox {
  constructor(readonly options: SearchOutboxOptions = {}) {
    for (const [name, value] of Object.entries(options)) {
      if (name === 'connection' || name === 'queue') continue;
      if (!Number.isSafeInteger(value) || Number(value) < 1) throw new Error(`Invalid search outbox ${name}.`);
      const maximum = name === 'maxAttempts' ? 1000 : name === 'leaseSeconds' ? 3600 : 86400;
      if (Number(value) > maximum) throw new Error(`Invalid search outbox ${name}.`);
    }
  }

  async enqueue(operation: SearchSyncOperation): Promise<void> {
    if (!operation.index || !operation.primaryKey || !['upsert', 'delete'].includes(operation.type) ||
      (typeof operation.id === 'number' ? !Number.isSafeInteger(operation.id) || operation.id < 0 : typeof operation.id !== 'string' || !operation.id) ||
      (operation.type === 'upsert' && (!operation.document || typeof operation.document !== 'object' || Array.isArray(operation.document)))) {
      throw new Error('Invalid search operation.');
    }
    const now = new Date().toISOString();
    const key = createHash('sha256').update(JSON.stringify([operation.index, operation.primaryKey, operation.id])).digest('hex');
    await this.table().insert({ document_key: key, operation: JSON.stringify(operation), context: JSON.stringify(ApplicationContext.snapshot()),
      status: 'pending', attempts: 0, available_at: now, created_at: now, owner: null, locked_until: null, error: null, processed_at: null });
  }

  /** Claims are transactional; only one operation per document can be processed at a time. */
  async drain(execute: (operation: SearchSyncOperation) => Promise<void>, limit = 100): Promise<{ completed: number; failed: number }> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new Error('Invalid search outbox batch size.');
    const result = { completed: 0, failed: 0 };
    for (let i = 0; i < limit; i++) {
      const owner = randomUUID();
      const row = await Connection.transaction(async () => {
        const now = new Date().toISOString();
        let query = this.eligible(now).whereRaw(
          'NOT EXISTS (SELECT 1 FROM svelar_search_outbox older WHERE older.document_key = svelar_search_outbox.document_key AND older.id < svelar_search_outbox.id AND older.status != ?)', ['completed'],
        ).orderBy('id');
        if (Connection.getDriver(this.options.connection) !== 'sqlite') query = query.forUpdate().skipLocked();
        const candidate = await query.first();
        if (!candidate) return null;
        const changed = await this.eligible(now).where('id', candidate.id).update({ status: 'processing', owner,
          locked_until: new Date(Date.now() + (this.options.leaseSeconds ?? 60) * 1000).toISOString() });
        return changed === 1 ? candidate : null;
      }, this.options.connection);
      if (!row) break;
      let renewing = false;
      let pendingRenewal: Promise<void> | undefined;
      let leaseError: unknown;
      const renew = setInterval(() => {
        if (renewing) return;
        renewing = true;
        pendingRenewal = this.owned(row.id, owner).update({ locked_until: new Date(Date.now() + (this.options.leaseSeconds ?? 60) * 1000).toISOString() })
          .then((count) => { if (count !== 1) leaseError = new Error('Search outbox lease lost.'); })
          .catch((error) => { leaseError = error; }).finally(() => { renewing = false; });
      }, Math.max(100, (this.options.leaseSeconds ?? 60) * 1000 / 3));
      renew.unref();
      try {
        const operation = JSON.parse(row.operation) as SearchSyncOperation;
        const context = JSON.parse(row.context) as ApplicationContextSnapshot;
        await ApplicationContext.runIsolated(context, () => execute(operation));
        clearInterval(renew);
        await pendingRenewal;
        if (leaseError) throw leaseError;
        const changed = await this.owned(row.id, owner).update({ status: 'completed', processed_at: new Date().toISOString(), owner: null, locked_until: null, error: null });
        if (changed !== 1) throw new Error('Search outbox lease lost.');
        result.completed++;
      } catch (error) {
        clearInterval(renew);
        await pendingRenewal;
        const attempts = Number(row.attempts) + 1;
        const retry = Math.min(3600, (this.options.retrySeconds ?? 10) * 2 ** Math.min(attempts - 1, 10));
        await this.owned(row.id, owner).update({ status: attempts >= (this.options.maxAttempts ?? 10) ? 'dead' : 'pending', attempts,
          available_at: new Date(Date.now() + retry * 1000).toISOString(), owner: null, locked_until: null,
          error: redactLogText(error instanceof Error ? error.message : String(error)).slice(0, 2000) });
        result.failed++;
      } finally { clearInterval(renew); await pendingRenewal; }
    }
    return result;
  }

  async stats(): Promise<{ pending: number; processing: number; dead: number; oldestPendingAt: string | null }> {
    const counts = { pending: 0, processing: 0, dead: 0, oldestPendingAt: null as string | null };
    const rows = await this.table().whereIn('status', ['pending', 'processing', 'dead']).select('status').selectRaw('COUNT(*) AS total').groupBy('status').get();
    for (const row of rows) counts[row.status as 'pending' | 'processing' | 'dead'] = Number(row.total);
    const oldest = await this.table().whereIn('status', ['pending', 'processing']).orderBy('id').first();
    counts.oldestPendingAt = oldest ? new Date(oldest.created_at).toISOString() : null;
    return counts;
  }

  async replay(id: number): Promise<boolean> {
    if (!Number.isSafeInteger(id) || id < 1) throw new Error('Invalid outbox entry ID.');
    return await this.table().where('id', id).where('status', 'dead').update({ status: 'pending', attempts: 0,
      available_at: new Date().toISOString(), error: null, owner: null, locked_until: null }) === 1;
  }

  async prune(before: Date): Promise<number> {
    if (!Number.isFinite(before.getTime())) throw new Error('Invalid outbox retention date.');
    return this.table().where('status', 'completed').where('processed_at', '<', before.toISOString()).delete();
  }

  private table() { return new QueryBuilder('svelar_search_outbox', undefined, this.options.connection); }
  private owned(id: number, owner: string) { return this.table().where('id', id).where('status', 'processing').where('owner', owner); }
  private eligible(now: string) {
    return this.table().whereNested((query) => {
      query.whereNested((pending) => { pending.where('status', 'pending').where('available_at', '<=', now); });
      query.orWhereNested((expired) => { expired.where('status', 'processing').where('locked_until', '<=', now); });
    });
  }
}
