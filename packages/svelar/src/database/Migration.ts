/**
 * Svelar Migration System
 *
 * Laravel-like database migrations with up/down support,
 * batch tracking, and rollback capabilities.
 */

import { Connection } from './Connection.js';
import { Schema } from './SchemaBuilder.js';

// ── Migration Base Class ───────────────────────────────────

export abstract class Migration {
  protected schema = new Schema();

  /** Apply the migration */
  abstract up(): Promise<void>;

  /** Reverse the migration */
  abstract down(): Promise<void>;
}

// ── Migration File Descriptor ──────────────────────────────

export interface MigrationFile {
  name: string;
  timestamp: string;
  path: string;
  migration: Migration;
}

// ── Migrator ───────────────────────────────────────────────

export class Migrator {
  private migrationsTable = 'svelar_migrations';
  private connectionName?: string;

  constructor(connectionName?: string) {
    this.connectionName = connectionName;
  }

  /**
   * Ensure the migrations tracking table exists
   */
  async ensureMigrationsTable(): Promise<void> {
    const schema = new Schema(this.connectionName);
    const exists = await schema.hasTable(this.migrationsTable);

    if (!exists) {
      await schema.createTable(this.migrationsTable, (table) => {
        table.increments('id');
        table.string('migration').unique();
        table.integer('batch');
        table.timestamp('ran_at').default('CURRENT_TIMESTAMP');
      });
    }
  }

  /**
   * Run all pending migrations
   */
  async run(migrations: MigrationFile[]): Promise<string[]> {
    await this.ensureMigrationsTable();

    const ran = await this.getRanMigrations();
    const pending = migrations.filter((m) => !ran.includes(m.name));

    if (pending.length === 0) {
      return [];
    }

    const batch = await this.getNextBatch();
    const migrated: string[] = [];

    for (const file of pending) {
      await file.migration.up();
      await Connection.raw(
        `INSERT INTO ${this.migrationsTable} (migration, batch) VALUES (?, ?)`,
        [file.name, batch],
        this.connectionName
      );
      migrated.push(file.name);
    }

    return migrated;
  }

  /**
   * Rollback the last batch of migrations
   */
  async rollback(migrations: MigrationFile[]): Promise<string[]> {
    await this.ensureMigrationsTable();

    const lastBatch = await this.getLastBatch();
    if (lastBatch === 0) return [];

    const batchMigrations = await Connection.raw(
      `SELECT migration FROM ${this.migrationsTable} WHERE batch = ? ORDER BY id DESC`,
      [lastBatch],
      this.connectionName
    );

    const rolledBack: string[] = [];

    for (const record of batchMigrations) {
      const name = record.migration;
      const file = migrations.find((m) => m.name === name);
      if (file) {
        await file.migration.down();
        await Connection.raw(
          `DELETE FROM ${this.migrationsTable} WHERE migration = ?`,
          [name],
          this.connectionName
        );
        rolledBack.push(name);
      }
    }

    return rolledBack;
  }

  /**
   * Reset all migrations (rollback everything)
   */
  async reset(migrations: MigrationFile[]): Promise<string[]> {
    const allRolledBack: string[] = [];

    while (true) {
      const batch = await this.rollback(migrations);
      if (batch.length === 0) break;
      allRolledBack.push(...batch);
    }

    return allRolledBack;
  }

  /**
   * Refresh: reset + run all
   */
  async refresh(migrations: MigrationFile[]): Promise<{ reset: string[]; migrated: string[] }> {
    const reset = await this.reset(migrations);
    const migrated = await this.run(migrations);
    return { reset, migrated };
  }

  /**
   * Get list of already-ran migration names
   */
  async getRanMigrations(): Promise<string[]> {
    try {
      const rows = await Connection.raw(
        `SELECT migration FROM ${this.migrationsTable} ORDER BY batch, id`,
        [],
        this.connectionName
      );
      return rows.map((r: any) => r.migration);
    } catch {
      return [];
    }
  }

  /**
   * Get the status of all migrations
   */
  async status(migrations: MigrationFile[]): Promise<{ name: string; ran: boolean; batch: number | null }[]> {
    const ran = await this.getRanMigrations();
    const batchMap = new Map<string, number>();

    try {
      const rows = await Connection.raw(
        `SELECT migration, batch FROM ${this.migrationsTable}`,
        [],
        this.connectionName
      );
      for (const row of rows) {
        batchMap.set(row.migration, row.batch);
      }
    } catch {
      // Table might not exist yet
    }

    return migrations.map((m) => ({
      name: m.name,
      ran: ran.includes(m.name),
      batch: batchMap.get(m.name) ?? null,
    }));
  }

  // ── Private Helpers ──

  private async getNextBatch(): Promise<number> {
    return (await this.getLastBatch()) + 1;
  }

  private async getLastBatch(): Promise<number> {
    try {
      const rows = await Connection.raw(
        `SELECT MAX(batch) as max_batch FROM ${this.migrationsTable}`,
        [],
        this.connectionName
      );
      return rows[0]?.max_batch ?? 0;
    } catch {
      return 0;
    }
  }
}
