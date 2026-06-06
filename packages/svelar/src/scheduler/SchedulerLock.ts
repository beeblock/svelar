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
import { QueryBuilder } from '../orm/QueryBuilder.js';

const ownerId = `${hostname()}:${process.pid}:${Math.random().toString(36).slice(2, 10)}`;

async function getConnection() {
  const { Connection } = await import('../database/Connection.js');
  return Connection;
}

function locksQuery(): QueryBuilder<any> {
  return new QueryBuilder('scheduler_locks');
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
    const conn = await getConnection();
    const driver = conn.getDriver();
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + ttlMinutes * 60_000).toISOString();
    let result: any;

    if (driver === 'mysql') {
      result = await conn.raw(
        'INSERT INTO scheduler_locks (task_key, owner, expires_at) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE owner = IF(expires_at < ?, VALUES(owner), owner), expires_at = IF(expires_at < ?, VALUES(expires_at), expires_at)',
        [taskKey, ownerId, expiresAt, now, now],
      );
    } else {
      result = await conn.raw(
        'INSERT INTO scheduler_locks (task_key, owner, expires_at) VALUES (?, ?, ?) ON CONFLICT (task_key) DO UPDATE SET owner = excluded.owner, expires_at = excluded.expires_at WHERE scheduler_locks.expires_at < ?',
        [taskKey, ownerId, expiresAt, now],
      );
    }

    const changed = affectedRows(result);
    if (changed !== null) {
      return changed > 0;
    }

    const row = await locksQuery().select('owner', 'expires_at').where('task_key', taskKey).first();
    return row?.owner === ownerId && row?.expires_at === expiresAt;
  }

  /**
   * Release a lock (only if this process owns it).
   */
  static async release(taskKey: string): Promise<void> {
    await locksQuery().where('task_key', taskKey).where('owner', ownerId).delete();
  }

  /**
   * Release all locks held by this process.
   * Called during graceful shutdown.
   */
  static async releaseAll(): Promise<void> {
    await locksQuery().where('owner', ownerId).delete();
  }
}
