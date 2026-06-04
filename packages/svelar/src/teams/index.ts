/**
 * Svelar Teams & Workspaces
 * Multi-tenant team support for SaaS applications.
 */

import { randomUUID } from 'crypto';
import { singleton } from '../support/singleton.js';
import { assertSqlIdentifier } from '../database/Connection.js';
import { QueryBuilder } from '../orm/QueryBuilder.js';

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
  role: string; // 'owner' | 'admin' | 'member' | custom
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

export type TeamRole = 'owner' | 'admin' | 'member' | 'viewer';

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
  private config: TeamsConfig = { driver: 'memory', invitationExpiryHours: 72 };

  // In-memory storage (used when driver = 'memory')
  private memTeams: Team[] = [];
  private memMembers: TeamMember[] = [];
  private memInvitations: TeamInvitation[] = [];

  private currentTeamId: string | number | null = null;

  configure(config: TeamsConfig): void {
    this.config = { ...this.config, ...config };
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
    return new QueryBuilder(this.invitationsTable);
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
      expiresAt: new Date(row.expires_at).getTime(),
      acceptedAt: row.accepted_at ? new Date(row.accepted_at).getTime() : undefined,
      createdAt: new Date(row.created_at).getTime(),
    };
  }

  // ── Team CRUD ────────────────────────────────────────────

  async create(data: {
    name: string;
    ownerId: string | number;
    personalTeam?: boolean;
  }): Promise<Team> {
    const slug = this.slugify(data.name);
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
      const newSlug = data.name ? this.slugify(data.name) : existing.slug;
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
    if (data.name) team.slug = this.slugify(data.name);
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
    if (this.useDb) {
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

    this.memMembers.splice(index, 1);
    return true;
  }

  async updateMemberRole(
    teamId: string | number,
    userId: string | number,
    role: string
  ): Promise<boolean> {
    if (this.useDb) {
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

  async invite(
    teamId: string | number,
    email: string,
    role: string = 'member'
  ): Promise<TeamInvitation> {
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
      // Verify team exists for memory driver
      const team = this.memTeams.find((t) => t.id === teamId);
      if (!team) throw new Error(`Team ${teamId} not found`);

      this.memInvitations.push(invitation);
    }

    return invitation;
  }

  async acceptInvitation(
    token: string,
    userId: string | number
  ): Promise<boolean> {
    if (this.useDb) {
      const nowIso = new Date().toISOString();

      const inv = await this.invitationsQuery()
        .where('token', token)
        .whereNull('accepted_at')
        .first();
      if (!inv) return false;

      if (new Date(inv.expires_at).getTime() < Date.now()) return false;

      // Add as member
      await this.addMember(inv.team_id, userId, inv.role);

      // Mark as accepted
      await this.invitationsQuery().where('id', inv.id).update({ accepted_at: nowIso });

      return true;
    }

    const invitation = this.memInvitations.find((i) => i.token === token);
    if (!invitation) return false;
    if (invitation.expiresAt < Date.now()) return false;

    await this.addMember(invitation.teamId, userId, invitation.role);
    invitation.acceptedAt = Date.now();
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
      (i) => i.teamId === teamId && !i.acceptedAt && i.expiresAt > Date.now()
    );
  }

  // ── Context ──────────────────────────────────────────────

  setCurrentTeam(teamId: string | number): void {
    this.currentTeamId = teamId;
  }

  getCurrentTeam(): string | number | null {
    return this.currentTeamId;
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
