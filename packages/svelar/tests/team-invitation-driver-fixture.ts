import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { Connection, type DatabaseConfig } from '../src/database/Connection.js';
import { Migrator } from '../src/database/Migration.js';
import { CreateTeamsTable } from '../src/database/core/00000000_000014_create_teams_table.js';
import { CreateTeamMembersTable } from '../src/database/core/00000000_000015_create_team_members_table.js';
import { CreateTeamInvitationsTable } from '../src/database/core/00000000_000016_create_team_invitations_table.js';
import { QueryBuilder } from '../src/orm/QueryBuilder.js';
import { Teams } from '../src/teams/index.js';

async function setup(config: DatabaseConfig) {
  assert.ok(['sqlite', 'postgres', 'mysql'].includes(config.driver));
  if (config.driver !== 'sqlite') { assert.equal(config.host, '127.0.0.1'); assert.equal(config.database, 'invitation_proof'); }
  Connection.configure({ default: 'proof', connections: { proof: config } });
  Teams.configure({ driver: 'database', roles: ['owner', 'admin', 'member', 'viewer'], maxTeamsPerUser: undefined, invitationExpiryHours: 1 });
  await Connection.raw('SELECT 1 AS ready');
  if (config.driver === 'sqlite') await Connection.raw('PRAGMA busy_timeout = 10000');
}
export async function ping(config: DatabaseConfig) { try { await setup(config); } finally { await Connection.disconnect(); } }
export async function migrate(config: DatabaseConfig) {
  try {
    await setup(config);
    await new Migrator().fresh([new CreateTeamsTable(), new CreateTeamMembersTable(), new CreateTeamInvitationsTable()].map((migration, index) => ({
      name: migration.constructor.name, timestamp: String(index), path: 'native-invitation-migrations', migration,
    })));
  } finally { await Connection.disconnect(); }
}
async function until(callback: () => boolean | Promise<boolean>, label: string) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) { if (await callback()) return; await delay(10); }
  throw new Error('Invitation fixture timed out: ' + label);
}
interface Plan { token: string; user: string; email: string; decision: 'accept' | 'decline'; barrier: string }
export async function worker(config: DatabaseConfig, plan: Plan) {
  try {
    await setup(config);
    console.log(JSON.stringify({ ready: true }));
    await until(async () => { try { await access(plan.barrier); return true; } catch { return false; } }, 'worker barrier');
    const accepted = plan.decision === 'accept' ? await Teams.acceptInvitation(plan.token, plan.user, plan.email) : await Teams.declineInvitation(plan.token, plan.email);
    console.log(JSON.stringify({ user: plan.user, decision: plan.decision, accepted }));
  } finally { await Connection.disconnect(); }
}
async function contend(config: DatabaseConfig, token: string, decisions: Plan['decision'][], bundle: string, directory: string) {
  await mkdir(directory, { recursive: true });
  const barrier = join(directory, randomUUID() + '.start');
  const workers = decisions.map((decision) => {
    const plan: Plan = { token, user: randomUUID(), email: 'recipient@example.test', decision, barrier };
    const script = 'import { worker } from ' + JSON.stringify(pathToFileURL(bundle).href) + '; await worker(' + JSON.stringify(config) + ',' + JSON.stringify(plan) + ');';
    const child = spawn(process.execPath, ['--input-type=module', '--eval', script], { stdio: ['ignore', 'pipe', 'pipe'] });
    const record = { child, plan, output: '', errors: '', ready: false, closed: false, failure: undefined as Error | undefined };
    child.stdout.on('data', (data) => { record.output += String(data); record.ready = record.output.includes('"ready":true'); });
    child.stderr.on('data', (data) => { record.errors += String(data); });
    child.on('error', (error) => { record.failure = error; });
    const closed = new Promise<void>((resolve) => child.once('close', (code, signal) => {
      record.closed = true;
      if (code !== 0) record.failure ??= new Error('Invitation worker failed (' + code + '/' + signal + '): ' + record.errors);
      resolve();
    }));
    return { ...record, state: record, closedPromise: closed };
  });
  try {
    await until(() => {
      for (const worker of workers) if (worker.state.failure || worker.state.closed && !worker.state.ready) throw worker.state.failure ?? new Error(worker.state.errors);
      return workers.every((worker) => worker.state.ready);
    }, 'all independent Node ESM imports ready');
    await writeFile(barrier, 'start');
    await until(() => workers.every((worker) => worker.state.closed), 'all contenders complete');
    await Promise.all(workers.map((worker) => worker.closedPromise));
    return workers.map((worker) => {
      if (worker.state.failure) throw worker.state.failure;
      const result = worker.state.output.trim().split('\n').map((line) => JSON.parse(line)).find((item) => 'accepted' in item);
      assert.ok(result); return result as { user: string; decision: Plan['decision']; accepted: boolean };
    });
  } finally {
    for (const worker of workers) if (!worker.state.closed) worker.child.kill('SIGKILL');
    await Promise.all(workers.map((worker) => worker.closedPromise));
  }
}
export async function proof(config: DatabaseConfig, scenario: string, bundle: string, directory: string) {
  const evidence: Record<string, unknown> = {};
  try {
    await setup(config);
    const team = await Teams.create({ name: 'Native invitation ' + randomUUID(), ownerId: randomUUID() });
    const invitation = await Teams.invite(team.id, 'Recipient@Example.test', 'viewer');
    if (scenario === 'lookup') {
      const before = await new QueryBuilder('team_invitations').where('id', invitation.id).first();
      const lookup = await Teams.lookupInvitation(invitation.token);
      assert.equal(lookup?.state, 'pending'); assert.equal(lookup?.team.name, team.name);
      assert.equal(lookup?.invitation.email, 'Recipient@Example.test');
      assert.ok(Math.abs(lookup!.invitation.expiresAt - invitation.expiresAt) < 1000, 'Native timestamp must retain its UTC instant');
      assert.deepEqual(await new QueryBuilder('team_invitations').where('id', invitation.id).first(), before);
      assert.equal(await Teams.lookupInvitation(randomUUID()), null);
      evidence.readOnly = true; evidence.timestampErrorMs = Math.abs(lookup!.invitation.expiresAt - invitation.expiresAt);
      evidence.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone; evidence.tables = ['teams', 'team_members', 'team_invitations'];
    } else if (scenario === 'exclusive') {
      const results = await contend(config, invitation.token, Array.from({ length: 16 }, () => 'accept'), bundle, directory);
      const winners = results.filter((result) => result.accepted); assert.equal(winners.length, 1);
      const members = (await Teams.getMembers(team.id)).filter((member) => member.role !== 'owner');
      assert.equal(members.length, 1); assert.equal(String(members[0].userId), winners[0].user);
      assert.equal(members[0].role, 'viewer'); assert.equal((await Teams.lookupInvitation(invitation.token))?.state, 'accepted');
      assert.equal(await Teams.declineInvitation(invitation.token, 'recipient@example.test'), false);
      evidence.contenders = results.length; evidence.winners = winners.length; evidence.memberships = members.length; evidence.uuidUser = members[0].userId;
    } else if (scenario === 'accept-decline') {
      const results = await contend(config, invitation.token, Array.from({ length: 16 }, (_, index) => index % 2 ? 'accept' : 'decline'), bundle, directory);
      const winners = results.filter((result) => result.accepted); assert.equal(winners.length, 1);
      const members = (await Teams.getMembers(team.id)).filter((member) => member.role !== 'owner');
      assert.equal(members.length, winners[0].decision === 'accept' ? 1 : 0);
      assert.equal((await Teams.lookupInvitation(invitation.token))?.state ?? 'missing', winners[0].decision === 'accept' ? 'accepted' : 'missing');
      evidence.contenders = results.length; evidence.winners = winners.length; evidence.decision = winners[0].decision; evidence.memberships = members.length;
    } else if (scenario === 'rollback') {
      const user = randomUUID(); const original = Teams.addMember;
      Teams.addMember = async () => { throw new Error('injected membership persistence failure'); };
      try { await assert.rejects(Teams.acceptInvitation(invitation.token, user, 'recipient@example.test'), /injected membership/); }
      finally { Teams.addMember = original; }
      assert.equal((await Teams.lookupInvitation(invitation.token))?.state, 'pending'); assert.equal(await Teams.isMember(team.id, user), false);
      assert.equal(await Teams.acceptInvitation(invitation.token, user, 'recipient@example.test'), true);
      assert.equal(await Teams.isMember(team.id, user), true);
      evidence.claimRolledBack = true; evidence.retryAccepted = true;
    } else if (scenario === 'guards') {
      const user = randomUUID();
      assert.equal(await Teams.acceptInvitation(invitation.token, user, 'foreign@example.test'), false);
      assert.equal(await Teams.declineInvitation(invitation.token, 'foreign@example.test'), false);
      await new QueryBuilder('team_invitations').where('id', invitation.id).update({ role: 'owner' });
      await assert.rejects(Teams.acceptInvitation(invitation.token, user, 'recipient@example.test'), /owner role is reserved/);
      assert.equal((await Teams.lookupInvitation(invitation.token))?.state, 'pending');
      Teams.configure({ driver: 'database', invitationExpiryHours: -1 });
      const expired = await Teams.invite(team.id, 'recipient@example.test');
      assert.equal((await Teams.lookupInvitation(expired.token))?.state, 'expired');
      assert.equal(await Teams.acceptInvitation(expired.token, user, 'recipient@example.test'), false);
      assert.equal(await Teams.declineInvitation(expired.token, 'recipient@example.test'), false);
      Teams.configure({ driver: 'database', invitationExpiryHours: 1 });
      const decline = await Teams.invite(team.id, 'recipient@example.test');
      assert.equal(await Teams.declineInvitation(decline.token, ' RECIPIENT@example.test '), true);
      assert.equal(await Teams.lookupInvitation(decline.token), null);
      assert.equal(await Teams.isMember(team.id, user), false);
      evidence.foreignRecipientDenied = true; evidence.ownerGrantDenied = true; evidence.expiredDenied = true; evidence.declineRemovedOnlyPending = true;
    } else if (scenario === 'current-state') {
      const original = Teams.lookupInvitation;
      Teams.lookupInvitation = async (token) => {
        const result = await original.call(Teams, token);
        if (result) await new QueryBuilder('team_invitations').where('id', result.invitation.id).update({ email: 'changed@example.test', role: 'admin' });
        return result;
      };
      try { assert.equal(await Teams.acceptInvitation(invitation.token, randomUUID(), 'recipient@example.test'), false); }
      finally { Teams.lookupInvitation = original; }
      assert.equal((await Teams.lookupInvitation(invitation.token))?.state, 'pending');
      assert.equal((await Teams.getMembers(team.id)).length, 1);
      evidence.staleRecipientAndRoleClaimDenied = true;
    } else throw new Error('Unknown invitation scenario: ' + scenario);
    return { driver: config.driver, scenario, passed: true, evidence };
  } finally { await Connection.disconnect(); }
}
