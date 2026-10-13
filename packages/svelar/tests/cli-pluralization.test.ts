import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MakeModelCommand } from '../src/cli/commands/MakeModelCommand.js';
import { MakeEntityCommand } from '../src/cli/commands/MakeEntityCommand.js';
import { MakeObserverCommand } from '../src/cli/commands/MakeObserverCommand.js';
import { loadCapabilityManifest } from '../src/cli/CapabilityScaffold.js';

const names = [
  { name: 'ApiKey', plural: 'ApiKeys', table: 'api_keys' },
  { name: 'Key', plural: 'Keys', table: 'keys' },
  { name: 'Monkey', plural: 'Monkeys', table: 'monkeys' },
  { name: 'Category', plural: 'Categories', table: 'categories' },
  { name: 'Company', plural: 'Companies', table: 'companies' },
  { name: 'Box', plural: 'Boxes', table: 'boxes' },
];
const cwd = process.cwd();
let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'svelar-cli-pluralization-'));
  process.chdir(root);
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  process.chdir(cwd);
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
});

function modelPath(ddd: boolean, module: string, name: string): string {
  return `src/lib/${ddd ? `modules/${module}/domain/models` : 'models'}/${name}.ts`;
}

function assertMigration(plural: string, table: string): void {
  const dir = join(root, 'src/lib/database/migrations');
  const files = readdirSync(dir);
  expect(files).toHaveLength(1);
  expect(files[0]).toMatch(new RegExp(`_create_${table}_table\\.ts$`));
  const migration = readFileSync(join(dir, files[0]), 'utf8');
  expect(migration).toContain(`export default class Create${plural}Table extends Migration`);
  expect(migration).toContain(`this.schema.createTable('${table}'`);
}

async function assertObserver(ddd: boolean, module: string, name: string, explicitModule = false): Promise<void> {
  for (const explicitModel of [false, true]) {
    const observer = `${name}${explicitModel ? 'Audit' : ''}Observer`;
    await new MakeObserverCommand().handle([observer], {
      ...(explicitModule ? { module } : {}),
      ...(explicitModel ? { model: name } : {}),
    });
    const path = `src/lib/${ddd ? `modules/${module}/domain/observers` : 'observers'}/${observer}.ts`;
    const content = readFileSync(join(root, path), 'utf8');
    expect(content).toContain(`import type { ${name} } from '$lib/${modelPath(ddd, module, name).slice('src/lib/'.length, -3)}.js';`);
    expect(existsSync(join(root, modelPath(ddd, module, name)))).toBe(true);
  }
}

describe.each([false, true])('shared generator pluralization (DDD=%s)', (ddd) => {
  beforeEach(() => {
    if (ddd) mkdirSync(join(root, 'src/lib/modules'), { recursive: true });
  });

  for (const generator of ['model', 'entity'] as const) {
    it.each(names)(`${generator} keeps $name table, module, migration and observer imports consistent`, async ({ name, plural, table }) => {
      if (generator === 'model') await new MakeModelCommand().handle([name], { migration: true });
      else await new MakeEntityCommand().handle([name], { public: true });
      expect(readFileSync(join(root, modelPath(ddd, table, name)), 'utf8')).toContain(`static table = '${table}';`);
      assertMigration(plural, table);
      await assertObserver(ddd, table, name);
    });

    it(`${generator} preserves an explicit module without changing table names`, async () => {
      const module = 'billing-orders';
      if (generator === 'model') await new MakeModelCommand().handle(['api-key'], { module, migration: true });
      else await new MakeEntityCommand().handle(['api-key'], { module, public: true });
      expect(readFileSync(join(root, modelPath(ddd, module, 'ApiKey')), 'utf8')).toContain("static table = 'api_keys';");
      assertMigration('ApiKeys', 'api_keys');
      await assertObserver(ddd, module, 'ApiKey', true);
    });
  }

  it('keeps default protected screen routes kebab-case while modules are snake-case', async () => {
    await new MakeEntityCommand().handle(['api-key'], { capability: 'api-keys', scope: 'platform' });
    expect(existsSync(join(root, modelPath(ddd, 'api_keys', 'ApiKey')))).toBe(true);
    expect(loadCapabilityManifest(root)!.screenForPath('/api-keys')?.screen).toBe('api-keys');
    expect(loadCapabilityManifest(root)!.screenForPath('/api_keys')).toBeNull();
  });
});

class PluralizationProbe extends MakeModelCommand {
  plural(value: string): string { return this.pluralize(value); }
}

it.each([
  ['Status', 'Statuses'], ['Brush', 'Brushes'], ['Church', 'Churches'],
  ['Quiz', 'Quizes'], ['User', 'Users'],
])('retains the existing suffix rule for %s', (name, plural) => {
  expect(new PluralizationProbe().plural(name)).toBe(plural);
});
