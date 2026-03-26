#!/usr/bin/env node

/**
 * create-svelar — Scaffold a new Svelar project
 *
 * Usage:
 *   npm create svelar@latest my-app
 *   pnpm create svelar my-app
 *   npx create-svelar my-app
 */

import prompts from 'prompts';
import { writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  createDirectoryStructure,
  generatePackageJson,
  generateEnvFile,
  generateAppBootstrap,
  generateDatabaseConfig,
  generateHooksServer,
  generateAuthScaffolding,
  type ProjectOptions,
  type DatabaseDriver,
  type PackageManager,
} from './generators/index.js';

import {
  svelteConfig,
  viteConfig,
  appHtml,
  appDts,
  appCss,
  gitignore,
  welcomePage,
  layoutPage,
  healthRoute,
  databaseSeeder,
  buttonComponent,
  inputComponent,
  labelComponent,
  cardComponent,
  cardHeaderComponent,
  cardTitleComponent,
  cardDescriptionComponent,
  cardContentComponent,
  cardFooterComponent,
  alertComponent,
  badgeComponent,
  uiIndex,
  cnUtil,
} from './templates/index.js';

// ── ANSI helpers ───────────────────────────────────────────
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

async function main() {
  console.log(`
${cyan(`  ____           _
 / ___|_   _____| | __ _ _ __
 \\___ \\ \\ / / _ \\ |/ _\` | '__|
  ___) \\ V /  __/ | (_| | |
 |____/ \\_/ \\___|_|\\__,_|_|`)}

  ${dim('Laravel-inspired framework for SvelteKit 2')}
`);

  const cliProjectName = process.argv[2];

  const response = await prompts(
    [
      {
        type: cliProjectName ? null : 'text',
        name: 'projectName',
        message: 'Project name:',
        initial: 'my-svelar-app',
      },
      {
        type: 'select',
        name: 'database',
        message: 'Database driver:',
        choices: [
          { title: 'SQLite', description: 'File-based, great for development', value: 'sqlite' },
          { title: 'PostgreSQL', description: 'Production-grade relational DB', value: 'postgres' },
          { title: 'MySQL', description: 'Classic relational database', value: 'mysql' },
        ],
        initial: 0,
      },
      {
        type: 'select',
        name: 'packageManager',
        message: 'Package manager:',
        choices: [
          { title: 'pnpm', value: 'pnpm' },
          { title: 'npm', value: 'npm' },
          { title: 'yarn', value: 'yarn' },
          { title: 'bun', value: 'bun' },
        ],
        initial: 0,
      },
    ],
    {
      onCancel: () => {
        console.log('\nProject creation cancelled.');
        process.exit(0);
      },
    }
  );

  const projectName = cliProjectName ?? response.projectName;
  const projectDir = resolve(process.cwd(), projectName);

  if (existsSync(projectDir)) {
    console.error(`\n${yellow('Directory already exists:')} ${projectDir}`);
    process.exit(1);
  }

  const options: ProjectOptions = {
    projectName,
    projectDir,
    database: response.database as DatabaseDriver,
    includeAuth: true, // Auth is now always included
    packageManager: response.packageManager as PackageManager,
  };

  console.log(`\n${dim('Creating project...')}\n`);

  // ── 1. Directory structure ──────────────────────────────
  createDirectoryStructure(options);

  // ── 2. Package & build config ───────────────────────────
  writeFileSync(join(projectDir, 'package.json'), generatePackageJson(options));
  writeFileSync(join(projectDir, 'svelte.config.js'), svelteConfig);
  writeFileSync(join(projectDir, 'vite.config.ts'), viteConfig);
  writeFileSync(
    join(projectDir, 'tsconfig.json'),
    JSON.stringify(
      {
        extends: './.svelte-kit/tsconfig.json',
        compilerOptions: {
          allowImportingTsExtensions: true,
          strict: true,
          moduleResolution: 'bundler',
        },
      },
      null,
      2
    )
  );

  // ── 3. Environment & git ────────────────────────────────
  const envContent = generateEnvFile(options.database);
  writeFileSync(join(projectDir, '.env'), envContent);
  writeFileSync(join(projectDir, '.env.example'), envContent);
  writeFileSync(join(projectDir, '.gitignore'), gitignore);

  // ── 4. App shell ────────────────────────────────────────
  writeFileSync(join(projectDir, 'src', 'app.html'), appHtml);
  writeFileSync(join(projectDir, 'src', 'app.d.ts'), appDts);
  writeFileSync(join(projectDir, 'src', 'app.css'), appCss);
  writeFileSync(join(projectDir, 'src', 'app.ts'), generateAppBootstrap(options));
  writeFileSync(join(projectDir, 'src', 'hooks.server.ts'), generateHooksServer(options));

  // ── 5. Routes ───────────────────────────────────────────
  writeFileSync(join(projectDir, 'src', 'routes', '+page.svelte'), welcomePage);
  writeFileSync(join(projectDir, 'src', 'routes', '+layout.svelte'), layoutPage);
  writeFileSync(join(projectDir, 'src', 'routes', 'api', 'health', '+server.ts'), healthRoute);

  // ── 6. Database ─────────────────────────────────────────
  writeFileSync(join(projectDir, 'src', 'lib', 'database', 'config.ts'), generateDatabaseConfig(options));
  writeFileSync(join(projectDir, 'src', 'lib', 'database', 'seeders', 'DatabaseSeeder.ts'), databaseSeeder);

  // ── 7. UI Components ────────────────────────────────────
  writeFileSync(join(projectDir, 'src', 'lib', 'utils', 'cn.ts'), cnUtil);
  writeFileSync(join(projectDir, 'src', 'lib', 'components', 'ui', 'Button.svelte'), buttonComponent);
  writeFileSync(join(projectDir, 'src', 'lib', 'components', 'ui', 'Input.svelte'), inputComponent);
  writeFileSync(join(projectDir, 'src', 'lib', 'components', 'ui', 'Label.svelte'), labelComponent);
  writeFileSync(join(projectDir, 'src', 'lib', 'components', 'ui', 'Card.svelte'), cardComponent);
  writeFileSync(join(projectDir, 'src', 'lib', 'components', 'ui', 'CardHeader.svelte'), cardHeaderComponent);
  writeFileSync(join(projectDir, 'src', 'lib', 'components', 'ui', 'CardTitle.svelte'), cardTitleComponent);
  writeFileSync(join(projectDir, 'src', 'lib', 'components', 'ui', 'CardDescription.svelte'), cardDescriptionComponent);
  writeFileSync(join(projectDir, 'src', 'lib', 'components', 'ui', 'CardContent.svelte'), cardContentComponent);
  writeFileSync(join(projectDir, 'src', 'lib', 'components', 'ui', 'CardFooter.svelte'), cardFooterComponent);
  writeFileSync(join(projectDir, 'src', 'lib', 'components', 'ui', 'Alert.svelte'), alertComponent);
  writeFileSync(join(projectDir, 'src', 'lib', 'components', 'ui', 'Badge.svelte'), badgeComponent);
  writeFileSync(join(projectDir, 'src', 'lib', 'components', 'ui', 'index.ts'), uiIndex);

  // ── 8. Auth scaffolding (now always included) ───────────
  generateAuthScaffolding(projectDir);

  // ── 9. Done! ────────────────────────────────────────────
  const pm = options.packageManager;
  const runCmd = pm === 'npm' ? 'npm run' : pm;

  console.log(`${green('✓')} Project created at ${bold(projectDir)}\n`);
  console.log(`  ${dim('Next steps:')}\n`);
  console.log(`  ${cyan('cd')} ${projectName}`);
  console.log(`  ${cyan(pm + ' install')}`);
  console.log(`  ${cyan(runCmd + ' dev')}`);
  console.log();
  console.log(`  ${dim('Generate resources:')}`);
  console.log(`  ${cyan('npx svelar make:model User -a')}  ${dim('# model + migration + controller')}`);
  console.log(`  ${cyan('npx svelar migrate')}             ${dim('# run migrations')}`);
  console.log();
}

main().catch(console.error);
