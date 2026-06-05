import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Connection } from '../src/database/Connection.js';
import { svelarCoreMigrations } from '../src/database/CoreMigrations.js';
import { Migrator } from '../src/database/Migration.js';
import { Teams } from '../src/teams/index.js';

describe.sequential('Teams', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'svelar-teams-'));
    await Connection.disconnect();
    Connection.configure({
      default: 'sqlite',
      connections: {
        sqlite: { driver: 'sqlite', filename: join(root, 'database.sqlite') },
      },
    });

    await new Migrator().fresh(svelarCoreMigrations());
    Teams.configure({
      driver: 'database',
      roles: ['owner', 'admin', 'member', 'viewer'],
      maxTeamsPerUser: 2,
      invitationExpiryHours: 1,
    });
  });

  afterEach(async () => {
    Teams.configure({
      driver: 'memory',
      roles: ['owner', 'admin', 'member', 'viewer'],
      maxTeamsPerUser: undefined,
      invitationExpiryHours: 72,
    });
    await Connection.disconnect();
    await rm(root, { recursive: true, force: true });
  });

  it('creates unique slugs and enforces max teams per user', async () => {
    const first = await Teams.create({ name: 'Acme Corp', ownerId: 'user-1' });
    const second = await Teams.create({ name: 'Acme Corp', ownerId: 'user-1' });

    expect(first.slug).toBe('acme-corp');
    expect(second.slug).toBe('acme-corp-2');

    await expect(Teams.create({ name: 'Third Team', ownerId: 'user-1' })).rejects.toThrow(
      'maximum number of teams'
    );

    const teams = await Teams.getUserTeams('user-1');
    expect(teams.map((team) => team.slug).sort()).toEqual(['acme-corp', 'acme-corp-2']);
    expect(await Teams.hasRole(first.id, 'user-1', 'owner')).toBe(true);
  });

  it('validates roles and protects the team owner membership', async () => {
    const team = await Teams.create({ name: 'Security Team', ownerId: 'owner-1' });

    await expect(Teams.addMember(team.id, 'user-2', 'editor')).rejects.toThrow('Invalid team role');
    await expect(Teams.addMember(team.id, 'user-2', 'owner')).rejects.toThrow('owner role is reserved');

    await Teams.addMember(team.id, 'user-2', 'member');
    expect(await Teams.updateMemberRole(team.id, 'user-2', 'admin')).toBe(true);
    expect(await Teams.hasRole(team.id, 'user-2', 'admin')).toBe(true);

    expect(await Teams.updateMemberRole(team.id, 'owner-1', 'admin')).toBe(false);
    expect(await Teams.removeMember(team.id, 'owner-1')).toBe(false);
    expect(await Teams.hasRole(team.id, 'owner-1', 'owner')).toBe(true);
  });

  it('requires invitations to target an existing team and blocks reserved roles', async () => {
    const team = await Teams.create({ name: 'Invites Team', ownerId: 'owner-1' });

    await expect(Teams.invite('missing-team', 'member@example.com')).rejects.toThrow('not found');
    await expect(Teams.invite(team.id, 'owner@example.com', 'owner')).rejects.toThrow('owner role is reserved');
    await expect(Teams.invite(team.id, 'editor@example.com', 'editor')).rejects.toThrow('Invalid team role');
  });

  it('accepts invitations once and hides accepted invitations from the pending list', async () => {
    const team = await Teams.create({ name: 'Replay Team', ownerId: 'owner-1' });
    const invitation = await Teams.invite(team.id, 'new@example.com', 'viewer');

    expect(await Teams.getPendingInvitations(team.id)).toHaveLength(1);
    expect(await Teams.acceptInvitation(invitation.token, 'user-2')).toBe(true);
    expect(await Teams.acceptInvitation(invitation.token, 'user-3')).toBe(false);
    expect(await Teams.hasRole(team.id, 'user-2', 'viewer')).toBe(true);
    expect(await Teams.hasRole(team.id, 'user-3', 'viewer')).toBe(false);
    expect(await Teams.getPendingInvitations(team.id)).toHaveLength(0);
  });

  it('rejects expired invitations', async () => {
    const team = await Teams.create({ name: 'Expired Invites', ownerId: 'owner-1' });
    Teams.configure({
      driver: 'database',
      roles: ['owner', 'admin', 'member', 'viewer'],
      maxTeamsPerUser: 2,
      invitationExpiryHours: -1,
    });

    const invitation = await Teams.invite(team.id, 'expired@example.com', 'member');

    expect(await Teams.acceptInvitation(invitation.token, 'user-2')).toBe(false);
    expect(await Teams.isMember(team.id, 'user-2')).toBe(false);
  });
});
