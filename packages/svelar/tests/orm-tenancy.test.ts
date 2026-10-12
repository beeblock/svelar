import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Connection } from '../src/database/Connection.js';
import { Schema } from '../src/database/SchemaBuilder.js';
import { TenantModel } from '../src/orm/index.js';
import { Teams } from '../src/teams/index.js';

class TenantProject extends TenantModel {
  static table = 'tenant_projects';
  static timestamps = false;
  static fillable = ['name', 'team_id'];
}

describe('ORM tenant scopes', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'svelar-tenancy-'));
    await Connection.disconnect();
    Connection.configure({
      default: 'sqlite',
      connections: {
        sqlite: { driver: 'sqlite', filename: join(root, 'database.sqlite') },
      },
    });

    await new Schema().createTable('tenant_projects', (table) => {
      table.increments('id');
      table.string('team_id');
      table.string('name');
    });

    Teams.configure({ driver: 'memory' });
    Teams.setCurrentTeam('bootstrap');
  });

  afterEach(async () => {
    Teams.clearCurrentTeam();
    await Connection.disconnect();
    await rm(root, { recursive: true, force: true });
  });

  it('fails closed when tenant-scoped models are queried without tenant context', async () => {
    Teams.clearCurrentTeam();

    await expect(TenantProject.count()).rejects.toThrow('Tenant context is required');
  });

  it('applies the current team to model queries and inserts', async () => {
    await Teams.runWithTeam('team-1', async () => {
      await TenantProject.create({ name: 'Alpha' });
    });
    await Teams.runWithTeam('team-2', async () => {
      await TenantProject.create({ name: 'Beta' });
    });

    const teamOne = await Teams.runWithTeam('team-1', async () => TenantProject.all());
    const teamTwo = await Teams.runWithTeam('team-2', async () => TenantProject.all());
    const all = await TenantProject.withoutTenantScope().orderBy('name').get();

    expect(teamOne.map((project) => project.getAttribute('name'))).toEqual(['Alpha']);
    expect(teamOne[0].getAttribute('team_id')).toBe('team-1');
    expect(teamTwo.map((project) => project.getAttribute('name'))).toEqual(['Beta']);
    expect(all.map((project) => project.getAttribute('name'))).toEqual(['Alpha', 'Beta']);
  });

  it('keeps concurrent team contexts isolated', async () => {
    const [first, second] = await Promise.all([
      Teams.runWithTeam('team-a', async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return Teams.getCurrentTeam();
      }),
      Teams.runWithTeam('team-b', async () => Teams.getCurrentTeam()),
    ]);

    expect(first).toBe('team-a');
    expect(second).toBe('team-b');
  });
});
