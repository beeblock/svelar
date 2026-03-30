/**
 * Svelar Teams & Workspaces
 * Multi-tenant team support for SaaS applications.
 *
 * Tables (`teams`, `team_members`, `team_invitations`) are auto-created
 * on first use when the database driver is configured — no migration required.
 */

import { randomUUID } from 'crypto';
import { singleton } from '../support/singleton.js';

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
  private tablesEnsured = false;

  configure(config: TeamsConfig): void {
    this.config = { ...this.config, ...config };
    this.tablesEnsured = false;
  }

  private get teamsTable(): string {
    return this.config.table || 'teams';
  }

  private get membersTable(): string {
    return this.config.membersTable || 'team_members';
  }

  private get invitationsTable(): string {
    return this.config.invitationsTable || 'team_invitations';
  }

  private get useDb(): boolean {
    return this.config.driver === 'database';
  }

  // ── Database helpers ─────────────────────────────────────

  private async getConnection() {
    const { Connection } = await import('../database/Connection.js');
    return Connection;
  }

  private async getDriver(): Promise<string> {
    const conn = await this.getConnection();
    return conn.getDriver();
  }

  /**
   * Auto-create teams, team_members, and team_invitations tables on first use.
   */
  async ensureTables(): Promise<void> {
    if (this.tablesEnsured || !this.useDb) return;

    const conn = await this.getConnection();
    const driver = conn.getDriver();
    const t = this.teamsTable;
    const m = this.membersTable;
    const inv = this.invitationsTable;

    switch (driver) {
      case 'sqlite':
        await conn.raw(
          `CREATE TABLE IF NOT EXISTS ${t} (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            slug TEXT NOT NULL UNIQUE,
            owner_id TEXT NOT NULL,
            personal_team INTEGER NOT NULL DEFAULT 0,
            metadata TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          )`,
        );
        await conn.raw(
          `CREATE TABLE IF NOT EXISTS ${m} (
            id TEXT PRIMARY KEY,
            team_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'member',
            joined_at TEXT NOT NULL,
            UNIQUE(team_id, user_id)
          )`,
        );
        await conn.raw(
          `CREATE TABLE IF NOT EXISTS ${inv} (
            id TEXT PRIMARY KEY,
            team_id TEXT NOT NULL,
            email TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'member',
            token TEXT NOT NULL UNIQUE,
            expires_at TEXT NOT NULL,
            accepted_at TEXT,
            created_at TEXT NOT NULL
          )`,
        );
        break;
      case 'postgres':
        await conn.raw(
          `CREATE TABLE IF NOT EXISTS ${t} (
            id VARCHAR(255) PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            slug VARCHAR(255) NOT NULL UNIQUE,
            owner_id VARCHAR(255) NOT NULL,
            personal_team BOOLEAN NOT NULL DEFAULT FALSE,
            metadata JSONB,
            created_at TIMESTAMPTZ NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL
          )`,
        );
        await conn.raw(
          `CREATE TABLE IF NOT EXISTS ${m} (
            id VARCHAR(255) PRIMARY KEY,
            team_id VARCHAR(255) NOT NULL,
            user_id VARCHAR(255) NOT NULL,
            role VARCHAR(50) NOT NULL DEFAULT 'member',
            joined_at TIMESTAMPTZ NOT NULL,
            UNIQUE(team_id, user_id)
          )`,
        );
        await conn.raw(
          `CREATE TABLE IF NOT EXISTS ${inv} (
            id VARCHAR(255) PRIMARY KEY,
            team_id VARCHAR(255) NOT NULL,
            email VARCHAR(255) NOT NULL,
            role VARCHAR(50) NOT NULL DEFAULT 'member',
            token VARCHAR(255) NOT NULL UNIQUE,
            expires_at TIMESTAMPTZ NOT NULL,
            accepted_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL
          )`,
        );
        break;
      case 'mysql':
        await conn.raw(
          `CREATE TABLE IF NOT EXISTS ${t} (
            id VARCHAR(255) PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            slug VARCHAR(255) NOT NULL UNIQUE,
            owner_id VARCHAR(255) NOT NULL,
            personal_team TINYINT(1) NOT NULL DEFAULT 0,
            metadata JSON,
            created_at DATETIME NOT NULL,
            updated_at DATETIME NOT NULL
          ) ENGINE=InnoDB`,
        );
        await conn.raw(
          `CREATE TABLE IF NOT EXISTS ${m} (
            id VARCHAR(255) PRIMARY KEY,
            team_id VARCHAR(255) NOT NULL,
            user_id VARCHAR(255) NOT NULL,
            role VARCHAR(50) NOT NULL DEFAULT 'member',
            joined_at DATETIME NOT NULL,
            UNIQUE(team_id, user_id)
          ) ENGINE=InnoDB`,
        );
        await conn.raw(
          `CREATE TABLE IF NOT EXISTS ${inv} (
            id VARCHAR(255) PRIMARY KEY,
            team_id VARCHAR(255) NOT NULL,
            email VARCHAR(255) NOT NULL,
            role VARCHAR(50) NOT NULL DEFAULT 'member',
            token VARCHAR(255) NOT NULL UNIQUE,
            expires_at DATETIME NOT NULL,
            accepted_at DATETIME,
            created_at DATETIME NOT NULL
          ) ENGINE=InnoDB`,
        );
        break;
    }

    this.tablesEnsured = true;
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
      await this.ensureTables();
      const conn = await this.getConnection();
      const nowIso = new Date(now).toISOString();
      await conn.raw(
        `INSERT INTO ${this.teamsTable} (id, name, slug, owner_id, personal_team, metadata, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [team.id, team.name, team.slug, team.ownerId, team.personalTeam ? 1 : 0, null, nowIso, nowIso],
      );
      // Auto-add owner as member
      await conn.raw(
        `INSERT INTO ${this.membersTable} (id, team_id, user_id, role, joined_at) VALUES (?, ?, ?, ?, ?)`,
        [randomUUID(), team.id, data.ownerId, 'owner', nowIso],
      );
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
      await this.ensureTables();
      const conn = await this.getConnection();
      const existing = await this.findById(teamId);
      if (!existing) return null;

      const nowIso = new Date().toISOString();
      const newName = data.name ?? existing.name;
      const newSlug = data.name ? this.slugify(data.name) : existing.slug;
      const newMeta = data.metadata !== undefined
        ? JSON.stringify(data.metadata)
        : (existing.metadata ? JSON.stringify(existing.metadata) : null);

      await conn.raw(
        `UPDATE ${this.teamsTable} SET name = ?, slug = ?, metadata = ?, updated_at = ? WHERE id = ?`,
        [newName, newSlug, newMeta, nowIso, teamId],
      );

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
      await this.ensureTables();
      const conn = await this.getConnection();
      // Cascade: delete invitations, members, then team
      await conn.raw(`DELETE FROM ${this.invitationsTable} WHERE team_id = ?`, [teamId]);
      await conn.raw(`DELETE FROM ${this.membersTable} WHERE team_id = ?`, [teamId]);
      const result: any = await conn.raw(`DELETE FROM ${this.teamsTable} WHERE id = ?`, [teamId]);
      // Different drivers return changes differently; check if the team existed
      return true;
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
      await this.ensureTables();
      const conn = await this.getConnection();
      const rows: any[] = await conn.raw(
        `SELECT * FROM ${this.teamsTable} WHERE id = ?`,
        [teamId],
      );
      return rows.length > 0 ? this.rowToTeam(rows[0]) : null;
    }

    return this.memTeams.find((t) => t.id === teamId) || null;
  }

  async findBySlug(slug: string): Promise<Team | null> {
    if (this.useDb) {
      await this.ensureTables();
      const conn = await this.getConnection();
      const rows: any[] = await conn.raw(
        `SELECT * FROM ${this.teamsTable} WHERE slug = ?`,
        [slug],
      );
      return rows.length > 0 ? this.rowToTeam(rows[0]) : null;
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
      await this.ensureTables();
      const conn = await this.getConnection();

      // Check if already a member
      const existing: any[] = await conn.raw(
        `SELECT * FROM ${this.membersTable} WHERE team_id = ? AND user_id = ?`,
        [teamId, userId],
      );
      if (existing.length > 0) return this.rowToMember(existing[0]);

      const id = randomUUID();
      const nowIso = new Date().toISOString();
      await conn.raw(
        `INSERT INTO ${this.membersTable} (id, team_id, user_id, role, joined_at) VALUES (?, ?, ?, ?, ?)`,
        [id, teamId, userId, role, nowIso],
      );

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
      await this.ensureTables();
      const conn = await this.getConnection();
      await conn.raw(
        `DELETE FROM ${this.membersTable} WHERE team_id = ? AND user_id = ?`,
        [teamId, userId],
      );
      return true;
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
      await this.ensureTables();
      const conn = await this.getConnection();
      await conn.raw(
        `UPDATE ${this.membersTable} SET role = ? WHERE team_id = ? AND user_id = ?`,
        [role, teamId, userId],
      );
      return true;
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
      await this.ensureTables();
      const conn = await this.getConnection();
      const rows: any[] = await conn.raw(
        `SELECT * FROM ${this.membersTable} WHERE team_id = ?`,
        [teamId],
      );
      return rows.map((r) => this.rowToMember(r));
    }

    return this.memMembers.filter((m) => m.teamId === teamId);
  }

  async getUserTeams(userId: string | number): Promise<Team[]> {
    if (this.useDb) {
      await this.ensureTables();
      const conn = await this.getConnection();
      const rows: any[] = await conn.raw(
        `SELECT t.* FROM ${this.teamsTable} t
         INNER JOIN ${this.membersTable} m ON m.team_id = t.id
         WHERE m.user_id = ?`,
        [userId],
      );
      return rows.map((r) => this.rowToTeam(r));
    }

    const memberTeamIds = this.memMembers
      .filter((m) => m.userId === userId)
      .map((m) => m.teamId);

    return this.memTeams.filter((t) => memberTeamIds.includes(t.id));
  }

  async isMember(teamId: string | number, userId: string | number): Promise<boolean> {
    if (this.useDb) {
      await this.ensureTables();
      const conn = await this.getConnection();
      const rows: any[] = await conn.raw(
        `SELECT 1 FROM ${this.membersTable} WHERE team_id = ? AND user_id = ?`,
        [teamId, userId],
      );
      return rows.length > 0;
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
      await this.ensureTables();
      const conn = await this.getConnection();
      const rows: any[] = await conn.raw(
        `SELECT 1 FROM ${this.membersTable} WHERE team_id = ? AND user_id = ? AND role = ?`,
        [teamId, userId, role],
      );
      return rows.length > 0;
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
      await this.ensureTables();
      const conn = await this.getConnection();
      await conn.raw(
        `INSERT INTO ${this.invitationsTable} (id, team_id, email, role, token, expires_at, accepted_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          invitation.id, teamId, email, role, invitation.token,
          new Date(invitation.expiresAt).toISOString(),
          null,
          new Date(now).toISOString(),
        ],
      );
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
      await this.ensureTables();
      const conn = await this.getConnection();
      const nowIso = new Date().toISOString();

      const rows: any[] = await conn.raw(
        `SELECT * FROM ${this.invitationsTable} WHERE token = ? AND accepted_at IS NULL`,
        [token],
      );
      if (rows.length === 0) return false;

      const inv = rows[0];
      if (new Date(inv.expires_at).getTime() < Date.now()) return false;

      // Add as member
      await this.addMember(inv.team_id, userId, inv.role);

      // Mark as accepted
      await conn.raw(
        `UPDATE ${this.invitationsTable} SET accepted_at = ? WHERE id = ?`,
        [nowIso, inv.id],
      );

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
      await this.ensureTables();
      const conn = await this.getConnection();
      await conn.raw(
        `DELETE FROM ${this.invitationsTable} WHERE id = ?`,
        [invitationId],
      );
      return true;
    }

    const index = this.memInvitations.findIndex((i) => i.id === invitationId);
    if (index === -1) return false;

    this.memInvitations.splice(index, 1);
    return true;
  }

  async getPendingInvitations(teamId: string | number): Promise<TeamInvitation[]> {
    if (this.useDb) {
      await this.ensureTables();
      const conn = await this.getConnection();
      const nowIso = new Date().toISOString();
      const rows: any[] = await conn.raw(
        `SELECT * FROM ${this.invitationsTable} WHERE team_id = ? AND accepted_at IS NULL AND expires_at > ?`,
        [teamId, nowIso],
      );
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
