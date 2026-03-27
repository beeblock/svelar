import type { Actions, PageServerLoad } from './$types';
import { fail, redirect } from '@sveltejs/kit';
import { ApiKeys } from 'svelar/api-keys';

export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.user) throw redirect(302, '/login');

  const user = locals.user as any;
  let keys: any[] = [];

  try {
    keys = await ApiKeys.listForUser(user.id);
  } catch {}

  return {
    user: { id: user.id, name: user.name, email: user.email },
    apiKeys: keys.map((k: any) => ({
      id: k.id,
      name: k.name,
      prefix: k.prefix,
      permissions: k.permissions ?? [],
      lastUsedAt: k.lastUsedAt ?? null,
      createdAt: k.createdAt,
    })),
  };
};

export const actions: Actions = {
  create: async ({ request, locals }) => {
    if (!locals.user) throw redirect(302, '/login');

    const data = await request.formData();
    const name = data.get('name') as string;
    const permissions = (data.get('permissions') as string || 'read').split(',').map(p => p.trim());

    if (!name?.trim()) {
      return fail(400, { error: 'Key name is required' });
    }

    try {
      const { plainTextKey, record } = await ApiKeys.create({
        name,
        userId: (locals.user as any).id,
        permissions,
      });

      return { success: true, plainTextKey, keyId: record.id };
    } catch (err: any) {
      return fail(500, { error: err.message || 'Failed to create key' });
    }
  },

  revoke: async ({ request, locals }) => {
    if (!locals.user) throw redirect(302, '/login');

    const data = await request.formData();
    const keyId = data.get('keyId') as string;

    if (!keyId) {
      return fail(400, { error: 'Key ID is required' });
    }

    try {
      await ApiKeys.revoke(keyId);
      return { success: true, revoked: true };
    } catch (err: any) {
      return fail(500, { error: err.message || 'Failed to revoke key' });
    }
  },
};
