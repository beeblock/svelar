import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Connection } from '../src/database/Connection.js';
import { Migrator } from '../src/database/Migration.js';
import { CreateTeamsTable } from '../src/database/core/00000000_000014_create_teams_table.js';
import { CreateTeamMembersTable } from '../src/database/core/00000000_000015_create_team_members_table.js';
import { CreateTeamInvitationsTable } from '../src/database/core/00000000_000016_create_team_invitations_table.js';
import { QueryBuilder } from '../src/orm/QueryBuilder.js';
import { Teams, type TeamInvitation } from '../src/teams/index.js';

describe.each(['memory', 'database'] as const)('Invitation boundaries (%s)', (driver) => {
  let directory: string;
  let teamId: string | number;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'svelar-invitation-unit-'));
    await Connection.disconnect();
    Connection.configure({ default: 'sqlite', connections: { sqlite: { driver: 'sqlite', filename: join(directory, 'test.sqlite') } } });
    if (driver === 'database') await new Migrator().fresh(
      [new CreateTeamsTable(), new CreateTeamMembersTable(), new CreateTeamInvitationsTable()].map((migration, index) => ({
        name: migration.constructor.name, timestamp: String(index), path: 'invitation-test-migrations', migration,
      })),
    );
    Teams.configure({ driver, roles: ['owner', 'admin', 'member', 'viewer'], maxTeamsPerUser: undefined, invitationExpiryHours: 1 });
    teamId = (await Teams.create({ name: 'Invitation test ' + randomUUID(), ownerId: randomUUID() })).id;
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    Teams.configure({ driver: 'memory', invitationExpiryHours: 72 });
    await Connection.disconnect();
    await rm(directory, { recursive: true, force: true });
  });
  const invite = () => Teams.invite(teamId, 'Recipient@Example.test', 'viewer');
  async function changeRole(invitation: TeamInvitation, role: string) {
    if (driver === 'database') await new QueryBuilder('team_invitations').where('id', invitation.id).update({ role });
    else invitation.role = role;
  }

  it('looks up team details and honest states without consuming or exposing mutable storage references', async () => {
    const invitation = await invite();
    const lookup = await Teams.lookupInvitation(invitation.token);
    expect(lookup).toMatchObject({ state: 'pending', invitation: { id: invitation.id, email: 'Recipient@Example.test', role: 'viewer' }, team: { id: teamId } });
    expect(lookup!.team.name).toContain('Invitation test');
    Object.assign(lookup!.invitation, { email: 'changed@example.test', acceptedAt: Date.now() });
    expect(await Teams.lookupInvitation(invitation.token)).toMatchObject({ state: 'pending', invitation: { email: 'Recipient@Example.test' } });
    expect(await Teams.getPendingInvitations(teamId)).toHaveLength(1);
    expect(await Teams.lookupInvitation('missing')).toBeNull();
    expect(await Teams.lookupInvitation('x'.repeat(256))).toBeNull();
    expect(await Teams.acceptInvitation(invitation.token, randomUUID(), 'recipient@example.test')).toBe(true);
    expect((await Teams.lookupInvitation(invitation.token))!.state).toBe('accepted');
  });

  it('rejects a foreign recipient without consuming and supports canonical email matching and UUID users', async () => {
    const invitation = await invite();
    const userId = randomUUID();
    expect(await Teams.acceptInvitation(invitation.token, userId, 'foreign@example.test')).toBe(false);
    expect(await Teams.declineInvitation(invitation.token, 'foreign@example.test')).toBe(false);
    expect(await Teams.acceptInvitation(invitation.token, userId, '')).toBe(false);
    expect(await Teams.acceptInvitation(invitation.token, userId, ' recipient@example.test ')).toBe(true);
    expect(await Teams.hasRole(teamId, userId, 'viewer')).toBe(true);
    expect(await Teams.acceptInvitation(invitation.token, randomUUID(), 'recipient@example.test')).toBe(false);
    expect(await Teams.declineInvitation(invitation.token, 'recipient@example.test')).toBe(false);
  });

  it('permits exactly one competing acceptance and leaves exactly one invited membership', async () => {
    const invitation = await invite();
    const users = Array.from({ length: 16 }, () => randomUUID());
    const results = await Promise.all(users.map((user) => Teams.acceptInvitation(invitation.token, user, 'recipient@example.test')));
    expect(results.filter(Boolean)).toHaveLength(1);
    const members = (await Teams.getMembers(teamId)).filter((member) => users.includes(String(member.userId)));
    expect(members).toHaveLength(1);
    expect(members[0].userId).toBe(users[results.indexOf(true)]);
    expect(members[0].role).toBe('viewer');
  });

  it('allows only one accept/decline winner and never declines a consumed invitation', async () => {
    const invitation = await invite();
    const user = randomUUID();
    const results = await Promise.all([Teams.acceptInvitation(invitation.token, user, 'recipient@example.test'),
      Teams.declineInvitation(invitation.token, 'recipient@example.test')]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await Teams.isMember(teamId, user)).toBe(results[0]);
    expect(await Teams.getPendingInvitations(teamId)).toHaveLength(0);
    expect(await Teams.declineInvitation(invitation.token, 'recipient@example.test')).toBe(false);
  });

  it('declines pending invitations without membership and honestly returns missing afterwards', async () => {
    const invitation = await invite();
    expect(await Teams.declineInvitation(invitation.token, 'recipient@example.test')).toBe(true);
    expect(await Teams.lookupInvitation(invitation.token)).toBeNull();
    expect(await Teams.declineInvitation(invitation.token, 'recipient@example.test')).toBe(false);
    expect(await Teams.acceptInvitation(invitation.token, randomUUID(), 'recipient@example.test')).toBe(false);
    expect(await Teams.getMembers(teamId)).toHaveLength(1);
  });

  it('rolls back consumption when membership fails and allows a genuine subsequent retry', async () => {
    const invitation = await invite();
    const user = randomUUID();
    const membership = vi.spyOn(Teams, 'addMember').mockRejectedValueOnce(new Error('membership unavailable'));
    await expect(Teams.acceptInvitation(invitation.token, user, 'recipient@example.test')).rejects.toThrow('membership unavailable');
    expect((await Teams.lookupInvitation(invitation.token))!.state).toBe('pending');
    expect(await Teams.isMember(teamId, user)).toBe(false);
    membership.mockRestore();
    expect(await Teams.acceptInvitation(invitation.token, user, 'recipient@example.test')).toBe(true);
  });

  it('does not accept or decline expired invitations', async () => {
    Teams.configure({ driver, invitationExpiryHours: -1 });
    const invitation = await invite();
    expect((await Teams.lookupInvitation(invitation.token))!.state).toBe('expired');
    expect(await Teams.acceptInvitation(invitation.token, randomUUID(), 'recipient@example.test')).toBe(false);
    expect(await Teams.declineInvitation(invitation.token, 'recipient@example.test')).toBe(false);
  });

  it('rejects even a corrupted persisted owner grant without consumption', async () => {
    const invitation = await invite();
    await changeRole(invitation, 'owner');
    await expect(Teams.acceptInvitation(invitation.token, randomUUID(), 'recipient@example.test')).rejects.toThrow('owner role is reserved');
    expect((await Teams.lookupInvitation(invitation.token))!.state).toBe('pending');
    expect(await Teams.getMembers(teamId)).toHaveLength(1);
  });

  it('retains the supported trusted two-argument API without changing existing member roles', async () => {
    const invitation = await invite();
    const owner = (await Teams.findById(teamId))!.ownerId;
    expect(await Teams.acceptInvitation(invitation.token, owner)).toBe(true);
    expect(await Teams.hasRole(teamId, owner, 'owner')).toBe(true);
    expect(await Teams.getMembers(teamId)).toHaveLength(1);
  });
});
