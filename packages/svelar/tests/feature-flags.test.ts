import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Connection } from '../src/database/Connection';
import { CreateFeatureFlagsTable, CreateFeatureFlagOverridesTable } from '../src/database/CoreMigrations';
import { Features } from '../src/feature-flags';

let sequence = 0;
let tempRoot: string | null = null;

function flagName(name: string): string {
  sequence += 1;
  return `test-${Date.now()}-${sequence}-${name}`;
}

async function useMemoryFlags(): Promise<void> {
  await Connection.disconnect();
  Features.configure({ driver: 'memory' });
}

async function useDatabaseFlags(): Promise<void> {
  tempRoot = await mkdtemp(join(tmpdir(), 'svelar-feature-flags-'));
  await Connection.disconnect();
  Connection.configure({
    default: 'sqlite',
    connections: {
      sqlite: { driver: 'sqlite', filename: join(tempRoot, 'database.sqlite') },
    },
  });

  await new CreateFeatureFlagsTable().up();
  await new CreateFeatureFlagOverridesTable().up();
  Features.configure({ driver: 'database' });
}

describe('Feature flags', () => {
  beforeEach(async () => {
    tempRoot = null;
    await useMemoryFlags();
  });

  afterEach(async () => {
    Features.configure({ driver: 'memory' });
    await Connection.disconnect();
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
      tempRoot = null;
    }
  });

  it('defines, updates, lists, enables, disables, and deletes memory-backed flags', async () => {
    const name = flagName('memory');

    const created = await Features.define(name, {
      description: 'New checkout flow',
      percentage: 25,
    });

    expect(created).toMatchObject({
      name,
      description: 'New checkout flow',
      enabled: false,
      percentage: 25,
    });
    expect(await Features.enabled(name)).toBe(false);

    await Features.enable(name);
    expect(await Features.enabled(name)).toBe(true);

    const updated = await Features.updateFlag(name, {
      description: 'Stable checkout flow',
      metadata: { owner: 'billing' },
      percentage: 50,
    });

    expect(updated).toMatchObject({
      description: 'Stable checkout flow',
      enabled: true,
      metadata: { owner: 'billing' },
      percentage: 50,
    });
    expect((await Features.allFlags()).some((flag) => flag.name === name)).toBe(true);

    await Features.disable(name);
    expect(await Features.enabled(name)).toBe(false);

    expect(await Features.deleteFlag(name)).toBe(true);
    expect(await Features.getFlag(name)).toBeNull();
    expect(await Features.deleteFlag(name)).toBe(false);
  });

  it('resolves user and team overrides before rollout percentage and global state', async () => {
    const name = flagName('overrides');
    await Features.define(name, { enabled: false, percentage: 0 });

    expect(await Features.enabledFor(name, 'user-1')).toBe(false);
    expect(await Features.enabledForTeam(name, 'team-1')).toBe(false);

    await Features.enableFor(name, 'user-1');
    await Features.enableForTeam(name, 'team-1');
    expect(await Features.enabledFor(name, 'user-1')).toBe(true);
    expect(await Features.enabledForTeam(name, 'team-1')).toBe(true);

    await Features.disableFor(name, 'user-1');
    await Features.disableForTeam(name, 'team-1');
    expect(await Features.enabledFor(name, 'user-1')).toBe(false);
    expect(await Features.enabledForTeam(name, 'team-1')).toBe(false);

    expect(await Features.removeOverride(name, 'user', 'user-1')).toBe(true);
    expect(await Features.removeOverride(name, 'team', 'team-1')).toBe(true);

    await Features.updateFlag(name, { enabled: true, percentage: null });
    expect(await Features.enabledFor(name, 'user-1')).toBe(true);
    expect(await Features.enabledForTeam(name, 'team-1')).toBe(true);
  });

  it('uses deterministic percentage rollouts for users and teams', async () => {
    const name = flagName('rollout');
    await Features.define(name, { enabled: false, percentage: 30 });

    const firstUserCheck = await Features.enabledFor(name, 'user-42');
    const secondUserCheck = await Features.enabledFor(name, 'user-42');
    const firstTeamCheck = await Features.enabledForTeam(name, 'team-42');
    const secondTeamCheck = await Features.enabledForTeam(name, 'team-42');

    expect(secondUserCheck).toBe(firstUserCheck);
    expect(secondTeamCheck).toBe(firstTeamCheck);

    await Features.updateFlag(name, { percentage: 100 });
    expect(await Features.enabledFor(name, 'user-42')).toBe(true);
    expect(await Features.enabledForTeam(name, 'team-42')).toBe(true);

    await Features.updateFlag(name, { percentage: 0 });
    expect(await Features.enabledFor(name, 'user-42')).toBe(false);
    expect(await Features.enabledForTeam(name, 'team-42')).toBe(false);
  });

  it('persists flags and overrides through the database driver', async () => {
    await useDatabaseFlags();
    const name = flagName('database');

    await Features.define(name, {
      description: 'Database-backed flag',
      enabled: false,
      percentage: 10,
    });

    await Features.enableFor(name, 123);
    await Features.disableForTeam(name, 456);
    await Features.updateFlag(name, { metadata: { tier: 'enterprise' } });

    const flag = await Features.getFlag(name);
    expect(flag).toMatchObject({
      name,
      description: 'Database-backed flag',
      enabled: false,
      percentage: 10,
      metadata: { tier: 'enterprise' },
    });

    await Features.enable(name);
    expect(await Features.enabled(name)).toBe(true);
    await Features.disable(name);
    expect(await Features.enabled(name)).toBe(false);

    expect(await Features.enabledFor(name, 123)).toBe(true);
    expect(await Features.enabledForTeam(name, 'enabled-team')).toBe(false);
    await Features.enableForTeam(name, 'enabled-team');
    expect(await Features.enabledForTeam(name, 'enabled-team')).toBe(true);
    expect(await Features.enabledForTeam(name, 456)).toBe(false);

    const overrides = await Features.getOverrides(name);
    expect(overrides).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ flagName: name, scopeType: 'user', scopeId: '123', enabled: true }),
        expect.objectContaining({ flagName: name, scopeType: 'team', scopeId: '456', enabled: false }),
      ]),
    );

    await Features.setOverride(name, 'user', 123, false);
    expect(await Features.enabledFor(name, 123)).toBe(false);

    expect(await Features.deleteFlag(name)).toBe(true);
    expect(await Features.getFlag(name)).toBeNull();
    expect(await Features.getOverrides(name)).toHaveLength(0);
  });

  it('rejects unsafe database table names in configuration', async () => {
    await useDatabaseFlags();
    Features.configure({ driver: 'database', table: 'feature_flags; DROP TABLE users' });

    await expect(Features.allFlags()).rejects.toThrow('Feature flags table name');
  });
});
