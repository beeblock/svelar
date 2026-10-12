import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Connection } from '../src/database/Connection.js';
import { Migrator } from '../src/database/Migration.js';
import { svelarCoreMigrations } from '../src/database/CoreMigrations.js';
import { Model } from '../src/orm/Model.js';
import { HasRoles, Permissions } from '../src/permissions/index.js';

class User extends HasRoles(Model) {
  static table = 'users';
  static timestamps = false;
}

describe.sequential('Permissions', () => {
  let root: string;

  beforeEach(async () => {
    Permissions.clearCapabilities();
    root = await mkdtemp(join(tmpdir(), 'svelar-permissions-'));
    await Connection.disconnect();
    Connection.configure({
      default: 'sqlite',
      connections: {
        sqlite: { driver: 'sqlite', filename: join(root, 'database.sqlite') },
      },
    });

    await new Migrator().fresh(svelarCoreMigrations());
  });

  afterEach(async () => {
    await Connection.disconnect();
    await rm(root, { recursive: true, force: true });
  });

  it('keeps role and permission checks scoped to the requested guard', async () => {
    const webRole = await Permissions.createRole({ name: 'editor', guard: 'web' });
    const apiRole = await Permissions.createRole({ name: 'editor', guard: 'api' });
    const webPermission = await Permissions.createPermission({ name: 'publish-posts', guard: 'web' });
    const apiPermission = await Permissions.createPermission({ name: 'publish-posts', guard: 'api' });

    await Permissions.giveRolePermission(webRole.id, webPermission.id);
    await Permissions.giveRolePermission(apiRole.id, apiPermission.id);
    await Permissions.assignRole('User', 1, webRole.id);

    const user = new User({ id: 1 }) as User;

    await expect(user.hasRole('editor')).resolves.toBe(true);
    await expect(user.hasRole('editor', 'api')).resolves.toBe(false);
    await expect(user.hasPermission('publish-posts')).resolves.toBe(true);
    await expect(user.hasPermission('publish-posts', 'api')).resolves.toBe(false);
    await expect(user.can('publish-posts', 'api')).resolves.toBe(false);
    await expect(Permissions.roleHasPermission(webRole.id, 'publish-posts', 'api')).resolves.toBe(false);
  });

  it('supports direct permissions, sync operations, and Laravel-style name helpers', async () => {
    await Permissions.createRole({ name: 'admin', guard: 'web' });
    await Permissions.createRole({ name: 'editor', guard: 'web' });
    await Permissions.createPermission({ name: 'delete-posts', guard: 'web' });
    await Permissions.createPermission({ name: 'publish-posts', guard: 'web' });

    const user = new User({ id: 2 }) as User;

    await user.syncRoles(['editor']);
    await user.syncPermissions(['publish-posts']);

    await expect(user.hasAnyRole(['admin', 'editor'])).resolves.toBe(true);
    await expect(user.hasAllRoles(['admin', 'editor'])).resolves.toBe(false);
    await expect(user.getRoleNames()).resolves.toEqual(['editor']);
    await expect(user.getPermissionNames()).resolves.toEqual(['publish-posts']);

    await user.syncRoles(['admin']);
    await user.givePermission('delete-posts');

    await expect(user.getRoleNames()).resolves.toEqual(['admin']);
    await expect(user.getPermissionNames()).resolves.toEqual(['delete-posts', 'publish-posts']);

    await user.revokePermission('publish-posts');

    await expect(user.cannot('publish-posts')).resolves.toBe(true);
    await expect(user.getPermissionNames()).resolves.toEqual(['delete-posts']);
  });

  it('registers code-defined capabilities and syncs them to permission records', async () => {
    Permissions.registerCapabilities([
      {
        name: 'boards.view',
        description: 'View boards',
        module: 'boards',
        screen: '/boards',
        action: 'view',
      },
      {
        name: 'boards.move-cards',
        description: 'Move cards between lists',
        module: 'boards',
        screen: '/boards/:id',
        action: 'update',
      },
      {
        name: 'admin.users.view',
        guard: 'api',
        description: 'Read users through the API',
        module: 'admin',
        action: 'view',
      },
    ]);

    await Permissions.createPermission({ name: 'old-permission', description: 'No longer used' });
    await Permissions.createPermission({ name: 'boards.view', description: 'Old description' });

    const result = await Permissions.syncCapabilities({ prune: true });

    expect(result.created.map((permission) => permission.name)).toEqual(['boards.move-cards']);
    expect(result.updated.map((permission) => permission.name)).toEqual(['boards.view']);
    expect(result.pruned.map((permission) => permission.name)).toEqual(['old-permission']);
    expect(Permissions.capabilityNames()).toEqual(['boards.move-cards', 'boards.view']);
    expect(Permissions.capabilities()[0]).toMatchObject({
      name: 'boards.move-cards',
      module: 'boards',
      screen: '/boards/:id',
      action: 'update',
    });
    await expect(Permissions.findPermission('boards.view')).resolves.toMatchObject({
      description: 'View boards',
    });

    const apiResult = await Permissions.syncCapabilities({ guard: 'api' });
    expect(apiResult.created.map((permission) => permission.name)).toEqual(['admin.users.view']);
    expect(Permissions.capabilityNames('api')).toEqual(['admin.users.view']);
  });
});
