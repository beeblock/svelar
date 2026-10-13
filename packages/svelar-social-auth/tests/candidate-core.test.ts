import { execFile } from 'node:child_process';
import { cp, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const packageRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const exec = promisify(execFile);
const core = process.env.SVELAR_PLUGIN_CORE;
const node = process.env.SVELAR_PLUGIN_NODE ?? process.execPath;

describe('Built Social Auth candidate-core compatibility (opt-in)', () => {
  it.skipIf(!core)('shares native public entry configuration and delegates federation eligibility/audit to the installed core', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'svelar-social-candidate-'));
    try {
      await mkdir(join(directory, 'node_modules/@beeblock'), { recursive: true });
      await symlink(resolve(core!), join(directory, 'node_modules/@beeblock/svelar'), 'dir');
      const installedPlugin = join(directory, 'node_modules/@beeblock/svelar-social-auth');
      await mkdir(installedPlugin, { recursive: true });
      await cp(join(packageRoot, 'dist'), join(installedPlugin, 'dist'), { recursive: true });
      await cp(join(packageRoot, 'package.json'), join(installedPlugin, 'package.json'));
      const publicCoreAuth = fileURLToPath(new URL('dist/auth/index.js', new URL('file://' + resolve(core!) + '/')));
      const script = join(directory, 'proof.mjs');
      await writeFile(script, `import assert from 'node:assert/strict';
        import { SocialAuth } from '@beeblock/svelar-social-auth';
        import SocialPlugin from '@beeblock/svelar-social-auth/plugin';
        import { SocialAuthController } from '@beeblock/svelar-social-auth/server';
        import { AuthManager } from ${JSON.stringify('file://' + publicCoreAuth)};
        new SocialPlugin({ providers: { github: { clientId: 'fixture', clientSecret: 'fixture-secret', redirectUrl: '/auth/github/callback' } } });
        assert.equal(SocialAuth.isConfigured('github'), true);
        const cookies = new Map();
        const url = new URL('https://app.test/auth/github/redirect');
        const redirect = SocialAuthController.redirect('github', { url, request: new Request(url), cookies: {
          get: name => cookies.get(name), set: (name, value) => cookies.set(name, value), delete: name => cookies.delete(name)
        } });
        assert.equal(redirect.status, 302);
        assert.equal(new URL(redirect.headers.get('location')).searchParams.get('client_id'), 'fixture');
        class Account {
          static persisted;
          static async find() { return this.persisted; }
          constructor(data) { this.data = data; }
          getAttribute(key) { return this.data[key]; }
        }
        Account.persisted = new Account({ id: 7, disabled: true });
        const writes = []; const audit = [];
        const auth = new AuthManager({ guard: 'session', model: Account, eligibility: { disabledColumn: 'disabled' }, audit: { record: value => audit.push(value) },
          presentation: { providers: [{ id: 'github', label: 'GitHub', protocol: 'oauth2', configured: true, loginUrl: '/auth/github/redirect' }] } });
        const event = { locals: { auth, session: { set: (key, value) => writes.push([key, value]), regenerateId: () => writes.push('rotate'), startAuthentication: value => writes.push(['remember', value]) } } };
        assert.equal(await SocialAuthController.login('github', event, new Account({ id: 7, disabled: false })), null);
        assert.equal(writes.length, 0);
        assert.equal(audit.at(-1).outcome, 'denied');
        Account.persisted = new Account({ id: 7, disabled: false });
        const user = await SocialAuthController.login('github', event, new Account({ id: 7 }), { remember: true });
        assert.equal(user, Account.persisted);
        assert.equal(auth.user(), user);
        assert.ok(writes.some(value => Array.isArray(value) && value[0] === 'remember' && value[1] === true));
        assert.equal(audit.at(-1).providerId, 'github');
        assert.equal(audit.at(-1).outcome, 'allowed');
        assert.equal(SocialAuth.isProviderName('constructor'), false);
        console.log('candidate social auth proof passed');
      `);
      const result = await exec(node, [script], { cwd: directory, timeout: 30000 });
      expect(result.stdout).toContain('candidate social auth proof passed');
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it.skipIf(!core)('strictly checks plugin source and Svelte components against installed candidate APIs', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'svelar-social-candidate-types-'));
    try {
      const appModules = resolve(core!, '../../');
      await symlink(appModules, join(directory, 'node_modules'), 'dir');
      const sdk = JSON.parse(await readFile(join(core!, 'package.json'), 'utf8'));
      const paths: Record<string, string[]> = {};
      for (const [entry, value] of Object.entries(sdk.exports) as [string, { types?: string } | string][]) {
        if (typeof value !== 'string' && value.types) paths[entry === '.' ? '@beeblock/svelar' : '@beeblock/svelar/' + entry.slice(2)] = [resolve(core!, value.types)];
      }
      await writeFile(join(directory, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'bundler', strict: true, skipLibCheck: true, noEmit: true, types: ['node', 'svelte'], paths }, include: [packageRoot + '/src/**/*.ts'], exclude: [packageRoot + '/src/publishable/**'] }));
      const tsc = resolve(appModules, 'typescript/bin/tsc');
      await exec(node, [tsc, '-p', join(directory, 'tsconfig.json')], { cwd: directory, timeout: 30000 }).catch((error: unknown) => {
        throw new Error(error instanceof Error && 'stdout' in error ? String(error.stdout) : String(error), { cause: error });
      });
      await mkdir(join(directory, 'src'), { recursive: true });
      for (const name of ['SocialLoginButton.svelte', 'SocialLoginButtons.svelte']) await writeFile(join(directory, 'src', name), await readFile(join(packageRoot, 'src/ui', name), 'utf8'));
      await writeFile(join(directory, 'tsconfig.svelte.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'bundler', strict: true, skipLibCheck: true }, include: ['src/**/*.svelte'] }));
      const check = resolve(appModules, 'svelte-check/bin/svelte-check');
      const result = await exec(node, [check, '--workspace', directory, '--tsconfig', './tsconfig.svelte.json'], { cwd: directory, timeout: 30000 });
      expect(result.stdout).toContain('0 errors');
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
