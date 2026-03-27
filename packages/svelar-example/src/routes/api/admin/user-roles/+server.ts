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

/** Assign a role to a user */
export async function POST(event: RequestEvent) {
  const denied = guardAdmin(event);
  if (denied) return denied;

  try {
    const { userId, roleId } = await event.request.json();
    if (!userId || !roleId) {
      return json({ message: 'userId and roleId are required' }, { status: 400 });
    }

    await Permissions.assignRole('User', userId, roleId);
    return json({ message: 'Role assigned to user' });
  } catch (err: any) {
    return json({ message: err.message || 'Failed to assign role' }, { status: 500 });
  }
}

/** Remove a role from a user */
export async function DELETE(event: RequestEvent) {
  const denied = guardAdmin(event);
  if (denied) return denied;

  try {
    const { userId, roleId } = await event.request.json();
    if (!userId || !roleId) {
      return json({ message: 'userId and roleId are required' }, { status: 400 });
    }

    await Permissions.removeRole('User', userId, roleId);
    return json({ message: 'Role removed from user' });
  } catch (err: any) {
    return json({ message: err.message || 'Failed to remove role' }, { status: 500 });
  }
}
