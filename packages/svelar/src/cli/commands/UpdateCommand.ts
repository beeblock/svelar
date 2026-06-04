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
  ownership: 'framework' | 'user';
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

/**
 * Interactive checkbox selector using raw terminal input.
 * Arrow keys to navigate, Space to toggle, A to toggle all, Enter to confirm.
 */
function checkbox(items: { label: string; hint?: string }[]): Promise<number[]> {
  return new Promise((resolve) => {
    const selected = new Set<number>();
    let cursor = 0;
    const stdin = process.stdin;
    const stdout = process.stdout;

    // Save cursor and hide it
    const hideCursor = '\x1b[?25l';
    const showCursor = '\x1b[?25h';

    function render() {
      // Move cursor up to overwrite previous render (except first render)
      if (renderCount > 0) {
        stdout.write(`\x1b[${items.length + 2}A`);
      }

      // Header
      stdout.write(`\x1b[2K  \x1b[36mSpace\x1b[0m toggle  \x1b[36mA\x1b[0m toggle all  \x1b[36m\u2191\u2193\x1b[0m navigate  \x1b[36mEnter\x1b[0m confirm\n`);

      for (let i = 0; i < items.length; i++) {
        const isCursor = i === cursor;
        const isSelected = selected.has(i);
        const check = isSelected ? '\x1b[32m\u25c9\x1b[0m' : '\x1b[90m\u25cb\x1b[0m';
        const pointer = isCursor ? '\x1b[36m\u276f\x1b[0m' : ' ';
        const label = isCursor ? `\x1b[1m${items[i].label}\x1b[0m` : items[i].label;
        const hint = items[i].hint ? `  \x1b[90m${items[i].hint}\x1b[0m` : '';
        stdout.write(`\x1b[2K  ${pointer} ${check} ${label}${hint}\n`);
      }

      // Footer
      const count = selected.size;
      stdout.write(`\x1b[2K  \x1b[90m${count} file${count !== 1 ? 's' : ''} selected\x1b[0m\n`);

      renderCount++;
    }

    let renderCount = 0;

    stdout.write(hideCursor);

    const wasRaw = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();

    render();

    function onData(key: Buffer) {
      const str = key.toString();

      // Enter — confirm
      if (str === '\r' || str === '\n') {
        cleanup();
        resolve([...selected].sort((a, b) => a - b));
        return;
      }

      // Ctrl+C — abort with empty selection
      if (str === '\x03') {
        cleanup();
        resolve([]);
        return;
      }

      // Escape — abort with empty selection
      if (str === '\x1b' && key.length === 1) {
        cleanup();
        resolve([]);
        return;
      }

      // Space — toggle current item
      if (str === ' ') {
        if (selected.has(cursor)) {
          selected.delete(cursor);
        } else {
          selected.add(cursor);
        }
        render();
        return;
      }

      // A / a — toggle all
      if (str === 'a' || str === 'A') {
        if (selected.size === items.length) {
          selected.clear();
        } else {
          for (let i = 0; i < items.length; i++) selected.add(i);
        }
        render();
        return;
      }

      // Arrow keys (escape sequences)
      if (str === '\x1b[A' || str === 'k') {
        // Up
        cursor = cursor > 0 ? cursor - 1 : items.length - 1;
        render();
        return;
      }

      if (str === '\x1b[B' || str === 'j') {
        // Down
        cursor = cursor < items.length - 1 ? cursor + 1 : 0;
        render();
        return;
      }
    }

    function cleanup() {
      stdin.removeListener('data', onData);
      stdin.setRawMode(wasRaw ?? false);
      stdin.pause();
      stdout.write(showCursor);
    }

    stdin.on('data', onData);
  });
}

export class UpdateCommand extends Command {
  name = 'update';
  description = 'Update scaffold files from the latest svelar templates without overwriting customizations';

  flags = [
    { name: 'force', alias: 'f', description: 'Overwrite all framework files without prompting', type: 'boolean' as const, default: false },
    { name: 'dry-run', alias: 'd', description: 'Show what would be updated without writing', type: 'boolean' as const, default: false },
    { name: 'category', alias: 'c', description: 'Only update a specific category (config, migration, route, page, domain, job, seeder)', type: 'string' as const, default: '' },
    { name: 'list', alias: 'l', description: 'List all updatable files and their status', type: 'boolean' as const, default: false },
    { name: 'include-user-files', alias: 'u', description: 'Include user-customizable files (app.ts, hooks, layouts, home page, etc.)', type: 'boolean' as const, default: false },
  ];

  async handle(_args: string[], flags: Record<string, any>): Promise<void> {
    const cwd = process.cwd();
    const force = flags.force ?? false;
    const dryRun = flags['dry-run'] ?? false;
    const categoryFilter = flags.category ?? '';
    const listOnly = flags.list ?? false;
    const includeUserFiles = flags['include-user-files'] ?? false;

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
    const allFiles = this.getFileManifest(isDDD, projectName);

    // Filter by category if specified
    const filtered = categoryFilter
      ? allFiles.filter(f => f.category === categoryFilter)
      : allFiles;

    if (filtered.length === 0) {
      this.warn(`No files found for category "${categoryFilter}". Valid categories: config, migration, route, page, domain, job, seeder`);
      return;
    }

    // Split into framework vs user files
    const frameworkFiles = filtered.filter(f => f.ownership === 'framework');
    const userFiles = filtered.filter(f => f.ownership === 'user');

    // Classify framework files
    const newFiles: ScaffoldFile[] = [];
    const changedFiles: ScaffoldFile[] = [];
    const unchangedFiles: ScaffoldFile[] = [];

    for (const file of frameworkFiles) {
      const fullPath = join(cwd, file.path);
      if (!existsSync(fullPath)) {
        newFiles.push(file);
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

    // Classify user files (only when --include-user-files)
    const userChanged: ScaffoldFile[] = [];
    const userNew: ScaffoldFile[] = [];
    const userUnchanged: ScaffoldFile[] = [];

    if (includeUserFiles) {
      for (const file of userFiles) {
        const fullPath = join(cwd, file.path);
        if (!existsSync(fullPath)) {
          userNew.push(file);
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
          userUnchanged.push(file);
        } else {
          userChanged.push(file);
        }
      }
    }

    // List mode
    if (listOnly) {
      this.printStatus(newFiles, changedFiles, unchangedFiles, 'Framework Files');
      if (includeUserFiles) {
        this.log('');
        this.printStatus(userNew, userChanged, userUnchanged, 'User-Customizable Files');
      } else {
        this.log('');
        this.log(`  \x1b[90m${userFiles.length} user-customizable files not shown. Use --include-user-files to include.\x1b[0m`);
      }
      return;
    }

    // Summary
    this.log(`  Framework files scanned: ${frameworkFiles.length}`);
    this.log(`  Up to date:             \x1b[32m${unchangedFiles.length}\x1b[0m`);
    this.log(`  Changed/outdated:       \x1b[33m${changedFiles.length}\x1b[0m`);
    this.log(`  Missing (new):          \x1b[36m${newFiles.length}\x1b[0m`);
    if (!includeUserFiles && userFiles.length > 0) {
      this.log(`  User files (excluded):  \x1b[90m${userFiles.length}\x1b[0m  \x1b[90m(use --include-user-files to include)\x1b[0m`);
    }
    this.log('');

    if (changedFiles.length === 0 && newFiles.length === 0 && userChanged.length === 0 && userNew.length === 0) {
      this.success('All scaffold files are up to date!');
      return;
    }

    // Handle missing files (new templates added in newer versions)
    if (newFiles.length > 0) {
      await this.handleNewFiles(newFiles, cwd, force, dryRun);
    }

    // Handle changed framework files
    if (changedFiles.length > 0) {
      await this.handleChangedFiles(changedFiles, cwd, force, dryRun, 'Framework');
    }

    // Handle user files (only when --include-user-files)
    if (includeUserFiles) {
      if (userNew.length > 0) {
        await this.handleNewFiles(userNew, cwd, force, dryRun);
      }
      if (userChanged.length > 0) {
        this.log('');
        this.warn('The following are user-customizable files. Updating them may overwrite your changes.');
        await this.handleChangedFiles(userChanged, cwd, false, dryRun, 'User');
      }
    }

    this.log('');
    this.success('Update complete.');
  }

  private async handleNewFiles(files: ScaffoldFile[], cwd: string, force: boolean, dryRun: boolean): Promise<void> {
    this.info(`New files available (${files.length}):`);
    for (const file of files) {
      this.log(`  \x1b[36m+\x1b[0m ${file.path}  \x1b[90m(${file.description})\x1b[0m`);
    }
    this.log('');

    if (dryRun) return;

    if (force) {
      for (const file of files) {
        this.writeFile(join(cwd, file.path), file.content());
        this.success(`Created ${file.path}`);
      }
      return;
    }

    // Interactive checkbox for new files
    this.log('  Select files to create:');
    this.log('');

    const indices = await checkbox(
      files.map(f => ({ label: f.path, hint: f.description }))
    );

    this.log('');

    if (indices.length === 0) {
      this.log('  Skipped new files.');
    } else {
      for (const idx of indices) {
        this.writeFile(join(cwd, files[idx].path), files[idx].content());
        this.success(`Created ${files[idx].path}`);
      }
    }
    this.log('');
  }

  private async handleChangedFiles(files: ScaffoldFile[], cwd: string, force: boolean, dryRun: boolean, label: string): Promise<void> {
    this.info(`${label} files with updates (${files.length}):`);
    for (const file of files) {
      this.log(`  \x1b[33m~\x1b[0m ${file.path}  \x1b[90m(${file.description})\x1b[0m`);
    }
    this.log('');

    if (dryRun) {
      this.info('Dry run — no files were modified.');
      return;
    }

    if (force) {
      for (const file of files) {
        this.backupAndWrite(join(cwd, file.path), file.content());
        this.success(`Updated ${file.path}`);
      }
      return;
    }

    // Ask if they want to see diffs first
    const wantDiff = await ask('  View diffs before selecting? [y/N] ');
    if (wantDiff === 'y' || wantDiff === 'yes') {
      for (const file of files) {
        this.log(`\n  \x1b[1m${file.path}\x1b[0m  \x1b[90m(${file.description})\x1b[0m`);
        this.showDiff(join(cwd, file.path), file.content());
      }
    }

    // Interactive checkbox
    this.log('  Select files to update (creates .bak backups):');
    this.log('');

    const indices = await checkbox(
      files.map(f => ({ label: f.path, hint: f.description }))
    );

    this.log('');

    if (indices.length === 0) {
      this.log('  No files updated.');
    } else {
      for (const idx of indices) {
        this.backupAndWrite(join(cwd, files[idx].path), files[idx].content());
        this.success(`Updated ${files[idx].path}  \x1b[90m(backup: ${files[idx].path}.bak)\x1b[0m`);
      }
    }
  }

  private backupAndWrite(fullPath: string, content: string): void {
    if (existsSync(fullPath)) {
      const existing = readFileSync(fullPath, 'utf-8');
      writeFileSync(fullPath + '.bak', existing);
    }
    this.writeFile(fullPath, content);
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

    this.log(`  \x1b[90m--- current\x1b[0m`);
    this.log(`  \x1b[90m+++ updated\x1b[0m`);

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

    const shown = diffLines.slice(0, 50);
    for (const line of shown) {
      this.log(line);
    }
    if (diffLines.length > 50) {
      this.log(`  \x1b[90m... and ${diffLines.length - 50} more lines\x1b[0m`);
    }
    this.log('');
  }

  private printStatus(missing: ScaffoldFile[], changed: ScaffoldFile[], unchanged: ScaffoldFile[], label: string): void {
    this.info(label);
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

    const add = (path: string, content: () => string, category: ScaffoldFile['category'], description: string, ownership: 'framework' | 'user' = 'framework') => {
      files.push({ path, content, category, description, ownership });
    };

    // ── Config ──
    // app.ts and hooks.server.ts are user-owned — users add their own bootstrap code
    add('src/app.ts', () => T.appTs(), 'config', 'Application bootstrap', 'user');
    add('src/hooks.server.ts', () => T.hooksServerTs(), 'config', 'SvelteKit hooks', 'user');
    add('vite.config.ts', () => T.viteConfig(), 'config', 'Vite configuration', 'user');
    add('.env.example', () => T.envExample(), 'config', 'Environment template');
    add('svelar.database.json', () => T.svelarDatabaseJson(), 'config', 'Database config');
    add('src/app.css', () => T.appCss(), 'config', 'Global styles');
    add('src/app.html', () => T.appHtml(), 'config', 'HTML shell');

    // ── Migrations ──
    for (const migration of T.svelarCoreMigrations()) {
      add(migration.path, () => migration.content, 'migration', migration.label);
    }
    add('src/lib/database/migrations/00000001_create_users_table.ts', () => T.createUsersTable(), 'migration', 'Users table');
    add('src/lib/database/migrations/00000002_create_posts_table.ts', () => T.createPostsTable(), 'migration', 'Posts table');
    add('src/lib/database/migrations/00000003_add_role_to_users.ts', () => T.addRoleToUsers(), 'migration', 'Role column on users');

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

    // ── Posts Domain — user-owned (example code users modify) ──
    const postsDir = isDDD ? 'src/lib/modules/posts' : 'src/lib';
    add(`${isDDD ? postsDir : `${postsDir}/models`}/Post.ts`, () => T.postModel(), 'domain', 'Post model', 'user');
    add(`${isDDD ? postsDir : `${postsDir}/repositories`}/PostRepository.ts`, () => T.postRepository(), 'domain', 'Post repository', 'user');
    add(`${isDDD ? postsDir : `${postsDir}/services`}/PostService.ts`, () => T.postService(), 'domain', 'Post service', 'user');
    add(`${isDDD ? postsDir : `${postsDir}/controllers`}/PostController.ts`, () => T.postController(), 'domain', 'Post controller', 'user');
    add(`${isDDD ? postsDir : `${postsDir}/actions`}/CreatePostAction.ts`, () => T.createPostAction(), 'domain', 'Create post action', 'user');

    // ── Seeder — user-owned ──
    add('src/lib/database/seeders/DatabaseSeeder.ts', () => T.databaseSeeder(), 'seeder', 'Database seeder', 'user');

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

    // ── Jobs — user-owned (users customize job logic) ──
    const jobDir = isDDD ? 'src/lib/shared/jobs' : 'src/lib/jobs';
    add(`${jobDir}/SendWelcomeEmail.ts`, () => T.sendWelcomeEmail(), 'job', 'Welcome email job', 'user');
    add(`${jobDir}/DailyDigestJob.ts`, () => T.dailyDigestJob(), 'job', 'Daily digest job', 'user');
    add(`${jobDir}/ExportDataJob.ts`, () => T.exportDataJob(), 'job', 'Export data job', 'user');

    // ── Scheduled Tasks — user-owned (users customize task logic) ──
    const taskDir = isDDD ? 'src/lib/shared/scheduler' : 'src/lib/scheduler';
    add(`${taskDir}/CleanupExpiredTokens.ts`, () => T.cleanupExpiredTokens(), 'job', 'Cleanup tokens task', 'user');
    add(`${taskDir}/CleanExpiredSessions.ts`, () => T.cleanExpiredSessions(), 'job', 'Clean sessions task', 'user');
    add(`${taskDir}/DailyDigestEmail.ts`, () => T.dailyDigestEmail(), 'job', 'Daily digest task', 'user');
    add(`${taskDir}/PruneAuditLogs.ts`, () => T.pruneAuditLogs(), 'job', 'Prune audit logs task', 'user');
    add(`${taskDir}/QueueHealthCheck.ts`, () => T.queueHealthCheck(), 'job', 'Queue health check task', 'user');

    // ── Root Layout — user-owned (users customize their app shell) ──
    add('src/routes/+layout.svelte', () => T.rootLayoutSvelte(projectName), 'page', 'Root layout', 'user');
    add('src/routes/+layout.server.ts', () => T.rootLayoutServer(), 'page', 'Root layout server', 'user');
    add('src/routes/+error.svelte', () => T.errorSvelte(), 'page', 'Error page', 'user');
    add('src/routes/+page.svelte', () => T.homePage(projectName), 'page', 'Home page', 'user');

    return files;
  }
}
