/**
 * Svelar Teams & Workspaces
 * Multi-tenant team support for SaaS applications.
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
  private teams: Team[] = [];
  private members: TeamMember[] = [];
  private invitations: TeamInvitation[] = [];
  private currentTeamId: string | number | null = null;

  configure(config: TeamsConfig): void {
    this.config = { ...this.config, ...config };
  }

  // ── Team CRUD ────────────────────────────────────────────

  async create(data: {
    name: string;
    ownerId: string | number;
    personalTeam?: boolean;
  }): Promise<Team> {
    const slug = this.slugify(data.name);
    const team: Team = {
      id: randomUUID(),
      name: data.name,
      slug,
      ownerId: data.ownerId,
      personalTeam: data.personalTeam || false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    if (this.config.driver === 'memory') {
      this.teams.push(team);
      // Auto-add owner as member
      this.members.push({
        id: randomUUID(),
        teamId: team.id,
        userId: data.ownerId,
        role: 'owner',
        joinedAt: Date.now(),
      });
    } else if (this.config.driver === 'database') {
      try {
        const { Connection } = await import('../database/Connection.js');
        await Connection.connection();
        // Would insert into teams table
        // And create owner membership
      } catch {
        this.teams.push(team);
        this.members.push({
          id: randomUUID(),
          teamId: team.id,
          userId: data.ownerId,
          role: 'owner',
          joinedAt: Date.now(),
        });
      }
    }

    return team;
  }

  async update(
    teamId: string | number,
    data: Partial<Team>
  ): Promise<Team | null> {
    const team = this.teams.find((t) => t.id === teamId);
    if (!team) return null;

    Object.assign(team, data, { updatedAt: Date.now() });
    return team;
  }

  async delete(teamId: string | number): Promise<boolean> {
    const index = this.teams.findIndex((t) => t.id === teamId);
    if (index === -1) return false;

    this.teams.splice(index, 1);
    this.members = this.members.filter((m) => m.teamId !== teamId);
    this.invitations = this.invitations.filter((i) => i.teamId !== teamId);
    return true;
  }

  async findById(teamId: string | number): Promise<Team | null> {
    return this.teams.find((t) => t.id === teamId) || null;
  }

  async findBySlug(slug: string): Promise<Team | null> {
    return this.teams.find((t) => t.slug === slug) || null;
  }

  // ── Members ──────────────────────────────────────────────

  async addMember(
    teamId: string | number,
    userId: string | number,
    role: string = 'member'
  ): Promise<TeamMember> {
    const team = await this.findById(teamId);
    if (!team) throw new Error(`Team ${teamId} not found`);

    // Check if already a member
    const existing = this.members.find(
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

    this.members.push(member);
    return member;
  }

  async removeMember(
    teamId: string | number,
    userId: string | number
  ): Promise<boolean> {
    const index = this.members.findIndex(
      (m) => m.teamId === teamId && m.userId === userId
    );
    if (index === -1) return false;

    this.members.splice(index, 1);
    return true;
  }

  async updateMemberRole(
    teamId: string | number,
    userId: string | number,
    role: string
  ): Promise<boolean> {
    const member = this.members.find(
      (m) => m.teamId === teamId && m.userId === userId
    );
    if (!member) return false;

    member.role = role;
    return true;
  }

  async getMembers(teamId: string | number): Promise<TeamMember[]> {
    return this.members.filter((m) => m.teamId === teamId);
  }

  async getUserTeams(userId: string | number): Promise<Team[]> {
    const memberTeamIds = this.members
      .filter((m) => m.userId === userId)
      .map((m) => m.teamId);

    return this.teams.filter((t) => memberTeamIds.includes(t.id));
  }

  async isMember(teamId: string | number, userId: string | number): Promise<boolean> {
    return this.members.some(
      (m) => m.teamId === teamId && m.userId === userId && !this.isInvitation(m.userId, teamId)
    );
  }

  async hasRole(
    teamId: string | number,
    userId: string | number,
    role: string
  ): Promise<boolean> {
    const member = this.members.find(
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
    const team = await this.findById(teamId);
    if (!team) throw new Error(`Team ${teamId} not found`);

    const expiryHours = this.config.invitationExpiryHours || 72;
    const invitation: TeamInvitation = {
      id: randomUUID(),
      teamId,
      email,
      role,
      token: randomUUID(),
      expiresAt: Date.now() + expiryHours * 60 * 60 * 1000,
      createdAt: Date.now(),
    };

    this.invitations.push(invitation);
    return invitation;
  }

  async acceptInvitation(
    token: string,
    userId: string | number
  ): Promise<boolean> {
    const invitation = this.invitations.find((i) => i.token === token);
    if (!invitation) return false;

    // Check expiry
    if (invitation.expiresAt < Date.now()) return false;

    // Add as member
    await this.addMember(invitation.teamId, userId, invitation.role);

    // Mark invitation as accepted
    invitation.acceptedAt = Date.now();

    return true;
  }

  async cancelInvitation(invitationId: string): Promise<boolean> {
    const index = this.invitations.findIndex((i) => i.id === invitationId);
    if (index === -1) return false;

    this.invitations.splice(index, 1);
    return true;
  }

  async getPendingInvitations(teamId: string | number): Promise<TeamInvitation[]> {
    return this.invitations.filter(
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

  private isInvitation(userId: string | number, teamId: string | number): boolean {
    return this.invitations.some(
      (i) =>
        i.teamId === teamId && !i.acceptedAt && i.expiresAt > Date.now()
    );
  }
}

export const Teams = singleton('svelar.teams', () => new TeamManager());
