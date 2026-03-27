import type { Actions, PageServerLoad } from './$types';
import { fail } from '@sveltejs/kit';
import { Teams } from 'svelar/teams';

export const load: PageServerLoad = async ({ locals }) => {
  const user = locals.user as any;

  // Get user's teams (create a personal team if none exists)
  let teams: any[] = [];
  try {
    teams = await Teams.getUserTeams(user.id);
  } catch {}

  // Auto-create personal team on first visit
  if (teams.length === 0) {
    try {
      const team = await Teams.create({
        name: `${user.name}'s Team`,
        ownerId: user.id,
        personalTeam: true,
      });
      teams = [team];
    } catch {}
  }

  const currentTeam = teams[0] ?? null;
  let members: any[] = [];
  let invitations: any[] = [];

  if (currentTeam) {
    try {
      members = await Teams.getMembers(currentTeam.id);
    } catch {}
    try {
      invitations = await Teams.getPendingInvitations(currentTeam.id);
    } catch {}
  }

  return {
    user: { id: user.id, name: user.name, email: user.email },
    team: currentTeam ? {
      id: currentTeam.id,
      name: currentTeam.name,
      slug: currentTeam.slug,
    } : null,
    members: members.map((m: any) => ({
      id: m.id,
      userId: m.userId,
      role: m.role,
      joinedAt: m.joinedAt,
    })),
    invitations: invitations.map((i: any) => ({
      id: i.id,
      email: i.email,
      role: i.role,
      createdAt: i.createdAt,
      expiresAt: i.expiresAt,
    })),
  };
};

export const actions: Actions = {
  invite: async ({ request, locals }) => {
    if (!locals.user) return fail(401, { error: 'Unauthenticated' });

    const data = await request.formData();
    const email = data.get('email') as string;
    const role = data.get('role') as string || 'member';
    const teamId = data.get('teamId') as string;

    if (!email?.trim()) {
      return fail(400, { error: 'Email is required' });
    }

    try {
      await Teams.invite(teamId, email, role);
      return { success: true, invited: email };
    } catch (err: any) {
      return fail(500, { error: err.message || 'Failed to send invitation' });
    }
  },

  updateRole: async ({ request, locals }) => {
    if (!locals.user) return fail(401, { error: 'Unauthenticated' });

    const data = await request.formData();
    const teamId = data.get('teamId') as string;
    const userId = data.get('userId') as string;
    const role = data.get('role') as string;

    try {
      await Teams.updateMemberRole(teamId, userId, role);
      return { success: true };
    } catch (err: any) {
      return fail(500, { error: err.message || 'Failed to update role' });
    }
  },

  removeMember: async ({ request, locals }) => {
    if (!locals.user) return fail(401, { error: 'Unauthenticated' });

    const data = await request.formData();
    const teamId = data.get('teamId') as string;
    const userId = data.get('userId') as string;

    try {
      await Teams.removeMember(teamId, userId);
      return { success: true, removed: true };
    } catch (err: any) {
      return fail(500, { error: err.message || 'Failed to remove member' });
    }
  },

  cancelInvitation: async ({ request, locals }) => {
    if (!locals.user) return fail(401, { error: 'Unauthenticated' });

    const data = await request.formData();
    const invitationId = data.get('invitationId') as string;

    try {
      await Teams.cancelInvitation(invitationId);
      return { success: true, cancelled: true };
    } catch (err: any) {
      return fail(500, { error: err.message || 'Failed to cancel invitation' });
    }
  },

  updateTeam: async ({ request, locals }) => {
    if (!locals.user) return fail(401, { error: 'Unauthenticated' });

    const data = await request.formData();
    const teamId = data.get('teamId') as string;
    const name = data.get('name') as string;

    if (!name?.trim()) {
      return fail(400, { error: 'Team name is required' });
    }

    try {
      await Teams.update(teamId, { name });
      return { success: true, updated: true };
    } catch (err: any) {
      return fail(500, { error: err.message || 'Failed to update team' });
    }
  },
};
