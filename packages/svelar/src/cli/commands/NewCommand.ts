/**
 * Svelar CLI — `new` command
 *
 * Scaffolds a complete SvelteKit + Svelar project.
 * Usage: npx svelar new my-app
 */

import { Command } from '../Command.js';

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

    // ── 1. Create directory structure ──
    this.info('Creating project structure...');
    const dirs = [
      '',
      'src',
      'src/lib',
      'src/lib/models',
      'src/lib/schema',
      'src/lib/controllers',
      'src/lib/middleware',
      'src/lib/services',
      'src/lib/stores',
      'src/lib/components',
      'src/routes',
      'src/routes/api',
      'static',
      'migrations',
    ];
    for (const dir of dirs) {
      mkdirSync(join(projectDir, dir), { recursive: true });
    }

    // ── 2. package.json ──
    writeFileSync(
      join(projectDir, 'package.json'),
      JSON.stringify(
        {
          name: projectName,
          version: '0.0.1',
          private: true,
          type: 'module',
          scripts: {
            dev: 'vite dev',
            build: 'vite build',
            preview: 'vite preview',
            migrate: 'npx svelar migrate',
            'migrate:rollback': 'npx svelar migrate --rollback',
            'migrate:refresh': 'npx svelar migrate --refresh',
            seed: 'npx svelar seed:run',
          },
          devDependencies: {
            '@sveltejs/adapter-auto': '^3.0.0',
            '@sveltejs/kit': '^2.55.0',
            '@sveltejs/vite-plugin-svelte': '^5.0.0',
            '@tailwindcss/vite': '^4.2.2',
            svelte: '^5.0.0',
            'svelte-check': '^4.0.0',
            tailwindcss: '^4.2.2',
            typescript: '^5.7.0',
            vite: '^6.0.0',
          },
          dependencies: {
            'better-sqlite3': '^11.0.0',
            'drizzle-orm': '^0.38.0',
            svelar: '^0.1.0',
            zod: '^3.23.0',
          },
        },
        null,
        2
      ) + '\n'
    );

    // ── 3. svelte.config.js ──
    writeFileSync(
      join(projectDir, 'svelte.config.js'),
      `import adapter from '@sveltejs/adapter-auto';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter(),
    alias: {
      '$lib': 'src/lib',
      '$lib/*': 'src/lib/*',
    },
  },
};

export default config;
`
    );

    // ── 4. vite.config.ts ──
    writeFileSync(
      join(projectDir, 'vite.config.ts'),
      `import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { createRequire } from 'module';
import { dirname, resolve } from 'path';

// Resolve the svelar package root so we can alias submodule imports
const require_ = createRequire(import.meta.url);
const svelarRoot = dirname(require_.resolve('svelar/package.json'));

export default defineConfig({
  plugins: [sveltekit(), tailwindcss()],
  resolve: {
    alias: {
      'svelar/actions': resolve(svelarRoot, 'dist/actions/index.js'),
      'svelar/api-keys': resolve(svelarRoot, 'dist/api-keys/index.js'),
      'svelar/audit': resolve(svelarRoot, 'dist/audit/index.js'),
      'svelar/auth': resolve(svelarRoot, 'dist/auth/index.js'),
      'svelar/broadcasting/client': resolve(svelarRoot, 'src/broadcasting/client.ts'),
      'svelar/broadcasting': resolve(svelarRoot, 'dist/broadcasting/index.js'),
      'svelar/cache': resolve(svelarRoot, 'dist/cache/index.js'),
      'svelar/cli': resolve(svelarRoot, 'dist/cli/index.js'),
      'svelar/config': resolve(svelarRoot, 'dist/config/index.js'),
      'svelar/container': resolve(svelarRoot, 'dist/container/index.js'),
      'svelar/dashboard': resolve(svelarRoot, 'dist/dashboard/index.js'),
      'svelar/database': resolve(svelarRoot, 'dist/database/index.js'),
      'svelar/dates': resolve(svelarRoot, 'dist/support/date.js'),
      'svelar/email-templates': resolve(svelarRoot, 'dist/email-templates/index.js'),
      'svelar/errors': resolve(svelarRoot, 'dist/errors/index.js'),
      'svelar/events': resolve(svelarRoot, 'dist/events/index.js'),
      'svelar/forms': resolve(svelarRoot, 'dist/forms/index.js'),
      'svelar/hashing': resolve(svelarRoot, 'dist/hashing/index.js'),
      'svelar/hooks': resolve(svelarRoot, 'dist/hooks/index.js'),
      'svelar/http': resolve(svelarRoot, 'dist/http/index.js'),
      'svelar/logging': resolve(svelarRoot, 'dist/logging/index.js'),
      'svelar/mail': resolve(svelarRoot, 'dist/mail/index.js'),
      'svelar/middleware': resolve(svelarRoot, 'dist/middleware/index.js'),
      'svelar/notifications': resolve(svelarRoot, 'dist/notifications/index.js'),
      'svelar/orm': resolve(svelarRoot, 'dist/orm/index.js'),
      'svelar/pagination': resolve(svelarRoot, 'dist/pagination/index.js'),
      'svelar/permissions': resolve(svelarRoot, 'dist/permissions/index.js'),
      'svelar/plugins': resolve(svelarRoot, 'dist/plugins/index.js'),
      'svelar/queue': resolve(svelarRoot, 'dist/queue/index.js'),
      'svelar/repositories': resolve(svelarRoot, 'dist/repositories/index.js'),
      'svelar/routing': resolve(svelarRoot, 'dist/routing/index.js'),
      'svelar/scheduler': resolve(svelarRoot, 'dist/scheduler/index.js'),
      'svelar/services': resolve(svelarRoot, 'dist/services/index.js'),
      'svelar/session': resolve(svelarRoot, 'dist/session/index.js'),
      'svelar/storage': resolve(svelarRoot, 'dist/storage/index.js'),
      'svelar/support': resolve(svelarRoot, 'dist/support/index.js'),
      'svelar/teams': resolve(svelarRoot, 'dist/teams/index.js'),
      'svelar/uploads': resolve(svelarRoot, 'dist/uploads/index.js'),
      'svelar/validation': resolve(svelarRoot, 'dist/validation/index.js'),
      'svelar/webhooks': resolve(svelarRoot, 'dist/webhooks/index.js'),
      'svelar/ui': resolve(svelarRoot, 'src/ui/index.ts'),
      'svelar/i18n/LanguageSwitcher.svelte': resolve(svelarRoot, 'src/i18n/LanguageSwitcher.svelte'),
      'svelar/i18n': resolve(svelarRoot, 'dist/i18n/index.js'),
      'svelar': resolve(svelarRoot, 'dist/index.js'),
    },
  },
  server: {
    fs: {
      // Allow serving files from the svelar package (UI components are source .svelte files)
      allow: ['.', svelarRoot],
    },
  },
  ssr: {
    // Process lucide-svelte during SSR (Svelte components must be compiled)
    noExternal: ['lucide-svelte', '@tabler/icons-svelte'],
  },
  optimizeDeps: {
    exclude: ['lucide-svelte', '@tabler/icons-svelte'],
  },
});
`
    );

    // ── 5. tsconfig.json ──
    writeFileSync(
      join(projectDir, 'tsconfig.json'),
      JSON.stringify(
        {
          extends: './.svelte-kit/tsconfig.json',
          compilerOptions: {
            allowJs: true,
            checkJs: true,
            esModuleInterop: true,
            forceConsistentCasingInFileNames: true,
            resolveJsonModule: true,
            skipLibCheck: true,
            sourceMap: true,
            strict: true,
            moduleResolution: 'bundler',
          },
        },
        null,
        2
      ) + '\n'
    );

    // ── 6. app.html ──
    writeFileSync(
      join(projectDir, 'src', 'app.html'),
      `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <link rel="icon" href="%sveltekit.assets%/favicon.png" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    %sveltekit.head%
  </head>
  <body data-sveltekit-prerender="true">
    <div style="display: contents">%sveltekit.body%</div>
  </body>
</html>
`
    );

    // ── 7. app.css (Tailwind v4) ──
    writeFileSync(
      join(projectDir, 'src', 'app.css'),
      `@import "tailwindcss";

@theme {
  --color-brand: #ff3e00;
  --color-brand-dark: #e03500;
  --color-brand-light: #fff5f2;
}
`
    );

    // ── 8. app.ts (bootstrap) ──
    writeFileSync(
      join(projectDir, 'src', 'app.ts'),
      `/**
 * Svelar Application Bootstrap
 *
 * Configure database, hashing, auth, and other services here.
 * This file runs once when the server starts.
 */

import { Connection } from 'svelar/database';
import { Hash } from 'svelar/hashing';
import { AuthManager } from 'svelar/auth';
// import { User } from './lib/models/User.js';

// ── Database (SQLite) ─────────────────────────────────────
Connection.configure({
  default: 'sqlite',
  connections: {
    sqlite: {
      driver: 'sqlite',
      filename: process.env.DB_PATH ?? 'database.db',
    },
  },
});

// ── Hashing (scrypt, zero dependencies) ───────────────────
Hash.configure({ driver: 'scrypt' });

// ── Auth (uncomment when you have a User model) ──────────
// export const auth = new AuthManager({
//   guard: 'session',
//   model: User,
// });

export { Connection, Hash };
`
    );

    // ── 9. hooks.server.ts ──
    writeFileSync(
      join(projectDir, 'src', 'hooks.server.ts'),
      `/**
 * SvelteKit Server Hooks — Svelar middleware pipeline
 */

import { createSvelarApp } from 'svelar/hooks';
import { MemorySessionStore } from 'svelar/session';

// Import app.ts to trigger database + hashing configuration
import './app.js';

export const { handle, handleError } = createSvelarApp({
  secret: process.env.APP_KEY || 'change-me-in-production',
  sessionStore: new MemorySessionStore(),
});
`
    );

    // ── 10. Root layout ──
    writeFileSync(
      join(projectDir, 'src', 'routes', '+layout.svelte'),
      `<script lang="ts">
  import '../app.css';

  let { children } = $props();
</script>

<svelte:head>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
</svelte:head>

{@render children()}

<style>
  :global(body) {
    margin: 0;
    padding: 0;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  }
</style>
`
    );

    // ── 11. Home page ──
    writeFileSync(
      join(projectDir, 'src', 'routes', '+page.svelte'),
      `<script lang="ts">
  import { Button, Card, Badge, Separator, Icon } from 'svelar/ui';
</script>

<svelte:head>
  <title>${projectName} — Powered by Svelar</title>
</svelte:head>

<div class="min-h-screen bg-white flex flex-col items-center justify-center px-4">
  <div class="text-center max-w-lg">
    <div class="w-16 h-16 bg-[var(--color-brand)] rounded-2xl flex items-center justify-center mx-auto mb-6">
      <span class="text-white font-bold text-2xl">&lt;/&gt;</span>
    </div>

    <Badge variant="outline" class="mb-4">Svelar + SvelteKit</Badge>

    <h1 class="text-4xl font-extrabold text-gray-900 mb-4">
      Welcome to <span class="text-[var(--color-brand)]">${projectName}</span>
    </h1>

    <p class="text-gray-600 mb-8 leading-relaxed">
      Your new Svelar project is ready. Edit
      <code class="bg-gray-100 px-1.5 py-0.5 rounded text-sm text-[var(--color-brand)]">src/routes/+page.svelte</code>
      to get started.
    </p>

    <div class="flex items-center justify-center gap-3">
      <a href="https://github.com/alephtus/svelar" target="_blank">
        <Button>Documentation</Button>
      </a>
      <a href="https://github.com/alephtus/svelar" target="_blank">
        <Button variant="outline">GitHub</Button>
      </a>
    </div>
  </div>

  <Separator class="my-12 max-w-sm w-full" />

  <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-2xl w-full">
    <Card class="p-5 text-center">
      <h3 class="font-semibold text-gray-900 mb-1">ORM</h3>
      <p class="text-sm text-gray-500">Eloquent-style models with Drizzle</p>
    </Card>
    <Card class="p-5 text-center">
      <h3 class="font-semibold text-gray-900 mb-1">Auth</h3>
      <p class="text-sm text-gray-500">Sessions, JWT, API tokens</p>
    </Card>
    <Card class="p-5 text-center">
      <h3 class="font-semibold text-gray-900 mb-1">Middleware</h3>
      <p class="text-sm text-gray-500">CORS, CSRF, rate limiting</p>
    </Card>
  </div>
</div>
`
    );

    // ── 12. .gitignore ──
    writeFileSync(
      join(projectDir, '.gitignore'),
      `node_modules
.svelte-kit
build
dist
.env
.env.*
*.db
!.env.example
`
    );

    // ── 13. .env.example ──
    writeFileSync(
      join(projectDir, '.env.example'),
      `APP_KEY=change-me-to-a-random-string
DB_DRIVER=sqlite
DB_PATH=database.db
`
    );

    // ── 14. Database config for CLI ──
    writeFileSync(
      join(projectDir, 'svelar.database.json'),
      JSON.stringify(
        {
          default: 'sqlite',
          connections: {
            sqlite: {
              driver: 'sqlite',
              filename: 'database.db',
            },
          },
        },
        null,
        2
      ) + '\n'
    );

    this.success('Project structure created');

    // ── 15. Install dependencies ──
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
    }

    // ── Done ──
    this.log('');
    this.log(`  \x1b[32m✓\x1b[0m  Project \x1b[1m${projectName}\x1b[0m created successfully!\n`);
    this.log('  Next steps:\n');
    this.log(`    cd ${projectName}`);
    if (flags['no-install']) {
      this.log('    npm install');
    }
    this.log('    npm run dev');
    this.log('');
    this.log('  Happy coding! 🚀\n');
  }
}
