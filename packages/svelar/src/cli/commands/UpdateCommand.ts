import { Command } from '../Command.js';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createInterface } from 'node:readline';
import { NewCommandTemplates as T } from './NewCommandTemplates.js';

interface ScaffoldFile {
  path: string;
  content: () => string;
  category: 'config' | 'migration' | 'route' | 'page' | 'domain' | 'job' | 'seeder';
  description: string;
}

function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

export class UpdateCommand extends Command {
  name = 'update';
  description = 'Update scaffold files from the latest svelar templates without overwriting customizations';

  flags = [
    { name: 'force', alias: 'f', description: 'Overwrite all files without prompting', type: 'boolean' as const, default: false },
    { name: 'dry-run', alias: 'd', description: 'Show what would be updated without writing', type: 'boolean' as const, default: false },
    { name: 'category', alias: 'c', description: 'Only update a specific category (config, migration, route, page, domain, job, seeder)', type: 'string' as const, default: '' },
    { name: 'list', alias: 'l', description: 'List all updatable files and their status', type: 'boolean' as const, default: false },
  ];

  async handle(_args: string[], flags: Record<string, any>): Promise<void> {
    const cwd = process.cwd();
    const force = flags.force ?? false;
    const dryRun = flags['dry-run'] ?? false;
    const categoryFilter = flags.category ?? '';
    const listOnly = flags.list ?? false;

    // Detect project structure
    const isDDD = existsSync(join(cwd, 'src', 'lib', 'modules'));

    // Read project name from package.json
    let projectName = 'app';
    try {
      const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf-8'));
      projectName = pkg.name ?? 'app';
    } catch { /* ignore */ }

    this.log('');
    this.info(`Svelar Update — scanning project files...`);
    this.log('');

    // Build file manifest
    const files = this.getFileManifest(isDDD, projectName);

    // Filter by category if specified
    const filtered = categoryFilter
      ? files.filter(f => f.category === categoryFilter)
      : files;

    if (filtered.length === 0) {
      this.warn(`No files found for category "${categoryFilter}". Valid categories: config, migration, route, page, domain, job, seeder`);
      return;
    }

    // Classify files
    const newFiles: ScaffoldFile[] = [];
    const changedFiles: ScaffoldFile[] = [];
    const unchangedFiles: ScaffoldFile[] = [];
    const missingFiles: ScaffoldFile[] = [];

    for (const file of filtered) {
      const fullPath = join(cwd, file.path);
      if (!existsSync(fullPath)) {
        missingFiles.push(file);
        continue;
      }

      const existing = readFileSync(fullPath, 'utf-8');
      let template: string;
      try {
        template = file.content();
      } catch {
        continue;
      }

      if (this.normalize(existing) === this.normalize(template)) {
        unchangedFiles.push(file);
      } else {
        changedFiles.push(file);
      }
    }

    // List mode
    if (listOnly) {
      this.printStatus(missingFiles, changedFiles, unchangedFiles);
      return;
    }

    // Summary
    this.log(`  Files scanned:    ${filtered.length}`);
    this.log(`  Up to date:       \x1b[32m${unchangedFiles.length}\x1b[0m`);
    this.log(`  Changed/outdated: \x1b[33m${changedFiles.length}\x1b[0m`);
    this.log(`  Missing (new):    \x1b[36m${missingFiles.length}\x1b[0m`);
    this.log('');

    if (changedFiles.length === 0 && missingFiles.length === 0) {
      this.success('All scaffold files are up to date!');
      return;
    }

    // Handle missing files (new templates added in newer versions)
    if (missingFiles.length > 0) {
      this.info(`New files available (${missingFiles.length}):`);
      for (const file of missingFiles) {
        this.log(`  \x1b[36m+\x1b[0m ${file.path}  \x1b[90m(${file.description})\x1b[0m`);
      }
      this.log('');

      if (!dryRun) {
        const answer = force ? 'y' : await ask('  Create all new files? [Y/n/s(elect)] ');

        if (answer === 'y' || answer === 'yes' || answer === '') {
          for (const file of missingFiles) {
            this.writeFile(join(cwd, file.path), file.content());
            this.success(`Created ${file.path}`);
          }
        } else if (answer === 's' || answer === 'select') {
          for (const file of missingFiles) {
            const a = await ask(`  Create ${file.path}? [y/N] `);
            if (a === 'y' || a === 'yes') {
              this.writeFile(join(cwd, file.path), file.content());
              this.success(`Created ${file.path}`);
            } else {
              this.log(`  \x1b[90mSkipped ${file.path}\x1b[0m`);
            }
          }
        } else {
          this.log('  Skipped new files.');
        }
        this.log('');
      }
    }

    // Handle changed files
    if (changedFiles.length > 0) {
      this.info(`Changed files (${changedFiles.length}):`);
      for (const file of changedFiles) {
        this.log(`  \x1b[33m~\x1b[0m ${file.path}  \x1b[90m(${file.description})\x1b[0m`);
      }
      this.log('');

      if (dryRun) {
        this.info('Dry run — no files were modified.');
        return;
      }

      if (force) {
        for (const file of changedFiles) {
          this.writeFile(join(cwd, file.path), file.content());
          this.success(`Updated ${file.path}`);
        }
      } else {
        const answer = await ask('  Update changed files? [s(elect)/a(ll)/N] ');

        if (answer === 'a' || answer === 'all') {
          for (const file of changedFiles) {
            const fullPath = join(cwd, file.path);
            // Backup
            const backupPath = fullPath + '.bak';
            const existing = readFileSync(fullPath, 'utf-8');
            writeFileSync(backupPath, existing);
            this.writeFile(fullPath, file.content());
            this.success(`Updated ${file.path}  \x1b[90m(backup: ${file.path}.bak)\x1b[0m`);
          }
        } else if (answer === 's' || answer === 'select') {
          for (const file of changedFiles) {
            const a = await ask(`  Update ${file.path}? [y/N/d(iff)] `);
            if (a === 'd' || a === 'diff') {
              this.showDiff(join(cwd, file.path), file.content());
              const confirm = await ask(`  Apply this update? [y/N] `);
              if (confirm === 'y' || confirm === 'yes') {
                const existing = readFileSync(join(cwd, file.path), 'utf-8');
                writeFileSync(join(cwd, file.path) + '.bak', existing);
                this.writeFile(join(cwd, file.path), file.content());
                this.success(`Updated ${file.path}`);
              } else {
                this.log(`  \x1b[90mSkipped ${file.path}\x1b[0m`);
              }
            } else if (a === 'y' || a === 'yes') {
              const existing = readFileSync(join(cwd, file.path), 'utf-8');
              writeFileSync(join(cwd, file.path) + '.bak', existing);
              this.writeFile(join(cwd, file.path), file.content());
              this.success(`Updated ${file.path}  \x1b[90m(backup: ${file.path}.bak)\x1b[0m`);
            } else {
              this.log(`  \x1b[90mSkipped ${file.path}\x1b[0m`);
            }
          }
        } else {
          this.log('  No files updated.');
        }
      }
    }

    this.log('');
    this.success('Update complete.');
  }

  private normalize(content: string): string {
    return content.replace(/\r\n/g, '\n').trim();
  }

  private writeFile(fullPath: string, content: string): void {
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, content);
  }

  private showDiff(filePath: string, newContent: string): void {
    const existing = readFileSync(filePath, 'utf-8').split('\n');
    const updated = newContent.split('\n');

    this.log('');
    this.log(`  \x1b[90m--- ${filePath} (current)\x1b[0m`);
    this.log(`  \x1b[90m+++ ${filePath} (updated)\x1b[0m`);

    const maxLines = Math.max(existing.length, updated.length);
    let contextBefore = 0;
    const diffLines: string[] = [];

    for (let i = 0; i < maxLines; i++) {
      const oldLine = existing[i] ?? '';
      const newLine = updated[i] ?? '';

      if (oldLine !== newLine) {
        if (existing[i] !== undefined) {
          diffLines.push(`  \x1b[31m- ${oldLine}\x1b[0m`);
        }
        if (updated[i] !== undefined) {
          diffLines.push(`  \x1b[32m+ ${newLine}\x1b[0m`);
        }
        contextBefore = 0;
      } else {
        if (contextBefore < 2 && diffLines.length > 0) {
          diffLines.push(`  \x1b[90m  ${oldLine}\x1b[0m`);
        }
        contextBefore++;
      }
    }

    // Show at most 40 diff lines to avoid flooding
    const shown = diffLines.slice(0, 40);
    for (const line of shown) {
      this.log(line);
    }
    if (diffLines.length > 40) {
      this.log(`  \x1b[90m... and ${diffLines.length - 40} more lines\x1b[0m`);
    }
    this.log('');
  }

  private printStatus(missing: ScaffoldFile[], changed: ScaffoldFile[], unchanged: ScaffoldFile[]): void {
    const rows: string[][] = [];

    for (const f of missing) {
      rows.push(['\x1b[36mNEW\x1b[0m', f.path, f.category, f.description]);
    }
    for (const f of changed) {
      rows.push(['\x1b[33mCHANGED\x1b[0m', f.path, f.category, f.description]);
    }
    for (const f of unchanged) {
      rows.push(['\x1b[32mOK\x1b[0m', f.path, f.category, f.description]);
    }

    this.table(['Status', 'File', 'Category', 'Description'], rows);
  }

  private getFileManifest(isDDD: boolean, projectName: string): ScaffoldFile[] {
    const files: ScaffoldFile[] = [];

    // Helper to add entries
    const add = (path: string, content: () => string, category: ScaffoldFile['category'], description: string) => {
      files.push({ path, content, category, description });
    };

    // ── Config ──
    add('src/app.ts', () => T.appTs(), 'config', 'Application bootstrap');
    add('src/hooks.server.ts', () => T.hooksServerTs(), 'config', 'SvelteKit hooks');
    add('vite.config.ts', () => T.viteConfig(), 'config', 'Vite configuration');
    add('.env.example', () => T.envExample(), 'config', 'Environment template');
    add('svelar.database.json', () => T.svelarDatabaseJson(), 'config', 'Database config');
    add('src/app.css', () => T.appCss(), 'config', 'Global styles');
    add('src/app.html', () => T.appHtml(), 'config', 'HTML shell');

    // ── Migrations ──
    add('src/lib/database/migrations/00000001_create_users_table.ts', () => T.createUsersTable(), 'migration', 'Users table');
    add('src/lib/database/migrations/00000002_create_posts_table.ts', () => T.createPostsTable(), 'migration', 'Posts table');
    add('src/lib/database/migrations/00000003_create_permissions_tables.ts', () => T.createPermissionsTables(), 'migration', 'Permissions tables');
    add('src/lib/database/migrations/00000004_add_role_to_users.ts', () => T.addRoleToUsers(), 'migration', 'Role column on users');
    add('src/lib/database/migrations/00000005_create_sessions_table.ts', () => T.createSessionsTable(), 'migration', 'Sessions table');
    add('src/lib/database/migrations/00000006_create_audit_logs_table.ts', () => T.createAuditLogsTable(), 'migration', 'Audit logs table');
    add('src/lib/database/migrations/00000007_create_notifications_table.ts', () => T.createNotificationsTable(), 'migration', 'Notifications table');
    add('src/lib/database/migrations/00000008_create_failed_jobs_table.ts', () => T.createFailedJobsTable(), 'migration', 'Failed jobs table');
    add('src/lib/database/migrations/00000009_add_stripe_to_users.ts', () => T.addStripeToUsers(), 'migration', 'Stripe customer ID on users');
    add('src/lib/database/migrations/00000010_create_subscription_plans.ts', () => T.createSubscriptionPlansTable(), 'migration', 'Subscription plans table');
    add('src/lib/database/migrations/00000011_create_subscriptions.ts', () => T.createSubscriptionsTable(), 'migration', 'Subscriptions table');
    add('src/lib/database/migrations/00000012_create_invoices.ts', () => T.createInvoicesTable(), 'migration', 'Invoices table');

    // ── Auth Domain ──
    const authDir = isDDD ? 'src/lib/modules/auth' : 'src/lib';
    const authModel = isDDD ? `${authDir}/User.ts` : `${authDir}/models/User.ts`;
    const authRepo = isDDD ? `${authDir}/UserRepository.ts` : `${authDir}/repositories/UserRepository.ts`;
    const authService = isDDD ? `${authDir}/AuthService.ts` : `${authDir}/services/AuthService.ts`;
    const authController = isDDD ? `${authDir}/AuthController.ts` : `${authDir}/controllers/AuthController.ts`;
    const authAction = isDDD ? `${authDir}/RegisterUserAction.ts` : `${authDir}/actions/RegisterUserAction.ts`;

    add(authModel, () => T.userModel(), 'domain', 'User model');
    add(authRepo, () => T.userRepository(), 'domain', 'User repository');
    add(authService, () => T.authService(), 'domain', 'Auth service');
    add(authController, () => T.authController(), 'domain', 'Auth controller');
    add(authAction, () => T.registerUserAction(), 'domain', 'Register user action');

    // Auth DTOs
    const dtoDir = isDDD ? authDir : `${authDir}/dtos`;
    add(`${isDDD ? authDir : dtoDir}/RegisterRequest.ts`, () => T.registerRequest(), 'domain', 'Register DTO');
    add(`${isDDD ? authDir : dtoDir}/LoginRequest.ts`, () => T.loginRequest(), 'domain', 'Login DTO');
    add(`${isDDD ? authDir : dtoDir}/ForgotPasswordRequest.ts`, () => T.forgotPasswordRequest(), 'domain', 'Forgot password DTO');
    add(`${isDDD ? authDir : dtoDir}/ResetPasswordRequest.ts`, () => T.resetPasswordRequest(), 'domain', 'Reset password DTO');
    add(`${isDDD ? authDir : dtoDir}/OtpSendRequest.ts`, () => T.otpSendRequest(), 'domain', 'OTP send DTO');
    add(`${isDDD ? authDir : dtoDir}/OtpVerifyRequest.ts`, () => T.otpVerifyRequest(), 'domain', 'OTP verify DTO');

    // Auth resource, gates, schemas
    add(`${isDDD ? authDir : `${authDir}/resources`}/UserResource.ts`, () => T.userResource(), 'domain', 'User resource');
    add(`${isDDD ? authDir : `${authDir}/schemas`}/gates.ts`, () => T.gates(), 'domain', 'Authorization gates');
    add(`${isDDD ? authDir + '/schemas' : `${authDir}/schemas`}.ts`, () => T.authSchema(), 'domain', 'Auth Zod schemas');

    // ── Posts Domain ──
    const postsDir = isDDD ? 'src/lib/modules/posts' : 'src/lib';
    add(`${isDDD ? postsDir : `${postsDir}/models`}/Post.ts`, () => T.postModel(), 'domain', 'Post model');
    add(`${isDDD ? postsDir : `${postsDir}/repositories`}/PostRepository.ts`, () => T.postRepository(), 'domain', 'Post repository');
    add(`${isDDD ? postsDir : `${postsDir}/services`}/PostService.ts`, () => T.postService(), 'domain', 'Post service');
    add(`${isDDD ? postsDir : `${postsDir}/controllers`}/PostController.ts`, () => T.postController(), 'domain', 'Post controller');
    add(`${isDDD ? postsDir : `${postsDir}/actions`}/CreatePostAction.ts`, () => T.createPostAction(), 'domain', 'Create post action');

    // ── Seeder ──
    add('src/lib/database/seeders/DatabaseSeeder.ts', () => T.databaseSeeder(), 'seeder', 'Database seeder');

    // ── Auth Pages ──
    add('src/routes/login/+page.server.ts', () => T.loginPageServer(), 'page', 'Login server');
    add('src/routes/login/+page.svelte', () => T.loginPageSvelte(), 'page', 'Login page');
    add('src/routes/register/+page.server.ts', () => T.registerPageServer(), 'page', 'Register server');
    add('src/routes/register/+page.svelte', () => T.registerPageSvelte(), 'page', 'Register page');
    add('src/routes/logout/+page.server.ts', () => T.logoutPageServer(), 'page', 'Logout handler');
    add('src/routes/forgot-password/+page.server.ts', () => T.forgotPasswordPageServer(), 'page', 'Forgot password server');
    add('src/routes/forgot-password/+page.svelte', () => T.forgotPasswordPageSvelte(), 'page', 'Forgot password page');
    add('src/routes/reset-password/+page.server.ts', () => T.resetPasswordPageServer(), 'page', 'Reset password server');
    add('src/routes/reset-password/+page.svelte', () => T.resetPasswordPageSvelte(), 'page', 'Reset password page');
    add('src/routes/otp-login/+page.server.ts', () => T.otpLoginPageServer(), 'page', 'OTP login server');
    add('src/routes/otp-login/+page.svelte', () => T.otpLoginPageSvelte(), 'page', 'OTP login page');
    add('src/routes/verify-email/+page.server.ts', () => T.verifyEmailPageServer(), 'page', 'Verify email server');
    add('src/routes/verify-email/+page.svelte', () => T.verifyEmailPageSvelte(), 'page', 'Verify email page');

    // ── Dashboard Pages ──
    add('src/routes/dashboard/+layout.server.ts', () => T.dashboardLayoutServer(), 'page', 'Dashboard auth guard');
    add('src/routes/dashboard/+layout.svelte', () => T.dashboardLayoutSvelte(), 'page', 'Dashboard layout');
    add('src/routes/dashboard/+page.server.ts', () => T.dashboardPageServer(), 'page', 'Dashboard server');
    add('src/routes/dashboard/+page.svelte', () => T.dashboardPageSvelte(), 'page', 'Dashboard overview');
    add('src/routes/dashboard/api-keys/+page.server.ts', () => T.apiKeysPageServer(), 'page', 'API keys server');
    add('src/routes/dashboard/api-keys/+page.svelte', () => T.apiKeysPageSvelte(), 'page', 'API keys page');
    add('src/routes/dashboard/team/+page.server.ts', () => T.teamPageServer(), 'page', 'Team server');
    add('src/routes/dashboard/team/+page.svelte', () => T.teamPageSvelte(), 'page', 'Team page');
    add('src/routes/dashboard/billing/+page.server.ts', () => T.billingPageServer(), 'page', 'Billing server');
    add('src/routes/dashboard/billing/+page.svelte', () => T.billingPageSvelte(), 'page', 'Billing page');

    // ── Admin Pages ──
    add('src/routes/admin/+layout.server.ts', () => T.adminLayoutServer(), 'page', 'Admin auth guard');
    add('src/routes/admin/+layout.svelte', () => T.adminLayoutSvelte(), 'page', 'Admin layout');
    add('src/routes/admin/+page.server.ts', () => T.adminPageServer(), 'page', 'Admin server');
    add('src/routes/admin/+page.svelte', () => T.adminPageSvelte(), 'page', 'Admin dashboard');

    // ── API Routes ──
    add('src/routes/api/health/+server.ts', () => T.apiHealth(), 'route', 'Health check');
    add('src/routes/api/auth/register/+server.ts', () => T.apiAuthRegister(), 'route', 'Auth register API');
    add('src/routes/api/auth/login/+server.ts', () => T.apiAuthLogin(), 'route', 'Auth login API');
    add('src/routes/api/auth/logout/+server.ts', () => T.apiAuthLogout(), 'route', 'Auth logout API');
    add('src/routes/api/auth/me/+server.ts', () => T.apiAuthMe(), 'route', 'Auth me API');
    add('src/routes/api/auth/forgot-password/+server.ts', () => T.apiAuthForgotPassword(), 'route', 'Forgot password API');
    add('src/routes/api/auth/reset-password/+server.ts', () => T.apiAuthResetPassword(), 'route', 'Reset password API');
    add('src/routes/api/auth/otp/send/+server.ts', () => T.apiAuthOtpSend(), 'route', 'OTP send API');
    add('src/routes/api/auth/otp/verify/+server.ts', () => T.apiAuthOtpVerify(), 'route', 'OTP verify API');
    add('src/routes/api/auth/verify-email/+server.ts', () => T.apiAuthVerifyEmail(), 'route', 'Verify email API');
    add('src/routes/api/posts/+server.ts', () => T.apiPosts(), 'route', 'Posts list/create API');
    add('src/routes/api/posts/[id]/+server.ts', () => T.apiPostsSingle(), 'route', 'Post CRUD API');
    add('src/routes/api/posts/mine/+server.ts', () => T.apiPostsMine(), 'route', 'My posts API');
    add('src/routes/api/broadcasting/[channel]/+server.ts', () => T.apiBroadcasting(), 'route', 'SSE broadcasting');
    add('src/routes/api/internal/broadcast/+server.ts', () => T.apiInternalBroadcast(), 'route', 'Internal broadcast bridge');
    add('src/routes/api/admin/users/+server.ts', () => T.apiAdminUsers(), 'route', 'Admin users API');
    add('src/routes/api/admin/roles/+server.ts', () => T.apiAdminRoles(), 'route', 'Admin roles API');
    add('src/routes/api/admin/permissions/+server.ts', () => T.apiAdminPermissions(), 'route', 'Admin permissions API');
    add('src/routes/api/admin/role-permissions/+server.ts', () => T.apiAdminRolePermissions(), 'route', 'Role-permissions API');
    add('src/routes/api/admin/user-roles/+server.ts', () => T.apiAdminUserRoles(), 'route', 'User-roles API');
    add('src/routes/api/admin/user-permissions/+server.ts', () => T.apiAdminUserPermissions(), 'route', 'User-permissions API');
    add('src/routes/api/admin/export/+server.ts', () => T.apiAdminExport(), 'route', 'Admin data export');
    add('src/routes/api/admin/health/+server.ts', () => T.apiAdminHealth(), 'route', 'Admin health API');
    add('src/routes/api/admin/queue/+server.ts', () => T.apiAdminQueue(), 'route', 'Admin queue API');
    add('src/routes/api/admin/queue/[id]/retry/+server.ts', () => T.apiAdminQueueRetry(), 'route', 'Queue retry API');
    add('src/routes/api/admin/queue/[id]/+server.ts', () => T.apiAdminQueueDelete(), 'route', 'Queue job API');
    add('src/routes/api/admin/scheduler/+server.ts', () => T.apiAdminScheduler(), 'route', 'Admin scheduler API');
    add('src/routes/api/admin/scheduler/[name]/run/+server.ts', () => T.apiAdminSchedulerRun(), 'route', 'Run task API');
    add('src/routes/api/admin/scheduler/[name]/toggle/+server.ts', () => T.apiAdminSchedulerToggle(), 'route', 'Toggle task API');
    add('src/routes/api/admin/logs/+server.ts', () => T.apiAdminLogs(), 'route', 'Admin logs API');
    add('src/routes/api/admin/stats/+server.ts', () => T.apiAdminStats(), 'route', 'Admin stats API');
    add('src/routes/api/admin/billing/subscriptions/+server.ts', () => T.apiAdminBillingSubscriptions(), 'route', 'Admin billing subscriptions');
    add('src/routes/api/admin/billing/refund/+server.ts', () => T.apiAdminBillingRefund(), 'route', 'Admin billing refund');
    add('src/routes/api/admin/billing/cancel/+server.ts', () => T.apiAdminBillingCancel(), 'route', 'Admin billing cancel');
    add('src/routes/api/webhooks/stripe/+server.ts', () => T.stripeWebhookRoute(), 'route', 'Stripe webhook');

    // ── Jobs ──
    const jobDir = isDDD ? 'src/lib/shared/jobs' : 'src/lib/jobs';
    add(`${jobDir}/SendWelcomeEmail.ts`, () => T.sendWelcomeEmail(), 'job', 'Welcome email job');
    add(`${jobDir}/DailyDigestJob.ts`, () => T.dailyDigestJob(), 'job', 'Daily digest job');
    add(`${jobDir}/ExportDataJob.ts`, () => T.exportDataJob(), 'job', 'Export data job');

    // ── Scheduled Tasks ──
    const taskDir = isDDD ? 'src/lib/shared/scheduler' : 'src/lib/scheduler';
    add(`${taskDir}/CleanupExpiredTokens.ts`, () => T.cleanupExpiredTokens(), 'job', 'Cleanup tokens task');
    add(`${taskDir}/CleanExpiredSessions.ts`, () => T.cleanExpiredSessions(), 'job', 'Clean sessions task');
    add(`${taskDir}/DailyDigestEmail.ts`, () => T.dailyDigestEmail(), 'job', 'Daily digest task');
    add(`${taskDir}/PruneAuditLogs.ts`, () => T.pruneAuditLogs(), 'job', 'Prune audit logs task');
    add(`${taskDir}/QueueHealthCheck.ts`, () => T.queueHealthCheck(), 'job', 'Queue health check task');

    // ── Root Layout ──
    add('src/routes/+layout.svelte', () => T.rootLayoutSvelte(projectName), 'page', 'Root layout');
    add('src/routes/+layout.server.ts', () => T.rootLayoutServer(), 'page', 'Root layout server');
    add('src/routes/+error.svelte', () => T.errorSvelte(), 'page', 'Error page');
    add('src/routes/+page.svelte', () => T.homePage(projectName), 'page', 'Home page');

    return files;
  }
}
