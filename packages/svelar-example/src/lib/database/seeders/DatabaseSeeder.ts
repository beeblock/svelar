import { Seeder } from 'svelar/database';
import { Hash } from 'svelar/hashing';
import { Permissions } from 'svelar/permissions';
import { User } from '../../models/User.js';
import { Post } from '../../models/Post.js';

export class DatabaseSeeder extends Seeder {
  async run(): Promise<void> {
    // ── Create Permissions ────────────────────────────────
    await Permissions.createPermission({ name: 'manage-users', description: 'Create, edit, delete users' });
    await Permissions.createPermission({ name: 'manage-roles', description: 'Assign and manage roles' });
    await Permissions.createPermission({ name: 'manage-posts', description: 'Edit or delete any post' });
    await Permissions.createPermission({ name: 'create-posts', description: 'Create new posts' });
    await Permissions.createPermission({ name: 'view-dashboard', description: 'Access the dashboard' });
    await Permissions.createPermission({ name: 'view-admin', description: 'Access admin panel' });

    // ── Create Roles ─────────────────────────────────────
    const adminRole = await Permissions.createRole({ name: 'admin', description: 'Full access to everything' });
    const editorRole = await Permissions.createRole({ name: 'editor', description: 'Can manage posts' });
    const userRole = await Permissions.createRole({ name: 'user', description: 'Regular user' });

    // ── Assign Permissions to Roles ──────────────────────
    const allPerms = await Permissions.allPermissions();
    for (const perm of allPerms) {
      await Permissions.giveRolePermission(adminRole.id, perm.id);
    }

    const editorPerms = ['manage-posts', 'create-posts', 'view-dashboard'];
    for (const permName of editorPerms) {
      const perm = allPerms.find((p) => p.name === permName);
      if (perm) await Permissions.giveRolePermission(editorRole.id, perm.id);
    }

    const userPerms = ['create-posts', 'view-dashboard'];
    for (const permName of userPerms) {
      const perm = allPerms.find((p) => p.name === permName);
      if (perm) await Permissions.giveRolePermission(userRole.id, perm.id);
    }

    // ── Create Admin User ────────────────────────────────
    const adminPassword = await Hash.make('admin123');
    const admin = await User.create({
      name: 'Admin',
      email: 'admin@svelar.dev',
      password: adminPassword,
      role: 'admin',
    });
    await Permissions.assignRole('User', (admin as any).id, adminRole.id);

    // ── Create Demo User ─────────────────────────────────
    const demoPassword = await Hash.make('password');
    const demo = await User.create({
      name: 'Demo User',
      email: 'demo@svelar.dev',
      password: demoPassword,
      role: 'user',
    });
    await Permissions.assignRole('User', (demo as any).id, userRole.id);

    // ── Create Sample Posts ──────────────────────────────
    await Post.create({
      title: 'Getting Started with Svelar',
      slug: 'getting-started-with-svelar',
      body: 'Svelar brings Laravel-style conventions to SvelteKit. Models, migrations, middleware, and more. This framework gives you the structure and power of Laravel with the speed and simplicity of SvelteKit.',
      published: true,
      user_id: (admin as any).id,
    });

    await Post.create({
      title: 'Eloquent-Style ORM in TypeScript',
      slug: 'eloquent-style-orm-in-typescript',
      body: 'Query your database with a fluent API: User.where("active", true).with("posts").orderBy("name").get(). Full support for relationships, eager loading, and pagination.',
      published: true,
      user_id: (demo as any).id,
    });

    await Post.create({
      title: 'Draft Post',
      slug: 'draft-post',
      body: 'This is a draft post that is not published yet. It demonstrates the published/unpublished toggle feature in the dashboard.',
      published: false,
      user_id: (demo as any).id,
    });

    console.log('[Seeder] Database seeded successfully.');
    console.log('[Seeder] Admin: admin@svelar.dev / admin123');
    console.log('[Seeder] Demo:  demo@svelar.dev / password');
  }
}
