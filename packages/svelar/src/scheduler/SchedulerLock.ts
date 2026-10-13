/**
 * Distributed Scheduler Lock
 *
 * Database-backed distributed locking for scheduled tasks.
 * Prevents duplicate task execution across multiple scheduler instances.
 * Supports SQLite, PostgreSQL, and MySQL via the Connection abstraction.
 *
 * The `scheduler_locks` table is managed by Svelar core migrations.
 */

import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import { QueryBuilder } from '../orm/QueryBuilder.js';
import { singleton } from '../support/singleton.js';

const ownerId = singleton('svelar.scheduler.owner', () => `${hostname()}:${process.pid}:${randomUUID()}`);
const legacyHeld = singleton('svelar.scheduler.legacy-held', () => new Map<string, number>());
const legacyAcquiring = singleton('svelar.scheduler.legacy-acquiring', () => new Set<string>());

async function getConnection() {
  const { Connection } = await import('../database/Connection.js');
  return Connection;
}

function locksQuery(connectionName?: string): QueryBuilder<any> {
  return new QueryBuilder('scheduler_locks', undefined, connectionName);
}

function affectedRows(result: any): number | null {
  if (typeof result?.changes === 'number') return result.changes;
  if (typeof result?.affectedRows === 'number') return result.affectedRows;
  if (typeof result?.rowCount === 'number') return result.rowCount;
  if (typeof result?.count === 'number') return result.count;
  return null;
}

export class SchedulerLock {
  /**
   * Get the unique owner ID for this process.
   */
  static getOwnerId(): string {
    return ownerId;
  }

  /**
   * Try to acquire a distributed lock for a task.
   * Returns true if the lock was acquired, false if another process holds it.
   */
  static async acquire(taskKey: string, ttlMinutes: number = 5): Promise<boolean> {
    if (legacyAcquiring.has(taskKey) || (legacyHeld.get(taskKey) ?? 0) > Date.now()) return false;
    legacyAcquiring.add(taskKey);
    try {
      const result = await this.acquireForOwner(taskKey, ttlMinutes, ownerId);
      if (result) legacyHeld.set(taskKey, Date.now() + ttlMinutes * 60000);
      return result;
    } finally { legacyAcquiring.delete(taskKey); }
  }

  static async acquireLease(taskKey: string, ttlMinutes = 5, connectionName?: string): Promise<SchedulerLease | null> {
    const owner = `${ownerId}:${randomUUID()}`;
    if (!await this.acquireForOwner(taskKey, ttlMinutes, owner, connectionName, true)) return null;
    return new SchedulerLease(taskKey, owner, ttlMinutes, connectionName);
  }

  private static async acquireForOwner(taskKey: string, ttlMinutes: number, owner: string, connectionName?: string, uniqueOwner = false): Promise<boolean> {
    if (!taskKey || taskKey.length > 255 || !Number.isFinite(ttlMinutes) || ttlMinutes <= 0 || ttlMinutes > 10080) throw new Error('Invalid scheduler lease.');
    const conn = await getConnection();
    const driver = conn.getDriver(connectionName);
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + ttlMinutes * 60_000).toISOString();
    let result: any;

    if (driver === 'mysql') {
      result = await conn.raw(
        'INSERT INTO scheduler_locks (task_key, owner, expires_at) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE owner = IF(expires_at <= ?, VALUES(owner), owner), expires_at = IF(expires_at <= ?, VALUES(expires_at), expires_at)',
        [taskKey, owner, expiresAt, now, now], connectionName,
      );
    } else {
      result = await conn.raw(
        'INSERT INTO scheduler_locks (task_key, owner, expires_at) VALUES (?, ?, ?) ON CONFLICT (task_key) DO UPDATE SET owner = excluded.owner, expires_at = excluded.expires_at WHERE scheduler_locks.expires_at <= ?',
        [taskKey, owner, expiresAt, now], connectionName,
      );
    }

    const changed = affectedRows(result);
    if (changed === 0) return false;

    const row = await locksQuery(connectionName).select('owner', 'expires_at').where('task_key', taskKey).first();
    return row?.owner === owner && (uniqueOwner || changed !== null || new Date(row.expires_at).getTime() === new Date(expiresAt).getTime());
  }

  /**
   * Release a lock (only if this process owns it).
   */
  static async release(taskKey: string): Promise<void> {
    await locksQuery().where('task_key', taskKey).where('owner', ownerId).delete();
    legacyHeld.delete(taskKey);
  }

  /**
   * Release all locks held by this process.
   * Called during graceful shutdown.
   */
  static async releaseAll(): Promise<void> {
    await locksQuery().where('owner', ownerId).delete();
    legacyHeld.clear();
  }
}

export class SchedulerLeaseLostError extends Error {
  constructor() { super('Scheduler execution lease was lost.'); this.name = 'SchedulerLeaseLostError'; }
}

/** An invocation token prevents an old completion from releasing its successor's lease. */
export class SchedulerLease {
  expiresAt: number;
  constructor(readonly key: string, readonly owner: string, readonly ttlMinutes: number, readonly connectionName?: string) {
    this.expiresAt = Date.now() + ttlMinutes * 60000;
  }

  async renew(): Promise<void> {
    const until = Date.now() + this.ttlMinutes * 60000;
    const updated = await locksQuery(this.connectionName).where('task_key', this.key).where('owner', this.owner)
      .where('expires_at', '>', new Date().toISOString()).update({ expires_at: new Date(until).toISOString() });
    if (updated !== 1) throw new SchedulerLeaseLostError();
    this.expiresAt = until;
  }

  async release(): Promise<void> {
    await locksQuery(this.connectionName).where('task_key', this.key).where('owner', this.owner).delete();
  }

  async run<T>(handler: (signal: AbortSignal) => Promise<T>, heartbeat?: () => Promise<void>): Promise<T> {
    const abort = new AbortController();
    let renewal: Promise<void> | null = null;
    let failure: unknown;
    const timer = setInterval(() => {
      if (renewal) return;
      renewal = (async () => { await this.renew(); await heartbeat?.(); })()
        .catch((error) => { failure = error; abort.abort(error); })
        .finally(() => { renewal = null; });
    }, Math.max(1, Math.floor(this.ttlMinutes * 60000 / 3)));
    try {
      const result = await handler(abort.signal);
      if (renewal) await renewal;
      if (failure) throw failure;
      await this.renew();
      return result;
    } finally {
      clearInterval(timer);
      if (renewal) await renewal;
      await this.release();
    }
  }
}
