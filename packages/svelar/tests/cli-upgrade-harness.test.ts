import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync,
} from 'node:fs';
import { spawnSync as realSpawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { applyZod4Migration, planZod4Migration } from '../src/cli/Zod4Migration.js';
import { UpdateCommand } from '../src/cli/commands/UpdateCommand.js';
import { applyCoreScaffoldMigration, planCoreScaffoldMigrationFromSource } from '../src/cli/CoreScaffoldMigration.js';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const smokePath = fileURLToPath(new URL('../../../scripts/release-smoke.mjs', import.meta.url));
const smokeSource = readFileSync(smokePath, 'utf8');
const parsed = ts.createSourceFile(smokePath, smokeSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const names = [
  'snapshotHistoricalSource', 'expectedHistoricalAdapterSource', 'assertHistoricalSource',
  'expectedHistoricalCorePlan', 'certifyHistoricalCoreMigration',
  'certifyHistoricalUpgrade', 'readUpgradeUsers', 'assertUpgradeData', 'certifyHistoricalLogin',
];
const functions = parsed.statements.filter((node) => ts.isFunctionDeclaration(node) && names.includes(node.name?.text ?? ''));
const definitions = functions.map((node) => node.getText(parsed)).join('\n');
type Provider = 'zod' | 'valibot';
type Users = Array<{ id: number; fingerprint: string }>;
type Original = { files: Map<string, Buffer>; users: Users };
type Target = { validation: Provider; name: string; port: number };
interface Harness {
  snapshotHistoricalSource(root: string): Map<string, Buffer>;
  expectedHistoricalAdapterSource(root: string, path: string, original: Buffer): Buffer;
  assertHistoricalSource(root: string, originals: Map<string, Buffer>, expected?: Map<string, Buffer>, backups?: boolean): void;
  certifyHistoricalUpgrade(root: string, target: Target, env: Record<string, string>, original: Original): void;
  assertUpgradeData(root: string, env: Record<string, string>, users: Users): void;
  certifyHistoricalLogin(root: string, target: Target, env: Record<string, string>): void;
}

let root: string;
let cwd: string;
const seededUsers: Users = [{ id: 1, fingerprint: 'original-complete-record-digest' }];
const target: Target = { validation: 'zod', name: 'historical-test', port: 5199 };

function write(path: string, content: string | Buffer): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
}

function harness(run = vi.fn(), spawnSync = vi.fn()): Harness {
  return runInNewContext(`${definitions}\n({${names.join(',')}})`, {
    existsSync, readFileSync, readdirSync, join, relative, createRequire, Buffer,
    process, JSON, console, corePackageRoot: packageRoot, run, spawnSync, recordVerificationStep: vi.fn(), section: vi.fn(),
    fail: (message: string) => { throw new Error(message); },
  }) as Harness;
}

function fixture(provider: Provider, flat: boolean): void {
  write('package.json', JSON.stringify({ name: 'historical-test', type: 'module', dependencies: {
    zod: '^3.23.0', 'sveltekit-superforms': '^2.27.0', '@beeblock/svelar': 'file:../current.tgz',
  } }, null, 2) + '\n');
  write('svelar.validation.json', JSON.stringify({ validation: provider }) + '\n');
  write('.env', Buffer.from('APP_KEY=original-secret\r\n# original marker\r\n'));
  write('src/app.ts', '// original customization marker\r\nexport const custom = true;\r\n');
  const model = flat ? 'src/lib/models/User.ts' : 'src/lib/modules/auth/domain/models/User.ts';
  write(model, 'export class User {}\n');
  write('src/lib/database/seeders/DatabaseSeeder.ts', '// customized original seeder\n');
  write('src/lib/database/migrations/00000001_create_users_table.ts', '// customized original migration\n');
  write('src/routes/login/+page.server.ts', provider === 'zod'
    ? "import { zod as formAdapter } from 'sveltekit-superforms/adapters';\n// custom zod call and marker\nconst example = 'zod';\n"
    : "import { valibot as formAdapter } from 'sveltekit-superforms/adapters';\n// customized valibot schema\n");
  write('src/routes/login/+page.svelte', `<script lang="ts">\nimport { ${provider === 'zod' ? 'zodClient' : 'valibotClient'} as client } from 'sveltekit-superforms/adapters';\n</script>\n<p>original zodClient customization marker</p>\n`);
}

beforeEach(() => {
  cwd = process.cwd();
  root = mkdtempSync(join(packageRoot, '.test-upgrade-'));
  process.chdir(root);
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  process.chdir(cwd);
  rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('Historical upgrade harness', () => {
  it.each([
    { provider: 'zod', flat: false }, { provider: 'zod', flat: true },
    { provider: 'valibot', flat: false }, { provider: 'valibot', flat: true },
  ] as const)('certifies explicit installed migration and original source preservation ($provider, flat=$flat)', async ({ provider, flat }) => {
    fixture(provider, flat);
    const pending: Promise<void>[] = [];
    const plan = await planZod4Migration(root);
    expect(plan.errors).toEqual([]);
    const run = vi.fn((_command: string, args: string[]) => {
      if (args.includes('--migrate-zod4') && args.includes('--force')) applyZod4Migration(plan, { confirmed: true });
      if (args.includes('--migrate-core') && args.includes('--force')) applyCoreScaffoldMigration(planCoreScaffoldMigrationFromSource(root, ts), { confirmed: true });
      if (args.includes('--add-missing-user-files') || args.includes('--category=migration')) {
        pending.push(new UpdateCommand().handle([], {
          'add-missing-user-files': args.includes('--add-missing-user-files'),
          'dry-run': args.includes('--dry-run'), force: args.includes('--force'),
          category: args.includes('--category=migration') ? 'migration' : 'config',
        }));
      }
    });
    const api = harness(run);
    const original = { files: api.snapshotHistoricalSource(root), users: seededUsers };
    api.certifyHistoricalUpgrade(root, { ...target, validation: provider }, {}, original);
    await Promise.all(pending);
    const migrationCalls = run.mock.calls.filter(([, args]) => args.includes('--migrate-zod4'));
    expect(migrationCalls).toHaveLength(provider === 'zod' ? 2 : 0);
    if (provider === 'zod') {
      expect(migrationCalls[0][1]).toContain('--dry-run');
      expect(migrationCalls[1][1]).toContain('--force');
      expect(migrationCalls.every(([command, args]) => command === process.execPath
        && args[0] === join(root, 'node_modules/@beeblock/svelar/dist/cli/bin.js'))).toBe(true);
    }
    expect(run.mock.calls.filter(([command]) => command === 'npm')).toHaveLength(provider === 'zod' ? 1 : 0);
    expect(readFileSync(join(root, 'src/svelar.d.ts'), 'utf8')).toContain(flat
      ? '$lib/models/User.js' : '$lib/modules/auth/domain/models/User.js');
    expect(readFileSync(join(root, '.env'))).toEqual(original.files.get('.env'));
    expect(readFileSync(join(root, 'src/lib/database/seeders/DatabaseSeeder.ts')))
      .toEqual(original.files.get('src/lib/database/seeders/DatabaseSeeder.ts'));
    expect(run.mock.calls.some(([, args]) => args.includes('--include-user-files'))).toBe(false);
    const coreCalls = run.mock.calls.filter(([, args]) => args.includes('--migrate-core'));
    expect(coreCalls).toHaveLength(2);
    expect(coreCalls[0][1]).toContain('--dry-run');
    expect(coreCalls[1][1]).toContain('--force');
  });

  it('rejects unexpected user source changes before invoking migration or any additions', () => {
    fixture('zod', false);
    const run = vi.fn();
    const api = harness(run);
    const original = { files: api.snapshotHistoricalSource(root), users: seededUsers };
    write('src/app.ts', '// overwritten by update');
    expect(() => api.certifyHistoricalUpgrade(root, target, {}, original)).toThrow('beyond approved adapter import tokens');
    expect(run).not.toHaveBeenCalled();
  });

  it('rejects a migration dry-run that modifies source or creates backups', () => {
    fixture('zod', false);
    const run = vi.fn((_command: string, args: string[]) => {
      if (args.includes('--migrate-zod4')) write('package.json.zod4.bak', 'not an allowed dry-run write');
    });
    const api = harness(run);
    const original = { files: api.snapshotHistoricalSource(root), users: seededUsers };
    expect(() => api.certifyHistoricalUpgrade(root, target, {}, original)).toThrow('dry-run created a backup');
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('rejects inexact source backups even if the approved migrated source is correct', () => {
    fixture('zod', false);
    const api = harness();
    const originals = api.snapshotHistoricalSource(root);
    const expected = new Map(originals);
    const path = 'src/routes/login/+page.server.ts';
    const original = originals.get(path);
    expect(original).toBeDefined();
    if (!original) throw new Error('Missing fixture');
    const updated = api.expectedHistoricalAdapterSource(root, path, original);
    expected.set(path, updated);
    write(path, updated);
    write(`${path}.zod4.bak`, 'not the original');
    expect(() => api.assertHistoricalSource(root, originals, expected, true)).toThrow('inexact original Zod migration backup');
  });

  it('reinstalls only when migration actually updates the manifest', () => {
    fixture('zod', false);
    const api = harness();
    const original = { files: api.snapshotHistoricalSource(root), users: seededUsers };
    for (const [path, content] of original.files) write(path, api.expectedHistoricalAdapterSource(root, path, content));
    const migrated = { files: api.snapshotHistoricalSource(root), users: seededUsers };
    write('src/svelar.d.ts', '// already installed custom ambient types');
    const run = vi.fn();
    harness(run).certifyHistoricalUpgrade(root, target, {}, migrated);
    expect(run.mock.calls.some(([command]) => command === 'npm')).toBe(false);
    expect(readFileSync(join(root, 'src/svelar.d.ts'), 'utf8')).toContain('already installed custom');
  });

  it('requires exact seeded records, not merely a positive user count', () => {
    const spawnSync = vi.fn(() => ({ status: 0, stdout: `UPGRADE_USERS_JSON ${JSON.stringify(seededUsers)}\n`, stderr: '' }));
    const api = harness(vi.fn(), spawnSync);
    expect(() => api.assertUpgradeData(root, {}, seededUsers)).not.toThrow();
    expect(() => api.assertUpgradeData(root, {}, [{ ...seededUsers[0], fingerprint: 'changed-record-digest' }])).toThrow('changed existing seeded user records');
    expect(spawnSync.mock.calls).toHaveLength(2);
  });

  it('fingerprints full stored user records without emitting passwords or tokens', () => {
    const spawnSync = vi.fn(() => ({ status: 0, stdout: `UPGRADE_USERS_JSON ${JSON.stringify(seededUsers)}\n`, stderr: '' }));
    harness(vi.fn(), spawnSync).assertUpgradeData(root, {}, seededUsers);
    const input = (spawnSync.mock.calls[0] as unknown as [string, string[], { input: string }])[2].input;
    const suffix = '\n.exit\n';
    expect(input.endsWith(suffix)).toBe(true);
    const program = input.slice(0, -suffix.length);
    const original = { id: 1, name: 'Admin', password: 'stored-test-password-hash', remember_token: 'stored-test-token', created_at: '2026-01-01' };
    const rows = [original, { ...original, password: 'changed-hash' }, { ...original, remember_token: 'changed-token' }, { ...original, created_at: '2026-02-01' }];
    const fingerprints = rows.map((row) => {
      const prelude = `const row = ${JSON.stringify(row)}; const User = { query: () => ({ orderBy: () => ({ get: async () => [{ id: row.id, getAttributes: () => row }] }) }) };\n`;
      const result = realSpawnSync(process.execPath, ['--input-type=module'], { input: prelude + program, encoding: 'utf8', timeout: 5000 });
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).not.toContain(row.password);
      expect(result.stdout).not.toContain(row.remember_token);
      const match = result.stdout.match(/UPGRADE_USERS_JSON (\[[^\r\n]*\])/);
      expect(match).not.toBeNull();
      return JSON.parse(match![1])[0].fingerprint;
    });
    expect(new Set(fingerprints).size).toBe(rows.length);
  });

  it('generates a syntactically valid bounded historical login/reload probe without invoking full browser smoke', () => {
    const spawnSync = vi.fn(() => ({ status: 0 }));
    harness(vi.fn(), spawnSync).certifyHistoricalLogin(root, target, {});
    const call = spawnSync.mock.calls[0] as unknown as [string, string[], { input: string }];
    expect(call[1]).toEqual(['--input-type=module']);
    expect(realSpawnSync(process.execPath, ['--check', '--input-type=module'], { input: call[2].input }).status).toBe(0);
    expect(call[2].input).toContain('page.reload');
    expect(call[2].input).toContain('Date.now() + 60000');
    expect(call[2].input).toContain("stop('SIGKILL')");
    expect(call[2].input).not.toContain('browser-smoke.mjs');
  });

  it('requires historical type-check/login before tests can refresh or reseed the database', () => {
    const smokeApp = parsed.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'smokeApp');
    const body = smokeApp?.getText(parsed) ?? '';
    expect(body.indexOf('certifyHistoricalLogin')).toBeGreaterThan(body.indexOf('svelte-check'));
    expect(body.indexOf('certifyHistoricalLogin')).toBeLessThan(body.indexOf('Testing ${target.name}'));
    expect(body).toContain('assertUpgradeData(appDir, env, originalSource.users)');
  });
});
