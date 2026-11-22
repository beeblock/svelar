import { afterEach, describe, expect, it } from 'vitest';
import {
  cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync,
  realpathSync, rmSync, writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { DeployTemplates } from '../src/cli/commands/DeployTemplates.js';

const require = createRequire(import.meta.url);
const owned: string[] = [];
const generated = 'node_modules/$app';
const snapshotDirectory = '.svelte-kit/svelar-runtime-app';

function temporary(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'svelar-docker-prune-')));
  owned.push(root);
  return root;
}
function write(root: string, path: string, content: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
}
function inventory(root: string, path = generated): Record<string, { bytes: string; mode: number }> {
  const result: Record<string, { bytes: string; mode: number }> = {};
  for (const name of readdirSync(join(root, path))) {
    const child = join(path, name);
    const stat = lstatSync(join(root, child));
    if (stat.isDirectory()) Object.assign(result, inventory(root, child));
    else {
      expect(stat.isFile()).toBe(true);
      result[child] = { bytes: readFileSync(join(root, child)).toString('base64'), mode: stat.mode & 0o777 };
    }
  }
  return result;
}
function run(root: string, command: string, args: string[]): ReturnType<typeof spawnSync> {
  return spawnSync(command, args, {
    cwd: root, encoding: 'utf8', timeout: 20000,
    env: { ...process.env, npm_config_cache: join(root, '.npm-cache'), npm_config_userconfig: join(root, '.npmrc') },
  });
}
function success(result: ReturnType<typeof spawnSync>): void {
  expect(result.error, String(result.stderr)).toBeUndefined();
  expect(result.status, String(result.stderr)).toBe(0);
}
function prune(root: string): void {
  success(run(root, 'npm', ['prune', '--omit=dev', '--ignore-scripts', '--offline', '--no-audit', '--no-fund']));
  expect(existsSync(join(root, 'node_modules/typescript'))).toBe(false);
  expect(existsSync(join(root, 'node_modules/jiti'))).toBe(true);
  expect(existsSync(join(root, 'unexpected-lifecycle'))).toBe(false);
}
function bootstrap(root: string): ReturnType<typeof spawnSync> {
  // Match Command.importUserModule: real app-owned aliases plus Jiti's real tsconfig resolver.
  return run(root, process.execPath, ['--input-type=module', '-e', `
    import { createRequire } from 'node:module';
    import { join } from 'node:path';
    try {
    const require = createRequire(join(process.cwd(), 'package.json'));
    const { createJiti } = require('jiti');
    const lib = join(process.cwd(), 'src/lib');
    const jiti = createJiti(join(process.cwd(), 'svelar-cli.mjs'), {
      alias: { '$lib': lib, '$lib/*': lib + '/*' }, tsconfigPaths: true,
      fsCache: false, moduleCache: false,
    });
    const app = await jiti.import(join(process.cwd(), 'src/bootstrap.ts'));
    if (app.worker !== 'real-pruned-worker-bootstrap') throw new Error('Wrong bootstrap result');
    } catch (error) { console.error(error.message); process.exitCode = 1; }
  `]);
}
async function fixture(kit3: boolean): Promise<string> {
  const root = temporary();
  const packages: Record<string, Record<string, unknown>> = {};
  for (const id of ['jiti', 'typescript']) {
    const packageRoot = realpathSync(dirname(require.resolve(`${id}/package.json`)));
    const metadata = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
    cpSync(realpathSync(packageRoot), join(root, 'node_modules', id), { recursive: true });
    // Local tarballs keep the real prune operation offline and independent of the user's npm cache.
    success(run(root, 'tar', ['-czf', `${id}.tgz`, '-C', dirname(packageRoot), basename(packageRoot)]));
    const integrity = `sha512-${createHash('sha512').update(readFileSync(join(root, `${id}.tgz`))).digest('base64')}`;
    packages[id] = { version: metadata.version, resolved: `file:${id}.tgz`, integrity, license: metadata.license, bin: metadata.bin,
      engines: metadata.engines, ...(id === 'typescript' ? { dev: true } : {}) };
  }
  const manifest = {
    name: 'svelar-owned-prune-fixture', version: '0.0.0', private: true, type: 'module',
    dependencies: { jiti: packages.jiti.resolved }, devDependencies: { typescript: packages.typescript.resolved },
    scripts: { prepare: "node -e \"require('node:fs').writeFileSync('unexpected-lifecycle', 'must-not-run')\"" },
  };
  write(root, 'package.json', JSON.stringify(manifest, null, 2));
  write(root, 'package-lock.json', JSON.stringify({
    name: manifest.name, version: manifest.version, lockfileVersion: 3, requires: true,
    packages: {
      '': { name: manifest.name, version: manifest.version, dependencies: manifest.dependencies, devDependencies: manifest.devDependencies },
      'node_modules/jiti': packages.jiti, 'node_modules/typescript': packages.typescript,
    },
  }, null, 2));
  write(root, 'src/lib/worker.ts', "export const marker: string = 'real-pruned-worker-bootstrap';\n");
  write(root, 'src/bootstrap.ts', "import { marker } from '$lib/worker.ts';\nexport const worker: string = marker;\n");
  mkdirSync(join(root, '.svelte-kit/types'), { recursive: true });
  write(root, 'tsconfig.json', JSON.stringify({ extends: kit3 ? '$app/tsconfig' : './.svelte-kit/tsconfig.json', include: ['src'] }));
  if (kit3) {
    const kitRoot = dirname(require.resolve('@sveltejs/kit/package.json'));
    const load = (path: string) => import(/* @vite-ignore */ pathToFileURL(join(kitRoot, path)).href);
    const { validate_config, process_config } = await load('src/core/config/index.js');
    const { write_tsconfig } = await load('src/core/sync/write_tsconfig/index.js');
    const { write_app_types } = await load('src/core/sync/write_app_types.js');
    const { write_env } = await load('src/core/sync/write_env.js');
    const config = process_config(validate_config({}), root);
    write_tsconfig(config, root);
    write_app_types(config, { routes: [], assets: [] }, root);
    write_env(null, null, root);
    expect(Object.keys(inventory(root)).sort()).toEqual([
      'node_modules/$app/tsconfig.json', 'node_modules/$app/tsconfig/service-worker.json',
      'node_modules/$app/types/env.d.ts', 'node_modules/$app/types/index.d.ts',
    ]);
  } else {
    write(root, '.svelte-kit/tsconfig.json', JSON.stringify({ compilerOptions: { target: 'ESNext', module: 'ESNext' } }));
  }
  success(bootstrap(root));
  return root;
}
function preservationCommands(): { before: string[]; after: string[] } {
  const lines = DeployTemplates.dockerfile().split('\n');
  const start = lines.indexOf('FROM builder AS deps');
  const pruneIndex = lines.indexOf('RUN npm prune --omit=dev --ignore-scripts');
  const end = lines.indexOf('FROM base AS production');
  const commands = (from: number, to: number): string[][] => lines.slice(from, to)
    .filter((line) => line.startsWith('RUN ['))
    .map((line) => JSON.parse(line.slice(4)) as string[]);
  const before = commands(start, pruneIndex);
  const after = commands(pruneIndex + 1, end);
  expect(before).toHaveLength(1);
  expect(after).toHaveLength(1);
  return { before: before[0], after: after[0] };
}
afterEach(() => {
  for (const root of owned.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('Docker production Kit 3 generated type preservation', () => {
  it('reproduces actual offline npm prune deleting genuine Kit 3 configs and breaking Jiti bootstrap', async () => {
    const root = await fixture(true);
    prune(root);
    expect(existsSync(join(root, generated))).toBe(false);
    const result = bootstrap(root);
    expect(result.status).not.toBe(0);
    expect(String(result.stderr)).toContain('$app/tsconfig');
  }, 30000);

  it('executes generated Docker snapshot/restore around real pruning and bootstraps without dev tooling', async () => {
    const root = await fixture(true);
    const original = inventory(root);
    const source = readFileSync(join(root, 'src/bootstrap.ts'));
    const commands = preservationCommands();
    success(run(root, commands.before[0], commands.before.slice(1)));
    expect(existsSync(join(root, snapshotDirectory, 'tsconfig.json'))).toBe(true);
    prune(root);
    expect(existsSync(join(root, generated))).toBe(false);
    success(run(root, commands.after[0], commands.after.slice(1)));
    expect(inventory(root)).toEqual(original);
    expect(readFileSync(join(root, 'src/bootstrap.ts'))).toEqual(source);
    expect(existsSync(join(root, 'node_modules/@sveltejs/kit'))).toBe(false);
    success(bootstrap(root));
    // Match the production COPY boundary: deps/node_modules and builder's app/config paths.
    const runtime = temporary();
    for (const path of ['node_modules', 'src']) cpSync(join(root, path), join(runtime, path), { recursive: true });
    for (const path of ['package.json', 'tsconfig.json']) cpSync(join(root, path), join(runtime, path));
    mkdirSync(join(runtime, '.svelte-kit/types'), { recursive: true });
    expect(inventory(runtime)).toEqual(original);
    expect(existsSync(join(runtime, snapshotDirectory))).toBe(false);
    success(bootstrap(runtime));
  }, 30000);

  it('keeps Kit 2 config and bootstrap unchanged when generated $app files are absent', async () => {
    const root = await fixture(false);
    const original = readFileSync(join(root, '.svelte-kit/tsconfig.json'));
    const commands = preservationCommands();
    success(run(root, commands.before[0], commands.before.slice(1)));
    prune(root);
    success(run(root, commands.after[0], commands.after.slice(1)));
    expect(existsSync(join(root, generated))).toBe(false);
    expect(readFileSync(join(root, '.svelte-kit/tsconfig.json'))).toEqual(original);
    success(bootstrap(root));
  }, 30000);

  it('uses literal exec-form paths, pruned dependencies, and no production sync/dev install', () => {
    const dockerfile = DeployTemplates.dockerfile();
    const commands = preservationCommands();
    for (const command of [commands.before, commands.after]) {
      expect(command.slice(0, 2)).toEqual(['node', '-e']);
      expect(command[2]).toContain('node_modules/$app');
      expect(command[2]).toContain(snapshotDirectory);
      expect(command[2]).not.toContain('svelte-kit sync');
    }
    expect(dockerfile).toContain('COPY --chown=sveltekit:sveltekit --from=deps /app/node_modules ./node_modules');
    expect(dockerfile).toContain('COPY --chown=sveltekit:sveltekit --from=builder /app/.svelte-kit ./.svelte-kit');
    expect(dockerfile).not.toContain('COPY --chown=sveltekit:sveltekit --from=builder /app/node_modules');
    expect(dockerfile).not.toContain('svelte-kit sync');
  });
});
