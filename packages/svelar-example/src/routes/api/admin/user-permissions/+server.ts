import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { Permissions } from 'svelar/permissions';

function guardAdmin(event: RequestEvent) {
  const user = event.locals.user;
  if (!user || user.role !== 'admin') {
    return json({ message: 'Unauthorized' }, { status: 403 });
  }
  return null;
}

/** Give a direct permission to a user */
export async function POST(event: RequestEvent) {
  const denied = guardAdmin(event);
  if (denied) return denied;

  try {
    const { userId, permissionId } = await event.request.json();
    if (!userId || !permissionId) {
      return json({ message: 'userId and permissionId are required' }, { status: 400 });
    }

    await Permissions.giveModelPermission('User', userId, permissionId);
    return json({ message: 'Permission granted to user' });
  } catch (err: any) {
    return json({ message: err.message || 'Failed to grant permission' }, { status: 500 });
  }
}

/** Revoke a direct permission from a user */
export async function DELETE(event: RequestEvent) {
  const denied = guardAdmin(event);
  if (denied) return denied;

  try {
    const { userId, permissionId } = await event.request.json();
    if (!userId || !permissionId) {
      return json({ message: 'userId and permissionId are required' }, { status: 400 });
    }

    await Permissions.revokeModelPermission('User', userId, permissionId);
    return json({ message: 'Permission revoked from user' });
  } catch (err: any) {
    return json({ message: err.message || 'Failed to revoke permission' }, { status: 500 });
  }
}
