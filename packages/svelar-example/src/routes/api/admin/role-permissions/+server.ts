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

/** Attach a permission to a role */
export async function POST(event: RequestEvent) {
  const denied = guardAdmin(event);
  if (denied) return denied;

  try {
    const { roleId, permissionId } = await event.request.json();
    if (!roleId || !permissionId) {
      return json({ message: 'roleId and permissionId are required' }, { status: 400 });
    }

    await Permissions.giveRolePermission(roleId, permissionId);
    return json({ message: 'Permission attached to role' });
  } catch (err: any) {
    return json({ message: err.message || 'Failed to attach permission' }, { status: 500 });
  }
}

/** Detach a permission from a role */
export async function DELETE(event: RequestEvent) {
  const denied = guardAdmin(event);
  if (denied) return denied;

  try {
    const { roleId, permissionId } = await event.request.json();
    if (!roleId || !permissionId) {
      return json({ message: 'roleId and permissionId are required' }, { status: 400 });
    }

    await Permissions.revokeRolePermission(roleId, permissionId);
    return json({ message: 'Permission detached from role' });
  } catch (err: any) {
    return json({ message: err.message || 'Failed to detach permission' }, { status: 500 });
  }
}
