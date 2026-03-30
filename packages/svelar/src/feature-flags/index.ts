/**
 * Svelar Feature Flags
 *
 * Database-backed feature flags with per-user, per-team, and percentage
 * rollout support. Tables are auto-created on first use — no migration required.
 *
 * Usage:
 *   import { Features } from '@beeblock/svelar/feature-flags';
 *
 *   Features.configure({ driver: 'database' });
 *
 *   // Define flags (typically in app.ts)
 *   Features.define('new-dashboard', { description: 'Redesigned dashboard UI' });
 *   Features.define('beta-api', { description: 'Beta API v2', percentage: 20 });
 *
 *   // Check flags
 *   if (await Features.enabled('new-dashboard')) { ... }
 *   if (await Features.enabledFor('beta-api', userId)) { ... }
 *   if (await Features.enabledForTeam('beta-api', teamId)) { ... }
 */

import { randomUUID } from 'crypto';
import { singleton } from '../support/singleton.js';

// ── Types ──────────────────────────────────────────────────

export interface FeatureFlag {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  /** 0–100. When set, the flag is enabled for this percentage of users (consistent hashing). */
  percentage: number | null;
  metadata?: Record<string, any>;
  createdAt: number;
  updatedAt: number;
}

export interface FeatureFlagOverride {
  id: string;
  flagName: string;
  /** 'user' or 'team' */
  scopeType: 'user' | 'team';
  scopeId: string | number;
  enabled: boolean;
  createdAt: number;
}

export interface FeatureFlagsConfig {
  driver: 'database' | 'memory';
  table?: string;
  overridesTable?: string;
}

export interface FeatureFlagDefinition {
  description?: string;
  enabled?: boolean;
  percentage?: number | null;
}

// ── Manager ────────────────────────────────────────────────

class FeatureFlagManager {
  private config: FeatureFlagsConfig = { driver: 'memory' };

  // In-memory storage
  private memFlags: FeatureFlag[] = [];
  private memOverrides: FeatureFlagOverride[] = [];

  private tablesEnsured = false;

  configure(config: FeatureFlagsConfig): void {
    this.config = { ...this.config, ...config };
    this.tablesEnsured = false;
  }

  private get flagsTable(): string {
    return this.config.table || 'feature_flags';
  }

  private get overridesTable(): string {
    return this.config.overridesTable || 'feature_flag_overrides';
  }

  private get useDb(): boolean {
    return this.config.driver === 'database';
  }

  // ── Database helpers ───────────────────────────────────────

  private async getConnection() {
    const { Connection } = await import('../database/Connection.js');
    return Connection;
  }

  /**
   * Auto-create feature_flags and feature_flag_overrides tables on first use.
   */
  async ensureTables(): Promise<void> {
    if (this.tablesEnsured || !this.useDb) return;

    const conn = await this.getConnection();
    const driver = conn.getDriver();
    const f = this.flagsTable;
    const o = this.overridesTable;

    switch (driver) {
      case 'sqlite':
        await conn.raw(
          `CREATE TABLE IF NOT EXISTS ${f} (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL UNIQUE,
            description TEXT NOT NULL DEFAULT '',
            enabled INTEGER NOT NULL DEFAULT 0,
            percentage INTEGER,
            metadata TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          )`,
        );
        await conn.raw(
          `CREATE TABLE IF NOT EXISTS ${o} (
            id TEXT PRIMARY KEY,
            flag_name TEXT NOT NULL,
            scope_type TEXT NOT NULL,
            scope_id TEXT NOT NULL,
            enabled INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL,
            UNIQUE(flag_name, scope_type, scope_id)
          )`,
        );
        break;
      case 'postgres':
        await conn.raw(
          `CREATE TABLE IF NOT EXISTS ${f} (
            id VARCHAR(255) PRIMARY KEY,
            name VARCHAR(255) NOT NULL UNIQUE,
            description TEXT NOT NULL DEFAULT '',
            enabled BOOLEAN NOT NULL DEFAULT FALSE,
            percentage INTEGER,
            metadata JSONB,
            created_at TIMESTAMPTZ NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL
          )`,
        );
        await conn.raw(
          `CREATE TABLE IF NOT EXISTS ${o} (
            id VARCHAR(255) PRIMARY KEY,
            flag_name VARCHAR(255) NOT NULL,
            scope_type VARCHAR(50) NOT NULL,
            scope_id VARCHAR(255) NOT NULL,
            enabled BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMPTZ NOT NULL,
            UNIQUE(flag_name, scope_type, scope_id)
          )`,
        );
        break;
      case 'mysql':
        await conn.raw(
          `CREATE TABLE IF NOT EXISTS ${f} (
            id VARCHAR(255) PRIMARY KEY,
            name VARCHAR(255) NOT NULL UNIQUE,
            description TEXT NOT NULL,
            enabled TINYINT(1) NOT NULL DEFAULT 0,
            percentage INT,
            metadata JSON,
            created_at DATETIME NOT NULL,
            updated_at DATETIME NOT NULL
          ) ENGINE=InnoDB`,
        );
        await conn.raw(
          `CREATE TABLE IF NOT EXISTS ${o} (
            id VARCHAR(255) PRIMARY KEY,
            flag_name VARCHAR(255) NOT NULL,
            scope_type VARCHAR(50) NOT NULL,
            scope_id VARCHAR(255) NOT NULL,
            enabled TINYINT(1) NOT NULL DEFAULT 1,
            created_at DATETIME NOT NULL,
            UNIQUE(flag_name, scope_type, scope_id)
          ) ENGINE=InnoDB`,
        );
        break;
    }

    this.tablesEnsured = true;
  }

  private rowToFlag(row: any): FeatureFlag {
    return {
      id: row.id,
      name: row.name,
      description: row.description || '',
      enabled: Boolean(row.enabled),
      percentage: row.percentage != null ? Number(row.percentage) : null,
      metadata: row.metadata ? (typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata) : undefined,
      createdAt: new Date(row.created_at).getTime(),
      updatedAt: new Date(row.updated_at).getTime(),
    };
  }

  private rowToOverride(row: any): FeatureFlagOverride {
    return {
      id: row.id,
      flagName: row.flag_name,
      scopeType: row.scope_type,
      scopeId: row.scope_id,
      enabled: Boolean(row.enabled),
      createdAt: new Date(row.created_at).getTime(),
    };
  }

  // ── Define & manage flags ──────────────────────────────────

  /**
   * Define (or update) a feature flag. Safe to call multiple times —
   * if the flag already exists, it updates description/percentage only.
   */
  async define(name: string, opts: FeatureFlagDefinition = {}): Promise<FeatureFlag> {
    const existing = await this.getFlag(name);

    if (existing) {
      // Update description/percentage if provided
      const updates: Partial<FeatureFlag> = {};
      if (opts.description !== undefined) updates.description = opts.description;
      if (opts.percentage !== undefined) updates.percentage = opts.percentage;
      if (opts.enabled !== undefined) updates.enabled = opts.enabled;

      if (Object.keys(updates).length > 0) {
        return (await this.updateFlag(name, updates))!;
      }
      return existing;
    }

    const now = Date.now();
    const flag: FeatureFlag = {
      id: randomUUID(),
      name,
      description: opts.description || '',
      enabled: opts.enabled ?? false,
      percentage: opts.percentage ?? null,
      createdAt: now,
      updatedAt: now,
    };

    if (this.useDb) {
      await this.ensureTables();
      const conn = await this.getConnection();
      const nowIso = new Date(now).toISOString();
      await conn.raw(
        `INSERT INTO ${this.flagsTable} (id, name, description, enabled, percentage, metadata, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [flag.id, flag.name, flag.description, flag.enabled ? 1 : 0, flag.percentage, null, nowIso, nowIso],
      );
    } else {
      this.memFlags.push(flag);
    }

    return flag;
  }

  /**
   * Get a flag by name.
   */
  async getFlag(name: string): Promise<FeatureFlag | null> {
    if (this.useDb) {
      await this.ensureTables();
      const conn = await this.getConnection();
      const rows: any[] = await conn.raw(
        `SELECT * FROM ${this.flagsTable} WHERE name = ?`,
        [name],
      );
      return rows.length > 0 ? this.rowToFlag(rows[0]) : null;
    }

    return this.memFlags.find((f) => f.name === name) || null;
  }

  /**
   * List all flags.
   */
  async allFlags(): Promise<FeatureFlag[]> {
    if (this.useDb) {
      await this.ensureTables();
      const conn = await this.getConnection();
      const rows: any[] = await conn.raw(
        `SELECT * FROM ${this.flagsTable} ORDER BY name`,
      );
      return rows.map((r) => this.rowToFlag(r));
    }

    return [...this.memFlags].sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Update a flag's properties.
   */
  async updateFlag(name: string, data: Partial<Pick<FeatureFlag, 'description' | 'enabled' | 'percentage' | 'metadata'>>): Promise<FeatureFlag | null> {
    if (this.useDb) {
      await this.ensureTables();
      const conn = await this.getConnection();
      const existing = await this.getFlag(name);
      if (!existing) return null;

      const nowIso = new Date().toISOString();
      const desc = data.description ?? existing.description;
      const enabled = data.enabled ?? existing.enabled;
      const pct = data.percentage !== undefined ? data.percentage : existing.percentage;
      const meta = data.metadata !== undefined
        ? JSON.stringify(data.metadata)
        : (existing.metadata ? JSON.stringify(existing.metadata) : null);

      await conn.raw(
        `UPDATE ${this.flagsTable} SET description = ?, enabled = ?, percentage = ?, metadata = ?, updated_at = ? WHERE name = ?`,
        [desc, enabled ? 1 : 0, pct, meta, nowIso, name],
      );

      return this.getFlag(name);
    }

    const flag = this.memFlags.find((f) => f.name === name);
    if (!flag) return null;

    if (data.description !== undefined) flag.description = data.description;
    if (data.enabled !== undefined) flag.enabled = data.enabled;
    if (data.percentage !== undefined) flag.percentage = data.percentage;
    if (data.metadata !== undefined) flag.metadata = data.metadata;
    flag.updatedAt = Date.now();
    return flag;
  }

  /**
   * Delete a flag and all its overrides.
   */
  async deleteFlag(name: string): Promise<boolean> {
    if (this.useDb) {
      await this.ensureTables();
      const conn = await this.getConnection();
      await conn.raw(`DELETE FROM ${this.overridesTable} WHERE flag_name = ?`, [name]);
      await conn.raw(`DELETE FROM ${this.flagsTable} WHERE name = ?`, [name]);
      return true;
    }

    const index = this.memFlags.findIndex((f) => f.name === name);
    if (index === -1) return false;

    this.memFlags.splice(index, 1);
    this.memOverrides = this.memOverrides.filter((o) => o.flagName !== name);
    return true;
  }

  // ── Enable / Disable shortcuts ─────────────────────────────

  /**
   * Globally enable a flag.
   */
  async enable(name: string): Promise<void> {
    await this.updateFlag(name, { enabled: true });
  }

  /**
   * Globally disable a flag.
   */
  async disable(name: string): Promise<void> {
    await this.updateFlag(name, { enabled: false });
  }

  // ── Check flags ────────────────────────────────────────────

  /**
   * Check if a flag is globally enabled (ignores per-user/team overrides).
   */
  async enabled(name: string): Promise<boolean> {
    const flag = await this.getFlag(name);
    if (!flag) return false;
    return flag.enabled;
  }

  /**
   * Check if a flag is enabled for a specific user.
   *
   * Resolution order:
   * 1. User-level override (if exists) — wins
   * 2. Percentage rollout (if configured) — consistent per user
   * 3. Global enabled/disabled state
   */
  async enabledFor(name: string, userId: string | number): Promise<boolean> {
    const flag = await this.getFlag(name);
    if (!flag) return false;

    // Check user override
    const override = await this.getOverride(name, 'user', userId);
    if (override) return override.enabled;

    // Check percentage rollout
    if (flag.percentage != null) {
      return this.inPercentage(name, String(userId), flag.percentage);
    }

    // Fall back to global
    return flag.enabled;
  }

  /**
   * Check if a flag is enabled for a specific team.
   *
   * Resolution order:
   * 1. Team-level override (if exists) — wins
   * 2. Percentage rollout (if configured) — consistent per team
   * 3. Global enabled/disabled state
   */
  async enabledForTeam(name: string, teamId: string | number): Promise<boolean> {
    const flag = await this.getFlag(name);
    if (!flag) return false;

    // Check team override
    const override = await this.getOverride(name, 'team', teamId);
    if (override) return override.enabled;

    // Check percentage rollout
    if (flag.percentage != null) {
      return this.inPercentage(name, `team:${teamId}`, flag.percentage);
    }

    // Fall back to global
    return flag.enabled;
  }

  // ── Overrides ──────────────────────────────────────────────

  /**
   * Set an override for a specific user or team.
   */
  async setOverride(
    flagName: string,
    scopeType: 'user' | 'team',
    scopeId: string | number,
    enabled: boolean
  ): Promise<FeatureFlagOverride> {
    const now = Date.now();

    if (this.useDb) {
      await this.ensureTables();
      const conn = await this.getConnection();
      const nowIso = new Date(now).toISOString();
      const driver = conn.getDriver();

      // Upsert: insert or update
      switch (driver) {
        case 'sqlite':
          await conn.raw(
            `INSERT INTO ${this.overridesTable} (id, flag_name, scope_type, scope_id, enabled, created_at)
             VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(flag_name, scope_type, scope_id)
             DO UPDATE SET enabled = ?, created_at = ?`,
            [randomUUID(), flagName, scopeType, String(scopeId), enabled ? 1 : 0, nowIso, enabled ? 1 : 0, nowIso],
          );
          break;
        case 'postgres':
          await conn.raw(
            `INSERT INTO ${this.overridesTable} (id, flag_name, scope_type, scope_id, enabled, created_at)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT(flag_name, scope_type, scope_id)
             DO UPDATE SET enabled = $5, created_at = $6`,
            [randomUUID(), flagName, scopeType, String(scopeId), enabled, nowIso],
          );
          break;
        case 'mysql':
          // Delete + insert for MySQL (simpler than ON DUPLICATE KEY with generated id)
          await conn.raw(
            `DELETE FROM ${this.overridesTable} WHERE flag_name = ? AND scope_type = ? AND scope_id = ?`,
            [flagName, scopeType, String(scopeId)],
          );
          await conn.raw(
            `INSERT INTO ${this.overridesTable} (id, flag_name, scope_type, scope_id, enabled, created_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [randomUUID(), flagName, scopeType, String(scopeId), enabled ? 1 : 0, nowIso],
          );
          break;
      }

      const override = await this.getOverride(flagName, scopeType, scopeId);
      return override!;
    }

    // Memory driver
    const existing = this.memOverrides.find(
      (o) => o.flagName === flagName && o.scopeType === scopeType && o.scopeId === String(scopeId)
    );
    if (existing) {
      existing.enabled = enabled;
      return existing;
    }

    const override: FeatureFlagOverride = {
      id: randomUUID(),
      flagName,
      scopeType,
      scopeId: String(scopeId),
      enabled,
      createdAt: now,
    };
    this.memOverrides.push(override);
    return override;
  }

  /**
   * Remove an override for a specific user or team.
   */
  async removeOverride(
    flagName: string,
    scopeType: 'user' | 'team',
    scopeId: string | number
  ): Promise<boolean> {
    if (this.useDb) {
      await this.ensureTables();
      const conn = await this.getConnection();
      await conn.raw(
        `DELETE FROM ${this.overridesTable} WHERE flag_name = ? AND scope_type = ? AND scope_id = ?`,
        [flagName, scopeType, String(scopeId)],
      );
      return true;
    }

    const index = this.memOverrides.findIndex(
      (o) => o.flagName === flagName && o.scopeType === scopeType && o.scopeId === String(scopeId)
    );
    if (index === -1) return false;
    this.memOverrides.splice(index, 1);
    return true;
  }

  /**
   * Get a specific override.
   */
  async getOverride(
    flagName: string,
    scopeType: 'user' | 'team',
    scopeId: string | number
  ): Promise<FeatureFlagOverride | null> {
    if (this.useDb) {
      await this.ensureTables();
      const conn = await this.getConnection();
      const rows: any[] = await conn.raw(
        `SELECT * FROM ${this.overridesTable} WHERE flag_name = ? AND scope_type = ? AND scope_id = ?`,
        [flagName, scopeType, String(scopeId)],
      );
      return rows.length > 0 ? this.rowToOverride(rows[0]) : null;
    }

    return this.memOverrides.find(
      (o) => o.flagName === flagName && o.scopeType === scopeType && o.scopeId === String(scopeId)
    ) || null;
  }

  /**
   * List all overrides for a flag.
   */
  async getOverrides(flagName: string): Promise<FeatureFlagOverride[]> {
    if (this.useDb) {
      await this.ensureTables();
      const conn = await this.getConnection();
      const rows: any[] = await conn.raw(
        `SELECT * FROM ${this.overridesTable} WHERE flag_name = ?`,
        [flagName],
      );
      return rows.map((r) => this.rowToOverride(r));
    }

    return this.memOverrides.filter((o) => o.flagName === flagName);
  }

  /**
   * Enable a flag for a specific user.
   */
  async enableFor(name: string, userId: string | number): Promise<void> {
    await this.setOverride(name, 'user', userId, true);
  }

  /**
   * Disable a flag for a specific user.
   */
  async disableFor(name: string, userId: string | number): Promise<void> {
    await this.setOverride(name, 'user', userId, false);
  }

  /**
   * Enable a flag for a specific team.
   */
  async enableForTeam(name: string, teamId: string | number): Promise<void> {
    await this.setOverride(name, 'team', teamId, true);
  }

  /**
   * Disable a flag for a specific team.
   */
  async disableForTeam(name: string, teamId: string | number): Promise<void> {
    await this.setOverride(name, 'team', teamId, false);
  }

  // ── Percentage rollout ─────────────────────────────────────

  /**
   * Deterministic percentage check using a simple hash.
   * The same flag+identifier always produces the same result,
   * so a user consistently sees the feature (or doesn't).
   */
  private inPercentage(flagName: string, identifier: string, percentage: number): boolean {
    if (percentage >= 100) return true;
    if (percentage <= 0) return false;

    // Simple FNV-1a-inspired hash for deterministic bucketing
    const key = `${flagName}:${identifier}`;
    let hash = 2166136261;
    for (let i = 0; i < key.length; i++) {
      hash ^= key.charCodeAt(i);
      hash = (hash * 16777619) >>> 0;
    }

    return (hash % 100) < percentage;
  }
}

export const Features = singleton('svelar.feature-flags', () => new FeatureFlagManager());
