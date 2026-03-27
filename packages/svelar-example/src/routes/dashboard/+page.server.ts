import type { PageServerLoad } from './$types';
import { ApiKeys } from 'svelar/api-keys';
import { Teams } from 'svelar/teams';
import { Audit } from 'svelar/audit';

export const load: PageServerLoad = async ({ locals }) => {
  const user = locals.user as any;

  let apiKeyCount = 0;
  let teamCount = 0;
  let recentActivity: any[] = [];

  try {
    const keys = await ApiKeys.listForUser(user.id);
    apiKeyCount = keys?.length ?? 0;
  } catch {}

  try {
    const teams = await Teams.getUserTeams(user.id);
    teamCount = teams?.length ?? 0;
  } catch {}

  try {
    const entries = await Audit.query({ limit: 10 });
    recentActivity = (entries ?? []).map((e: any) => ({
      action: e.action,
      modelType: e.modelType,
      modelId: e.modelId,
      timestamp: e.timestamp,
    }));
  } catch {}

  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role ?? 'user',
    },
    stats: {
      apiKeyCount,
      teamCount,
    },
    recentActivity,
  };
};
