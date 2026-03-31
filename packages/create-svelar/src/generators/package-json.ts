/**
 * Generates the project's package.json
 */

import type { ProjectOptions } from './types.js';
import { getDatabaseDependency } from './database.js';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Read svelar version from our own package.json at build time won't work,
// so we read it at runtime from the installed @beeblock/svelar package or fall back.
function getSvelarVersion(): string {
  try {
    const __dir = dirname(fileURLToPath(import.meta.url));
    const pkgPath = join(__dir, '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    return pkg.peerDependencies?.['@beeblock/svelar']?.replace(/[^0-9.]/g, '') || pkg.version || '0.4.0';
  } catch {
    return '0.4.0';
  }
}

export function generatePackageJson(options: ProjectOptions): string {
  const svelarVersion = getSvelarVersion();

  return JSON.stringify(
    {
      name: options.projectName,
      version: '0.0.1',
      private: true,
      type: 'module',
      scripts: {
        dev: 'vite dev',
        build: 'vite build',
        preview: 'vite preview',
        svelar: 'node --loader ts-node/esm node_modules/.bin/svelar',
        migrate: 'node --loader ts-node/esm node_modules/.bin/svelar migrate',
        'migrate:rollback': 'node --loader ts-node/esm node_modules/.bin/svelar migrate --rollback',
        seed: 'node --loader ts-node/esm node_modules/.bin/svelar seed:run',
      },
      devDependencies: {
        '@sveltejs/adapter-auto': '^3.0.0',
        '@sveltejs/kit': '^2.0.0',
        '@sveltejs/vite-plugin-svelte': '^5.0.0',
        svelte: '^5.0.0',
        'svelte-check': '^4.0.0',
        typescript: '^5.7.0',
        vite: '^6.0.0',
        'ts-node': '^10.9.0',
        tailwindcss: '^4.0.0',
        '@tailwindcss/vite': '^4.0.0',
      },
      dependencies: {
        '@beeblock/svelar': `^${svelarVersion}`,
        'drizzle-orm': '^0.38.0',
        zod: '^3.23.0',
        ...getDatabaseDependency(options.database),
      },
    },
    null,
    2
  );
}
