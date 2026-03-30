/**
 * Distributed Scheduler Lock
 *
 * Database-backed distributed locking for scheduled tasks.
 * Prevents duplicate task execution across multiple scheduler instances.
 * Supports SQLite, PostgreSQL, and MySQL via the Connection abstraction.
 *
 * The `scheduler_locks` table is auto-created on first use.
 */

import { hostname } from 'node:os';

let tableEnsured = false;

const ownerId = `${hostname()}:${process.pid}:${Math.random().toString(36).slice(2, 10)}`;

async function getConnection() {
  const { Connection } = await import('../database/Connection.js');
  return Connection;
}

async function getDriver(): Promise<string> {
  const conn = await getConnection();
  return conn.getDriver();
}

export class SchedulerLock {
  /**
   * Get the unique owner ID for this process.
   */
  static getOwnerId(): string {
    return ownerId;
  }

  /**
   * Ensure the scheduler_locks table exists (auto-created on first use).
   */
  static async ensureTable(): Promise<void> {
    if (tableEnsured) return;

    const conn = await getConnection();
    const driver = conn.getDriver();

    switch (driver) {
      case 'sqlite':
        await conn.raw(
          `CREATE TABLE IF NOT EXISTS scheduler_locks (
            task_key TEXT PRIMARY KEY,
            owner TEXT NOT NULL,
            expires_at TEXT NOT NULL
          )`,
        );
        break;
      case 'postgres':
        await conn.raw(
          `CREATE TABLE IF NOT EXISTS scheduler_locks (
            task_key VARCHAR(255) PRIMARY KEY,
            owner VARCHAR(255) NOT NULL,
            expires_at TIMESTAMPTZ NOT NULL
          )`,
        );
        break;
      case 'mysql':
        await conn.raw(
          `CREATE TABLE IF NOT EXISTS scheduler_locks (
            task_key VARCHAR(255) PRIMARY KEY,
            owner VARCHAR(255) NOT NULL,
            expires_at DATETIME NOT NULL
          ) ENGINE=InnoDB`,
        );
        break;
    }

    tableEnsured = true;
  }

  /**
   * Try to acquire a distributed lock for a task.
   * Returns true if the lock was acquired, false if another process holds it.
   */
  static async acquire(taskKey: string, ttlMinutes: number = 5): Promise<boolean> {
    await this.ensureTable();

    const conn = await getConnection();
    const driver = await getDriver();
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + ttlMinutes * 60_000).toISOString();

    try {
      await conn.transaction(async () => {
        // Clean up expired locks for this task
        await conn.raw(
          'DELETE FROM scheduler_locks WHERE task_key = ? AND expires_at < ?',
          [taskKey, now],
        );

        // Attempt to insert — fails with unique constraint if lock is held
        switch (driver) {
          case 'sqlite':
            await conn.raw(
              'INSERT OR IGNORE INTO scheduler_locks (task_key, owner, expires_at) VALUES (?, ?, ?)',
              [taskKey, ownerId, expiresAt],
            );
            break;
          case 'postgres':
            await conn.raw(
              'INSERT INTO scheduler_locks (task_key, owner, expires_at) VALUES ($1, $2, $3) ON CONFLICT (task_key) DO NOTHING',
              [taskKey, ownerId, expiresAt],
            );
            break;
          case 'mysql':
            await conn.raw(
              'INSERT IGNORE INTO scheduler_locks (task_key, owner, expires_at) VALUES (?, ?, ?)',
              [taskKey, ownerId, expiresAt],
            );
            break;
        }
      });

      // Verify we own the lock
      const rows: any[] = await conn.raw(
        'SELECT owner FROM scheduler_locks WHERE task_key = ?',
        [taskKey],
      );

      return rows.length > 0 && rows[0].owner === ownerId;
    } catch {
      return false;
    }
  }

  /**
   * Release a lock (only if this process owns it).
   */
  static async release(taskKey: string): Promise<void> {
    try {
      const conn = await getConnection();
      await conn.raw(
        'DELETE FROM scheduler_locks WHERE task_key = ? AND owner = ?',
        [taskKey, ownerId],
      );
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
      const conn = await getConnection();
      await conn.raw(
        'DELETE FROM scheduler_locks WHERE owner = ?',
        [ownerId],
      );
    } catch {
      // Best-effort
    }
  }
}
