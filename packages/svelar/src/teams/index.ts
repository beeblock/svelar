/**
 * Svelar Teams & Workspaces
 * Multi-tenant team support for SaaS applications.
 */

import { randomUUID } from 'crypto';
import { singleton } from '../support/singleton.js';
import { Connection, assertSqlIdentifier } from '../database/Connection.js';
import { QueryBuilder } from '../orm/QueryBuilder.js';
import { ApplicationContext, type ApplicationContextSnapshot } from '../support/Context.js';

export interface Team {
  id: string | number;
  name: string;
  slug: string;
  ownerId: string | number;
  personalTeam: boolean;
  metadata?: Record<string, any>;
  createdAt: number;
  updatedAt: number;
}

export interface TeamMember {
  id: string | number;
  teamId: string | number;
  userId: string | number;
  role: string;
  joinedAt: number;
}

export interface TeamInvitation {
  id: string;
  teamId: string | number;
  email: string;
  role: string;
  token: string;
  expiresAt: number;
  acceptedAt?: number;
  createdAt: number;
}

export interface TeamInvitationLookup {
  invitation: Readonly<TeamInvitation>;
  team: Readonly<Pick<Team, 'id' | 'name' | 'slug'>>;
  state: 'pending' | 'expired' | 'accepted';
}

export type TeamRole = 'owner' | 'admin' | 'member' | 'viewer' | (string & {});

const DEFAULT_TEAM_ROLES: TeamRole[] = ['owner', 'admin', 'member', 'viewer'];

export interface TeamsConfig {
  driver: 'database' | 'memory';
  table?: string;
  membersTable?: string;
  invitationsTable?: string;
  roles?: TeamRole[];
  maxTeamsPerUser?: number;
  invitationExpiryHours?: number;
}

class TeamManager {
  private config: TeamsConfig = {
    driver: 'memory',
    roles: DEFAULT_TEAM_ROLES,
    invitationExpiryHours: 72,
  };

  // In-memory storage (used when driver = 'memory')
  private memTeams: Team[] = [];
  private memMembers: TeamMember[] = [];
  private memInvitations: TeamInvitation[] = [];

  configure(config: TeamsConfig): void {
    this.config = {
      ...this.config,
      ...config,
      roles: config.roles ?? this.config.roles ?? DEFAULT_TEAM_ROLES,
    };
  }

  private get teamsTable(): string {
    return assertSqlIdentifier(this.config.table || 'teams', 'Teams table name');
  }

  private get membersTable(): string {
    return assertSqlIdentifier(this.config.membersTable || 'team_members', 'Team members table name');
  }

  private get invitationsTable(): string {
    return assertSqlIdentifier(this.config.invitationsTable || 'team_invitations', 'Team invitations table name');
  }

  private get useDb(): boolean {
    return this.config.driver === 'database';
  }

  private teamsQuery(): QueryBuilder<any> {
    return new QueryBuilder(this.teamsTable);
  }

  private membersQuery(): QueryBuilder<any> {
    return new QueryBuilder(this.membersTable);
  }

  private invitationsQuery(): QueryBuilder<any> {
    // These columns store UTC wall-clock values; native drivers otherwise decode them in local time.
    const textType = Connection.getDriver() === 'mysql' ? 'CHAR' : 'TEXT';
    return new QueryBuilder(this.invitationsTable).select('id', 'team_id', 'email', 'role', 'token')
      .selectRaw(`CAST(expires_at AS ${textType}) AS expires_at`)
      .selectRaw(`CAST(accepted_at AS ${textType}) AS accepted_at`)
      .selectRaw(`CAST(created_at AS ${textType}) AS created_at`);
  }

  private get roles(): string[] {
    return (this.config.roles?.length ? this.config.roles : DEFAULT_TEAM_ROLES).map(String);
  }

  private assertRole(role: string): void {
    if (!this.roles.includes(role)) {
      throw new Error(`Invalid team role "${role}". Allowed roles: ${this.roles.join(', ')}`);
    }
  }

  private assertAssignableRole(role: string): void {
    this.assertRole(role);
    if (role === 'owner') {
      throw new Error('The owner role is reserved for the team owner');
    }
  }

  isAssignableRole(role: string): boolean {
    return role !== 'owner' && this.roles.includes(role);
  }

  private async assertTeamExists(teamId: string | number): Promise<Team> {
    const team = await this.findById(teamId);
    if (!team) throw new Error(`Team ${teamId} not found`);
    return team;
  }

  private async assertWithinTeamLimit(ownerId: string | number): Promise<void> {
    const max = this.config.maxTeamsPerUser;
    if (!max || max < 1) return;

    const teams = await this.getUserTeams(ownerId);
    if (teams.length >= max) {
      throw new Error(`User ${ownerId} has reached the maximum number of teams (${max})`);
    }
  }

  private async slugExists(slug: string, excludeTeamId?: string | number): Promise<boolean> {
    const existing = await this.findBySlug(slug);
    return Boolean(existing && String(existing.id) !== String(excludeTeamId));
  }

  private async uniqueSlug(name: string, excludeTeamId?: string | number): Promise<string> {
    const base = this.slugify(name) || 'team';
    let slug = base;
    let suffix = 2;

    while (await this.slugExists(slug, excludeTeamId)) {
      slug = `${base}-${suffix}`;
      suffix += 1;
    }

    return slug;
  }

  private rowToTeam(row: any): Team {
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      ownerId: row.owner_id,
      personalTeam: Boolean(row.personal_team),
      metadata: row.metadata ? (typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata) : undefined,
      createdAt: new Date(row.created_at).getTime(),
      updatedAt: new Date(row.updated_at).getTime(),
    };
  }

  private rowToMember(row: any): TeamMember {
    return {
      id: row.id,
      teamId: row.team_id,
      userId: row.user_id,
      role: row.role,
      joinedAt: new Date(row.joined_at).getTime(),
    };
  }

  private rowToInvitation(row: any): TeamInvitation {
    return {
      id: row.id,
      teamId: row.team_id,
      email: row.email,
      role: row.role,
      token: row.token,
      expiresAt: this.invitationTimestamp(row.expires_at),
      acceptedAt: row.accepted_at ? this.invitationTimestamp(row.accepted_at) : undefined,
      createdAt: this.invitationTimestamp(row.created_at),
    };
  }

  private invitationTimestamp(value: string): number {
    const timestamp = value.replace(' ', 'T');
    return new Date(/(?:Z|[+-]\d{2}(?::?\d{2})?)$/i.test(timestamp)
      ? timestamp.replace(/([+-]\d{2})$/, '$1:00') : timestamp + 'Z').getTime();
  }

  // ── Team CRUD ────────────────────────────────────────────

  async create(data: {
    name: string;
    ownerId: string | number;
    personalTeam?: boolean;
  }): Promise<Team> {
    this.assertRole('owner');
    await this.assertWithinTeamLimit(data.ownerId);

    const slug = await this.uniqueSlug(data.name);
    const now = Date.now();
    const team: Team = {
      id: randomUUID(),
      name: data.name,
      slug,
      ownerId: data.ownerId,
      personalTeam: data.personalTeam || false,
      createdAt: now,
      updatedAt: now,
    };

    if (this.useDb) {
      const nowIso = new Date(now).toISOString();
      await this.teamsQuery().insert({
        id: team.id,
        name: team.name,
        slug: team.slug,
        owner_id: team.ownerId,
        personal_team: team.personalTeam ? 1 : 0,
        metadata: null,
        created_at: nowIso,
        updated_at: nowIso,
      });
      // Auto-add owner as member
      await this.membersQuery().insert({
        id: randomUUID(),
        team_id: team.id,
        user_id: data.ownerId,
        role: 'owner',
        joined_at: nowIso,
      });
    } else {
      this.memTeams.push(team);
      this.memMembers.push({
        id: randomUUID(),
        teamId: team.id,
        userId: data.ownerId,
        role: 'owner',
        joinedAt: now,
      });
    }

    return team;
  }

  async update(
    teamId: string | number,
    data: Partial<Pick<Team, 'name' | 'metadata'>>
  ): Promise<Team | null> {
    if (this.useDb) {
      const existing = await this.findById(teamId);
      if (!existing) return null;

      const nowIso = new Date().toISOString();
      const newName = data.name ?? existing.name;
      const newSlug = data.name ? await this.uniqueSlug(data.name, teamId) : existing.slug;
      const newMeta = data.metadata !== undefined
        ? JSON.stringify(data.metadata)
        : (existing.metadata ? JSON.stringify(existing.metadata) : null);

      await this.teamsQuery().where('id', teamId).update({
        name: newName,
        slug: newSlug,
        metadata: newMeta,
        updated_at: nowIso,
      });

      return this.findById(teamId);
    }

    const team = this.memTeams.find((t) => t.id === teamId);
    if (!team) return null;

    Object.assign(team, data, { updatedAt: Date.now() });
    if (data.name) team.slug = await this.uniqueSlug(data.name, teamId);
    return team;
  }

  async delete(teamId: string | number): Promise<boolean> {
    if (this.useDb) {
      // Cascade: delete invitations, members, then team
      await this.invitationsQuery().where('team_id', teamId).delete();
      await this.membersQuery().where('team_id', teamId).delete();
      const deleted = await this.teamsQuery().where('id', teamId).delete();
      return deleted > 0;
    }

    const index = this.memTeams.findIndex((t) => t.id === teamId);
    if (index === -1) return false;

    this.memTeams.splice(index, 1);
    this.memMembers = this.memMembers.filter((m) => m.teamId !== teamId);
    this.memInvitations = this.memInvitations.filter((i) => i.teamId !== teamId);
    return true;
  }

  async findById(teamId: string | number): Promise<Team | null> {
    if (this.useDb) {
      const row = await this.teamsQuery().where('id', teamId).first();
      return row ? this.rowToTeam(row) : null;
    }

    return this.memTeams.find((t) => t.id === teamId) || null;
  }

  async findBySlug(slug: string): Promise<Team | null> {
    if (this.useDb) {
      const row = await this.teamsQuery().where('slug', slug).first();
      return row ? this.rowToTeam(row) : null;
    }

    return this.memTeams.find((t) => t.slug === slug) || null;
  }

  // ── Members ──────────────────────────────────────────────

  async addMember(
    teamId: string | number,
    userId: string | number,
    role: string = 'member'
  ): Promise<TeamMember> {
    this.assertAssignableRole(role);
    await this.assertTeamExists(teamId);

    if (this.useDb) {
      // Check if already a member
      const existing = await this.membersQuery()
        .where('team_id', teamId)
        .where('user_id', userId)
        .first();
      if (existing) return this.rowToMember(existing);

      const id = randomUUID();
      const nowIso = new Date().toISOString();
      await this.membersQuery().insert({
        id,
        team_id: teamId,
        user_id: userId,
        role,
        joined_at: nowIso,
      });

      return { id, teamId, userId, role, joinedAt: Date.now() };
    }

    // Check if already a member
    const existing = this.memMembers.find(
      (m) => m.teamId === teamId && m.userId === userId
    );
    if (existing) return existing;

    const member: TeamMember = {
      id: randomUUID(),
      teamId,
      userId,
      role,
      joinedAt: Date.now(),
    };

    this.memMembers.push(member);
    return member;
  }

  async removeMember(
    teamId: string | number,
    userId: string | number
  ): Promise<boolean> {
    const team = await this.assertTeamExists(teamId);

    if (this.useDb) {
      const member = await this.membersQuery()
        .where('team_id', teamId)
        .where('user_id', userId)
        .first();
      if (!member || member.role === 'owner' || String(team.ownerId) === String(userId)) return false;

      const deleted = await this.membersQuery()
        .where('team_id', teamId)
        .where('user_id', userId)
        .delete();
      return deleted > 0;
    }

    const index = this.memMembers.findIndex(
      (m) => m.teamId === teamId && m.userId === userId
    );
    if (index === -1) return false;
    if (this.memMembers[index].role === 'owner' || String(team.ownerId) === String(userId)) return false;

    this.memMembers.splice(index, 1);
    return true;
  }

  async updateMemberRole(
    teamId: string | number,
    userId: string | number,
    role: string
  ): Promise<boolean> {
    this.assertAssignableRole(role);
    const team = await this.assertTeamExists(teamId);

    if (this.useDb) {
      const member = await this.membersQuery()
        .where('team_id', teamId)
        .where('user_id', userId)
        .first();
      if (!member || member.role === 'owner' || String(team.ownerId) === String(userId)) return false;

      const updated = await this.membersQuery()
        .where('team_id', teamId)
        .where('user_id', userId)
        .update({ role });
      return updated > 0;
    }

    const member = this.memMembers.find(
      (m) => m.teamId === teamId && m.userId === userId
    );
    if (!member) return false;
    if (member.role === 'owner' || String(team.ownerId) === String(userId)) return false;

    member.role = role;
    return true;
  }

  async getMembers(teamId: string | number): Promise<TeamMember[]> {
    if (this.useDb) {
      const rows = await this.membersQuery().where('team_id', teamId).get();
      return rows.map((r) => this.rowToMember(r));
    }

    return this.memMembers.filter((m) => m.teamId === teamId);
  }

  async getUserTeams(userId: string | number): Promise<Team[]> {
    if (this.useDb) {
      const rows = await new QueryBuilder<any>(`${this.teamsTable} t`)
        .select('t.*')
        .join(`${this.membersTable} m`, 'm.team_id', '=', 't.id')
        .where('m.user_id', userId)
        .get();
      return rows.map((r) => this.rowToTeam(r));
    }

    const memberTeamIds = this.memMembers
      .filter((m) => m.userId === userId)
      .map((m) => m.teamId);

    return this.memTeams.filter((t) => memberTeamIds.includes(t.id));
  }

  async isMember(teamId: string | number, userId: string | number): Promise<boolean> {
    if (this.useDb) {
      return this.membersQuery()
        .where('team_id', teamId)
        .where('user_id', userId)
        .exists();
    }

    return this.memMembers.some(
      (m) => m.teamId === teamId && m.userId === userId
    );
  }

  async hasRole(
    teamId: string | number,
    userId: string | number,
    role: string
  ): Promise<boolean> {
    if (this.useDb) {
      return this.membersQuery()
        .where('team_id', teamId)
        .where('user_id', userId)
        .where('role', role)
        .exists();
    }

    const member = this.memMembers.find(
      (m) => m.teamId === teamId && m.userId === userId
    );
    return member?.role === role || false;
  }

  // ── Invitations ──────────────────────────────────────────

  /** Trusted server lookup. HTTP callers must authorize the recipient and project public fields. */
  async lookupInvitation(token: string): Promise<TeamInvitationLookup | null> {
    if (typeof token !== 'string' || !token || token.length > 255) return null;
    const invitation = this.useDb
      ? await this.invitationsQuery().where('token', token).first().then((row) => row ? this.rowToInvitation(row) : null)
      : this.memInvitations.find((item) => item.token === token);
    if (!invitation || !Number.isFinite(invitation.expiresAt)) return null;
    const team = await this.findById(invitation.teamId);
    if (!team) return null;
    return {
      invitation: { ...invitation }, team: { id: team.id, name: team.name, slug: team.slug },
      state: invitation.acceptedAt !== undefined ? 'accepted' : invitation.expiresAt <= Date.now() ? 'expired' : 'pending',
    };
  }

  private matchesInvitationEmail(invitation: TeamInvitation, recipientEmail?: string): boolean {
    return recipientEmail === undefined || typeof recipientEmail === 'string' && recipientEmail.trim().length > 0
      && invitation.email.trim().toLowerCase() === recipientEmail.trim().toLowerCase();
  }

  private pendingInvitationQuery(invitation: TeamInvitation): QueryBuilder<any> {
    return this.invitationsQuery().where('id', invitation.id).where('token', invitation.token)
      .where('team_id', invitation.teamId).where('email', invitation.email).where('role', invitation.role)
      .whereNull('accepted_at').where('expires_at', '>', new Date().toISOString());
  }

  async invite(
    teamId: string | number,
    email: string,
    role: string = 'member'
  ): Promise<TeamInvitation> {
    this.assertAssignableRole(role);
    await this.assertTeamExists(teamId);

    const expiryHours = this.config.invitationExpiryHours || 72;
    const now = Date.now();
    const invitation: TeamInvitation = {
      id: randomUUID(),
      teamId,
      email,
      role,
      token: randomUUID(),
      expiresAt: now + expiryHours * 60 * 60 * 1000,
      createdAt: now,
    };

    if (this.useDb) {
      await this.invitationsQuery().insert({
        id: invitation.id,
        team_id: teamId,
        email,
        role,
        token: invitation.token,
        expires_at: new Date(invitation.expiresAt).toISOString(),
        accepted_at: null,
        created_at: new Date(now).toISOString(),
      });
    } else {
      this.memInvitations.push(invitation);
    }

    return invitation;
  }

  async acceptInvitation(
    token: string,
    userId: string | number,
    recipientEmail?: string
  ): Promise<boolean> {
    const lookup = await this.lookupInvitation(token);
    if (!lookup || lookup.state !== 'pending' || !this.matchesInvitationEmail(lookup.invitation, recipientEmail)) return false;
    this.assertAssignableRole(lookup.invitation.role);
    if (this.useDb) return Connection.transaction(async () => {
      // Claim with the first transaction statement: SQLite needs no read-to-write lock upgrade.
      const claimed = await this.pendingInvitationQuery(lookup.invitation).update({ accepted_at: new Date().toISOString() });
      if (claimed !== 1) return false;
      await this.addMember(lookup.invitation.teamId, userId, lookup.invitation.role);
      return true;
    });
    const invitation = this.memInvitations.find((i) => i.token === token);
    if (!invitation || invitation.acceptedAt !== undefined || invitation.expiresAt <= Date.now()
      || !this.matchesInvitationEmail(invitation, recipientEmail)) return false;
    invitation.acceptedAt = Date.now();
    try {
      await this.addMember(invitation.teamId, userId, invitation.role);
      return true;
    } catch (error) {
      invitation.acceptedAt = undefined;
      throw error;
    }
  }

  async declineInvitation(token: string, recipientEmail: string): Promise<boolean> {
    const lookup = await this.lookupInvitation(token);
    if (!lookup || lookup.state !== 'pending' || !recipientEmail || !this.matchesInvitationEmail(lookup.invitation, recipientEmail)) return false;
    if (this.useDb) return await this.pendingInvitationQuery(lookup.invitation).delete() === 1;
    const index = this.memInvitations.findIndex((item) => item.token === token && item.acceptedAt === undefined
      && item.expiresAt > Date.now() && this.matchesInvitationEmail(item, recipientEmail));
    if (index === -1) return false;
    this.memInvitations.splice(index, 1);
    return true;
  }

  async cancelInvitation(invitationId: string): Promise<boolean> {
    if (this.useDb) {
      const deleted = await this.invitationsQuery().where('id', invitationId).delete();
      return deleted > 0;
    }

    const index = this.memInvitations.findIndex((i) => i.id === invitationId);
    if (index === -1) return false;

    this.memInvitations.splice(index, 1);
    return true;
  }

  async getPendingInvitations(teamId: string | number): Promise<TeamInvitation[]> {
    if (this.useDb) {
      const nowIso = new Date().toISOString();
      const rows = await this.invitationsQuery()
        .where('team_id', teamId)
        .whereNull('accepted_at')
        .where('expires_at', '>', nowIso)
        .get();
      return rows.map((r) => this.rowToInvitation(r));
    }

    return this.memInvitations.filter(
      (i) => i.teamId === teamId && i.acceptedAt === undefined && i.expiresAt > Date.now()
    );
  }

  // ── Context ──────────────────────────────────────────────

  setCurrentTeam(teamId: string | number): void {
    ApplicationContext.set('teamId', teamId);
  }

  clearCurrentTeam(): void {
    ApplicationContext.set('teamId', null);
  }

  getCurrentTeam(): string | number | null {
    return ApplicationContext.get<string | number | null>('teamId') ?? null;
  }

  runWithTeam<T>(teamId: string | number, callback: () => T | Promise<T>): T | Promise<T> {
    return ApplicationContext.run({ teamId }, callback);
  }

  runWithContext<T>(context: ApplicationContextSnapshot, callback: () => T | Promise<T>): T | Promise<T> {
    return ApplicationContext.run(context, callback);
  }

  getContext(): ApplicationContextSnapshot {
    return ApplicationContext.snapshot();
  }

  // ── Helpers ──────────────────────────────────────────────

  private slugify(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .replace(/[\s_]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }
}

export const Teams = singleton('svelar.teams', () => new TeamManager());
