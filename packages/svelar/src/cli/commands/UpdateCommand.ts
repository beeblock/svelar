import { Command } from '../Command.js';
import { existsSync, lstatSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createInterface } from 'node:readline';
import { NewCommandTemplates as T } from './NewCommandTemplates.js';
import { transformScaffoldFile } from './NewCommand.js';
import { MakeDashboardCommand } from './MakeDashboardCommand.js';
import { applyZod4Migration, planZod4Migration } from '../Zod4Migration.js';
import { applyCoreScaffoldMigration, planCoreScaffoldMigration } from '../CoreScaffoldMigration.js';

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
    { name: 'add-missing-user-files', description: 'Add only missing user-owned files from the manifest; never overwrite (requires --force)', type: 'boolean' as const, default: false },
    { name: 'migrate-zod4', description: 'Opt in to backed-up Zod 4 adapter/dependency migration (requires confirmation or --force)', type: 'boolean' as const, default: false },
    { name: 'migrate-core', description: 'Opt in to narrowly backed-up 0.7.9 scaffold API migration (requires confirmation or --force)', type: 'boolean' as const, default: false },
  ];

  async handle(_args: string[], flags: Record<string, any>): Promise<void> {
    const cwd = process.cwd();
    const force = flags.force ?? false;
    const dryRun = flags['dry-run'] ?? false;
    const categoryFilter = flags.category ?? '';
    const listOnly = flags.list ?? false;
    const includeUserFiles = flags['include-user-files'] ?? false;
    const addMissingUserFiles = flags['add-missing-user-files'] ?? false;

    if (flags['migrate-core']) {
      if (addMissingUserFiles || includeUserFiles || flags['migrate-zod4'] || categoryFilter) {
        this.error('--migrate-core is a separate migration. Do not combine it with other update modes or --category.');
        return;
      }
      await this.migrateCore(cwd, Boolean(force), Boolean(dryRun || listOnly));
      return;
    }

    if (addMissingUserFiles && (includeUserFiles || flags['migrate-zod4'])) {
      this.error('--add-missing-user-files is a separate missing-only mode. Do not combine it with --include-user-files or --migrate-zod4.');
      return;
    }

    if (flags['migrate-zod4']) {
      await this.migrateZod4(cwd, Boolean(force), Boolean(dryRun || listOnly));
      return;
    }

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

    if (addMissingUserFiles) {
      this.addMissingUserFiles(userFiles, cwd, Boolean(force), Boolean(dryRun || listOnly));
      return;
    }

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

    if (!dryRun && !process.stdin.isTTY && (!force || userChanged.length > 0 || userNew.length > 0)) {
      throw new Error('Interactive scaffold updates require a terminal. Use --dry-run to inspect or --force to update framework-owned files.');
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

  private addMissingUserFiles(files: ScaffoldFile[], cwd: string, force: boolean, dryRun: boolean): void {
    const missing = files.filter((file) => !lstatSync(join(cwd, file.path), { throwIfNoEntry: false }));
    this.info(`Missing-only user-file update: ${missing.length} file(s); existing files and framework files are excluded.`);
    for (const file of missing) this.log(`  ${file.path}: ${file.description}`);
    if (dryRun || !missing.length) return;
    if (!force) {
      this.error('Review --add-missing-user-files --dry-run, then use --add-missing-user-files --force to approve additions. No files written.');
      return;
    }

    // Preflight parents and render every selected template before adding files.
    const additions = missing.map((file) => {
      let parent = dirname(join(cwd, file.path));
      while (parent !== cwd) {
        const stat = lstatSync(parent, { throwIfNoEntry: false });
        if (stat && (!stat.isDirectory() || stat.isSymbolicLink())) {
          throw new Error(`Cannot safely add ${file.path}: parent is not an app-owned directory (${parent}).`);
        }
        parent = dirname(parent);
      }
      return { ...file, rendered: file.content() };
    });
    for (const file of additions) {
      const path = join(cwd, file.path);
      mkdirSync(dirname(path), { recursive: true });
      try {
        writeFileSync(path, file.rendered, { flag: 'wx' });
        this.success(`Added ${file.path}`);
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'EEXIST') {
          this.warn(`Preserved ${file.path}: it appeared after preflight.`);
          continue;
        }
        throw error;
      }
    }
  }

  private async migrateCore(cwd: string, force: boolean, dryRun: boolean): Promise<void> {
    const plan = await planCoreScaffoldMigration(cwd);
    this.info('Core scaffold API migration preflight; no templates, packages or schemas are replaced.');
    for (const edit of plan.edits) {
      this.log(`  ${edit.path}: ${[...new Set(edit.tokens.map((token) => token.rule))].join(', ')}`);
      for (const token of edit.tokens) this.log(`    [${token.start}, ${token.end}) ${token.rule}: ${JSON.stringify(token.replacement)}`);
    }
    for (const warning of plan.warnings) this.warn(warning);
    if (plan.errors.length) {
      for (const error of plan.errors) this.error(error);
      this.error('Core migration blocked before writes; review the reported customized patterns.');
      return;
    }
    if (dryRun) {
      this.info(`Dry run: ${plan.edits.length} file(s); no source or backups written.`);
      return;
    }
    if (!plan.edits.length) {
      this.info('No recognized legacy core patterns require migration. This is not a compatibility certification.');
      return;
    }
    if (!force) {
      if (!process.stdin.isTTY) {
        this.error('Core migration requires an interactive confirmation or explicit --migrate-core --force after reviewing --dry-run.');
        return;
      }
      const answer = await ask(`Apply ${plan.edits.length} reviewed core API/authorization/outcome edits with exact-original backups? [y/N] `);
      if (answer !== 'y' && answer !== 'yes') {
        this.info('Core migration cancelled; no files written.');
        return;
      }
    }
    try {
      for (const backup of applyCoreScaffoldMigration(plan, { confirmed: true })) this.log(`  Backup: ${backup}`);
      this.success('Core token migration applied. Run app type-checks, tests, browser login and reviewed admin-operation checks; compatibility is not implied.');
    } catch (error) { this.error(error instanceof Error ? error.message : String(error)); }
  }

  private async migrateZod4(cwd: string, force: boolean, dryRun: boolean): Promise<void> {
    const plan = await planZod4Migration(cwd);
    this.info('Zod 4 migration preflight (no scaffold templates will be applied)');
    if (plan.skipped) {
      this.info(plan.skipped);
      return;
    }
    for (const edit of plan.edits) this.log(`  ${edit.path}: ${edit.reasons.join('; ')}`);
    for (const warning of plan.warnings) this.warn(warning);
    if (plan.errors.length) {
      for (const error of plan.errors) this.error(error);
      this.error('Migration blocked before writes. Resolve the reported patterns and rerun --migrate-zod4 --dry-run.');
      return;
    }
    if (dryRun) {
      this.info(`Dry run: ${plan.edits.length} file(s) would change; no files or backups written.`);
      return;
    }
    if (!plan.edits.length) {
      this.success('Zod 4 adapter imports and selected dependencies are already aligned.');
      return;
    }
    if (!force) {
      if (!process.stdin.isTTY) {
        this.error('Migration requires explicit approval. Review --migrate-zod4 --dry-run, then rerun with --migrate-zod4 --force or use an interactive terminal.');
        return;
      }
      const answer = await ask(`Apply Zod 4 migration to ${plan.edits.length} file(s), with exact-original backups? [y/N] `);
      if (answer !== 'y' && answer !== 'yes') {
        this.info('Migration cancelled; no files written.');
        return;
      }
    }
    try {
      const backups = applyZod4Migration(plan, { confirmed: true });
      for (const backup of backups) this.log(`  Backup: ${backup}`);
      this.success(`Migrated ${plan.edits.length} file(s). Run npm install, npm run check and your application tests before release.`);
    } catch (error) {
      this.error(error instanceof Error ? error.message : String(error));
    }
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
    const validation = this.validationProvider();

    const add = (path: string, content: () => string, category: ScaffoldFile['category'], description: string, ownership: 'framework' | 'user' = 'framework') => {
      const transformedPath = transformScaffoldFile(path, '', !isDDD).path;
      files.push({
        path: transformedPath,
        content: () => transformScaffoldFile(path, T.applyValidationProvider(content(), validation), !isDDD).content,
        category,
        description,
        ownership: ['domain', 'page', 'route'].includes(category) ? 'user' : ownership,
      });
    };

    // ── Config ──
    // app.ts and hooks.server.ts are user-owned — users add their own bootstrap code
    add('src/app.ts', () => T.appTs(), 'config', 'Application bootstrap', 'user');
    add('src/svelar.d.ts', () => T.appDts(), 'config', 'Application locals types', 'user');
    add('src/hooks.server.ts', () => T.hooksServerTs(), 'config', 'SvelteKit hooks', 'user');
    add('vite.config.ts', () => T.viteConfig(), 'config', 'Vite configuration', 'user');
    add('.env.example', () => T.envExample(), 'config', 'Environment template');
    add('svelar.database.json', () => T.svelarDatabaseJson(), 'config', 'Database config');
    add('svelar.validation.json', () => T.validationConfig(validation), 'config', 'Validation provider config');
    add('src/app.css', () => T.appCss(), 'config', 'Global styles', 'user');
    add('src/app.html', () => T.appHtml(), 'config', 'HTML shell', 'user');
    add('scripts/svelar-dev-runtime.mjs', () => T.svelarDevRuntimeScript(), 'config', 'Development worker/scheduler runtime');
    add('AGENTS.md', () => T.agentsMd(), 'config', 'Codex project guidance', 'user');
    add('CLAUDE.md', () => T.claudeMd(), 'config', 'Claude project guidance', 'user');
    add('.codex/skills/svelar-specialist/SKILL.md', () => T.codexSvelarSkill(), 'config', 'Codex Svelar skill', 'user');
    add('.claude/skills/svelar-specialist/SKILL.md', () => T.claudeSvelarSkill(), 'config', 'Claude Svelar skill', 'user');

    // ── Migrations ──
    for (const migration of T.svelarCoreMigrations()) {
      add(migration.path, () => migration.content, 'migration', migration.label);
    }
    add('src/lib/database/migrations/00000001_create_users_table.ts', () => T.createUsersTable(), 'migration', 'Users table', 'user');
    add('src/lib/database/migrations/00000002_create_posts_table.ts', () => T.createPostsTable(), 'migration', 'Posts table', 'user');
    add('src/lib/database/migrations/00000003_add_role_to_users.ts', () => T.addRoleToUsers(), 'migration', 'Role column on users', 'user');

    // ── Auth Domain ──
    const authDir = 'src/lib/modules/auth';
    const authModel = `${authDir}/User.ts`;
    const authRepo = `${authDir}/UserRepository.ts`;
    const authService = `${authDir}/AuthService.ts`;
    const authController = `${authDir}/AuthController.ts`;
    const authAction = `${authDir}/RegisterUserAction.ts`;

    add(authModel, () => T.userModel(), 'domain', 'User model');
    add(authRepo, () => T.userRepository(), 'domain', 'User repository');
    add(authService, () => T.authService(), 'domain', 'Auth service');
    add(authController, () => T.authController(), 'domain', 'Auth controller');
    add(authAction, () => T.registerUserAction(), 'domain', 'Register user action');

    // Auth DTOs
    add(`${authDir}/RegisterRequest.ts`, () => T.registerRequest(), 'domain', 'Register request');
    add(`${authDir}/LoginRequest.ts`, () => T.loginRequest(), 'domain', 'Login request');
    add(`${authDir}/ForgotPasswordRequest.ts`, () => T.forgotPasswordRequest(), 'domain', 'Forgot password request');
    add(`${authDir}/ResetPasswordRequest.ts`, () => T.resetPasswordRequest(), 'domain', 'Reset password request');
    add(`${authDir}/OtpSendRequest.ts`, () => T.otpSendRequest(), 'domain', 'OTP send request');
    add(`${authDir}/OtpVerifyRequest.ts`, () => T.otpVerifyRequest(), 'domain', 'OTP verify request');

    // Auth resource, gates, schemas
    add(`${authDir}/UserResource.ts`, () => T.userResource(), 'domain', 'User resource');
    add(`${authDir}/gates.ts`, () => T.gates(), 'domain', 'Authorization gates');
    add(`${authDir}/schemas.ts`, () => T.authSchema(validation), 'domain', 'Auth validation schemas');
    add(`${authDir}/UserRegistered.ts`, () => T.userRegisteredEvent(), 'domain', 'User registered event');
    add(`${authDir}/SendWelcomeEmailListener.ts`, () => T.sendWelcomeEmailListener(), 'domain', 'Welcome email listener');
    add(`${authDir}/WelcomeNotification.ts`, () => T.welcomeNotification(), 'domain', 'Welcome notification');

    // ── Posts Domain — user-owned (example code users modify) ──
    const postsDir = 'src/lib/modules/posts';
    add(`${postsDir}/Post.ts`, () => T.postModel(), 'domain', 'Post model', 'user');
    add(`${postsDir}/PostRepository.ts`, () => T.postRepository(), 'domain', 'Post repository', 'user');
    add(`${postsDir}/PostService.ts`, () => T.postService(), 'domain', 'Post service', 'user');
    add(`${postsDir}/PostController.ts`, () => T.postController(), 'domain', 'Post controller', 'user');
    add(`${postsDir}/CreatePostAction.ts`, () => T.createPostAction(), 'domain', 'Create post action', 'user');
    add(`${postsDir}/CreatePostRequest.ts`, () => T.createPostRequest(), 'domain', 'Create post request', 'user');
    add(`${postsDir}/UpdatePostRequest.ts`, () => T.updatePostRequest(), 'domain', 'Update post request', 'user');
    add(`${postsDir}/PostResource.ts`, () => T.postResource(), 'domain', 'Post resource', 'user');
    add(`${postsDir}/schemas.ts`, () => T.postSchema(validation), 'domain', 'Post schemas', 'user');

    const adminDir = 'src/lib/modules/admin';
    const adminFiles: Array<[string, () => string]> = [
      ['AdminService', () => T.adminService()], ['AdminController', () => T.adminController()],
      ['AdminDtos', () => T.adminDtos()], ['AdminActions', () => T.adminActions()],
      ['UpdateUserRoleRequest', () => T.updateUserRoleRequest()], ['DeleteUserRequest', () => T.deleteUserRequest()],
      ['CreateRoleRequest', () => T.createRoleRequest()], ['DeleteRoleRequest', () => T.deleteRoleRequest()],
      ['CreatePermissionRequest', () => T.createPermissionRequest()], ['DeletePermissionRequest', () => T.deletePermissionRequest()],
      ['RolePermissionRequest', () => T.rolePermissionRequest()], ['UserRoleRequest', () => T.userRoleRequest()],
      ['UserPermissionRequest', () => T.userPermissionRequest()], ['ExportDataRequest', () => T.exportDataRequest()],
      ['RoleResource', () => T.roleResource()], ['PermissionResource', () => T.permissionResource()],
      ['schemas', () => T.adminSchema(validation)],
    ];
    for (const [name, template] of adminFiles) add(`${adminDir}/${name}.ts`, template, 'domain', `${name} scaffold`);

    for (const [moduleName, schemaFile, schema, dtos, requests, actions] of [
      ['api-keys', 'api-key.schema', () => T.apiKeySchema(validation), () => T.apiKeyDtos(), () => T.apiKeyRequests(), () => T.apiKeyActions()],
      ['team', 'team.schema', () => T.teamSchema(validation), () => T.teamDtos(), () => T.teamRequests(), () => T.teamActions()],
    ] as const) {
      const prefix = moduleName === 'team' ? 'Team' : 'ApiKey';
      const dir = `src/lib/modules/${moduleName}`;
      add(`${dir}/${schemaFile}.ts`, schema, 'domain', `${prefix} schema`);
      add(`${dir}/${prefix}Dtos.ts`, dtos, 'domain', `${prefix} DTOs`);
      add(`${dir}/${prefix}Requests.ts`, requests, 'domain', `${prefix} requests`);
      add(`${dir}/${prefix}Actions.ts`, actions, 'domain', `${prefix} actions`);
    }

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
    for (const file of new MakeDashboardCommand().files()) {
      add(file.path, () => file.content, file.path.endsWith('+server.ts') ? 'route' : 'page', 'Operational dashboard');
    }

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
