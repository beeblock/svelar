import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { transformScaffoldFile } from '../src/cli/commands/NewCommand.js';
import { NewCommandTemplates as T } from '../src/cli/commands/NewCommandTemplates.js';
import { Connection } from '../src/database/Connection.js';
import { Migration } from '../src/database/Migration.js';
import { QueryBuilder } from '../src/orm/QueryBuilder.js';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const sourceRoot = join(packageRoot, 'src');

class PreserveConfiguredDatabase extends Migration {
  async up() {
    await this.schema.createTable('configured_records', (table) => { table.increments('id'); table.string('marker'); });
  }
}

describe('Executed generated authentication examples', () => {
  it.each([
    { provider: 'zod', flat: false }, { provider: 'valibot', flat: false },
    { provider: 'zod', flat: true }, { provider: 'valibot', flat: true },
  ] as const)('runs real emitted contracts/factory/auth on SQLite ($provider, flat=$flat) without modifying configured data', async ({ provider, flat }) => {
    const root = mkdtempSync(join(tmpdir(), 'svelar-generated-auth-'));
    const appRoot = join(root, 'app');
    const configuredDatabase = join(root, 'configured-do-not-refresh.sqlite');
    try {
      await Connection.disconnect();
      Connection.configure({ default: 'sqlite', connections: { sqlite: { driver: 'sqlite', filename: configuredDatabase } } });
      await new PreserveConfiguredDatabase().up();
      await new QueryBuilder('configured_records').insert({ marker: 'must-survive-generated-tests' });
      await Connection.disconnect();
      const before = createHash('sha256').update(readFileSync(configuredDatabase)).digest('hex');
      function write(path: string, content: string) {
        const result = transformScaffoldFile(path, T.applyValidationProvider(content, provider), flat);
        const absolute = join(appRoot, result.path);
        mkdirSync(dirname(absolute), { recursive: true });
        writeFileSync(absolute, result.content);
      }
      write('package.json', '{"type":"module","name":"generated-auth-test"}\n');
      symlinkSync(join(repoRoot, 'node_modules'), join(appRoot, 'node_modules'), 'dir');
      write('svelar.database.json', JSON.stringify({ default: 'sqlite', connections: { sqlite: { driver: 'sqlite', filename: configuredDatabase } }, migrations: { path: 'src/lib/database/migrations', table: 'migrations' } }));
      write('src/lib/database/migrations/00000001_create_users.ts', T.createUsersTable());
      write('src/lib/database/migrations/00000002_create_posts.ts', T.createPostsTable());
      write('src/lib/database/migrations/00000003_add_role.ts', T.addRoleToUsers());
      write('src/lib/modules/auth/User.ts', T.userModel());
      write('src/lib/modules/posts/Post.ts', T.postModel());
      write('src/lib/modules/auth/UserRepository.ts', T.userRepository());
      write('src/lib/modules/auth/UserRegistered.ts', T.userRegisteredEvent());
      write('src/lib/modules/auth/AuthService.ts', T.authService());
      write('src/lib/modules/auth/LoginAction.ts', T.loginAction());
      write('src/lib/modules/auth/LoginRequest.ts', T.loginRequest());
      write('src/lib/modules/auth/LoginDto.ts', T.loginDto());
      write('src/lib/modules/auth/schemas.ts', T.authSchema(provider));
      write('src/lib/factories/UserFactory.ts', T.scaffoldUserFactory());
      write('tests/unit/example.test.ts', T.exampleUnitTest());
      write('tests/feature/auth.test.ts', T.exampleFeatureTest());
      const aliases = ['database', 'auth', 'hashing', 'hooks', 'middleware', 'session', 'testing', 'orm', 'permissions', 'audit', 'services', 'events', 'routing', 'actions', 'config', 'repositories'];
      const config = `export default { resolve: { alias: [
  { find: '$lib', replacement: ${JSON.stringify(join(appRoot, 'src/lib'))} },
  { find: '@beeblock/svelar/validation/valibot', replacement: ${JSON.stringify(join(sourceRoot, 'validation/valibot.ts'))} },
  { find: '@beeblock/svelar/validation', replacement: ${JSON.stringify(join(sourceRoot, 'validation/index.ts'))} },
  ${aliases.map((name) => `{ find: '@beeblock/svelar/${name}', replacement: ${JSON.stringify(join(sourceRoot, name, 'index.ts'))} }`).join(',\n')}
] }, test: { globals: true, include: ['tests/**/*.test.ts'], fileParallelism: false, testTimeout: 15000 } };`;
      write('vitest.config.mjs', config);
      const result = spawnSync(process.execPath, [join(repoRoot, 'node_modules/vitest/vitest.mjs'), 'run', '--root', appRoot], {
        cwd: appRoot, encoding: 'utf8', timeout: 60000, maxBuffer: 4 * 1024 * 1024,
        env: { ...process.env, DB_DRIVER: 'sqlite', DB_PATH: configuredDatabase },
      });
      expect(result.error).toBeUndefined();
      expect(result.status, result.stdout + result.stderr).toBe(0);
      expect(result.stdout).toContain('Tests');
      expect(createHash('sha256').update(readFileSync(configuredDatabase)).digest('hex')).toBe(before);
      Connection.configure({ default: 'sqlite', connections: { sqlite: { driver: 'sqlite', filename: configuredDatabase } } });
      expect((await new QueryBuilder('configured_records').first())?.marker).toBe('must-survive-generated-tests');
    } finally { await Connection.disconnect(); rmSync(root, { recursive: true, force: true }); }
  }, 90000);

  it('emits syntactically valid browser regressions with explicit isolation acknowledgement and no database refresh', () => {
    const source = T.exampleE2ETest();
    const ast = ts.createSourceFile('auth.spec.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const host = ts.createCompilerHost({ noLib: true, noResolve: true });
    host.getSourceFile = (name) => name === 'auth.spec.ts' ? ast : undefined;
    expect(ts.createProgram(['auth.spec.ts'], { noLib: true, noResolve: true }, host).getSyntacticDiagnostics(ast)).toEqual([]);
    expect(source).toContain('SVELAR_E2E_ISOLATED_APP');
    expect(source).toContain('https://attacker.invalid');
    expect(source).not.toContain('refreshDatabase');
  });
});
