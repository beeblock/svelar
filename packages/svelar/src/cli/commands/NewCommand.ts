/**
 * Svelar CLI — `new` command
 *
 * Scaffolds a complete SvelteKit + Svelar SaaS project with auth,
 * dashboard, admin panel, jobs, tasks, and 90+ API endpoints.
 * Usage: npx svelar new my-app
 */

import { Command } from '../Command.js';
import { NewCommandTemplates as T } from './NewCommandTemplates.js';

export class NewCommand extends Command {
  name = 'new';
  description = 'Create a new SvelteKit project with Svelar pre-configured';
  arguments = ['name'];

  flags = [
    { name: 'no-install', alias: 'n', description: 'Skip npm install', type: 'boolean' as const, default: false },
  ];

  async handle(args: string[], flags: Record<string, any>): Promise<void> {
    const { join, resolve } = await import('node:path');
    const { existsSync, mkdirSync, writeFileSync } = await import('node:fs');
    const { execSync } = await import('node:child_process');

    const projectName = args[0];
    if (!projectName) {
      this.error('Please provide a project name: npx svelar new my-app');
      process.exit(1);
    }

    const projectDir = resolve(process.cwd(), projectName);

    if (existsSync(projectDir)) {
      this.error(`Directory "${projectName}" already exists.`);
      process.exit(1);
    }

    this.log('');
    this.log(`  \x1b[1m\x1b[38;5;208m</>  Svelar\x1b[0m  — Creating new project\n`);

    // Helper to write a file, creating parent dirs as needed
    const write = (relativePath: string, content: string) => {
      const fullPath = join(projectDir, relativePath);
      mkdirSync(join(fullPath, '..'), { recursive: true });
      writeFileSync(fullPath, content);
    };

    // ── 1. Create directory structure ──────────────────────
    this.info('Creating project structure...');
    const dirs = [
      '',
      'src',
      'src/lib',
      'src/lib/models',
      'src/lib/repositories',
      'src/lib/services',
      'src/lib/controllers',
      'src/lib/dtos',
      'src/lib/actions',
      'src/lib/auth',
      'src/lib/schemas',
      'src/lib/jobs',
      'src/lib/scheduler',
      'src/lib/events',
      'src/lib/listeners',
      'src/lib/resources',
      'src/lib/notifications',
      'src/lib/shared/middleware',
      'src/lib/shared/components',
      'src/lib/shared/stores',
      'src/lib/shared/plugins',
      'src/lib/shared/channels',
      'src/lib/shared/commands',
      'src/lib/shared/providers',
      'src/lib/database/migrations',
      'src/lib/database/seeders',
      'src/routes',
      'src/routes/api',
      'static',
      'storage/logs',
      'storage/cache',
      'storage/uploads',
      'storage/sessions',
    ];
    for (const dir of dirs) {
      mkdirSync(join(projectDir, dir), { recursive: true });
    }

    // ── 2. Config files ───────────────────────────────────
    this.info('Writing config files...');
    write('package.json', T.packageJson(projectName));
    write('svelte.config.js', T.svelteConfig());
    write('vite.config.ts', T.viteConfig());
    write('tsconfig.json', T.tsConfig());
    write('src/app.html', T.appHtml());
    write('src/app.css', T.appCss());
    write('src/app.ts', T.appTs());
    write('src/hooks.server.ts', T.hooksServerTs());
    write('.env.example', T.envExample());
    write('.gitignore', T.gitignore());
    write('svelar.database.json', T.svelarDatabaseJson());

    // .gitkeep files in storage directories
    for (const dir of ['storage/logs', 'storage/cache', 'storage/uploads', 'storage/sessions']) {
      write(`${dir}/.gitkeep`, '');
    }

    // ── 3. Domain layer ───────────────────────────────────
    this.info('Scaffolding domain layer...');
    write('src/lib/models/User.ts', T.userModel());
    write('src/lib/models/Post.ts', T.postModel());
    write('src/lib/repositories/UserRepository.ts', T.userRepository());
    write('src/lib/repositories/PostRepository.ts', T.postRepository());
    write('src/lib/services/AuthService.ts', T.authService());
    write('src/lib/services/PostService.ts', T.postService());
    write('src/lib/controllers/AuthController.ts', T.authController());
    write('src/lib/controllers/PostController.ts', T.postController());
    write('src/lib/controllers/AdminController.ts', T.adminController());
    write('src/lib/dtos/RegisterRequest.ts', T.registerRequest());
    write('src/lib/dtos/LoginRequest.ts', T.loginRequest());
    write('src/lib/dtos/CreatePostRequest.ts', T.createPostRequest());
    write('src/lib/dtos/UpdatePostRequest.ts', T.updatePostRequest());
    write('src/lib/dtos/UpdateUserRoleRequest.ts', T.updateUserRoleRequest());
    write('src/lib/dtos/DeleteUserRequest.ts', T.deleteUserRequest());
    write('src/lib/dtos/CreateRoleRequest.ts', T.createRoleRequest());
    write('src/lib/dtos/DeleteRoleRequest.ts', T.deleteRoleRequest());
    write('src/lib/dtos/CreatePermissionRequest.ts', T.createPermissionRequest());
    write('src/lib/dtos/DeletePermissionRequest.ts', T.deletePermissionRequest());
    write('src/lib/dtos/RolePermissionRequest.ts', T.rolePermissionRequest());
    write('src/lib/dtos/UserRoleRequest.ts', T.userRoleRequest());
    write('src/lib/dtos/UserPermissionRequest.ts', T.userPermissionRequest());
    write('src/lib/dtos/ExportDataRequest.ts', T.exportDataRequest());
    write('src/lib/actions/RegisterUserAction.ts', T.registerUserAction());
    write('src/lib/actions/CreatePostAction.ts', T.createPostAction());
    write('src/lib/auth/gates.ts', T.gates());
    write('src/lib/schemas/auth.ts', T.authSchema());
    write('src/lib/schemas/post.ts', T.postSchema());
    write('src/lib/schemas/admin.ts', T.adminSchema());
    write('src/lib/services/AdminService.ts', T.adminService());
    write('src/lib/resources/RoleResource.ts', T.roleResource());
    write('src/lib/resources/PermissionResource.ts', T.permissionResource());
    write('src/lib/shared/providers/EventServiceProvider.ts', T.eventServiceProvider());
    write('src/lib/resources/UserResource.ts', T.userResource());
    write('src/lib/resources/PostResource.ts', T.postResource());
    write('src/lib/events/UserRegistered.ts', T.userRegisteredEvent());
    write('src/lib/listeners/SendWelcomeEmailListener.ts', T.sendWelcomeEmailListener());
    write('src/lib/notifications/WelcomeNotification.ts', T.welcomeNotification());

    // ── 4. Migrations ─────────────────────────────────────
    this.info('Creating migrations...');
    write('src/lib/database/migrations/00000001_create_users_table.ts', T.createUsersTable());
    write('src/lib/database/migrations/00000002_create_posts_table.ts', T.createPostsTable());
    write('src/lib/database/migrations/00000003_create_permissions_tables.ts', T.createPermissionsTables());
    write('src/lib/database/migrations/00000004_add_role_to_users.ts', T.addRoleToUsers());
    write('src/lib/database/migrations/00000005_create_sessions_table.ts', T.createSessionsTable());
    write('src/lib/database/migrations/00000006_create_audit_logs_table.ts', T.createAuditLogsTable());
    write('src/lib/database/migrations/00000007_create_notifications_table.ts', T.createNotificationsTable());

    // ── 5. Seeder ─────────────────────────────────────────
    write('src/lib/database/seeders/DatabaseSeeder.ts', T.databaseSeeder());

    // ── 6. Auth pages ─────────────────────────────────────
    this.info('Creating auth pages...');
    write('src/routes/login/+page.server.ts', T.loginPageServer());
    write('src/routes/login/+page.svelte', T.loginPageSvelte());
    write('src/routes/register/+page.server.ts', T.registerPageServer());
    write('src/routes/register/+page.svelte', T.registerPageSvelte());
    write('src/routes/logout/+page.server.ts', T.logoutPageServer());
    write('src/routes/forgot-password/+page.server.ts', T.forgotPasswordPageServer());
    write('src/routes/forgot-password/+page.svelte', T.forgotPasswordPageSvelte());
    write('src/routes/reset-password/+page.server.ts', T.resetPasswordPageServer());
    write('src/routes/reset-password/+page.svelte', T.resetPasswordPageSvelte());
    write('src/routes/otp-login/+page.server.ts', T.otpLoginPageServer());
    write('src/routes/otp-login/+page.svelte', T.otpLoginPageSvelte());
    write('src/routes/verify-email/+page.server.ts', T.verifyEmailPageServer());
    write('src/routes/verify-email/+page.svelte', T.verifyEmailPageSvelte());

    // ── 7. Dashboard pages ────────────────────────────────
    this.info('Creating dashboard...');
    write('src/routes/dashboard/+layout.server.ts', T.dashboardLayoutServer());
    write('src/routes/dashboard/+page.server.ts', T.dashboardPageServer());
    write('src/routes/dashboard/+page.svelte', T.dashboardPageSvelte());
    write('src/routes/dashboard/api-keys/+page.server.ts', T.apiKeysPageServer());
    write('src/routes/dashboard/api-keys/+page.svelte', T.apiKeysPageSvelte());
    write('src/routes/dashboard/team/+page.server.ts', T.teamPageServer());
    write('src/routes/dashboard/team/+page.svelte', T.teamPageSvelte());

    // ── 8. Admin pages ────────────────────────────────────
    this.info('Creating admin panel...');
    write('src/routes/admin/+layout.server.ts', T.adminLayoutServer());
    write('src/routes/admin/+page.server.ts', T.adminPageServer());
    write('src/routes/admin/+page.svelte', T.adminPageSvelte());

    // ── 9. API routes ─────────────────────────────────────
    this.info('Creating API routes...');
    write('src/routes/api/health/+server.ts', T.apiHealth());
    write('src/routes/api/auth/register/+server.ts', T.apiAuthRegister());
    write('src/routes/api/auth/login/+server.ts', T.apiAuthLogin());
    write('src/routes/api/auth/logout/+server.ts', T.apiAuthLogout());
    write('src/routes/api/auth/me/+server.ts', T.apiAuthMe());
    write('src/routes/api/auth/forgot-password/+server.ts', T.apiAuthForgotPassword());
    write('src/routes/api/auth/reset-password/+server.ts', T.apiAuthResetPassword());
    write('src/routes/api/auth/otp/send/+server.ts', T.apiAuthOtpSend());
    write('src/routes/api/auth/otp/verify/+server.ts', T.apiAuthOtpVerify());
    write('src/routes/api/auth/verify-email/+server.ts', T.apiAuthVerifyEmail());
    write('src/routes/api/posts/+server.ts', T.apiPosts());
    write('src/routes/api/posts/[id]/+server.ts', T.apiPostsSingle());
    write('src/routes/api/posts/mine/+server.ts', T.apiPostsMine());
    write('src/routes/api/broadcasting/[channel]/+server.ts', T.apiBroadcasting());
    write('src/routes/api/internal/broadcast/+server.ts', T.apiInternalBroadcast());
    write('src/routes/api/admin/users/+server.ts', T.apiAdminUsers());
    write('src/routes/api/admin/roles/+server.ts', T.apiAdminRoles());
    write('src/routes/api/admin/permissions/+server.ts', T.apiAdminPermissions());
    write('src/routes/api/admin/role-permissions/+server.ts', T.apiAdminRolePermissions());
    write('src/routes/api/admin/user-roles/+server.ts', T.apiAdminUserRoles());
    write('src/routes/api/admin/user-permissions/+server.ts', T.apiAdminUserPermissions());
    write('src/routes/api/admin/export/+server.ts', T.apiAdminExport());

    // ── 10. Jobs ──────────────────────────────────────────
    this.info('Creating background jobs...');
    write('src/lib/jobs/SendWelcomeEmail.ts', T.sendWelcomeEmail());
    write('src/lib/jobs/DailyDigestJob.ts', T.dailyDigestJob());
    write('src/lib/jobs/ExportDataJob.ts', T.exportDataJob());

    // ── 11. Scheduled tasks ───────────────────────────────
    this.info('Creating scheduled tasks...');
    write('src/lib/scheduler/CleanupExpiredTokens.ts', T.cleanupExpiredTokens());
    write('src/lib/scheduler/CleanExpiredSessions.ts', T.cleanExpiredSessions());
    write('src/lib/scheduler/DailyDigestEmail.ts', T.dailyDigestEmail());
    write('src/lib/scheduler/PruneAuditLogs.ts', T.pruneAuditLogs());
    write('src/lib/scheduler/QueueHealthCheck.ts', T.queueHealthCheck());

    // ── 12. Layout & pages ────────────────────────────────
    this.info('Creating layouts...');
    write('src/routes/+layout.svelte', T.rootLayoutSvelte(projectName));
    write('src/routes/+layout.server.ts', T.rootLayoutServer());
    write('src/routes/+error.svelte', T.errorSvelte());
    write('src/routes/+page.svelte', T.homePage(projectName));

    this.success('Project structure created');

    // ── 13. Install dependencies ──────────────────────────
    if (!flags['no-install']) {
      this.info('Installing dependencies...');
      try {
        execSync('npm install', {
          cwd: projectDir,
          stdio: 'inherit',
        });
        this.success('Dependencies installed');
      } catch {
        this.warn('npm install failed — run it manually with: cd ' + projectName + ' && npm install');
      }

      // ── 14. Run migrations and seed ─────────────────────
      this.info('Running migrations...');
      try {
        execSync('npx svelar migrate', {
          cwd: projectDir,
          stdio: 'inherit',
        });
        this.success('Migrations complete');
      } catch {
        this.warn('Migrations failed — run manually: cd ' + projectName + ' && npx svelar migrate');
      }

      this.info('Seeding database...');
      try {
        execSync('npx svelar seed:run', {
          cwd: projectDir,
          stdio: 'inherit',
        });
        this.success('Database seeded');
      } catch {
        this.warn('Seeding failed — run manually: cd ' + projectName + ' && npx svelar seed:run');
      }
    }

    // ── Done ──────────────────────────────────────────────
    this.log('');
    this.log(`  \x1b[32m+\x1b[0m  Project \x1b[1m${projectName}\x1b[0m created successfully!\n`);
    this.log('  Next steps:\n');
    this.log(`    cd ${projectName}`);
    if (flags['no-install']) {
      this.log('    npm install');
      this.log('    npx svelar migrate');
      this.log('    npx svelar seed:run');
    }
    this.log('    npm run dev');
    this.log('');
    this.log('  Default accounts:');
    this.log('    Admin: admin@svelar.dev / admin123');
    this.log('    Demo:  demo@svelar.dev / password');
    this.log('');
  }
}
