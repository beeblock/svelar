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

export async function POST(event: RequestEvent) {
  const denied = guardAdmin(event);
  if (denied) return denied;

  try {
    const { name, guard, description } = await event.request.json();
    if (!name) return json({ message: 'Name is required' }, { status: 400 });

    const existing = await Permissions.findPermission(name, guard);
    if (existing) return json({ message: 'Permission already exists' }, { status: 409 });

    const perm = await Permissions.createPermission({ name, guard, description });
    return json(perm, { status: 201 });
  } catch (err: any) {
    return json({ message: err.message || 'Failed to create permission' }, { status: 500 });
  }
}

export async function DELETE(event: RequestEvent) {
  const denied = guardAdmin(event);
  if (denied) return denied;

  try {
    const { name, guard } = await event.request.json();
    if (!name) return json({ message: 'Name is required' }, { status: 400 });

    await Permissions.deletePermission(name, guard);
    return json({ message: 'Permission deleted' });
  } catch (err: any) {
    return json({ message: err.message || 'Failed to delete permission' }, { status: 500 });
  }
}
