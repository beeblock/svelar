import { createHash, randomUUID } from 'node:crypto';
import { QueryBuilder } from '../orm/QueryBuilder.js';
import { validateTimezone } from './cron.js';

export interface SchedulerScope { tenantId?: string | number | null; timezone?: string }
export interface MissedRunPolicy { policy: 'skip' | 'latest' | 'catch-up'; windowMinutes: number; maxRuns: number }
export interface SchedulerTaskSettings {
  enabled?: boolean;
  timezone?: string | null;
  missedRun?: MissedRunPolicy;
}
export interface SchedulerRunRequest {
  id: string;
  task: string;
  tenantId: string | null;
  state: 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  requestedAt: Date;
  requestedBy: string | null;
  owner: string | null;
  leaseUntil: Date | null;
  attempts: number;
  result: unknown;
  error: string | null;
}
export interface SchedulerRuntimeRecord {
  runtime_key: string;
  kind: 'task' | 'process';
  task_name: string | null;
  tenant_id: string | null;
  state: string;
  owner: string | null;
  lease_until: number | null;
  heartbeat_at: number;
  started_at: number | null;
  last_checked_at: number | null;
  last_run_at: number | null;
  next_run_at: number | null;
  last_tick_at: number | null;
  last_success_at: number | null;
  last_error_at: number | null;
  last_duration: number | null;
  last_error: string | null;
  failures: number;
}
interface RequestRow {
  id: string; task_key: string; task_name: string; tenant_id: string | null;
  state: SchedulerRunRequest['state']; requested_at: number; requested_by: string | null;
  correlation_id: string | null; owner: string | null; lease_until: number | null;
  attempts: number; result: string | null; error: string | null;
}

export function schedulerTenantId(scope: SchedulerScope): string | null {
  const value = scope.tenantId;
  if (value === null || value === undefined) return null;
  if ((typeof value !== 'string' && typeof value !== 'number') || (typeof value === 'number' && !Number.isFinite(value))
    || String(value).trim() === '' || String(value).length > 255) throw new Error('Invalid scheduler tenant.');
  return String(value);
}

export function schedulerTaskKey(name: string, scope: SchedulerScope = {}): string {
  if (!name || name.length > 255 || name.startsWith('tenant:') || name.startsWith('process:')) throw new Error('Invalid scheduler task name.');
  const tenant = schedulerTenantId(scope);
  return tenant === null ? name : `tenant:${createHash('sha256').update(JSON.stringify([tenant, name])).digest('hex')}`;
}

export function validateMissedRun(policy: MissedRunPolicy): void {
  if (!['skip', 'latest', 'catch-up'].includes(policy.policy) || !Number.isInteger(policy.windowMinutes) || policy.windowMinutes < 1 || policy.windowMinutes > 10080
    || !Number.isInteger(policy.maxRuns) || policy.maxRuns < 1 || policy.maxRuns > 100) throw new Error('Invalid bounded scheduler missed-run policy.');
}

/** Durable operations are scoped by immutable task keys, never by ambient request context. */
export class SchedulerRuntimeStore {
  readonly scope: SchedulerScope;
  constructor(scope: SchedulerScope = {}, readonly connectionName?: string) {
    this.scope = Object.freeze({ tenantId: schedulerTenantId(scope), timezone: scope.timezone });
    if (scope.timezone !== undefined) validateTimezone(scope.timezone);
  }
  key(name: string): string { return schedulerTaskKey(name, this.scope); }
  private query<T = Record<string, any>>(table: string): QueryBuilder<T> { return new QueryBuilder<T>(table, undefined, this.connectionName); }

  async settings(name: string): Promise<{ enabled: boolean; timezone: string | null; missedRun: MissedRunPolicy | null } | null> {
    const row = await this.query('scheduled_task_settings').where('task', this.key(name)).first();
    if (!row) return null;
    const missedRun: MissedRunPolicy | null = row.missed_run_policy === null ? null : { policy: row.missed_run_policy, windowMinutes: Number(row.catch_up_minutes), maxRuns: Number(row.max_catch_up_runs) };
    if (missedRun) validateMissedRun(missedRun);
    if (row.timezone !== null) validateTimezone(row.timezone);
    return { enabled: row.enabled === true || row.enabled === 1, timezone: row.timezone, missedRun };
  }

  async setSettings(name: string, settings: SchedulerTaskSettings): Promise<void> {
    if (settings.enabled !== undefined && typeof settings.enabled !== 'boolean') throw new Error('Scheduler enabled must be a boolean.');
    if (settings.timezone !== undefined && settings.timezone !== null) validateTimezone(settings.timezone);
    if (settings.missedRun) validateMissedRun(settings.missedRun);
    const payload: Record<string, unknown> = {
      task: this.key(name), task_name: name, tenant_id: schedulerTenantId(this.scope),
      enabled: settings.enabled ?? true, updated_at: new Date().toISOString(),
    };
    const updates = ['task_name', 'tenant_id', 'updated_at'];
    if (settings.enabled !== undefined) updates.push('enabled');
    if (settings.timezone !== undefined) { payload.timezone = settings.timezone; updates.push('timezone'); }
    if (settings.missedRun) {
      Object.assign(payload, { missed_run_policy: settings.missedRun.policy, catch_up_minutes: settings.missedRun.windowMinutes, max_catch_up_runs: settings.missedRun.maxRuns });
      updates.push('missed_run_policy', 'catch_up_minutes', 'max_catch_up_runs');
    }
    await this.query('scheduled_task_settings').upsert(payload, 'task', updates);
  }

  async task(name: string): Promise<SchedulerRuntimeRecord | null> {
    return this.query<SchedulerRuntimeRecord>('scheduler_runtime').where('runtime_key', this.key(name)).first();
  }

  async ensureTask(name: string): Promise<SchedulerRuntimeRecord> {
    await this.query('scheduler_runtime').upsert({
      runtime_key: this.key(name), kind: 'task', task_name: name, tenant_id: schedulerTenantId(this.scope),
      state: 'idle', heartbeat_at: Date.now(),
    }, 'runtime_key', ['task_name', 'tenant_id']);
    return (await this.task(name))!;
  }

  async updateTask(name: string, data: Partial<SchedulerRuntimeRecord>, owner?: string): Promise<boolean> {
    let query = this.query('scheduler_runtime').where('runtime_key', this.key(name));
    if (owner !== undefined) query = query.where('owner', owner);
    return (await query.update(data)) > 0;
  }

  async process(owner: string, data: Partial<SchedulerRuntimeRecord>): Promise<void> {
    await this.query('scheduler_runtime').upsert({
      runtime_key: `process:${owner}`, kind: 'process', task_name: null, tenant_id: schedulerTenantId(this.scope),
      state: 'running', heartbeat_at: Date.now(), started_at: Date.now(), ...data,
    }, 'runtime_key', ['state', 'heartbeat_at', ...Object.keys(data)]);
  }

  async processes(): Promise<SchedulerRuntimeRecord[]> {
    let query = this.query<SchedulerRuntimeRecord>('scheduler_runtime').where('kind', 'process');
    const tenant = schedulerTenantId(this.scope);
    query = tenant === null ? query.whereNull('tenant_id') : query.where('tenant_id', tenant);
    return query.orderBy('heartbeat_at', 'desc').limit(100).get();
  }

  async enqueue(name: string, actor?: string | number | null, correlationId?: string | null): Promise<SchedulerRunRequest> {
    for (const value of [actor, correlationId]) if (value !== null && value !== undefined && (String(value).length > 255 || String(value).trim() === '')) throw new Error('Invalid scheduler request context.');
    const id = randomUUID();
    await this.query('scheduler_requests').insert({
      id, task_key: this.key(name), task_name: name, tenant_id: schedulerTenantId(this.scope), state: 'pending',
      requested_at: Date.now(), requested_by: actor === null || actor === undefined ? null : String(actor), correlation_id: correlationId ?? null,
    });
    return (await this.request(name, id))!;
  }

  async request(name: string, id: string): Promise<SchedulerRunRequest | null> {
    const row = await this.query<RequestRow>('scheduler_requests').where('id', id).where('task_key', this.key(name)).first();
    return row ? this.requestRecord(row) : null;
  }

  async pending(name: string, limit: number): Promise<RequestRow[]> {
    return this.query<RequestRow>('scheduler_requests').where('task_key', this.key(name))
      .whereNested((query) => { query.where('state', 'pending').orWhereNested((expired) => { expired.where('state', 'running').where('lease_until', '<=', Date.now()); }); })
      .orderBy('requested_at').orderBy('id').limit(limit).get();
  }

  async claim(request: RequestRow, owner: string, until: number): Promise<boolean> {
    return (await this.query('scheduler_requests').where('id', request.id).where('task_key', this.key(request.task_name))
      .whereNested((query) => { query.where('state', 'pending').orWhereNested((expired) => { expired.where('state', 'running').where('lease_until', '<=', Date.now()); }); })
      .update({ state: 'running', owner, lease_until: until, started_at: Date.now(), attempts: Number(request.attempts) + 1 })) > 0;
  }

  async renewRequest(name: string, id: string, owner: string, until: number): Promise<boolean> {
    return (await this.query('scheduler_requests').where('id', id).where('task_key', this.key(name)).where('state', 'running')
      .where('owner', owner).where('lease_until', '>', Date.now()).update({ lease_until: until })) > 0;
  }

  async finishRequest(name: string, id: string, owner: string, result: { success: boolean; error?: string }): Promise<boolean> {
    return (await this.query('scheduler_requests').where('id', id).where('task_key', this.key(name)).where('state', 'running')
      .where('owner', owner).where('lease_until', '>', Date.now()).update({
        state: result.success ? 'succeeded' : 'failed', result: JSON.stringify(result), error: result.error ?? null,
        finished_at: Date.now(), owner: null, lease_until: null,
      })) > 0;
  }

  async cancelRequest(name: string, id: string): Promise<boolean> {
    return (await this.query('scheduler_requests').where('id', id).where('task_key', this.key(name)).where('state', 'pending')
      .update({ state: 'cancelled', finished_at: Date.now() })) > 0;
  }

  private requestRecord(row: RequestRow): SchedulerRunRequest {
    return {
      id: row.id, task: row.task_name, tenantId: row.tenant_id, state: row.state,
      requestedAt: new Date(Number(row.requested_at)), requestedBy: row.requested_by, owner: row.owner,
      leaseUntil: row.lease_until === null ? null : new Date(Number(row.lease_until)), attempts: Number(row.attempts),
      result: row.result === null ? null : JSON.parse(row.result), error: row.error,
    };
  }
}
