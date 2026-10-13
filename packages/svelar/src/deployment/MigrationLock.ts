import { Connection } from '../database/Connection.js';
import { Schema } from '../database/SchemaBuilder.js';
import { QueryBuilder } from '../orm/QueryBuilder.js';

export interface MigrationLockOptions { name?: string; connectionName?: string; }
export class MigrationLockBusyError extends Error {
  constructor() { super('Migrations are already locked. Verify the previous migration process has stopped before recovering its exact owner token.'); }
}
export class MigrationLockFoundationError extends Error {
  constructor() { super('Deployment lock migration 000049 is not installed. Bootstrap core migrations explicitly before adopting blue/green deployment; the current release has not been changed.'); }
}

export class MigrationLock {
  private static query(options: MigrationLockOptions) { return new QueryBuilder<any>('svelar_deployment_locks', undefined, options.connectionName); }
  private static name(options: MigrationLockOptions): string {
    const name = options.name ?? 'migrations';
    if (typeof name !== 'string' || !name || Buffer.byteLength(name) > 128 || name.includes('\0')) throw new TypeError('Invalid migration lock name.');
    return name;
  }
  static async check(options: MigrationLockOptions = {}): Promise<void> {
    const name = this.name(options);
    if (!await new Schema(options.connectionName).hasTable('svelar_deployment_locks')) throw new MigrationLockFoundationError();
    const row = await this.query(options).where('name', name).first();
    if (row?.owner != null) throw new MigrationLockBusyError();
  }
  static async inspect(options: MigrationLockOptions = {}): Promise<{ owner: string | null; acquiredAt: number | null } | null> {
    const row = await this.query(options).where('name', this.name(options)).first();
    return row ? { owner: row.owner ?? null, acquiredAt: row.acquired_at == null ? null : Number(row.acquired_at) } : null;
  }
  /** Operator recovery requires the exact persisted token, after independently verifying the old process is dead. */
  static async release(owner: string, options: MigrationLockOptions = {}): Promise<boolean> {
    if (typeof owner !== 'string' || !/^[0-9a-f-]{36}$/i.test(owner)) throw new TypeError('An exact migration lock owner UUID is required.');
    return await this.query(options).where('name', this.name(options)).where('owner', owner).update({ owner: null, acquired_at: null }) === 1;
  }
  static async run<T>(callback: () => Promise<T>, options: MigrationLockOptions = {}): Promise<T> {
    if (Connection.inTransaction(options.connectionName)) throw new Error('Migration ownership must be committed outside an existing transaction.');
    await this.check(options);
    const name = this.name(options); const owner = crypto.randomUUID();
    const acquiredAt = Date.now();
    const acquired = await Connection.transaction(async () => {
      try {
        await Connection.withSavepointIfNeeded(() => this.query(options).insert({ name, owner, acquired_at: acquiredAt }), options.connectionName);
        return true;
      } catch (error: any) {
        const unique = ['23505', 'ER_DUP_ENTRY', 'SQLITE_CONSTRAINT_PRIMARYKEY', 'SQLITE_CONSTRAINT_UNIQUE'].includes(error?.code) ||
          error?.code === 'ERR_SQLITE_ERROR' && [1555, 2067].includes(error?.errcode);
        if (!unique) throw error;
        return await this.query(options).where('name', name).whereNull('owner').update({ owner, acquired_at: acquiredAt }) === 1;
      }
    }, options.connectionName);
    if (!acquired) throw new MigrationLockBusyError();
    let original: unknown;
    let failed = false;
    try { return await callback(); }
    catch (error) { original = error; failed = true; throw error; }
    finally {
      try { if (!await this.release(owner, options)) throw new Error('Migration lock ownership was lost.'); }
      catch (error) { if (failed) throw new AggregateError([original, error], 'Migration failed and its ownership could not be released.'); throw error; }
    }
  }
}
