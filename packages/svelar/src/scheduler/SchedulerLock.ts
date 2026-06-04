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
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + ttlMinutes * 60_000).toISOString();

    try {
      await conn.transaction(async () => {
        await locksQuery().where('task_key', taskKey).where('expires_at', '<', now).delete();
        await locksQuery().upsert(
          { task_key: taskKey, owner: ownerId, expires_at: expiresAt },
          'task_key',
          [],
        );
      });

      const row = await locksQuery().select('owner').where('task_key', taskKey).first();
      return row?.owner === ownerId;
    } catch {
      return false;
    }
  }

  /**
   * Release a lock (only if this process owns it).
   */
  static async release(taskKey: string): Promise<void> {
    try {
      await locksQuery().where('task_key', taskKey).where('owner', ownerId).delete();
    } catch {
      // Best-effort release — TTL will handle cleanup if this fails
    }
  }

  /**
   * Release all locks held by this process.
   * Called during graceful shutdown.
   */
  static async releaseAll(): Promise<void> {
    try {
      await locksQuery().where('owner', ownerId).delete();
    } catch {
      // Best-effort
    }
  }
}
