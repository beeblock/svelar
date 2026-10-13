import { createHash, randomUUID } from 'node:crypto';
import { Connection } from '../database/Connection.js';
import { QueryBuilder } from '../orm/QueryBuilder.js';
import { ApplicationContext, type ApplicationContextSnapshot } from '../support/Context.js';
import { singleton } from '../support/singleton.js';
import { Job, Queue } from '../queue/index.js';
import { ScheduledTask } from '../scheduler/index.js';
import { Broadcast } from '../broadcasting/index.js';
import { Notifier, type Notifiable, type Notification } from '../notifications/index.js';
import { redactLogText } from '../logging/Redaction.js';

export type OperationState = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
export interface OperationRecord {
  id: string; name: string; label: string; state: OperationState;
  tenantId: string | null; actorId: string; returnUrl: string | null;
  progress: number; total: number | null; attempts: number; cancelRequested: boolean;
  result: unknown; error: string | null; createdAt: number; updatedAt: number;
}
export interface OperationExecution {
  operation: OperationRecord;
  payload: unknown;
  signal: AbortSignal;
  report(progress: number): Promise<void>;
  isCancelled(): Promise<boolean>;
}
export interface OperationDefinition {
  handle(execution: OperationExecution): Promise<unknown>;
  maxAttempts?: number;
  retrySeconds?: number;
  leaseSeconds?: number;
  notify?: (operation: OperationRecord) => Promise<{ recipient: Notifiable; notification: Notification }>;
}

const query = () => new QueryBuilder('background_operations');
const terminal: OperationState[] = ['succeeded', 'failed', 'cancelled'];
function integer(value: number, maximum: number, label: string, minimum = 1): void {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new RangeError(`Invalid operation ${label}.`);
}
function identity(value: unknown, label: string): string {
  if ((typeof value !== 'string' && typeof value !== 'number') || !String(value).trim() || String(value).length > 255 ||
    (typeof value === 'number' && !Number.isSafeInteger(value))) throw new TypeError(`Operation requires a valid ${label}.`);
  return String(value);
}
function json(value: unknown): string {
  const encoded = JSON.stringify(value);
  if (encoded === undefined || Buffer.byteLength(encoded) > 131_072) throw new RangeError('Operation JSON must fit in 128 KiB.');
  return encoded;
}
function record(row: any): OperationRecord {
  return { id: row.id, name: row.name, label: row.label, state: row.state, tenantId: row.tenant_id,
    actorId: row.actor_id, returnUrl: row.return_url, progress: Number(row.progress), total: row.total == null ? null : Number(row.total),
    attempts: Number(row.attempts), cancelRequested: row.cancel_requested === true || Number(row.cancel_requested) === 1,
    result: row.result == null ? null : JSON.parse(row.result), error: row.error,
    createdAt: Number(row.created_at), updatedAt: Number(row.updated_at) };
}

export class BackgroundOperationManager {
  private definitions = new Map<string, OperationDefinition>();
  register(name: string, definition: OperationDefinition): void {
    if (!/^[A-Za-z][A-Za-z0-9._-]{0,127}$/.test(name) || typeof definition.handle !== 'function') throw new TypeError('Invalid operation definition.');
    integer(definition.maxAttempts ?? 3, 100, 'attempts');
    integer(definition.retrySeconds ?? 10, 3600, 'retry');
    integer(definition.leaseSeconds ?? 60, 3600, 'lease');
    this.definitions.set(name, { ...definition });
    Queue.register(ProcessBackgroundOperationJob);
  }

  async dispatch(name: string, payload: unknown, options: { label: string; total?: number; returnUrl?: string; queue?: string }): Promise<OperationRecord> {
    if (!this.definitions.has(name)) throw new Error('Operation is not registered in this runtime.');
    if (!options.label || options.label.length > 255) throw new TypeError('Operation requires a bounded label.');
    if (options.total !== undefined) integer(options.total, 1_000_000_000, 'total', 0);
    if (options.returnUrl !== undefined) {
      const decoded = decodeURIComponent(options.returnUrl);
      if (!options.returnUrl.startsWith('/') || decoded.startsWith('//') || options.returnUrl.length > 2048 ||
        /[\x00-\x20\x7f\\]/.test(options.returnUrl) || /[\x00-\x1f\x7f\\]/.test(decoded)) throw new TypeError('Operation return URL must be a local application path.');
    }
    const context = ApplicationContext.snapshot();
    const actorId = identity(context.actorId ?? context.userId, 'actor');
    const tenant = context.tenantId ?? context.teamId;
    if (context.tenantId != null && context.teamId != null && String(context.tenantId) !== String(context.teamId)) throw new Error('Operation tenant context is inconsistent.');
    const tenantId = tenant == null ? null : identity(tenant, 'tenant');
    const id = randomUUID();
    const queueName = options.queue ?? 'default';
    if (!queueName || queueName.length > 255) throw new TypeError('Invalid operation queue.');
    const now = Date.now();
    return Connection.transaction(async () => {
      await query().insert({ id, name, label: options.label, state: 'queued', tenant_id: tenantId, actor_id: actorId,
        return_url: options.returnUrl ?? null, queue: queueName, payload: json(payload), context: json(context),
        total: options.total ?? null, available_at: now, created_at: now, updated_at: now });
      await Connection.afterCommit(() => this.wake(id, queueName));
      return record(await query().where('id', id).first());
    });
  }

  async find(id: string): Promise<OperationRecord | null> {
    const row = await this.owned().where('id', id).first();
    return row ? record(row) : null;
  }

  async list(options: { cursor?: string; limit?: number } = {}): Promise<{ data: OperationRecord[]; meta: { nextCursor: string | null } }> {
    const limit = options.limit ?? 20; integer(limit, 100, 'page size');
    const scoped = this.owned();
    if (options.cursor !== undefined) {
      const parsed = /^(\d{1,16}):([a-f0-9-]{36})$/.exec(options.cursor);
      if (!parsed) throw new TypeError('Invalid operation cursor.');
      const timestamp = Number(parsed[1]); integer(timestamp, Number.MAX_SAFE_INTEGER, 'cursor', 0);
      scoped.whereNested((page) => { page.where('created_at', '<', timestamp).orWhereNested((same) => {
        same.where('created_at', timestamp).where('id', '<', parsed[2]);
      }); });
    }
    const rows = await scoped.orderBy('created_at', 'desc').orderBy('id', 'desc').limit(limit + 1).get();
    const data = rows.slice(0, limit).map(record);
    return { data, meta: { nextCursor: rows.length > limit ? `${data.at(-1)!.createdAt}:${data.at(-1)!.id}` : null } };
  }

  async cancel(id: string): Promise<boolean> {
    return Connection.transaction(async () => {
      let lookup = this.owned().where('id', id).whereIn('state', ['queued', 'running']);
      if (Connection.getDriver() !== 'sqlite') lookup = lookup.forUpdate();
      const row = await lookup.first(); if (!row) return false;
      const changed = await this.owned().where('id', id).where('state', row.state).update({ cancel_requested: true,
        ...(row.state === 'queued' ? { state: 'cancelled', notification_pending: !!this.definitions.get(row.name)?.notify } : {}), updated_at: Date.now() });
      if (changed) await Connection.afterCommit(() => this.publish(record({ ...row, cancel_requested: true, state: row.state === 'queued' ? 'cancelled' : row.state })));
      return changed === 1;
    });
  }

  /** Infrastructure boundary, not an HTTP authorization API. Registered jobs/scheduler use this. */
  async process(id: string): Promise<boolean> {
    const owner = randomUUID();
    const row = await Connection.transaction(async () => {
      let candidate = query().where('id', id).where('available_at', '<=', Date.now()).whereNested((states) => {
        states.where('state', 'queued').orWhereNested((running) => { running.where('state', 'running').where('locked_until', '<=', Date.now()); });
      });
      if (Connection.getDriver() !== 'sqlite') candidate = candidate.forUpdate().skipLocked();
      const selected = await candidate.first(); if (!selected) return null;
      const definition = this.definitions.get(selected.name); if (!definition) return null;
      if (selected.cancel_requested === true || Number(selected.cancel_requested) === 1 || Number(selected.attempts) >= (definition.maxAttempts ?? 3)) {
        await query().where('id', id).update({ state: Number(selected.cancel_requested) === 1 ? 'cancelled' : 'failed',
          lock_owner: null, locked_until: null, notification_pending: !!definition.notify, updated_at: Date.now() });
        return { ...selected, exhausted: true };
      }
      await query().where('id', id).update({ state: 'running', lock_owner: owner, locked_until: Date.now() + (definition.leaseSeconds ?? 60) * 1000,
        attempts: Number(selected.attempts) + 1, updated_at: Date.now() });
      return { ...selected, state: 'running', attempts: Number(selected.attempts) + 1 };
    });
    if (!row) return false;
    if (row.exhausted) {
      await this.publish(record(await query().where('id', id).first()));
      await this.deliverNotification(id);
      return true;
    }
    const definition = this.definitions.get(row.name)!;
    const owned = () => query().where('id', id).where('state', 'running').where('lock_owner', owner);
    const abort = new AbortController();
    let heartbeatWork: Promise<void> | undefined;
    let renewing = false;
    let leaseError: unknown;
    const cancelled = async () => {
      const active = await owned().first();
      if (!active) throw new Error('Operation lease was lost.');
      if (active.cancel_requested === true || Number(active.cancel_requested) === 1) abort.abort();
      return abort.signal.aborted;
    };
    const heartbeat = setInterval(() => {
      if (renewing) return;
      renewing = true;
      heartbeatWork = (async () => {
        if (await owned().update({ locked_until: Date.now() + (definition.leaseSeconds ?? 60) * 1000 }) !== 1) throw new Error('Operation lease was lost.');
        await cancelled();
      })().catch((error) => { leaseError = error; abort.abort(); }).finally(() => { renewing = false; });
    }, Math.max(100, (definition.leaseSeconds ?? 60) * 1000 / 3));
    heartbeat.unref();
    try {
      const result = await ApplicationContext.runIsolated(JSON.parse(row.context) as ApplicationContextSnapshot, () => definition.handle({
        operation: record(row), payload: JSON.parse(row.payload), signal: abort.signal, isCancelled: cancelled,
        report: async (progress) => {
          integer(progress, row.total == null ? 1_000_000_000 : Number(row.total), 'progress', 0);
          if (await owned().where('progress', '<=', progress).update({ progress, updated_at: Date.now() }) !== 1) throw new Error('Operation progress cannot decrease or use a lost lease.');
          await this.publish(record(await owned().first()));
        },
      }));
      await heartbeatWork;
      if (leaseError) throw leaseError;
      await cancelled();
      const changes = { error: null, lock_owner: null, locked_until: null, notification_pending: !!definition.notify, updated_at: Date.now() };
      if (await owned().where('cancel_requested', false).update({ ...changes, state: 'succeeded', result: json(result ?? null) }) !== 1 &&
        await owned().where('cancel_requested', true).update({ ...changes, state: 'cancelled', result: null }) !== 1) throw new Error('Operation lease was lost.');
    } catch (error) {
      await heartbeatWork;
      try { await cancelled(); } catch {}
      const lastAttempt = Number(row.attempts) >= (definition.maxAttempts ?? 3);
      await owned().update({ state: abort.signal.aborted && !leaseError ? 'cancelled' : lastAttempt ? 'failed' : 'queued',
        error: redactLogText(error instanceof Error ? error.message : String(error)).slice(0, 2000), lock_owner: null, locked_until: null,
        available_at: Date.now() + (definition.retrySeconds ?? 10) * 1000, notification_pending: (lastAttempt || abort.signal.aborted) && !!definition.notify, updated_at: Date.now() });
    } finally { clearInterval(heartbeat); await heartbeatWork; }
    const settled = await query().where('id', id).first();
    await this.publish(record(settled));
    if (terminal.includes(settled.state)) await this.deliverNotification(id);
    return true;
  }

  async sweep(limit = 100): Promise<number> {
    integer(limit, 1000, 'sweep size');
    const rows = await query().whereIn('name', [...this.definitions.keys()]).where('available_at', '<=', Date.now())
      .whereNested((states) => { states.where('state', 'queued').orWhereNested((running) => {
        running.where('state', 'running').where('locked_until', '<=', Date.now());
      }); }).orderBy('created_at').limit(limit).get();
    let handled = 0;
    for (const row of rows) if (await this.process(row.id)) handled++;
    const notifications = await query().where('notification_pending', true).whereIn('state', terminal).orderBy('updated_at').limit(limit).get();
    for (const row of notifications) await this.deliverNotification(row.id);
    return handled;
  }

  channel(operation: Pick<OperationRecord, 'tenantId' | 'actorId'>): string {
    return `private-operations.${createHash('sha256').update(JSON.stringify([operation.tenantId, operation.actorId])).digest('hex')}`;
  }

  currentChannel(): string { return this.channel(this.ownerScope()); }

  /** Infrastructure retention. Invoke only from trusted scheduler/operator code, never an unguarded route. */
  async prune(before: number): Promise<number> {
    integer(before, Number.MAX_SAFE_INTEGER, 'retention cutoff', 0);
    return query().whereIn('state', terminal).where('notification_pending', false).where('updated_at', '<', before).delete();
  }

  private owned(): QueryBuilder {
    const { actorId, tenantId } = this.ownerScope();
    const scoped = query().where('actor_id', actorId);
    return tenantId === null ? scoped.whereNull('tenant_id') : scoped.where('tenant_id', tenantId);
  }

  private ownerScope(): Pick<OperationRecord, 'tenantId' | 'actorId'> {
    const actor = identity(ApplicationContext.get('actorId') ?? ApplicationContext.get('userId'), 'actor');
    if (ApplicationContext.get('tenantId') != null && ApplicationContext.get('teamId') != null &&
      String(ApplicationContext.get('tenantId')) !== String(ApplicationContext.get('teamId'))) throw new Error('Operation tenant context is inconsistent.');
    const tenant = ApplicationContext.get('tenantId') ?? ApplicationContext.get('teamId');
    return { actorId: actor, tenantId: tenant == null ? null : identity(tenant, 'tenant') };
  }

  private wake(id: string, queueName: string): void {
    try {
      if (Queue.getDriver() === 'sync') return;
      void Queue.dispatch(new ProcessBackgroundOperationJob(id), { queue: queueName, context: {} })
        .catch(() => { console.error('[Operations] Queue signal unavailable; durable sweep will retry.'); });
    } catch { console.error('[Operations] Queue signal unavailable; durable sweep will retry.'); }
  }

  private async publish(operation: OperationRecord): Promise<void> {
    try { await Broadcast.to(this.channel(operation)).send('operation.changed', operation); }
    catch { console.error('[Operations] Realtime signal unavailable; refetch durable state.'); }
  }

  private async deliverNotification(id: string): Promise<void> {
    const owner = randomUUID();
    const changed = await query().where('id', id).where('notification_pending', true).whereNested((lease) => {
      lease.whereNull('locked_until').orWhere('locked_until', '<=', Date.now());
    }).update({ lock_owner: owner, locked_until: Date.now() + 60_000 });
    if (!changed) return;
    const leased = () => query().where('id', id).where('lock_owner', owner);
    const row = await leased().first();
    try {
      const notify = this.definitions.get(row.name)?.notify;
      if (!notify) return;
      await ApplicationContext.runIsolated(JSON.parse(row.context), async () => {
        const delivery = await notify(record(row)); await Notifier.notify(delivery.recipient, delivery.notification);
      });
      await leased().update({ notification_pending: false });
    } catch { console.error('[Operations] Completion notification pending retry.'); }
    finally { await leased().update({ lock_owner: null, locked_until: null }); }
  }
}

export const BackgroundOperation = singleton('svelar.backgroundOperations', () => new BackgroundOperationManager());

export class ProcessBackgroundOperationJob extends Job {
  constructor(public operationId: string) { super(); }
  async handle(): Promise<void> { await BackgroundOperation.process(this.operationId); }
}
export class BackgroundOperationSweep extends ScheduledTask {
  schedule(): this { return this.everyMinute().preventOverlap(); }
  async handle(): Promise<void> { await BackgroundOperation.sweep(); }
}

export { OperationsController } from './Controller.js';
