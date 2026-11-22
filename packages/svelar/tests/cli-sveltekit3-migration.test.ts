import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  chmodSync, existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync,
  readdirSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applySvelteKit3Migration, planSvelteKit3Migration, SVELTEKIT3_GUIDE_PATH,
} from '../src/cli/SvelteKit3Migration.js';
import { UpdateCommand } from '../src/cli/commands/UpdateCommand.js';

const confirmation = vi.hoisted(() => ({ answer: 'yes' }));
vi.mock('node:readline', () => ({
  createInterface: () => ({ question: (_question: string, cb: (answer: string) => void) => cb(confirmation.answer), close: () => {} }),
}));
vi.mock('node:fs', async (original) => {
  const fs = await original<typeof import('node:fs')>();
  return { ...fs, renameSync: vi.fn(fs.renameSync), linkSync: vi.fn(fs.linkSync), openSync: vi.fn(fs.openSync) };
});
const fs = await vi.importActual<typeof import('node:fs')>('node:fs');
const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const legacy = [
  "import adapter from '@sveltejs/adapter-node';",
  "import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';",
  "/** @type {import('@sveltejs/kit').Config} */",
  'const config = {',
  '  preprocess: vitePreprocess(),',
  "  kit: { adapter: adapter(), alias: { '$lib': 'src/lib', '$lib/*': 'src/lib/*' } },",
  '};',
  'export default config;',
  '',
].join('\r\n');
const vite = [
  "import { sveltekit } from '@sveltejs/kit/vite';",
  "import { defineConfig, loadEnv } from 'vite';",
  "import tailwindcss from '@tailwindcss/vite';",
  'export default defineConfig(({ mode }) => {',
  "  Object.assign(process.env, loadEnv(mode, process.cwd(), ''));",
  '  return { plugins: [sveltekit(), tailwindcss()], server: { port: 5199 } };',
  '});',
  '',
].join('\n');
// Frozen generated output from the npm @beeblock/svelar@0.8.0 tarball; registry SHA-512 verified.
// Keep this independent of current templates so published-baseline drift cannot pass unnoticed.
const published080 = {
  integrity: `sha512-4Ya7/LTqYXWWHSnmFDDV11rllXW1kzp57u+SRTgjpsxdfIZC6B47QXE/ZvIJzd+5pbLvtJFf4O/3H0QjMaK76Q==`,
  manifest: `{
  "name": "published-080",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "engines": {
    "node": "^22.12.0 || >=24.0.0"
  },
  "scripts": {
    "prepare": "svelte-kit sync",
    "dev": "vite dev",
    "prebuild": "svelar lint:architecture",
    "build": "vite build",
    "lint:architecture": "svelar lint:architecture",
    "preview": "vite preview",
    "migrate": "npx svelar migrate",
    "migrate:rollback": "npx svelar migrate --rollback",
    "migrate:refresh": "npx svelar migrate --refresh",
    "seed": "npx svelar seed:run",
    "dev:worker": "node scripts/svelar-dev-runtime.mjs queue:work --queue=default",
    "dev:scheduler": "node scripts/svelar-dev-runtime.mjs schedule:run",
    "test": "svelte-kit sync && vitest run",
    "test:watch": "svelte-kit sync && vitest",
    "test:e2e": "playwright test",
    "test:coverage": "svelte-kit sync && vitest run --coverage",
    "ui:install": "npm exec --package shadcn-svelte@latest -- shadcn-svelte add --all --yes && npm install --save-prod @internationalized/date@^3.12.4 bits-ui@^2.19.5 embla-carousel-svelte@^8.6.0 formsnap@^2.0.1 layerchart@^2.8.0 mode-watcher@^1.1.0 paneforge@^1.0.2 svelte-sonner@^1.2.1 sveltekit-superforms@^2.31.0 tailwind-variants@^3.3.1 typebox@^1.3.37 vaul-svelte@^1.0.0-next.7 zod-v3-to-json-schema@^4.0.0"
  },
  "devDependencies": {
    "@sveltejs/adapter-node": "^5.5.7",
    "@sveltejs/kit": "^2.70.3",
    "@sveltejs/vite-plugin-svelte": "^7.3.1",
    "@tailwindcss/vite": "^4.3.3",
    "@lucide/svelte": "^1.56.0",
    "svelte": "^5.57.2",
    "svelte-check": "^4.7.6",
    "tailwindcss": "^4.3.3",
    "typescript": "^6.0.3",
    "@types/node": "^22.20.5",
    "vite": "^8.3.4",
    "vitest": "^4.1.11",
    "@vitest/coverage-v8": "^4.1.11",
    "@playwright/test": "^1.64.0"
  },
  "dependencies": {
    "@internationalized/date": "^3.12.4",
    "bits-ui": "^2.19.5",
    "embla-carousel-svelte": "^8.6.0",
    "formsnap": "^2.0.1",
    "layerchart": "^2.8.0",
    "mode-watcher": "^1.1.0",
    "paneforge": "^1.0.2",
    "svelte-sonner": "^1.2.1",
    "sveltekit-superforms": "^2.31.0",
    "tailwind-variants": "^3.3.1",
    "typebox": "^1.3.37",
    "vaul-svelte": "^1.0.0-next.7",
    "zod-v3-to-json-schema": "^4.0.0",
    "@aws-sdk/client-s3": "^3.1150.0",
    "@aws-sdk/s3-request-presigner": "^3.1150.0",
    "better-sqlite3": "^12.11.1",
    "bullmq": "^5.81.5",
    "drizzle-orm": "^0.45.4",
    "ioredis": "^5.11.1",
    "meilisearch": "^0.62.0",
    "mysql2": "^3.24.6",
    "postgres": "^3.4.9",
    "@beeblock/svelar": "^0.8.0",
    "clsx": "^2.1.1",
    "pdfkit": "^0.18.0",
    "tailwind-merge": "^3.7.0",
    "tw-animate-css": "^1.4.0",
    "zod": "^4.6.7",
    "valibot": "^1.5.0"
  },
  "overrides": {
    "@sveltejs/kit": {
      "cookie": "^0.7.2"
    },
    "exceljs": {
      "uuid": "^11.1.1"
    },
    "esbuild@>=0.27.3 <0.28.1": "^0.28.2"
  }
}
`,
  svelteConfig: `import adapter from '@sveltejs/adapter-node';
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
`,
  viteConfig: `import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, loadEnv } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { createRequire } from 'module';
import { dirname, resolve } from 'path';

// Resolve the svelar package root so we can alias submodule imports
const require_ = createRequire(import.meta.url);
const svelarRoot = dirname(require_.resolve('@beeblock/svelar/package.json'));

export default defineConfig(({ mode }) => {
  Object.assign(process.env, loadEnv(mode, process.cwd(), ''));

  return {
  plugins: [sveltekit(), tailwindcss()],
  resolve: {
    alias: {
      '@beeblock/svelar/actions': resolve(svelarRoot, 'dist/actions/index.js'),
      '@beeblock/svelar/api-keys': resolve(svelarRoot, 'dist/api-keys/index.js'),
      '@beeblock/svelar/audit': resolve(svelarRoot, 'dist/audit/index.js'),
      '@beeblock/svelar/auth': resolve(svelarRoot, 'dist/auth/index.js'),
      '@beeblock/svelar/broadcasting/client': resolve(svelarRoot, 'dist/broadcasting/client.js'),
      '@beeblock/svelar/broadcasting': resolve(svelarRoot, 'dist/broadcasting/index.js'),
      '@beeblock/svelar/cache': resolve(svelarRoot, 'dist/cache/index.js'),
      '@beeblock/svelar/cli': resolve(svelarRoot, 'dist/cli/index.js'),
      '@beeblock/svelar/config': resolve(svelarRoot, 'dist/config/index.js'),
      '@beeblock/svelar/container': resolve(svelarRoot, 'dist/container/index.js'),
      '@beeblock/svelar/dashboard/schemas': resolve(svelarRoot, 'dist/dashboard/schemas.js'),
      '@beeblock/svelar/dashboard': resolve(svelarRoot, 'dist/dashboard/index.js'),
      '@beeblock/svelar/database': resolve(svelarRoot, 'dist/database/index.js'),
      '@beeblock/svelar/deployment': resolve(svelarRoot, 'dist/deployment/index.js'),
      '@beeblock/svelar/dates': resolve(svelarRoot, 'dist/support/date.js'),
      '@beeblock/svelar/email-templates': resolve(svelarRoot, 'dist/email-templates/index.js'),
      '@beeblock/svelar/errors': resolve(svelarRoot, 'dist/errors/index.js'),
      '@beeblock/svelar/events': resolve(svelarRoot, 'dist/events/index.js'),
      '@beeblock/svelar/excel': resolve(svelarRoot, 'dist/excel/index.js'),
      '@beeblock/svelar/feature-flags': resolve(svelarRoot, 'dist/feature-flags/index.js'),
      '@beeblock/svelar/forms': resolve(svelarRoot, 'dist/forms/index.js'),
      '@beeblock/svelar/hashing': resolve(svelarRoot, 'dist/hashing/index.js'),
      '@beeblock/svelar/hooks': resolve(svelarRoot, 'dist/hooks/index.js'),
      '@beeblock/svelar/http': resolve(svelarRoot, 'dist/http/index.js'),
      '@beeblock/svelar/logging/LogViewer': resolve(svelarRoot, 'dist/logging/LogViewer.js'),
      '@beeblock/svelar/logging': resolve(svelarRoot, 'dist/logging/index.js'),
      '@beeblock/svelar/mail': resolve(svelarRoot, 'dist/mail/index.js'),
      '@beeblock/svelar/middleware': resolve(svelarRoot, 'dist/middleware/index.js'),
      '@beeblock/svelar/notifications': resolve(svelarRoot, 'dist/notifications/index.js'),
      '@beeblock/svelar/operations': resolve(svelarRoot, 'dist/operations/index.js'),
      '@beeblock/svelar/orm': resolve(svelarRoot, 'dist/orm/index.js'),
      '@beeblock/svelar/pagination': resolve(svelarRoot, 'src/pagination'),
      '@beeblock/svelar/pdf/GeneratePdfJob': resolve(svelarRoot, 'dist/pdf/GeneratePdfJob.js'),
      '@beeblock/svelar/pdf': resolve(svelarRoot, 'dist/pdf/index.js'),
      '@beeblock/svelar/permissions/client': resolve(svelarRoot, 'dist/permissions/client.js'),
      '@beeblock/svelar/permissions': resolve(svelarRoot, 'dist/permissions/index.js'),
      '@beeblock/svelar/plugins/PluginInstaller': resolve(svelarRoot, 'dist/plugins/PluginInstaller.js'),
      '@beeblock/svelar/plugins/PluginPublisher': resolve(svelarRoot, 'dist/plugins/PluginPublisher.js'),
      '@beeblock/svelar/plugins/PluginRegistry': resolve(svelarRoot, 'dist/plugins/PluginRegistry.js'),
      '@beeblock/svelar/plugins': resolve(svelarRoot, 'dist/plugins/index.js'),
      '@beeblock/svelar/queue/JobMonitor': resolve(svelarRoot, 'dist/queue/JobMonitor.js'),
      '@beeblock/svelar/queue': resolve(svelarRoot, 'dist/queue/index.js'),
      '@beeblock/svelar/repositories': resolve(svelarRoot, 'dist/repositories/index.js'),
      '@beeblock/svelar/routing': resolve(svelarRoot, 'dist/routing/index.js'),
      '@beeblock/svelar/scheduler/ScheduleMonitor': resolve(svelarRoot, 'dist/scheduler/ScheduleMonitor.js'),
      '@beeblock/svelar/scheduler': resolve(svelarRoot, 'dist/scheduler/index.js'),
      '@beeblock/svelar/search': resolve(svelarRoot, 'dist/search/index.js'),
      '@beeblock/svelar/services': resolve(svelarRoot, 'dist/services/index.js'),
      '@beeblock/svelar/session': resolve(svelarRoot, 'dist/session/index.js'),
      '@beeblock/svelar/storage': resolve(svelarRoot, 'dist/storage/index.js'),

      '@beeblock/svelar/support': resolve(svelarRoot, 'dist/support/index.js'),
      '@beeblock/svelar/teams': resolve(svelarRoot, 'dist/teams/index.js'),
      '@beeblock/svelar/uploads': resolve(svelarRoot, 'dist/uploads/index.js'),
      '@beeblock/svelar/validation/valibot': resolve(svelarRoot, 'dist/validation/valibot.js'),
      '@beeblock/svelar/validation': resolve(svelarRoot, 'dist/validation/index.js'),
      '@beeblock/svelar/webhooks': resolve(svelarRoot, 'dist/webhooks/index.js'),
      '@beeblock/svelar/ui': resolve(svelarRoot, 'src/ui'),
      '@beeblock/svelar/i18n/LanguageSwitcher.svelte': resolve(svelarRoot, 'src/i18n/LanguageSwitcher.svelte'),
      '@beeblock/svelar/i18n': resolve(svelarRoot, 'dist/i18n/index.js'),
      '@beeblock/svelar/testing': resolve(svelarRoot, 'dist/testing/index.js'),
      '@beeblock/svelar': resolve(svelarRoot, 'dist/index.js'),
    },
  },
  server: {
    fs: {
      // Allow serving files from the svelar package (UI components are source .svelte files)
      allow: ['.', svelarRoot],
    },
  },
  ssr: {
    // Node-only optional drivers must stay external for adapter-node production builds.
	    external: ['bcrypt', 'argon2', 'bullmq', 'ioredis', 'meilisearch', '@aws-sdk/client-s3', '@aws-sdk/s3-request-presigner'],
    // Process Svelte icon components during SSR.
    noExternal: ['@lucide/svelte', '@tabler/icons-svelte', 'bits-ui'],
  },
  optimizeDeps: {
    exclude: ['@lucide/svelte', '@tabler/icons-svelte', 'bits-ui'],
  },
  build: {
    rolldownOptions: {
      output: { keepNames: true },
      onwarn(warning, warn) {
        const warningText = [
          warning.message,
          warning.id,
          ...(Array.isArray(warning.ids) ? warning.ids : []),
        ]
          .filter(Boolean)
          .join(' ');

        if (
          warning.code === 'CIRCULAR_DEPENDENCY' &&
          (
            warningText.includes('node_modules/typebox') ||
            warningText.includes('node_modules/zod-v3-to-json-schema')
          )
        ) {
          return;
        }

        warn(warning);
      },
    },
  },
  };
});
`,
  tsconfig: `{
  "extends": "./.svelte-kit/tsconfig.json",
  "compilerOptions": {
    "allowJs": true,
    "checkJs": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "sourceMap": true,
    "strict": true,
    "moduleResolution": "bundler",
    "types": [
      "node",
      "vite/client"
    ]
  }
}
`,
};
let root: string;
let cwd: string;
function write(path: string, content: string | Buffer): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
}
function read(path: string): string { return readFileSync(join(root, path), 'utf8'); }
function packageJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    name: 'custom-existing-app', type: 'module', private: true,
    scripts: { custom: 'echo keep-owned-config', check: 'svelte-check' },
    engines: { node: '>=18.13.0', pnpm: '>=9.0.0' },
    dependencies: { '@beeblock/svelar': '^0.8.0', zod: '^4.6.7', 'sveltekit-superforms': '^2.31.0', custom: 'file:../custom' },
    devDependencies: { '@sveltejs/kit': '^2.70.3', svelte: '^5.0.0', vite: '^7.0.0', typescript: '^5.0.0', '@sveltejs/vite-plugin-svelte': '^6.0.0' },
    ...overrides,
  }, null, 2) + '\n';
}
function backupFiles(path = root): string[] {
  return readdirSync(path, { withFileTypes: true }).flatMap((file) => file.isDirectory()
    ? backupFiles(join(path, file.name)) : file.name.includes('.sveltekit3') ? [join(path, file.name)] : []);
}
async function tty(value: boolean, run: () => Promise<void>): Promise<void> {
  const descriptor = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
  Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value });
  try { await run(); }
  finally {
    if (descriptor) Object.defineProperty(process.stdin, 'isTTY', descriptor);
    else Reflect.deleteProperty(process.stdin, 'isTTY');
  }
}
beforeEach(() => {
  cwd = process.cwd();
  root = mkdtempSync(join(packageRoot, '.test-kit3-'));
  write('package.json', packageJson());
  write('svelte.config.js', legacy);
  write('vite.config.ts', vite);
  write('tsconfig.json', '{\n  // custom configuration\n  "extends": "./.svelte-kit/tsconfig.json",\n  "compilerOptions": { "strict": true }\n}\n');
  write('svelar.validation.json', '{"validation":"valibot","custom":"retained"}\r\n');
  write('src/app.ts', '// app-owned bootstrap\r\nexport const marker = true;\r\n');
  vi.mocked(renameSync).mockReset().mockImplementation(fs.renameSync);
  vi.mocked(linkSync).mockReset().mockImplementation(fs.linkSync);
  vi.mocked(openSync).mockReset().mockImplementation(fs.openSync);
  confirmation.answer = 'yes';
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  process.chdir(cwd);
  rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('opt-in SvelteKit 3 plan/apply', () => {
  it('migrates the actual published 0.8.0 manifest and complete generated configs, not just a minimal fixture', async () => {
    write('package.json', published080.manifest);
    write('svelte.config.js', published080.svelteConfig);
    write('vite.config.ts', published080.viteConfig);
    write('tsconfig.json', published080.tsconfig);
    const before = JSON.parse(published080.manifest);
    expect(before.overrides['@sveltejs/kit']).toEqual({ cookie: '^0.7.2' });
    expect(before.engines.node).toBe('^22.12.0 || >=24.0.0');
    expect(before.devDependencies['@sveltejs/adapter-node']).toBe('^5.5.7');
    expect(before.dependencies.formsnap).toBe('^2.0.1');
    const plan = await planSvelteKit3Migration(root);
    expect(plan.errors).toEqual([]);
    expect(plan.manualSteps.join('\n')).not.toContain('Unsupported/custom');
    expect(plan.manualSteps.join('\n')).not.toContain('preserved install scripts');
    expect(plan.manualSteps.join('\n')).not.toContain('customized ui:install');
    expect(plan.edits.find((edit) => edit.path === 'svelte.config.js')?.updated).toBeNull();
    applySvelteKit3Migration(plan, { confirmed: true });
    const expected = structuredClone(before);
    expected.engines.node = '^22.17.0 || ^24.0.0 || >=26.0.0';
    expected.devDependencies['@sveltejs/kit'] = '^3.4.0';
    expected.devDependencies.svelte = '^5.59.1';
    expected.devDependencies['@sveltejs/adapter-node'] = '^6.0.5';
    expected.dependencies['sveltekit-superforms'] = '^3.1.0';
    expected.dependencies.formsnap = '^2.1.0';
    expected.scripts['ui:install'] = before.scripts['ui:install']
      .replace('formsnap@^2.0.1', 'formsnap@^2.1.0')
      .replace('sveltekit-superforms@^2.31.0', 'sveltekit-superforms@^3.1.0') + ' && svelte-kit sync';
    expected.imports = { '#lib': './src/lib/index.js', '#lib/*': './src/lib/*' };
    delete expected.overrides['@sveltejs/kit'];
    expect(JSON.parse(read('package.json'))).toEqual(expected);
    expect(read('package.json')).toContain('"exceljs": {\n      "uuid": "^11.1.1"\n    }');
    expect(read('package.json')).toContain('"esbuild@>=0.27.3 <0.28.1": "^0.28.2"');
    expect(read('package.json.sveltekit3.bak')).toBe(published080.manifest);
    expect(read('svelte.config.js.sveltekit3.bak')).toBe(published080.svelteConfig);
    expect(read('vite.config.ts.sveltekit3.bak')).toBe(published080.viteConfig);
    expect(read('tsconfig.json.sveltekit3.bak')).toBe(published080.tsconfig);
    expect(read('vite.config.ts')).toBe(
      'import svelarKit3Adapter from "@sveltejs/adapter-node";\n'
      + "import { vitePreprocess as svelarKit3Preprocess } from '@sveltejs/vite-plugin-svelte';\n"
      + published080.viteConfig
        .replace('sveltekit()', "sveltekit({ adapter: svelarKit3Adapter(), preprocess: svelarKit3Preprocess(), alias: { '$lib': 'src/lib', '$lib/*': 'src/lib/*' } })")
        .replace("noExternal: ['@lucide/svelte', '@tabler/icons-svelte', 'bits-ui']", "noExternal: ['@lucide/svelte', '@tabler/icons-svelte', 'bits-ui', \"tw-animate-css\"]"),
    );
    const expectedTypes = JSON.parse(published080.tsconfig);
    expectedTypes.extends = '$app/tsconfig';
    expectedTypes.include = ['src', 'test', 'tests', '*'];
    expectedTypes.exclude = ['src/service-worker'];
    expectedTypes.compilerOptions.types.unshift('$app/types');
    expect(JSON.parse(read('tsconfig.json'))).toEqual(expectedTypes);
    expect((await planSvelteKit3Migration(root)).edits).toEqual([]);
  });

  it.each(['zod', 'valibot'])('migrates only the exact published UI install script with final sync while preserving %s provider and other scripts', async (provider) => {
    const pkg = JSON.parse(published080.manifest);
    if (provider === 'valibot') delete pkg.dependencies.zod;
    pkg.scripts['custom:install'] = 'npm run owned-hook && echo keep-exactly';
    const original = JSON.stringify(pkg, null, 2) + '\n';
    write('package.json', original);
    const validation = JSON.stringify({ validation: provider, custom: 'preserved' }) + '\r\n';
    write('svelar.validation.json', validation);
    const plan = await planSvelteKit3Migration(root);
    expect(plan.errors).toEqual([]);
    expect(read('package.json')).toBe(original);
    const migrated = JSON.parse(plan.edits.find((edit) => edit.path === 'package.json')!.updated!.toString());
    expect(migrated.scripts).toEqual({ ...pkg.scripts, 'ui:install': pkg.scripts['ui:install']
      .replace('formsnap@^2.0.1', 'formsnap@^2.1.0')
      .replace('sveltekit-superforms@^2.31.0', 'sveltekit-superforms@^3.1.0') + ' && svelte-kit sync' });
    expect(migrated.scripts['ui:install'].split(' && ')).toHaveLength(3);
    expect(migrated.scripts['ui:install'].split(' && ')[2]).toBe('svelte-kit sync');
    expect(plan.guide).toContain('Only the exact published 0.8 ui:install script is migrated');
    applySvelteKit3Migration(plan, { confirmed: true });
    expect(read('svelar.validation.json')).toBe(validation);
    expect(read('package.json.sveltekit3.bak')).toBe(original);
    expect((await planSvelteKit3Migration(root)).edits).toEqual([]);
  });

  it.each([
    (script: string) => script + ' && npm run custom-hook',
    (script: string) => script.replace('shadcn-svelte@latest', 'shadcn-svelte@1.8.1'),
    (script: string) => script.replace('formsnap@^2.0.1', 'formsnap@^2.0.2'),
    (script: string) => script + ' && svelte-kit sync',
    (script: string) => script.replace(' && ', '  &&  '),
  ])('leaves customized UI scripts unchanged and reports an unresolved pins/sync blocker', async (customize) => {
    const pkg = JSON.parse(published080.manifest);
    const custom = customize(pkg.scripts['ui:install']);
    pkg.scripts['ui:install'] = custom;
    write('package.json', JSON.stringify(pkg, null, 2) + '\n');
    const plan = await planSvelteKit3Migration(root);
    expect(plan.errors).toEqual([]);
    expect(plan.manualSteps.join('\n')).toContain('customized ui:install is preserved');
    expect(plan.manualSteps.join('\n')).toContain('unresolved manual blocker');
    expect(plan.guide).toContain('append a final svelte-kit sync');
    applySvelteKit3Migration(plan, { confirmed: true });
    expect(JSON.parse(read('package.json')).scripts['ui:install']).toBe(custom);
    expect(plan.requiresManual).toBe(true);
  });

  it('migrates recognized config and dependency tokens with exact backups, preserving application state', async () => {
    write('.env', Buffer.from([65, 80, 80, 95, 75, 69, 89, 61, 255, 10]));
    write('data/private.db', Buffer.from([0, 1, 255, 4]));
    write('src/lib/database/migrations/20261122_custom.ts', "// historical migration\nimport { browser } from '$app/environment';\n");
    write('src/lib/custom.ts', "// $app/environment is an example\r\nimport { browser } from '$app/environment';\r\nimport { schema } from '$lib/schemas/custom';\r\nexport { browser, schema };\r\n");
    write('src/lib/schemas/custom.ts', 'export const schema = true;\n');
    chmodSync(join(root, 'package.json'), 0o640);
    const preserved = new Map(['.env', 'data/private.db', 'svelar.validation.json', 'src/app.ts', 'src/lib/database/migrations/20261122_custom.ts']
      .map((path) => [path, readFileSync(join(root, path))]));
    const plan = await planSvelteKit3Migration(root);
    expect(plan.errors).toEqual([]);
    expect(plan.requiresManual).toBe(true);
    expect(read('svelte.config.js')).toBe(legacy);
    expect(existsSync(join(root, SVELTEKIT3_GUIDE_PATH))).toBe(false);
    expect(backupFiles()).toEqual([]);
    const backups = applySvelteKit3Migration(plan, { confirmed: true });
    expect(backups).toContain('svelte.config.js.sveltekit3.bak');
    for (const edit of plan.edits.filter((edit) => edit.original !== null)) {
      expect(readFileSync(join(root, `${edit.path}.sveltekit3.bak`))).toEqual(edit.original);
      expect(lstatSync(join(root, `${edit.path}.sveltekit3.bak`)).mode & 0o777).toBe(edit.mode);
    }
    expect(existsSync(join(root, 'svelte.config.js'))).toBe(false);
    expect(read('vite.config.ts')).toContain("alias: { '$lib': 'src/lib', '$lib/*': 'src/lib/*' }");
    expect(read('vite.config.ts')).toContain('server: { port: 5199 }');
    expect(read('vite.config.ts')).toContain("Object.assign(process.env, loadEnv(mode, process.cwd(), ''));");
    expect(read('src/lib/custom.ts')).toContain('from "$app/env"');
    expect(read('src/lib/custom.ts')).toContain("from '$lib/schemas/custom'");
    expect(read('src/lib/custom.ts')).toContain('// $app/environment is an example');
    const pkg = JSON.parse(read('package.json'));
    expect(pkg.devDependencies).toMatchObject({ '@sveltejs/kit': '^3.4.0', svelte: '^5.59.1', vite: '^8.3.4', typescript: '^6.0.3', '@sveltejs/vite-plugin-svelte': '^7.3.1' });
    expect(pkg.dependencies).toMatchObject({ '@beeblock/svelar': '^0.8.0', zod: '^4.6.7', 'sveltekit-superforms': '^3.1.0', custom: 'file:../custom' });
    expect(pkg.engines).toEqual({ node: '>=22.17.0', pnpm: '>=9.0.0' });
    expect(pkg.imports).toEqual({ '#lib': './src/lib/index.js', '#lib/*': './src/lib/*' });
    expect(read('tsconfig.json')).toContain('// custom configuration');
    expect(read('tsconfig.json')).toContain('"extends": "$app/tsconfig"');
    expect(read('tsconfig.json')).toContain('"strict": true');
    expect(lstatSync(join(root, 'package.json')).mode & 0o777).toBe(0o640);
    for (const [path, content] of preserved) expect(readFileSync(join(root, path))).toEqual(content);
    expect(read(SVELTEKIT3_GUIDE_PATH)).toContain('NOT complete');
    expect(existsSync(join(root, '.svelar-sveltekit3-migration.lock'))).toBe(false);
    const again = await planSvelteKit3Migration(root);
    expect(again.errors).toEqual([]);
    expect(again.edits).toEqual([]);
    expect(applySvelteKit3Migration(again, { confirmed: true })).toEqual([]);
  });

  it('edits only real module tokens in Svelte scripts, not markup, comments or application aliases', async () => {
    const original = '<script module lang="ts">\nexport { version } from "$app/environment";\n</script>\n<script lang="ts">\nimport { browser } from "$app/environment";\nimport { page } from "$app/stores";\nimport Foo from "$lib/Foo.svelte";\n</script>\n<p>$app/environment {$page.url.pathname}</p>\n';
    write('src/routes/+page.svelte', original);
    const plan = await planSvelteKit3Migration(root);
    expect(plan.errors).toEqual([]);
    const output = plan.edits.find((edit) => edit.path === 'src/routes/+page.svelte')!.updated!.toString();
    expect(output).toBe(original.replace('from "$app/environment";', 'from "$app/env";').replace('from "$app/environment";', 'from "$app/env";'));
    expect(plan.manualSteps.join('\n')).toContain('$app/stores');
    expect(plan.guide).toContain('npx sv migrate sveltekit-3');
    expect(plan.guide).toContain('Superforms');
    expect(plan.guide).toContain('$app/tsconfig/service-worker');
  });

  it.each([
    legacy.replace('adapter()', 'adapter({ out: "custom-output" })'),
    legacy.replace('adapter: adapter()', 'adapter: adapter(), paths: { base: "/custom" }'),
    legacy.replace("'$lib': 'src/lib'", "'$lib': 'custom/lib'"),
    'export default await loadCustomConfig();\n',
  ])('preserves unsupported configs and reports an incomplete manual migration', async (custom) => {
    write('svelte.config.js', custom);
    const plan = await planSvelteKit3Migration(root);
    expect(plan.errors).toEqual([]);
    expect(plan.edits.some((edit) => ['svelte.config.js', 'vite.config.ts'].includes(edit.path))).toBe(false);
    expect(plan.manualSteps.join('\n')).toContain('npx sv migrate sveltekit-3');
    applySvelteKit3Migration(plan, { confirmed: true });
    expect(read('svelte.config.js')).toBe(custom);
    expect(read('vite.config.ts')).toBe(vite);
    expect(read(SVELTEKIT3_GUIDE_PATH)).toContain('Unsupported/custom');
  });

  it.each([
    vite.replace('sveltekit()', 'sveltekit(customOptions)'),
    vite.replace('sveltekit()', 'wrapper(sveltekit())'),
    vite.replace('sveltekit()', 'sveltekit(), sveltekit()'),
    vite.replace('return {', 'const sveltekit = () => null; return {'),
    vite.replace('server: { port: 5199 }', 'plugins: customPlugins'),
    vite.replace('server: { port: 5199 }', '...customOptions'),
  ])('preserves ambiguous/preconfigured Vite config', async (custom) => {
    write('vite.config.ts', custom);
    const plan = await planSvelteKit3Migration(root);
    expect(plan.errors).toEqual([]);
    expect(plan.edits.some((edit) => ['svelte.config.js', 'vite.config.ts'].includes(edit.path))).toBe(false);
  });

  it('preserves newer versions, custom metadata and explicit tsconfig lists', async () => {
    const pkg = JSON.parse(packageJson());
    pkg.devDependencies.svelte = '^5.60.0';
    pkg.devDependencies['@sveltejs/kit'] = '^3.4.1';
    pkg.devDependencies.vite = '^8.3.5';
    pkg.engines.node = '>=24.0.0';
    pkg.imports = { '#custom/*': './custom/*' };
    write('package.json', '\uFEFF' + JSON.stringify(pkg, null, '\t') + '\r\n');
    write('tsconfig.json', '{"extends":"./.svelte-kit/tsconfig.json","include":["src/custom"],"exclude":["private"],"compilerOptions":{"strict":false}}');
    const plan = await planSvelteKit3Migration(root);
    expect(plan.errors).toEqual([]);
    applySvelteKit3Migration(plan, { confirmed: true });
    const output = JSON.parse(read('package.json').slice(1));
    expect(output.devDependencies.svelte).toBe('^5.60.0');
    expect(output.devDependencies['@sveltejs/kit']).toBe('^3.4.1');
    expect(output.devDependencies.vite).toBe('^8.3.5');
    expect(output.engines.node).toBe('>=24.0.0');
    expect(output.imports['#custom/*']).toBe('./custom/*');
    expect(JSON.parse(read('tsconfig.json'))).toEqual({ extends: '$app/tsconfig', include: ['src/custom'], exclude: ['private'], compilerOptions: { strict: false } });
  });

  it.each(['8.0.16', '^8.0.16', '~8.0.16'])('raises an existing Vite %s range to the approved tested lower bound while preserving the old lockfile for review', async (range) => {
    const pkg = JSON.parse(packageJson());
    pkg.devDependencies.vite = range;
    write('package.json', JSON.stringify(pkg, null, 2) + '\n');
    const lock = JSON.stringify({ name: pkg.name, lockfileVersion: 3, packages: { '': { devDependencies: { vite: range } }, 'node_modules/vite': { version: '8.0.16' } } }, null, 2) + '\n';
    write('package-lock.json', lock);
    const plan = await planSvelteKit3Migration(root);
    expect(plan.errors).toEqual([]);
    expect(plan.guide).toContain('vite: ^8.3.4');
    expect(plan.guide).toContain('Kit ^3.4.0, TypeScript ^6.0.3, Svelte ^5.59.1, Vite ^8.3.4');
    expect(plan.guide).not.toContain('Vite >=8.0.12');
    expect(plan.guide).toContain('stricter than the official minimum requirements');
    expect(plan.guide).toContain('not a blanket security guarantee');
    expect(plan.warnings.join('\n')).toContain('Older same-major versions may change');
    const manifest = plan.edits.find((edit) => edit.path === 'package.json')!;
    expect(JSON.parse(manifest.updated!.toString()).devDependencies.vite).toBe('^8.3.4');
    applySvelteKit3Migration(plan, { confirmed: true });
    expect(JSON.parse(read('package.json')).devDependencies.vite).toBe('^8.3.4');
    expect(read('package-lock.json')).toBe(lock);
    expect((await planSvelteKit3Migration(root)).edits).toEqual([]);
  });

  it.each([
    { types: ['node', 'vite/client', 'custom/globals'] }, { types: [] }, { types: ['$app/types', 'node', 'custom/globals'] },
  ])('adds $app/types once without replacing explicit custom type declarations: $types', async ({ types }) => {
    write('tsconfig.json', JSON.stringify({ extends: './.svelte-kit/tsconfig.json', compilerOptions: { types } }));
    const plan = await planSvelteKit3Migration(root);
    expect(plan.errors).toEqual([]);
    applySvelteKit3Migration(plan, { confirmed: true });
    expect(JSON.parse(read('tsconfig.json')).compilerOptions.types).toEqual(types.includes('$app/types') ? types : ['$app/types', ...types]);
    expect((await planSvelteKit3Migration(root)).edits).toEqual([]);
  });

  it('preserves unsupported explicit type-list configuration with a manual blocker', async () => {
    write('tsconfig.json', '{"extends":"./.svelte-kit/tsconfig.json","compilerOptions":{"types":"app-owned-computed-types"}}');
    const plan = await planSvelteKit3Migration(root);
    expect(plan.errors).toEqual([]);
    expect(plan.manualSteps.join('\n')).toContain('types is not a static string list');
    applySvelteKit3Migration(plan, { confirmed: true });
    expect(JSON.parse(read('tsconfig.json')).compilerOptions.types).toBe('app-owned-computed-types');
  });

  it('requires a real Kit plugin and Superforms 3 inlining in the manual Vitest checklist without overwriting test config', async () => {
    const original = [
      "import { defineConfig } from 'vitest/config';",
      "import { sveltekit } from '@sveltejs/kit/vite';",
      'export default defineConfig({',
      "  plugins: [sveltekit()], test: { server: { deps: { inline: ['custom-dependency'] } } },",
      '});',
      '',
    ].join('\n');
    write('vitest.config.ts', original);
    const plan = await planSvelteKit3Migration(root);
    expect(plan.errors).toEqual([]);
    expect(plan.edits.some((edit) => edit.path === 'vitest.config.ts')).toBe(false);
    expect(plan.manualSteps.join('\n')).toContain('test.server.deps.inline');
    expect(plan.guide).toContain("sveltekit({ preprocess: vitePreprocess(), alias: { '$lib': 'src/lib', '$lib/*': 'src/lib/*' } })");
    expect(plan.guide).toContain("Include 'sveltekit-superforms' in test.server.deps.inline");
    expect(plan.guide).toContain('retaining existing inline dependencies and test settings');
    expect(plan.guide).toContain('Do not alias or mock $app/server with an empty shim');
    expect(plan.requiresManual).toBe(true);
    applySvelteKit3Migration(plan, { confirmed: true });
    expect(read('vitest.config.ts')).toBe(original);
    expect(read(SVELTEKIT3_GUIDE_PATH)).toContain('real $app/server side-effect marker');
  });

  it.each([
    { '@sveltejs/kit': { cookie: '^0.7.2' } },
    { exceljs: { uuid: '^11.1.1' }, '@sveltejs/kit': { cookie: '^0.7.2' } },
    { '@sveltejs/kit': { cookie: '^0.7.2' }, exceljs: { uuid: '^11.1.1' } },
    { exceljs: { uuid: '^11.1.1' }, '@sveltejs/kit': { cookie: '^0.7.2' }, custom: '^1.2.3' },
    { '@sveltejs/kit': { cookie: '^0.7.2' }, '@sveltejs/kit@^2': { cookie: '^0.7.2' } },
    { custom: '^1.2.3', '@sveltejs/kit': { cookie: '^0.7.2' }, '@sveltejs/kit@^2': { cookie: '^0.7.2' } },
  ])('removes only exact recognized Kit 2 cookie overrides with valid property separators: %j', async (overrides) => {
    write('package.json', packageJson({ overrides, engines: { node: '^22.12.0 || >=24.0.0' } }));
    const plan = await planSvelteKit3Migration(root);
    expect(plan.errors).toEqual([]);
    applySvelteKit3Migration(plan, { confirmed: true });
    expect(JSON.parse(read('package.json')).overrides).toEqual(Object.fromEntries(Object.entries(overrides).filter(([key]) => !key.startsWith('@sveltejs/kit'))));
    expect((await planSvelteKit3Migration(root)).edits).toEqual([]);
  });

  it('does not add optional integration packages or update formsnap without Superforms', async () => {
    write('package.json', packageJson({ dependencies: { '@beeblock/svelar': '^0.8.0', formsnap: '^2.0.1' } }));
    const plan = await planSvelteKit3Migration(root);
    expect(plan.errors).toEqual([]);
    applySvelteKit3Migration(plan, { confirmed: true });
    const pkg = JSON.parse(read('package.json'));
    expect(pkg.dependencies.formsnap).toBe('^2.0.1');
    expect(pkg.devDependencies['@sveltejs/adapter-node']).toBeUndefined();
    expect(pkg.devDependencies['sveltekit-superforms']).toBeUndefined();
  });
});

describe('style-only dependency SSR migration', () => {
  function app(config: string, css = true): void {
    const pkg = JSON.parse(packageJson());
    if (css) pkg.dependencies['tw-animate-css'] = '^1.4.0';
    write('package.json', JSON.stringify(pkg, null, 2) + '\n');
    rmSync(join(root, 'svelte.config.js'));
    write('vite.config.ts', "import { defineConfig } from 'vite';\nexport default defineConfig(" + config + ');\n');
  }

  it('adds to the recognized list while preserving custom externals, other Vite settings and CSS/source bytes', async () => {
    app("{ ssr: { external: ['custom-server'], noExternal: ['@lucide/svelte', '@tabler/icons-svelte', 'bits-ui'], resolve: { conditions: ['custom'] } }, server: { port: 5199 } }");
    write('src/app.css', '@import "tw-animate-css";\n/* app-owned CSS */\n');
    const original = read('vite.config.ts');
    const bootstrap = read('src/app.ts');
    const css = read('src/app.css');
    const plan = await planSvelteKit3Migration(root);
    expect(plan.errors).toEqual([]);
    expect(plan.manualSteps.join('\n')).not.toContain('SSR manual blocker');
    applySvelteKit3Migration(plan, { confirmed: true });
    expect(read('vite.config.ts')).toBe(original.replace("'bits-ui']", "'bits-ui', \"tw-animate-css\"]"));
    expect(read('vite.config.ts.sveltekit3.bak')).toBe(original);
    expect(read('src/app.ts')).toBe(bootstrap);
    expect(read('src/app.css')).toBe(css);
    expect((await planSvelteKit3Migration(root)).edits).toEqual([]);
  });

  it.each([
    "{ plugins: [], ssr: { external: ['custom-server'], noExternal: [] } }",
    "{ plugins: [], ssr: { external: ['custom-server'] } }",
    '{ plugins: [], server: { port: 5199 } }',
    "() => { const custom = true; return { plugins: [], ssr: { noExternal: ['existing',] }, build: { custom } }; }",
  ])('adds missing/static SSR configuration without duplicate edits and remains idempotent: %s', async (config) => {
    app(config);
    const plan = await planSvelteKit3Migration(root);
    expect(plan.errors).toEqual([]);
    const edits = plan.edits.filter((edit) => edit.path === 'vite.config.ts');
    expect(edits).toHaveLength(1);
    expect(edits[0].updated!.toString().match(/tw-animate-css/g)).toHaveLength(1);
    applySvelteKit3Migration(plan, { confirmed: true });
    expect((await planSvelteKit3Migration(root)).edits).toEqual([]);
  });

  it.each(['true', "['existing', 'tw-animate-css']"] )('does not alter noExternal=%s or add duplicate entries', async (noExternal) => {
    app(`{ ssr: { noExternal: ${noExternal}, external: ['kept'] } }`);
    const original = read('vite.config.ts');
    const plan = await planSvelteKit3Migration(root);
    expect(plan.errors).toEqual([]);
    expect(plan.edits.some((edit) => edit.path === 'vite.config.ts')).toBe(false);
    applySvelteKit3Migration(plan, { confirmed: true });
    expect(read('vite.config.ts')).toBe(original);
    expect((await planSvelteKit3Migration(root)).edits).toEqual([]);
  });

  it.each([
    '{ ssr: { noExternal: customList } }',
    '{ ssr: { noExternal: getList() } }',
    '{ ssr: { noExternal: false } }',
    '{ ssr: { noExternal: [...customList] } }',
    '{ ssr: { noExternal: [/custom/] } }',
    '{ ssr: { noExternal: [], ...customSsr } }',
    '{ ssr: getSsr() }',
    '{ ssr: {}, ...customConfig }',
    '{ ssr: { noExternal: [], noExternal: customList } }',
    '() => { if (custom) return customConfig; return { ssr: {} }; }',
  ])('preserves ambiguous/custom SSR configuration with an explicit manual blocker: %s', async (config) => {
    app(config);
    const original = read('vite.config.ts');
    const plan = await planSvelteKit3Migration(root);
    expect(plan.errors).toEqual([]);
    expect(plan.edits.some((edit) => edit.path === 'vite.config.ts')).toBe(false);
    expect(plan.manualSteps.join('\n')).toContain('tw-animate-css SSR manual blocker');
    expect(plan.guide).toContain('Custom noExternal/SSR source is preserved');
    applySvelteKit3Migration(plan, { confirmed: true });
    expect(read('vite.config.ts')).toBe(original);
  });

  it('does not add CSS-specific SSR config or checklist items when the dependency is absent', async () => {
    app('{ ssr: { noExternal: [] } }', false);
    const plan = await planSvelteKit3Migration(root);
    expect(plan.errors).toEqual([]);
    expect(plan.edits.some((edit) => edit.path === 'vite.config.ts')).toBe(false);
    expect(plan.manualSteps.join('\n')).not.toContain('tw-animate-css');
  });
});

describe('migration safety', () => {
  it('requires approval and rejects forged or mutated plans', async () => {
    const plan = await planSvelteKit3Migration(root);
    expect(() => applySvelteKit3Migration(plan, { confirmed: false })).toThrow('requires');
    expect(() => applySvelteKit3Migration({ ...plan }, { confirmed: true })).toThrow('Untrusted');
    plan.edits[0].updated![0] ^= 1;
    expect(() => applySvelteKit3Migration(plan, { confirmed: true })).toThrow('modified');
    expect(backupFiles()).toEqual([]);
  });

  it('rejects a path traversal injected into a reviewed plan', async () => {
    const plan = await planSvelteKit3Migration(root);
    (plan.edits[0] as { path: string }).path = '../escaped-package.json';
    expect(() => applySvelteKit3Migration(plan, { confirmed: true })).toThrow('modified');
    expect(backupFiles()).toEqual([]);
    expect(existsSync(join(root, '../escaped-package.json'))).toBe(false);
  });

  it.each(['package.json', 'svelte.config.js', 'vite.config.ts', 'svelar.validation.json', 'src/app.ts'])('rejects stale %s before all writes/backups', async (path) => {
    const plan = await planSvelteKit3Migration(root);
    write(path, read(path) + '\n');
    expect(() => applySvelteKit3Migration(plan, { confirmed: true })).toThrow('changed after planning');
    expect(backupFiles()).toEqual([]);
    expect(existsSync(join(root, SVELTEKIT3_GUIDE_PATH))).toBe(false);
  });

  it('rejects source inventory, absent-file and permission changes after planning', async () => {
    let plan = await planSvelteKit3Migration(root);
    write('src/new.ts', 'export {};');
    expect(() => applySvelteKit3Migration(plan, { confirmed: true })).toThrow('inventory changed');
    plan = await planSvelteKit3Migration(root);
    write('svelte.config.mjs', 'export default {};');
    expect(() => applySvelteKit3Migration(plan, { confirmed: true })).toThrow('changed after planning');
    rmSync(join(root, 'svelte.config.mjs'));
    plan = await planSvelteKit3Migration(root);
    chmodSync(join(root, 'package.json'), 0o600);
    expect(() => applySvelteKit3Migration(plan, { confirmed: true })).toThrow('changed after planning');
    expect(backupFiles()).toEqual([]);
  });

  it.each(['svelte.config.js', 'package.json', 'vite.config.ts', 'svelar.validation.json', 'src/app.ts'])('rejects symlinked %s', async (path) => {
    write('outside.txt', read(path));
    rmSync(join(root, path));
    symlinkSync(join(root, 'outside.txt'), join(root, path));
    const plan = await planSvelteKit3Migration(root);
    expect(plan.errors.join('\n')).toContain('symlinks');
    expect(() => applySvelteKit3Migration(plan, { confirmed: true })).toThrow('preflight failed');
    expect(backupFiles()).toEqual([]);
  });

  it('rejects symlinked parents, root and backup paths without touching targets', async () => {
    const parentPlan = await planSvelteKit3Migration(root);
    renameSync(join(root, 'src'), join(root, 'saved-src'));
    symlinkSync(join(root, 'saved-src'), join(root, 'src'));
    expect(() => applySvelteKit3Migration(parentPlan, { confirmed: true })).toThrow('symlinks');
    await expect(planSvelteKit3Migration(join(root, 'src'))).rejects.toThrow('root must not be a symlink');
    unlinkSync(join(root, 'src'));
    renameSync(join(root, 'saved-src'), join(root, 'src'));
    const plan = await planSvelteKit3Migration(root);
    symlinkSync(join(root, 'private-secret'), join(root, 'package.json.sveltekit3.bak'));
    expect(() => applySvelteKit3Migration(plan, { confirmed: true })).toThrow('symlinks');
    expect(existsSync(join(root, 'private-secret'))).toBe(false);
    expect(read('svelte.config.js')).toBe(legacy);
  });

  it('does not overwrite regular backups, custom guides, locks or ambiguous package specs', async () => {
    write('package.json.sveltekit3.bak', 'older backup');
    let plan = await planSvelteKit3Migration(root);
    expect(applySvelteKit3Migration(plan, { confirmed: true })).toContain('package.json.sveltekit3.bak.1');
    expect(read('package.json.sveltekit3.bak')).toBe('older backup');
    write(SVELTEKIT3_GUIDE_PATH, '# My own upgrade notes\n');
    plan = await planSvelteKit3Migration(root);
    expect(plan.errors.join('\n')).toContain('guide conflicts');
    expect(() => applySvelteKit3Migration(plan, { confirmed: true })).toThrow('preflight failed');
  });

  it.each([
    { imports: { '#lib/*': './custom/*' } },
    { engines: { node: '>=20 <23' } },
    { devDependencies: { '@sveltejs/kit': 'workspace:*' } },
    { overrides: { '@sveltejs/kit': '^2.70.3' } },
    { overrides: { '@sveltejs/kit': { cookie: '^0.7.1' } } },
    { overrides: { '@sveltejs/kit': { cookie: '^0.7.2', custom: '^1.0.0' } } },
    { resolutions: { '@sveltejs/kit': '^2.70.3' } },
    { pnpm: { overrides: { '@sveltejs/kit': { cookie: '^0.7.2' } } } },
    { engines: { node: '^22.12.0 || >=25.0.0' } },
  ])('fails closed on custom dependency/import constraints: %j', async (overrides) => {
    const original = packageJson(overrides);
    write('package.json', original);
    const plan = await planSvelteKit3Migration(root);
    expect(plan.errors.length).toBeGreaterThan(0);
    expect(() => applySvelteKit3Migration(plan, { confirmed: true })).toThrow('preflight failed');
    expect(read('package.json')).toBe(original);
    expect(backupFiles()).toEqual([]);
  });

  it('blocks duplicate JSON keys and malformed source before all writes', async () => {
    write('package.json', '{"devDependencies":{"@sveltejs/kit":"^2.70.3","@sveltejs/kit":"^3.0.0"}}');
    let plan = await planSvelteKit3Migration(root);
    expect(plan.errors.join('\n')).toContain('Duplicate key');
    write('package.json', packageJson());
    write('src/broken.ts', 'export const = broken;');
    plan = await planSvelteKit3Migration(root);
    expect(plan.errors.join('\n')).toContain('src/broken.ts');
    expect(() => applySvelteKit3Migration(plan, { confirmed: true })).toThrow('preflight failed');
    expect(backupFiles()).toEqual([]);
  });

  it('rolls back earlier edits on write failure, retains exact backups and cleans temporary files', async () => {
    const plan = await planSvelteKit3Migration(root);
    const originals = new Map(plan.edits.filter((edit) => edit.original !== null).map((edit) => [edit.path, edit.original]));
    vi.mocked(renameSync).mockImplementation((from, to) => {
      if (String(to) === join(root, 'vite.config.ts')) throw new Error('simulated write failure');
      fs.renameSync(from, to);
    });
    expect(() => applySvelteKit3Migration(plan, { confirmed: true })).toThrow('simulated write failure');
    for (const [path, content] of originals) expect(readFileSync(join(root, path))).toEqual(content);
    expect(existsSync(join(root, SVELTEKIT3_GUIDE_PATH))).toBe(false);
    expect(backupFiles().some((path) => path.endsWith('.tmp') || path.endsWith('.lock'))).toBe(false);
    expect(read('package.json.sveltekit3.bak')).toBe(originals.get('package.json')!.toString());
  });

  it('completes backups before any source writes and aborts on backup creation failure', async () => {
    const plan = await planSvelteKit3Migration(root);
    vi.mocked(openSync).mockImplementation((path, flags, mode) => {
      if (String(path) === join(root, 'vite.config.ts.sveltekit3.bak')) throw new Error('simulated backup failure');
      return fs.openSync(path, flags, mode);
    });
    expect(() => applySvelteKit3Migration(plan, { confirmed: true })).toThrow('simulated backup failure');
    for (const edit of plan.edits.filter((edit) => edit.original !== null)) {
      expect(readFileSync(join(root, edit.path))).toEqual(edit.original);
    }
    expect(read('package.json.sveltekit3.bak')).toBe(packageJson());
    expect(existsSync(join(root, SVELTEKIT3_GUIDE_PATH))).toBe(false);
    expect(existsSync(join(root, '.svelar-sveltekit3-migration.lock'))).toBe(false);
  });

  it('does not overwrite a guide created by another writer after preflight', async () => {
    const plan = await planSvelteKit3Migration(root);
    vi.mocked(linkSync).mockImplementation((from, to) => {
      if (String(to) === join(root, SVELTEKIT3_GUIDE_PATH)) write(SVELTEKIT3_GUIDE_PATH, '# Concurrent user guide\n');
      fs.linkSync(from, to);
    });
    expect(() => applySvelteKit3Migration(plan, { confirmed: true })).toThrow('Migration failed');
    expect(read(SVELTEKIT3_GUIDE_PATH)).toBe('# Concurrent user guide\n');
    expect(read('package.json')).toBe(packageJson());
    expect(read('vite.config.ts')).toBe(vite);
    expect(read('svelte.config.js')).toBe(legacy);
  });

  it('refuses hard-linked sources and non-file backup conflicts', async () => {
    linkSync(join(root, 'package.json'), join(root, 'linked-package.json'));
    let plan = await planSvelteKit3Migration(root);
    expect(plan.errors.join('\n')).toContain('one link');
    expect(() => applySvelteKit3Migration(plan, { confirmed: true })).toThrow('preflight failed');
    unlinkSync(join(root, 'linked-package.json'));
    plan = await planSvelteKit3Migration(root);
    mkdirSync(join(root, 'vite.config.ts.sveltekit3.bak'));
    expect(() => applySvelteKit3Migration(plan, { confirmed: true })).toThrow('non-regular');
    expect(existsSync(join(root, 'package.json.sveltekit3.bak'))).toBe(false);
  });

  it('preserves concurrently changed output during rollback and reports manual recovery', async () => {
    const plan = await planSvelteKit3Migration(root);
    vi.mocked(renameSync).mockImplementation((from, to) => {
      if (String(to) === join(root, 'vite.config.ts')) {
        write('package.json', '{"concurrent":"user work"}\n');
        throw new Error('simulated concurrent write');
      }
      fs.renameSync(from, to);
    });
    expect(() => applySvelteKit3Migration(plan, { confirmed: true })).toThrow('Rollback needs manual review');
    expect(read('package.json')).toBe('{"concurrent":"user work"}\n');
    expect(read('package.json.sveltekit3.bak')).toBe(packageJson());
  });

  it('refuses an existing migration lock before creating backups', async () => {
    write('.svelar-sveltekit3-migration.lock', 'another migration');
    const plan = await planSvelteKit3Migration(root);
    expect(() => applySvelteKit3Migration(plan, { confirmed: true })).toThrow();
    expect(backupFiles()).toEqual([]);
    expect(read('.svelar-sveltekit3-migration.lock')).toBe('another migration');
  });
});

describe('update command integration', () => {
  it.each([false, true])('allows additive Kit 2 core migration updates without changing schema history or config (DDD=%s)', async (ddd) => {
    if (ddd) mkdirSync(join(root, 'src/lib/modules'), { recursive: true });
    write('package.json', published080.manifest);
    write('.env', 'APP_KEY=preserved-private-key\n');
    write('src/lib/database/migrations/custom_app_table.ts', '// app-owned schema history\n');
    process.chdir(root);
    const command = new UpdateCommand();
    const migrations = (command as any).getFileManifest(ddd, 'published-080')
      .filter((file: any) => file.category === 'migration' && file.ownership === 'framework');
    expect(migrations.length).toBeGreaterThan(0);
    const existing = migrations[0].path;
    write(existing, '// existing core migration history must not be rewritten\r\n');
    const preserved = new Map(['package.json', 'vite.config.ts', 'svelte.config.js', 'tsconfig.json',
      'svelar.validation.json', 'src/app.ts', '.env', existing, 'src/lib/database/migrations/custom_app_table.ts']
      .map((path) => [path, readFileSync(join(root, path))]));
    for (const flag of ['dry-run', 'list']) {
      await command.handle([], { force: true, category: 'migration', [flag]: true });
      expect(command.exitCode).toBe(0);
      expect(existsSync(join(root, migrations[1].path))).toBe(false);
    }
    await command.handle([], { force: true, category: 'migration' });
    expect(command.exitCode).toBe(0);
    for (const [path, bytes] of preserved) expect(readFileSync(join(root, path))).toEqual(bytes);
    for (const file of migrations.slice(1)) expect(read(file.path)).toBe(file.content());
    expect(existsSync(join(root, `${existing}.bak`))).toBe(false);
    expect(existsSync(join(root, 'src/svelar.d.ts'))).toBe(false);
    expect(existsSync(join(root, '.env.example'))).toBe(false);
    expect(backupFiles()).toEqual([]);
    await command.handle([], { force: true, category: 'migration' });
    expect(read(existing)).toBe('// existing core migration history must not be rewritten\r\n');
    expect(vi.mocked(console.log).mock.calls.flat().join('\n')).toContain('No SvelteKit major upgrade');
  });

  it.each([
    { category: 'config' }, { category: 'route' }, { category: 'page' }, { category: 'domain' },
    { category: 'job' }, { category: 'seeder' },
    { category: 'migration', 'include-user-files': true },
    { category: 'config', 'add-missing-user-files': true },
    { category: 'migration', 'add-missing-user-files': true },
  ])('does not extend the Kit 2 migration exception to unsafe writes: %j', async (flags) => {
    process.chdir(root);
    const command = new UpdateCommand();
    await command.handle([], { force: true, ...flags });
    expect(command.exitCode).toBe(1);
    expect(read('package.json')).toBe(packageJson());
    expect(read('svelte.config.js')).toBe(legacy);
    expect(read('vite.config.ts')).toBe(vite);
    expect(existsSync(join(root, 'src/svelar.d.ts'))).toBe(false);
    expect(existsSync(join(root, 'src/lib/database/migrations'))).toBe(false);
    expect(existsSync(join(root, '.env.example'))).toBe(false);
  });

  it('requires approval for focused Kit 2 core migration additions and preflights symlink parents', async () => {
    process.chdir(root);
    const unapproved = new UpdateCommand();
    await unapproved.handle([], { category: 'migration' });
    expect(unapproved.exitCode).toBe(1);
    expect(existsSync(join(root, 'src/lib'))).toBe(false);
    write('outside/marker', 'unchanged');
    symlinkSync(join(root, 'outside'), join(root, 'src/lib'));
    await expect(new UpdateCommand().handle([], { force: true, category: 'migration' })).rejects.toThrow('parent is not an app-owned directory');
    expect(read('outside/marker')).toBe('unchanged');
    expect(existsSync(join(root, 'outside/database'))).toBe(false);
  });

  it.each(['dry-run', 'list'])('allows existing Kit 2 read-only --%s scaffold diagnostics without writing', async (flag) => {
    write('package.json', published080.manifest);
    process.chdir(root);
    const command = new UpdateCommand();
    await command.handle([], { [flag]: true, force: true, category: 'config' });
    expect(command.exitCode).toBe(0);
    expect(vi.mocked(console.log).mock.calls.flat().join('\n')).toContain('Read-only scaffold diagnostics');
    expect(read('package.json')).toBe(published080.manifest);
    expect(read('svelte.config.js')).toBe(legacy);
    expect(read('vite.config.ts')).toBe(vite);
    expect(existsSync(join(root, '.env.example'))).toBe(false);
    expect(backupFiles()).toEqual([]);
  });

  it.each(['dry-run', 'list'])('prints a plan/guide with --%s without creating any files', async (flag) => {
    process.chdir(root);
    await new UpdateCommand().handle([], { 'migrate-sveltekit3': true, force: true, [flag]: true });
    expect(backupFiles()).toEqual([]);
    expect(existsSync(join(root, SVELTEKIT3_GUIDE_PATH))).toBe(false);
    expect(read('svelte.config.js')).toBe(legacy);
    expect(vi.mocked(console.log).mock.calls.flat().join('\n')).toContain('Human And AI Checklist');
  });

  it('guards bare forced updates on Kit 2 apps without affecting their custom config', async () => {
    process.chdir(root);
    const command = new UpdateCommand();
    await command.handle([], { force: true });
    expect(command.exitCode).toBe(1);
    expect(read('vite.config.ts')).toBe(vite);
    expect(read('svelte.config.js')).toBe(legacy);
    expect(read('package.json')).toBe(packageJson());
    expect(existsSync(join(root, '.env.example'))).toBe(false);
    expect(backupFiles()).toEqual([]);
  });

  it('recognizes an already-migrated Kit 3 manifest with a preserved BOM', async () => {
    write('package.json', '\uFEFF' + packageJson());
    const plan = await planSvelteKit3Migration(root);
    expect(plan.errors).toEqual([]);
    applySvelteKit3Migration(plan, { confirmed: true });
    process.chdir(root);
    const command = new UpdateCommand();
    await command.handle([], { force: true, 'dry-run': true, category: 'config' });
    expect(command.exitCode).toBe(0);
    expect(read('package.json').charCodeAt(0)).toBe(0xfeff);
  });

  it.each(['migrate-zod4', 'migrate-core', 'migrate-api-fetch', 'include-user-files', 'add-missing-user-files', 'category'])('rejects mode combination --%s', async (flag) => {
    process.chdir(root);
    const command = new UpdateCommand();
    await command.handle([], { 'migrate-sveltekit3': true, force: true, [flag]: flag === 'category' ? 'config' : true });
    expect(command.exitCode).toBe(1);
    expect(backupFiles()).toEqual([]);
  });

  it('requires force outside a TTY and honors interactive cancellation/confirmation', async () => {
    process.chdir(root);
    await tty(false, async () => {
      const command = new UpdateCommand();
      await command.handle([], { 'migrate-sveltekit3': true });
      expect(command.exitCode).toBe(1);
      expect(backupFiles()).toEqual([]);
    });
    await tty(true, async () => {
      confirmation.answer = 'no';
      await new UpdateCommand().handle([], { 'migrate-sveltekit3': true });
      expect(backupFiles()).toEqual([]);
      confirmation.answer = 'yes';
      const command = new UpdateCommand();
      await command.handle([], { 'migrate-sveltekit3': true });
      expect(command.exitCode).toBe(0);
      expect(existsSync(join(root, 'svelte.config.js'))).toBe(false);
      expect(read(SVELTEKIT3_GUIDE_PATH)).toContain('NOT complete');
      expect(vi.mocked(console.log).mock.calls.flat().join('\n')).not.toContain('Update complete.');
    });
  });
});
