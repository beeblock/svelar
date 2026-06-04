/**
 * Svelar CLI — `new` command
 *
 * Scaffolds a complete SvelteKit + Svelar SaaS project with auth,
 * dashboard, admin panel, jobs, tasks, and 90+ API endpoints.
 * Usage: npx svelar new my-app
 *        npx svelar new my-app --flat
 */

import { Command } from '../Command.js';
import { NewCommandTemplates as T } from './NewCommandTemplates.js';

export class NewCommand extends Command {
  name = 'new';
  description = 'Create a new SvelteKit project with Svelar pre-configured';
  arguments = ['name'];

  flags = [
    { name: 'no-install', alias: 'n', description: 'Skip npm install', type: 'boolean' as const, default: false },
    { name: 'flat', description: 'Use flat folder structure instead of DDD modules', type: 'boolean' as const, default: false },
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

    const flat = flags['flat'] || false;
    const structureLabel = flat ? 'flat' : 'DDD modular';

    this.log('');
    this.log(`  \x1b[1m\x1b[38;5;208m</>  Svelar\x1b[0m  — Creating new project (${structureLabel})\n`);

    // Helper to write a file, creating parent dirs as needed.
    // Templates always use DDD paths internally. When --flat is set,
    // both the file path and import paths are transformed automatically.
    const write = (dddPath: string, content: string) => {
      const relativePath = flat ? toFlatPath(dddPath) : dddPath;
      const transformedContent = flat ? toFlatImports(content, dddPath) : content;
      const fullPath = join(projectDir, relativePath);
      mkdirSync(join(fullPath, '..'), { recursive: true });
      writeFileSync(fullPath, transformedContent);
    };

    // ── 1. Create directory structure ─────────────────────
    this.info('Creating project structure...');
    const dirs = flat ? [
      '', 'src', 'src/lib',
      'src/lib/models', 'src/lib/services', 'src/lib/controllers',
      'src/lib/repositories', 'src/lib/dtos', 'src/lib/actions',
      'src/lib/resources', 'src/lib/events', 'src/lib/listeners',
      'src/lib/notifications', 'src/lib/schemas',
      'src/lib/jobs', 'src/lib/scheduler', 'src/lib/middleware',
      'src/lib/components', 'src/lib/components/ui', 'src/lib/hooks',
      'src/lib/stores', 'src/lib/plugins',
      'src/lib/channels', 'src/lib/commands', 'src/lib/providers',
      'src/lib/database/migrations', 'src/lib/database/seeders',
      'src/routes', 'src/routes/api',
      'static', 'storage/logs', 'storage/cache', 'storage/uploads', 'storage/sessions',
      'tests/unit', 'tests/feature', 'tests/e2e', 'src/lib/factories',
    ] : [
      '', 'src', 'src/lib',
      'src/lib/modules/auth', 'src/lib/modules/posts', 'src/lib/modules/admin',
      'src/lib/shared/jobs', 'src/lib/shared/scheduler', 'src/lib/shared/middleware',
      'src/lib/shared/components', 'src/lib/components/ui', 'src/lib/hooks',
      'src/lib/shared/stores', 'src/lib/shared/plugins',
      'src/lib/shared/channels', 'src/lib/shared/commands', 'src/lib/shared/providers',
      'src/lib/database/migrations', 'src/lib/database/seeders',
      'src/routes', 'src/routes/api',
      'static', 'storage/logs', 'storage/cache', 'storage/uploads', 'storage/sessions',
      'tests/unit', 'tests/feature', 'tests/e2e', 'src/lib/factories',
    ];
    for (const dir of dirs) {
      mkdirSync(join(projectDir, dir), { recursive: true });
    }

    // ── 2. Config files ───────────────────────────────────
    this.info('Writing config files...');

    // Read our own version so scaffolded projects depend on the correct release
    const { dirname: dn } = await import('node:path');
    const { fileURLToPath: ftu } = await import('node:url');
    const ownPkgPath = join(dn(dn(dn(ftu(import.meta.url)))), 'package.json');
    const ownPkg = JSON.parse((await import('node:fs')).readFileSync(ownPkgPath, 'utf-8'));
    const svelarVersion = ownPkg.version ?? '0.4.0';

    write('package.json', T.packageJson(projectName, svelarVersion));
    write('svelte.config.js', T.svelteConfig());
    write('vite.config.ts', T.viteConfig());
    write('tsconfig.json', T.tsConfig());
    write('src/app.html', T.appHtml());
    write('static/favicon.svg', T.faviconSvg());
    write('src/app.css', T.appCss());
    write('src/app.ts', T.appTs());
    write('src/hooks.server.ts', T.hooksServerTs());
    write('.env.example', T.envExample());

    // Generate .env with unique secrets so the app works immediately
    const { randomBytes } = await import('node:crypto');
    const appKey = randomBytes(32).toString('hex');
    const internalSecret = randomBytes(16).toString('hex');
    const envContent = T.envExample()
      .replace('APP_KEY=change-me-to-a-random-string', `APP_KEY=${appKey}`)
      .replace('INTERNAL_SECRET=change-me-to-a-random-string', `INTERNAL_SECRET=${internalSecret}`);
    write('.env', envContent);

    write('.gitignore', T.gitignore());
    write('svelar.database.json', T.svelarDatabaseJson());
    write('components.json', T.componentsJson());
    write('src/lib/utils.ts', T.utilsCn());

    // .gitkeep files in storage directories
    for (const dir of ['storage/logs', 'storage/cache', 'storage/uploads', 'storage/sessions']) {
      write(`${dir}/.gitkeep`, '');
    }

    // ── 3. Domain layer ───────────────────────────────────
    this.info('Scaffolding domain layer...');

    // Auth module
    write('src/lib/modules/auth/User.ts', T.userModel());
    write('src/lib/modules/auth/UserRepository.ts', T.userRepository());
    write('src/lib/modules/auth/AuthService.ts', T.authService());
    write('src/lib/modules/auth/AuthController.ts', T.authController());
    write('src/lib/modules/auth/RegisterUserAction.ts', T.registerUserAction());
    write('src/lib/modules/auth/RegisterRequest.ts', T.registerRequest());
    write('src/lib/modules/auth/LoginRequest.ts', T.loginRequest());
    write('src/lib/modules/auth/ForgotPasswordRequest.ts', T.forgotPasswordRequest());
    write('src/lib/modules/auth/ResetPasswordRequest.ts', T.resetPasswordRequest());
    write('src/lib/modules/auth/OtpSendRequest.ts', T.otpSendRequest());
    write('src/lib/modules/auth/OtpVerifyRequest.ts', T.otpVerifyRequest());
    write('src/lib/modules/auth/UserResource.ts', T.userResource());
    write('src/lib/modules/auth/gates.ts', T.gates());
    write('src/lib/modules/auth/schemas.ts', T.authSchema());
    write('src/lib/modules/auth/UserRegistered.ts', T.userRegisteredEvent());
    write('src/lib/modules/auth/SendWelcomeEmailListener.ts', T.sendWelcomeEmailListener());
    write('src/lib/modules/auth/WelcomeNotification.ts', T.welcomeNotification());

    // Posts module
    write('src/lib/modules/posts/Post.ts', T.postModel());
    write('src/lib/modules/posts/PostRepository.ts', T.postRepository());
    write('src/lib/modules/posts/PostService.ts', T.postService());
    write('src/lib/modules/posts/PostController.ts', T.postController());
    write('src/lib/modules/posts/CreatePostAction.ts', T.createPostAction());
    write('src/lib/modules/posts/CreatePostRequest.ts', T.createPostRequest());
    write('src/lib/modules/posts/UpdatePostRequest.ts', T.updatePostRequest());
    write('src/lib/modules/posts/PostResource.ts', T.postResource());
    write('src/lib/modules/posts/schemas.ts', T.postSchema());

    // Admin module
    write('src/lib/modules/admin/AdminService.ts', T.adminService());
    write('src/lib/modules/admin/AdminController.ts', T.adminController());
    write('src/lib/modules/admin/UpdateUserRoleRequest.ts', T.updateUserRoleRequest());
    write('src/lib/modules/admin/DeleteUserRequest.ts', T.deleteUserRequest());
    write('src/lib/modules/admin/CreateRoleRequest.ts', T.createRoleRequest());
    write('src/lib/modules/admin/DeleteRoleRequest.ts', T.deleteRoleRequest());
    write('src/lib/modules/admin/CreatePermissionRequest.ts', T.createPermissionRequest());
    write('src/lib/modules/admin/DeletePermissionRequest.ts', T.deletePermissionRequest());
    write('src/lib/modules/admin/RolePermissionRequest.ts', T.rolePermissionRequest());
    write('src/lib/modules/admin/UserRoleRequest.ts', T.userRoleRequest());
    write('src/lib/modules/admin/UserPermissionRequest.ts', T.userPermissionRequest());
    write('src/lib/modules/admin/ExportDataRequest.ts', T.exportDataRequest());
    write('src/lib/modules/admin/RoleResource.ts', T.roleResource());
    write('src/lib/modules/admin/PermissionResource.ts', T.permissionResource());
    write('src/lib/modules/admin/schemas.ts', T.adminSchema());

    // Shared providers
    write('src/lib/shared/providers/EventServiceProvider.ts', T.eventServiceProvider());

    // ── 4. Migrations ─────────────────────────────────────
    this.info('Creating migrations...');
    for (const migration of T.svelarCoreMigrations()) {
      write(migration.path, migration.content);
    }
    write('src/lib/database/migrations/00000001_create_users_table.ts', T.createUsersTable());
    write('src/lib/database/migrations/00000002_create_posts_table.ts', T.createPostsTable());
    write('src/lib/database/migrations/00000003_add_role_to_users.ts', T.addRoleToUsers());


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
    write('src/routes/dashboard/+layout.svelte', T.dashboardLayoutSvelte());
    write('src/routes/dashboard/+page.server.ts', T.dashboardPageServer());
    write('src/routes/dashboard/+page.svelte', T.dashboardPageSvelte());
    write('src/routes/dashboard/api-keys/+page.server.ts', T.apiKeysPageServer());
    write('src/routes/dashboard/api-keys/+page.svelte', T.apiKeysPageSvelte());
    write('src/routes/dashboard/team/+page.server.ts', T.teamPageServer());
    write('src/routes/dashboard/team/+page.svelte', T.teamPageSvelte());

    // ── 8. Admin pages ────────────────────────────────────
    this.info('Creating admin panel...');
    write('src/routes/admin/+layout.server.ts', T.adminLayoutServer());
    write('src/routes/admin/+layout.svelte', T.adminLayoutSvelte());
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
    write('src/routes/api/admin/health/+server.ts', T.apiAdminHealth());
    write('src/routes/api/admin/queue/+server.ts', T.apiAdminQueue());
    write('src/routes/api/admin/queue/[id]/retry/+server.ts', T.apiAdminQueueRetry());
    write('src/routes/api/admin/queue/[id]/+server.ts', T.apiAdminQueueDelete());
    write('src/routes/api/admin/scheduler/+server.ts', T.apiAdminScheduler());
    write('src/routes/api/admin/scheduler/[name]/run/+server.ts', T.apiAdminSchedulerRun());
    write('src/routes/api/admin/scheduler/[name]/toggle/+server.ts', T.apiAdminSchedulerToggle());
    write('src/routes/api/admin/logs/+server.ts', T.apiAdminLogs());
    write('src/routes/api/admin/stats/+server.ts', T.apiAdminStats());


    // ── 10. Jobs ──────────────────────────────────────────
    this.info('Creating background jobs...');
    write('src/lib/shared/jobs/SendWelcomeEmail.ts', T.sendWelcomeEmail());
    write('src/lib/shared/jobs/DailyDigestJob.ts', T.dailyDigestJob());
    write('src/lib/shared/jobs/ExportDataJob.ts', T.exportDataJob());

    // ── 11. Scheduled tasks ───────────────────────────────
    this.info('Creating scheduled tasks...');
    write('src/lib/shared/scheduler/CleanupExpiredTokens.ts', T.cleanupExpiredTokens());
    write('src/lib/shared/scheduler/CleanExpiredSessions.ts', T.cleanExpiredSessions());
    write('src/lib/shared/scheduler/DailyDigestEmail.ts', T.dailyDigestEmail());
    write('src/lib/shared/scheduler/PruneAuditLogs.ts', T.pruneAuditLogs());
    write('src/lib/shared/scheduler/QueueHealthCheck.ts', T.queueHealthCheck());
    write('src/lib/shared/scheduler/index.ts', T.schedulerIndex());

    // ── 12. Layout & pages ────────────────────────────────
    this.info('Creating layouts...');
    write('src/routes/+layout.svelte', T.rootLayoutSvelte(projectName));
    write('src/routes/+layout.server.ts', T.rootLayoutServer());
    write('src/routes/+error.svelte', T.errorSvelte());
    write('src/routes/+page.svelte', T.homePage(projectName));

    // ── 13. Testing infrastructure ─────────────────────────
    this.info('Setting up testing...');
    write('vitest.config.ts', T.vitestConfig());
    write('playwright.config.ts', T.playwrightConfig());
    write('tests/unit/example.test.ts', T.exampleUnitTest());
    write('tests/feature/auth.test.ts', T.exampleFeatureTest());
    write('src/lib/factories/UserFactory.ts', T.scaffoldUserFactory());

    this.success(`Project structure created (${structureLabel})`);

    // ── 14. Install dependencies ──────────────────────────
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

      // ── 15. Install shadcn-svelte components ─────────────
      this.info('Installing shadcn-svelte components...');
      try {
        execSync('npx shadcn-svelte@latest add --all --yes', {
          cwd: projectDir,
          stdio: 'inherit',
        });
        this.success('shadcn-svelte components installed');
      } catch {
        this.warn('shadcn-svelte setup failed — run manually: cd ' + projectName + ' && npx shadcn-svelte@latest add --all');
      }

      // ── 16. Run migrations and seed ─────────────────────
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
      this.log('    npx shadcn-svelte@latest add --all');
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

// ── Path transformation helpers (DDD → flat) ──────────────

/**
 * Determines the flat category folder for a given file name.
 * E.g. "AuthService.ts" → "services", "User.ts" → "models"
 */
function fileCategory(name: string): string {
  if (/Service\./.test(name)) return 'services';
  if (/Controller\./.test(name)) return 'controllers';
  if (/Repository\./.test(name)) return 'repositories';
  if (/Request\./.test(name)) return 'dtos';
  if (/Resource\./.test(name)) return 'resources';
  if (/Action\./.test(name)) return 'actions';
  if (/Listener\./.test(name)) return 'listeners';
  if (/Notification\./.test(name)) return 'notifications';
  // Event classes typically contain past-tense verbs
  if (/Registered|Created|Updated|Deleted|Verified|Invited/.test(name)) return 'events';
  // Everything else is a model
  return 'models';
}

/**
 * Converts a DDD file output path to the flat equivalent.
 * E.g. "src/lib/modules/auth/User.ts" → "src/lib/models/User.ts"
 *      "src/lib/shared/jobs/X.ts"     → "src/lib/jobs/X.ts"
 */
function toFlatPath(dddPath: string): string {
  // Module files: src/lib/modules/{mod}/{File}.ts
  const moduleMatch = dddPath.match(/^src\/lib\/modules\/(\w+)\/(.+)$/);
  if (moduleMatch) {
    const [, mod, fileName] = moduleMatch;
    if (fileName === 'schemas.ts') return `src/lib/schemas/${mod}.ts`;
    if (fileName === 'gates.ts') return `src/lib/gates.ts`;
    return `src/lib/${fileCategory(fileName)}/${fileName}`;
  }

  // Shared files: src/lib/shared/{type}/{File}.ts → src/lib/{type}/{File}.ts
  const sharedMatch = dddPath.match(/^src\/lib\/shared\/(.+)$/);
  if (sharedMatch) return `src/lib/${sharedMatch[1]}`;

  return dddPath;
}

/**
 * Resolves a flat $lib/ import path for a given module + file name.
 */
function flatImport(mod: string, name: string, ext: string): string {
  if (name === 'schemas') return `$lib/schemas/${mod}${ext}`;
  if (name === 'gates') return `$lib/gates${ext}`;
  return `$lib/${fileCategoryByName(name)}/${name}${ext}`;
}

/**
 * Like fileCategory but works on the import name (no extension).
 */
function fileCategoryByName(name: string): string {
  if (/Service$/.test(name)) return 'services';
  if (/Controller$/.test(name)) return 'controllers';
  if (/Repository$/.test(name)) return 'repositories';
  if (/Request$/.test(name)) return 'dtos';
  if (/Resource$/.test(name)) return 'resources';
  if (/Action$/.test(name)) return 'actions';
  if (/Listener$/.test(name)) return 'listeners';
  if (/Notification$/.test(name)) return 'notifications';
  if (/Registered|Created|Updated|Deleted|Verified|Invited/.test(name)) return 'events';
  return 'models';
}

/**
 * Transforms all import paths in template content from DDD to flat.
 * Uses the DDD write path to determine the module context.
 */
function toFlatImports(content: string, dddPath: string): string {
  // Determine which module this file is in (empty for non-module files)
  const moduleMatch = dddPath.match(/modules\/(\w+)\//);
  const mod = moduleMatch?.[1] || '';

  // 1. Replace $lib/modules/{mod}/{Name}(.js)? with flat import paths
  content = content.replace(
    /\$lib\/modules\/(\w+)\/(\w+)(\.js)?/g,
    (_match, m: string, name: string, ext: string) => flatImport(m, name, ext || ''),
  );

  // 2. Replace ./lib/modules/{mod}/{Name}(.js)? (app.ts style, relative from project root)
  content = content.replace(
    /\.\/lib\/modules\/(\w+)\/(\w+)(\.js)?/g,
    (_match, m: string, name: string, ext: string) => {
      if (name === 'schemas') return `./lib/schemas/${m}${ext || ''}`;
      if (name === 'gates') return `./lib/gates${ext || ''}`;
      return `./lib/${fileCategoryByName(name)}/${name}${ext || ''}`;
    },
  );

  // 3. Replace $lib/shared/{type}/ with $lib/{type}/
  content = content.replace(/\$lib\/shared\//g, '$lib/');

  // 4. Replace ./lib/shared/ with ./lib/ (app.ts style)
  content = content.replace(/\.\/lib\/shared\//g, './lib/');

  // 5. Fix relative depth for shared files (shared/ removed = one fewer ../)
  //    ../../../ in shared/{type}/ → ../../ in {type}/
  if (dddPath.includes('shared/')) {
    content = content.replace(/'\.\.\/(\.\.\/\.\.\/)'/g, "'$1'");
    content = content.replace(/'\.\.\/\.\.\/\.\.\//g, "'../../");
  }

  // 6. Replace ./{Name}(.js)? relative imports within module files
  //    Only for files that are inside a module directory
  if (mod) {
    content = content.replace(
      /from '\.\/(\w+)(\.js)?'/g,
      (match, name: string, ext: string) => {
        // Don't transform SvelteKit $types or local non-module files
        if (name.startsWith('$') || name === 'app') return match;
        ext = ext || '';
        return `from '${flatImport(mod, name, ext)}'`;
      },
    );

    // Also handle standalone import './file.js' (no from keyword, e.g. side-effect imports)
    content = content.replace(
      /import '\.\/(\w+)(\.js)?'/g,
      (match, name: string, ext: string) => {
        if (name.startsWith('$') || name === 'app') return match;
        ext = ext || '';
        return `import '${flatImport(mod, name, ext)}'`;
      },
    );
  }

  return content;
}
