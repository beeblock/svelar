#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseEnv, promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { fixtureIdentity, installationProvenance, pendingFormSubmission, prepareIsolatedApp, sourceSnapshot, startServer, stopServer } from './auth-ui-certification.mjs';

const run = promisify(execFile);
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scriptPath = fileURLToPath(import.meta.url);

async function sourceCertification() {
const { build } = await import('esbuild');
const clients = resolve(process.argv.find((arg) => arg.startsWith('--clients='))?.slice(10)
  ?? join(repository, '../svelar-testing-area/apps/svelar-evolution-candidate-ddd-zod/package.json'));
const report = resolve(process.argv.find((arg) => arg.startsWith('--report-dir='))?.slice(13) ?? join(repository, '../svelar-testing-area/artifacts/invitation-ui'));
const provider = process.argv.includes('--valibot') ? 'valibot' : 'zod';
const directory = await mkdtemp(join(tmpdir(), 'svelar-invitation-ui-'));
const session = 'invitation-' + randomUUID();
const secret = randomBytes(32).toString('hex');
const recipient = { id: randomUUID(), email: 'recipient@example.test', session: randomUUID() };
const foreign = { id: randomUUID(), email: 'foreign@example.test', session: randomUUID() };
const cases = []; let server; let serverLog = ''; let failure;
const port = await new Promise((accept, reject) => {
  const probe = createServer(); probe.once('error', reject); probe.listen(0, '127.0.0.1', () => {
    const port = probe.address().port; probe.close((error) => error ? reject(error) : accept(port));
  });
});
const origin = 'http://127.0.0.1:' + port;
const browser = async (...args) => {
  const result = await run('agent-browser', ['--session', session, '--json', ...args], { timeout: 45_000, maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, AGENT_BROWSER_ALLOWED_DOMAINS: '127.0.0.1', AGENT_BROWSER_DEFAULT_TIMEOUT: '10000' } });
  const parsed = JSON.parse(result.stdout); assert.equal(parsed.success, true, JSON.stringify(parsed)); return parsed.data;
};
const evaluate = async (code) => (await browser('eval', '-b', Buffer.from(code).toString('base64'))).result;
const check = async (name, callback) => { await callback(); cases.push(name); console.log('Invitation UI passed: ' + name); };
const setActor = async (actor) => {
  await browser('cookies', 'clear');
  if (actor) await browser('cookies', 'set', 'svelar_session', actor.session + '.' + createHmac('sha256', secret).update(actor.session).digest('base64url'),
    '--url', origin, '--httpOnly', '--sameSite', 'Lax');
};
async function write(path, content) { const destination = join(directory, path); await mkdir(dirname(destination), { recursive: true }); await writeFile(destination, content); }
try {
  await mkdir(report, { recursive: true });
  await symlink(join(dirname(clients), 'node_modules'), join(directory, 'node_modules'));
  const exports = join(directory, 'templates.mjs');
  await build({ stdin: { contents: `export { NewCommandTemplates as T } from './packages/svelar/src/cli/commands/NewCommandTemplates.ts'; export { transformScaffoldFile } from './packages/svelar/src/cli/commands/NewCommand.ts';`, resolveDir: repository },
    outfile: exports, bundle: true, platform: 'node', format: 'esm', packages: 'external', logLevel: 'silent' });
  const { T, transformScaffoldFile } = await import(pathToFileURL(exports).href);
  const artifacts = { Invitation: T.invitationModel, InvitationRepository: T.invitationRepository, InvitationDto: T.invitationDto,
    InvitationRequest: T.invitationRequest, InvitationResource: T.invitationResource, InvitationService: T.invitationService,
    AcceptInvitationAction: T.acceptInvitationAction, DeclineInvitationAction: T.declineInvitationAction, InvitationController: T.invitationController };
  const generated = async (path, content) => { const file = transformScaffoldFile(path, T.applyValidationProvider(content, provider), false); await write(file.path, file.content); };
  for (const [name, template] of Object.entries(artifacts)) await generated('src/lib/modules/team/' + name + '.ts', template());
  await generated('src/lib/modules/team/invitation.schema.ts', T.invitationSchema(provider));
  await generated('src/routes/invitations/[token]/+page.server.ts', T.invitationPageServer());
  await generated('src/routes/invitations/[token]/+page.svelte', T.invitationPageSvelte());
  for (const operation of ['preview', 'accept', 'decline']) await generated('src/routes/api/invitations/[token]/' + (operation === 'preview' ? '' : operation + '/') + '+server.ts', T.invitationApiRoute(operation));
  await write('src/lib/AuthFrame.svelte', T.authFrame());
  await cp(join(dirname(clients), 'src/lib/components/ui/button'), join(directory, 'src/lib/components/ui/button'), { recursive: true });
  await cp(join(dirname(clients), 'src/lib/utils.ts'), join(directory, 'src/lib/utils.ts'));
  await mkdir(join(directory, 'static')); await cp(join(repository, 'docs/assets/svelar-s.svg'), join(directory, 'static/favicon.svg'));
  const clientManifest = JSON.parse(await readFile(clients, 'utf8'));
  await write('package.json', JSON.stringify({ name: 'invitation-source-browser-fixture', private: true, type: 'module',
    dependencies: clientManifest.dependencies, devDependencies: clientManifest.devDependencies }));
  await write('svelte.config.js', "export default { kit: { } };\n");
  const aliases = Object.fromEntries(['actions', 'services', 'repositories', 'orm', 'teams', 'routing', 'middleware', 'config', 'auth', 'session', 'hooks', 'validation'].map((name) => ['@beeblock/svelar/' + name, join(repository, 'packages/svelar/src/' + name + '/index.ts')]));
  aliases['@beeblock/svelar/validation/valibot'] = join(repository, 'packages/svelar/src/validation/valibot.ts');
  const orderedAliases = Object.entries(aliases).sort(([a], [b]) => b.length - a.length).map(([find, replacement]) => ({ find, replacement }));
  await write('vite.config.ts', `import { sveltekit } from '@sveltejs/kit/vite'; import tailwindcss from '@tailwindcss/vite'; export default { cacheDir: ${JSON.stringify(join(directory, '.vite'))}, plugins: [tailwindcss(), sveltekit()], ssr: { noExternal: ['sveltekit-superforms', '@lucide/svelte', 'bits-ui'] }, resolve: { alias: ${JSON.stringify(orderedAliases)} }, server: { fs: { allow: ${JSON.stringify([directory, repository, dirname(clients)])} } } };`);
  await write('tsconfig.json', JSON.stringify({ extends: './.svelte-kit/tsconfig.json', compilerOptions: { strict: true, skipLibCheck: true } }));
  await write('src/app.html', '<!doctype html><html lang="en"><head><meta charset="utf-8"><link rel="icon" href="%sveltekit.assets%/favicon.svg"><meta name="viewport" content="width=device-width,initial-scale=1">%sveltekit.head%</head><body><div style="display:contents">%sveltekit.body%</div></body></html>');
  await write('src/app.css', T.appCss());
  const stateFile = join(directory, 'state.json');
  await write('src/lib/fixture.ts', `import { writeFile } from 'node:fs/promises';
import { Model } from '@beeblock/svelar/orm'; import { Teams } from '@beeblock/svelar/teams';
import { AuthManager } from '@beeblock/svelar/auth'; import { MemorySessionStore } from '@beeblock/svelar/session';
const actors = ${JSON.stringify([recipient, foreign])};
export const sessions = new MemorySessionStore();
export const auth = new AuthManager({ guard: 'session', model: { find: async (id: string) => { const actor = actors.find((user) => user.id === id); return actor ? new Model({ id: actor.id, email: actor.email, name: 'Invitation recipient' }) : null; } }, audit: false, presentation: { brand: { name: 'Invitation fixture', title: 'Invitation fixture', logoUrl: '/favicon.svg', logoAlt: 'Svelar' } } });
Teams.configure({ driver: 'memory', roles: ['owner', 'admin', 'member', 'viewer'], maxTeamsPerUser: undefined, invitationExpiryHours: 1 });
for (const actor of actors) await sessions.write(actor.session, { auth_user_id: actor.id }, 3600);
const team = await Teams.create({ name: 'Native invitation browser fixture', ownerId: 'fixture-owner' });
const tokens: Record<string, string> = {};
for (const name of ['accept', 'decline', 'guard', 'mobile', 'accepted']) tokens[name] = (await Teams.invite(team.id, actors[0].email, 'viewer')).token;
await Teams.acceptInvitation(tokens.accepted, actors[0].id, actors[0].email);
Teams.configure({ driver: 'memory', invitationExpiryHours: -1 }); tokens.expired = (await Teams.invite(team.id, actors[0].email)).token;
Teams.configure({ driver: 'memory', invitationExpiryHours: 1 });
await writeFile(${JSON.stringify(stateFile)}, JSON.stringify({ tokens, teamId: team.id }));
`);
  await write('src/hooks.server.ts', `import { createSvelarApp } from '@beeblock/svelar/hooks'; import { auth, sessions } from '$lib/fixture'; export const { handle, handleError } = createSvelarApp({ auth, secret: ${JSON.stringify(secret)}, sessionStore: sessions, rateLimit: 300, debug: false });`);
  await write('src/routes/+layout.server.ts', "import { auth } from '$lib/fixture'; export const load = () => ({ authPresentation: auth.presentation() });");
  await write('src/routes/+layout.svelte', `<script lang="ts">import './app.css'; import AuthFrame from '$lib/AuthFrame.svelte'; let { data, children } = $props(); function csrf(node: HTMLElement) { const update = (event: Event) => { if (!(event.target instanceof HTMLFormElement)) return; const token = document.cookie.match(/(?:^|;\\s*)XSRF-TOKEN=([^;]+)/)?.[1]; if (!token) return; let field = event.target.querySelector<HTMLInputElement>('input[name="_csrf"]'); if (!field) { field = document.createElement('input'); field.type = 'hidden'; field.name = '_csrf'; event.target.append(field); } field.value = token; }; node.addEventListener('submit', update, true); return { destroy() { node.removeEventListener('submit', update, true); } }; }</script><AuthFrame presentation={data.authPresentation}><div use:csrf>{@render children()}</div></AuthFrame>` .replace("import './app.css'", "import '../app.css'"));
  await run(process.execPath, [join(dirname(clients), 'node_modules/@sveltejs/kit/svelte-kit.js'), 'sync'], { cwd: directory, timeout: 60_000 });
  server = spawn(process.execPath, [join(dirname(clients), 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: directory,
    env: { ...process.env, NODE_ENV: 'development', APP_ENV: 'testing' }, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout.on('data', (chunk) => serverLog += String(chunk)); server.stderr.on('data', (chunk) => serverLog += String(chunk));
  let serverError; server.on('error', (error) => { serverError = error; });
  const deadline = Date.now() + 60_000;
  while (true) { if (serverError || server.exitCode !== null) throw serverError ?? new Error(serverLog);
    try { await fetch(origin + '/invitations/' + randomUUID()); const state = JSON.parse(await readFile(stateFile, 'utf8')); if (state.tokens) break; } catch {}
    assert.ok(Date.now() < deadline, serverLog); await new Promise((accept) => setTimeout(accept, 250)); }
  const { tokens } = JSON.parse(await readFile(stateFile, 'utf8'));
  await check('anonymous preview reveals no invited email or team', async () => {
    await browser('open', origin + '/invitations/' + tokens.accept); await browser('wait', '--text', 'Sign in to review');
    const text = await evaluate('document.body.innerText'); assert.ok(!text.includes(recipient.email)); assert.ok(!text.includes('Native invitation browser fixture'));
    assert.ok((await evaluate('document.querySelector("a[href^=\\"/login?redirectTo=\\"]").getAttribute("href")')).includes(encodeURIComponent('/invitations/' + tokens.accept)));
  });
  await check('foreign signed session cannot view recipient details', async () => {
    await setActor(foreign); await browser('open', origin + '/invitations/' + tokens.guard); await browser('wait', '--text', 'not available to this account');
    assert.equal(await evaluate('document.querySelector("button[type=submit]") === null'), true);
  });
  await setActor(recipient);
  await check('expired, consumed and missing links present honest inline states', async () => {
    for (const [token, message] of [[tokens.expired, 'has expired'], [tokens.accepted, 'already been accepted'], [randomUUID(), 'could not be found']]) {
      await browser('open', origin + '/invitations/' + token); await browser('wait', '--text', message);
      assert.equal(await evaluate('document.querySelector("button[type=submit]") === null'), true);
    }
  });
  await check('direct browser POST without CSRF is rejected without consuming', async () => {
    await browser('open', origin + '/invitations/' + tokens.guard);
    const result = await evaluate(`(async () => { const response = await fetch('/api/invitations/${tokens.guard}/accept', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); return response.status; })()`);
    assert.ok([403, 419].includes(result)); await browser('reload'); await browser('wait', 'button[type=submit]');
  });
  await check('desktop signed recipient sees the shared frame and responsive invitation details', async () => {
    await browser('set', 'viewport', '1440', '900'); await browser('open', origin + '/invitations/' + tokens.accept); await browser('wait', 'button[type=submit]');
    assert.equal(await evaluate('!!document.querySelector(".auth-frame img.logo") && document.querySelector(".auth-frame img.logo").naturalWidth > 0'), true);
    assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
    await browser('screenshot', join(report, provider + '-desktop.png'));
  });
  await check('keyboard acceptance updates the envelope and removes duplicate-submit controls', async () => {
    await browser('focus', 'button[type=submit]'); await browser('press', 'Enter'); await browser('wait', '--text', 'Invitation accepted.');
    assert.equal(await evaluate('document.querySelector("button[type=submit]") === null'), true);
    await browser('reload'); await browser('wait', '--text', 'already been accepted');
  });
  await check('mobile decline uses the named action and persists the consumed state', async () => {
    await browser('set', 'viewport', '390', '844'); await browser('open', origin + '/invitations/' + tokens.mobile); await browser('wait', 'button[formaction]');
    assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
    await browser('screenshot', join(report, provider + '-mobile.png'));
    await browser('find', 'role', 'button', 'click', '--name', 'Decline'); await browser('wait', '--text', 'Invitation declined.');
    assert.equal(await evaluate('document.querySelector("button[type=submit]") === null'), true);
    await browser('reload'); await browser('wait', '--text', 'could not be found');
  });
  await check('no uncaught browser errors', async () => { const errors = await browser('errors'); assert.ok(!errors.errors?.length, JSON.stringify(errors)); });
} catch (error) { failure = error; console.error(error); }
finally {
  const errors = [];
  try { await browser('close'); } catch (error) { errors.push(error); }
  if (server && server.exitCode === null) {
    server.kill('SIGTERM');
    const closed = new Promise((accept) => server.once('close', accept));
    const timer = setTimeout(() => server.kill('SIGKILL'), 5000); await closed; clearTimeout(timer);
  }
  await mkdir(report, { recursive: true });
  await writeFile(join(report, provider + '-server.log'), serverLog);
  try { await rm(directory, { recursive: true, force: true }); } catch (error) { errors.push(error); }
  if (errors.length) failure = new AggregateError(failure ? [failure, ...errors] : errors, 'Invitation UI cleanup failed');
  await writeFile(join(report, provider + '-summary.json'), JSON.stringify({ passed: cases.length, skipped: 0, failed: failure ? 1 : 0,
    cases, provider, port, scope: 'Source templates, real signed sessions, memory Teams engine, Vite dev SSR/client; not packed-artifact certification', cleanupErrors: errors.map(String) }, null, 2));
}
if (failure) process.exitCode = 1;
}

const fixturePrefix = 'INVITATION_UI_FIXTURE_RESULT:';
const invitationRoutes = ['/invitations/[token]', '/api/invitations/[token]', '/api/invitations/[token]/accept', '/api/invitations/[token]/decline'];
const digest = (value) => createHash('sha256').update(value).digest('hex');
const installedRequire = (appDir) => createRequire(join(appDir, 'package.json'));

export function parseInstalledOptions(args) {
  const options = {};
  for (const arg of args) {
    const match = /^--(installed-app|report-dir|database|tarball)=(.+)$/.exec(arg);
    assert(match, `Unknown installed-mode option: ${arg}`);
    const key = { 'installed-app': 'appDir', 'report-dir': 'reportDir', database: 'database', tarball: 'tarball' }[match[1]];
    assert(options[key] === undefined, `Repeated option: ${match[1]}`);
    options[key] = match[2];
  }
  assert(options.appDir, '--installed-app=<production-built app directory> is required.');
  options.appDir = resolve(options.appDir);
  options.reportDir = resolve(options.reportDir ?? join(repository, '../svelar-testing-area/artifacts/invitation-ui-installed', randomUUID()));
  assert(options.reportDir !== options.appDir && !options.reportDir.startsWith(options.appDir + '/'), 'Evidence must be outside the original app.');
  return options;
}

export async function verifyArtifact(tarball, installation) {
  const bytes = await readFile(tarball);
  const archive = async (path) => (await run('tar', ['-xOf', resolve(tarball), path], { encoding: 'buffer', maxBuffer: 32 * 1024 * 1024 })).stdout;
  assert.equal(digest(await archive('package/package.json')), installation.manifestSha256, 'Installed package manifest differs from the supplied artifact.');
  for (const [subpath, entry] of Object.entries(installation.entries)) {
    assert.equal(digest(await archive('package/' + entry.entry.slice(2))), entry.sha256, `Installed ${subpath} differs from the supplied artifact.`);
  }
  const listing = (await run('tar', ['-tzf', resolve(tarball)], { maxBuffer: 4 * 1024 * 1024 })).stdout.trim().split('\n');
  return { path: resolve(tarball), sha256: digest(bytes), sha1: createHash('sha1').update(bytes).digest('hex'),
    listedFiles: listing.filter((path) => !path.endsWith('/')).length, verifiedPublicEntries: Object.keys(installation.entries) };
}

async function installedImport(appDir, subpath) {
  const manifestPath = installedRequire(appDir).resolve('@beeblock/svelar/package.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const entry = manifest.exports?.['./' + subpath]?.import;
  assert(typeof entry === 'string' && entry.startsWith('./dist/'), `Missing installed public dist export: ${subpath}`);
  return import(pathToFileURL(resolve(dirname(manifestPath), entry)).href);
}

async function treeSnapshot(directory) {
  const files = {};
  async function visit(path, prefix = '') {
    for (const entry of (await readdir(path, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      assert(!entry.isSymbolicLink(), `Refusing production output symlink: ${prefix}${entry.name}`);
      const key = prefix + entry.name;
      if (entry.isDirectory()) await visit(join(path, entry.name), key + '/');
      else if (entry.isFile()) files[key] = digest(await readFile(join(path, entry.name)));
    }
  }
  await visit(directory);
  return files;
}

async function databaseDigests(filename) {
  return { main: digest(await readFile(filename)), wal: existsSync(filename + '-wal') ? digest(await readFile(filename + '-wal')) : null };
}

export async function productionManifest(appDir) {
  const buildDir = join(appDir, 'build');
  let path = join(buildDir, 'server/manifest.js');
  if (!existsSync(path)) {
    const ts = await import('typescript');
    const entry = ts.createSourceFile('index.js', await readFile(join(buildDir, 'index.js'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const imports = entry.statements.filter(ts.isImportDeclaration).filter((node) => ts.isStringLiteral(node.moduleSpecifier))
      .map((node) => node.moduleSpecifier.text).filter((value) => value.startsWith('./') && /^manifest(?:\.|-)/.test(basename(value)));
    assert.equal(imports.length, 1, 'Missing production server manifest import, or ambiguous adapter output.');
    path = resolve(buildDir, imports[0]);
    assert(path.startsWith(buildDir + '/'), 'Manifest import must remain inside production output.');
  }
  const exports = await import(pathToFileURL(path).href);
  const manifests = Object.values(exports).filter((value) => value && typeof value.appDir === 'string' && Array.isArray(value._?.routes));
  assert.equal(manifests.length, 1, 'Production output must export one route manifest.');
  return { manifest: manifests[0], entry: { path: relative(appDir, path), sha256: digest(await readFile(path)) } };
}

export async function installedPreflight(appDir) {
  assert(existsSync(join(appDir, 'build/index.js')), 'Missing adapter-node build/index.js; this runner never builds the app.');
  const { manifest, entry: manifestEntry } = await productionManifest(appDir);
  assert(existsSync(join(appDir, 'src/lib/factories/UserFactory.ts')), 'Missing actual generated UserFactory; no replacement factory is generated.');
  const manifestPath = installedRequire(appDir).resolve('@beeblock/svelar/package.json');
  const packageRoot = await realpath(dirname(manifestPath));
  assert(!packageRoot.startsWith(join(repository, 'packages') + '/'), 'Installed mode refuses a workspace/source-linked core package.');
  const packageJson = JSON.parse(await readFile(manifestPath, 'utf8'));
  const entries = {};
  for (const subpath of ['cli', 'database', 'orm', 'auth', 'session', 'hashing', 'teams', 'testing']) {
    const entry = packageJson.exports?.['./' + subpath]?.import;
    assert(typeof entry === 'string' && entry.startsWith('./dist/'), `Missing installed public dist export: ${subpath}`);
    entries[subpath] = { entry, sha256: digest(await readFile(resolve(packageRoot, entry))) };
  }
  const routes = manifest._.routes.map((route) => route.id);
  for (const route of invitationRoutes) assert(routes.includes(route), `Production build missing invitation route: ${route}`);
  const { Teams } = await installedImport(appDir, 'teams');
  for (const method of ['lookupInvitation', 'acceptInvitation', 'declineInvitation', 'isAssignableRole']) {
    assert.equal(typeof Teams[method], 'function', `Installed Teams is missing ${method}.`);
  }
  return { ...await installationProvenance(appDir), packageRoot, entries, manifestEntry, routes: invitationRoutes,
    userFactorySha256: digest(await readFile(join(appDir, 'src/lib/factories/UserFactory.ts'))) };
}

export async function ownedFixtureDirectory(path) {
  const directory = await realpath(path);
  const parent = dirname(directory);
  assert(dirname(parent) === await realpath(tmpdir()) && basename(parent).startsWith('svelar-auth-ui-') && basename(directory) === 'app',
    'Fixture writes require the owned isolated app.');
  return directory;
}

export function assertBranding(presentation, observed) {
  assert.equal(observed.frameCount, 1, 'Expected the shared authentication frame.');
  assert.equal(observed.heading, presentation.brand.title ?? presentation.brand.name, 'Configured brand heading was not rendered.');
  for (const key of ['logoUrl', 'imageUrl']) {
    const src = presentation.brand[key];
    if (src) assert(observed.images.some((image) => image.src === src && image.complete && image.naturalWidth > 0), `Configured auth ${key} did not render.`);
  }
}

export async function recipientMembership(QueryBuilder, Teams, teamId, userId) {
  const row = await new QueryBuilder('team_members').where('team_id', teamId).where('user_id', userId).first();
  assert.equal(await Teams.isMember(teamId, userId), !!row, 'Public membership check and persisted row disagree.');
  return row ? [{ role: row.role, userId: String(row.user_id) }] : [];
}

async function fixtureChild(operation) {
  let raw = '';
  for await (const chunk of process.stdin) { raw += chunk; assert(raw.length < 65536, 'Fixture input too large.'); }
  const state = JSON.parse(raw);
  const appDir = await ownedFixtureDirectory(process.cwd());
  const { Command } = await installedImport(appDir, 'cli');
  const { Connection } = await installedImport(appDir, 'database');
  const { QueryBuilder } = await installedImport(appDir, 'orm');
  const { Hash } = await installedImport(appDir, 'hashing');
  const { Session, DatabaseSessionStore } = await installedImport(appDir, 'session');
  const { Teams } = await installedImport(appDir, 'teams');
  class FixtureCommand extends Command {
    name = 'invitation-ui:fixture';
    description = 'Owned installed invitation certification fixtures';
    async handle() {
      await this.bootstrap();
      assert.equal(Connection.getDriver(), 'sqlite');
      const database = await realpath(Connection.getConfig().filename);
      assert(database.startsWith(appDir + '/'), 'Refusing writes outside the owned database backup.');
      const factoryModule = await this.importUserModule(join(appDir, 'src/lib/factories/UserFactory.ts'));
      assert.equal(typeof factoryModule.UserFactory, 'function', 'Generated UserFactory class is required.');
      const factory = new factoryModule.UserFactory();
      const User = factory.model();
      const { auth } = await this.importUserModule(join(appDir, 'src/app.ts'));
      assert.equal(typeof auth?.attempt, 'function', 'Actual app AuthManager is required.');
      const identity = fixtureIdentity(state.runId);
      for (const kind of ['eligible', 'unavailable']) assert.equal(state.accounts[kind].email, identity.accounts[kind].email, 'Foreign fixture identity.');
      if (operation === 'create') {
        state.presentation = auth.presentation();
        const password = await Hash.make(state.password);
        for (const kind of ['eligible', 'unavailable']) {
          const account = state.accounts[kind];
          assert.equal(await User.where('email', account.email).first(), null, 'Fixture email already exists.');
          const user = await factory.create({ name: 'Invitation UI ' + kind, email: account.email, password,
            role: 'user', email_verified_at: new Date().toISOString(), disabled_at: null, locked_until: null });
          const session = new Session(randomUUID());
          assert(await auth.attempt({ email: account.email, password: state.password }, session), 'Fixture password authentication failed.');
          account.id = auth.id();
          assert.equal(String(user.getAttribute(User.primaryKey ?? 'id')), String(account.id));
          const now = Date.now();
          await new DatabaseSessionStore().write(session.id, { ...session.all(), _svelar_created_at: now,
            _svelar_last_activity_at: now, _svelar_last_touched_at: now }, 3600);
          account.session = session.id;
        }
        const team = await Teams.create({ name: 'Invitation UI ' + state.runId, ownerId: state.accounts.unavailable.id });
        state.team = { id: team.id, name: team.name };
        state.tokens = {};
        for (const name of ['accept', 'mobile', 'guard', 'expired', 'loginDesktop', 'loginMobile']) {
          state.tokens[name] = (await Teams.invite(team.id, state.accounts.eligible.email, 'viewer')).token;
        }
        const consumedTeam = await Teams.create({ name: 'Consumed invitation UI ' + state.runId, ownerId: state.accounts.unavailable.id });
        state.tokens.accepted = (await Teams.invite(consumedTeam.id, state.accounts.eligible.email, 'viewer')).token;
        await Teams.acceptInvitation(state.tokens.accepted, state.accounts.eligible.id, state.accounts.eligible.email);
        const expired = await Teams.lookupInvitation(state.tokens.expired);
        assert.equal(await new QueryBuilder('team_invitations').where('id', expired.invitation.id).where('token', state.tokens.expired)
          .where('team_id', team.id).update({ expires_at: new Date(Date.now() - 3600000).toISOString() }), 1);
        return state;
      }
      assert.equal(operation, 'status', 'Unknown fixture operation.');
      const tables = {};
      for (const table of ['teams', 'team_members', 'team_invitations']) {
        const rows = await new QueryBuilder(table).orderBy('id').get();
        tables[table] = { count: rows.length, sha256: digest(JSON.stringify(rows)) };
      }
      const invitations = {};
      for (const [name, token] of Object.entries(state.tokens)) invitations[name] = (await Teams.lookupInvitation(token))?.state ?? 'missing';
      const members = await Teams.getMembers(state.team.id);
      return { tables, invitations, expectedRecipientId: String(state.accounts.eligible.id),
        ownedMembers: members.map((member) => ({ userId: String(member.userId), role: member.role })),
        recipientMemberships: await recipientMembership(QueryBuilder, Teams, state.team.id, state.accounts.eligible.id) };
    }
  }
  try { process.stdout.write(fixturePrefix + JSON.stringify(await new FixtureCommand().handle()) + '\n'); }
  finally { await Connection.disconnect(); }
}

function redact(value, state) {
  let result = String(value);
  const secrets = [state?.password, state?.sessionSecret, ...Object.values(state?.accounts ?? {}).flatMap((account) => [account.email, account.session]), ...Object.values(state?.tokens ?? {})];
  for (const secret of secrets.filter(Boolean)) result = result.replaceAll(String(secret), '[fixture-redacted]');
  return result;
}

async function installedFixture(isolation, operation, state) {
  const child = spawn(process.execPath, [scriptPath, '--fixture-op=' + operation], { cwd: isolation.appDir, env: isolation.env, stdio: ['pipe', 'pipe', 'pipe'] });
  let output = ''; let stderr = ''; let forced;
  child.stdout.on('data', (chunk) => output = (output + chunk).slice(-131072));
  child.stderr.on('data', (chunk) => stderr = (stderr + chunk).slice(-8000));
  const timeout = setTimeout(() => { child.kill('SIGTERM'); forced = setTimeout(() => child.kill('SIGKILL'), 5000); }, 45000);
  try {
    const closed = new Promise((accept, reject) => { child.once('error', reject); child.once('close', accept); });
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify(state));
    assert.equal(await closed, 0, `Installed fixture ${operation} failed: ${redact(stderr, state)}`);
    const lines = output.split('\n').filter((line) => line.startsWith(fixturePrefix));
    assert.equal(lines.length, 1, 'Fixture must emit exactly one result.');
    return JSON.parse(lines[0].slice(fixturePrefix.length));
  } finally { clearTimeout(timeout); clearTimeout(forced); }
}

export function invitationCdpEndpoint(data) {
  const candidates = Object.values(data).filter((value) => typeof value === 'string' && /^wss?:\/\//.test(value));
  assert.equal(candidates.length, 1, 'Expected one CDP endpoint from the owned agent-browser session.');
  const url = new URL(candidates[0]);
  assert(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) && !url.username && !url.password
    && url.pathname.startsWith('/devtools/browser/'), 'Refusing a non-local or non-browser CDP endpoint.');
  return url.href;
}

async function restoreOriginalAuthConfig(original, copy) {
  for (const entry of await readdir(join(copy, 'config'))) {
    if (entry === 'auth.js' || entry === 'auth.ts' || entry.startsWith('.auth-ui-original-auth.')) await rm(join(copy, 'config', entry));
  }
  for (const extension of ['ts', 'js']) {
    if (existsSync(join(original, 'config/auth.' + extension))) await cp(join(original, 'config/auth.' + extension), join(copy, 'config/auth.' + extension));
  }
}

export async function installedCertification(options) {
  const result = { mode: 'installed-production', passed: 0, failed: 0, skipped: 0, expectedChecks: 14, complete: false, cases: [], pendingForms: [], cleanupErrors: [],
    startedAt: new Date().toISOString(), nodeVersion: process.version,
    scope: 'Unchanged installed adapter-node production routes and Superforms; actual generated UserFactory/installed Hash/Auth/Teams; owned SQLite online backup. No core-source aliases, Vite, app source patches, builds, packs or installs.' };
  let state = fixtureIdentity(); let isolation; let server; let browserOpened = false; let cdpBrowser; let pendingPage; let failure; let snapshot; let buildSnapshot; let originalDatabase; let databaseSnapshot; let interrupted = false;
  const session = 'invitation-installed-' + state.runId;
  let origin;
  const browser = async (...args) => {
    assert(!interrupted || args[0] === 'close', 'Installed certification interrupted.');
    browserOpened = true;
    let response;
    try { response = await run('agent-browser', ['--session', session, '--json', ...args], { timeout: 45000, maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, AGENT_BROWSER_ALLOWED_DOMAINS: '127.0.0.1', AGENT_BROWSER_DEFAULT_TIMEOUT: '10000' } }); }
    catch (error) { throw new Error('Browser command failed: ' + redact(error.stderr ?? 'command timeout', state)); }
    const parsed = JSON.parse(response.stdout); assert.equal(parsed.success, true, redact(JSON.stringify(parsed), state)); return parsed.data;
  };
  const evaluate = async (code) => (await browser('eval', '-b', Buffer.from(code).toString('base64'))).result;
  const check = async (name, callback) => { assert(!interrupted, 'Installed certification interrupted.'); await callback(); result.cases.push(name); result.passed++; console.log('Installed invitation UI passed: ' + name); };
  const status = () => { assert(!interrupted, 'Installed certification interrupted.'); return installedFixture(isolation, 'status', state); };
  const interrupt = () => { interrupted = true; if (server) void stopServer(server).catch((error) => result.cleanupErrors.push(redact(error.message, state))); };
  process.on('SIGINT', interrupt); process.on('SIGTERM', interrupt);
  const setActor = async (account) => {
    await browser('cookies', 'clear');
    if (account) await browser('cookies', 'set', 'svelar_session', account.session + '.' + createHmac('sha256', isolation.env.APP_KEY).update(account.session).digest('base64url'),
      '--url', origin, '--httpOnly', '--sameSite', 'Lax');
  };
  const api = (name, operation, csrf = false) => evaluate(`(async () => {
    const token = document.cookie.match(/(?:^|;\\s*)XSRF-TOKEN=([^;]+)/)?.[1];
    const response = await fetch('/api/invitations/${state.tokens[name] ?? name}${operation ? '/' + operation : ''}', {
      method: '${operation ? 'POST' : 'GET'}', headers: { ${operation ? "'Content-Type': 'application/json'," : ''} ${csrf ? "'X-CSRF-Token': token ?? ''," : ''} }, ${operation ? "body: '{}'," : ''} });
    return { status: response.status, body: await response.json() };
  })()`);
  try {
    await mkdir(options.reportDir, { recursive: true });
    result.runner = { path: scriptPath, sha256: digest(await readFile(scriptPath)) };
    snapshot = await sourceSnapshot(options.appDir);
    await check('installed production preflight', async () => {
      result.installation = await installedPreflight(options.appDir);
      if (options.tarball) result.artifact = await verifyArtifact(options.tarball, result.installation);
    });
    buildSnapshot = await treeSnapshot(join(options.appDir, 'build'));
    const port = await new Promise((accept, reject) => { const probe = createServer(); probe.once('error', reject); probe.listen(0, '127.0.0.1', () => {
      const port = probe.address().port; probe.close((error) => error ? reject(error) : accept(port)); }); });
    origin = 'http://127.0.0.1:' + port; result.port = port;
    await check('owned online backup and persisted installed UserFactory/Auth/Teams fixtures', async () => {
      const appEnv = existsSync(join(options.appDir, '.env')) ? parseEnv(await readFile(join(options.appDir, '.env'), 'utf8')) : {};
      originalDatabase = resolve(options.appDir, options.database ?? appEnv.DB_PATH ?? 'database.db');
      databaseSnapshot = await databaseDigests(originalDatabase);
      isolation = await prepareIsolatedApp({ ...options, port, baseUrl: origin }, state);
      await restoreOriginalAuthConfig(options.appDir, isolation.appDir);
      assert(typeof isolation.env.APP_KEY === 'string' && isolation.env.APP_KEY.length >= 16, 'Signed fixture sessions require the actual app key.');
      state.sessionSecret = isolation.env.APP_KEY;
      assert.deepEqual(await treeSnapshot(join(isolation.appDir, 'build')), buildSnapshot, 'Isolation changed production output.');
      const copiedSource = await sourceSnapshot(isolation.appDir);
      for (const [path, hash] of Object.entries(snapshot).filter(([path]) => path.startsWith('src/'))) assert.equal(copiedSource[path], hash, `App source changed: ${path}`);
      state = await installedFixture(isolation, 'create', state);
      assert.equal((await status()).recipientMemberships.length, 0, 'Acceptance must create a new membership in the main fixture team.');
    });
    result.fixture = { runId: state.runId, driver: 'sqlite', database: 'owned online backup',
      creation: 'generated UserFactory; Hash.make; app AuthManager.attempt + DatabaseSessionStore; public Teams APIs',
      readOnlyScope: ['teams', 'team_members', 'team_invitations'], originalDatabaseDigests: databaseSnapshot,
      originalSourceDigest: digest(JSON.stringify(snapshot)), productionDigest: digest(JSON.stringify(buildSnapshot)) };
    server = startServer(isolation.appDir, { ...isolation.env, NODE_ENV: 'production', APP_ENV: 'testing' });
    const deadline = Date.now() + 30000;
    while (true) {
      assert(server.child.exitCode === null && server.child.signalCode === null, redact(server.tail(), state));
      try { const response = await fetch(origin + '/login', { signal: AbortSignal.timeout(1500) }); assert.equal(response.status, 200, 'Production startup HTTP ' + response.status); break; }
      catch (error) { if (!['ECONNREFUSED', 'UND_ERR_CONNECT_TIMEOUT'].includes(error.cause?.code)) throw error; }
      assert(Date.now() < deadline, 'Production server startup timed out.'); await new Promise((accept) => setTimeout(accept, 250));
    }
    const recipient = state.accounts.eligible; const foreign = state.accounts.unavailable;
    await check('anonymous page/API GET is readonly and discloses no recipient or team', async () => {
      const before = await status();
      await browser('open', origin + '/invitations/' + state.tokens.accept); await browser('wait', '--text', 'Sign in to review');
      const text = await evaluate('document.body.innerText'); assert(!text.includes(recipient.email) && !text.includes(state.team.name));
      const response = await api('accept'); assert.equal(response.status, 401);
      assert(!JSON.stringify(response.body).includes(recipient.email) && !JSON.stringify(response.body).includes(state.team.name));
      assert.deepEqual((await status()).tables, before.tables);
    });
    for (const [width, height, label, name] of [[1440, 900, 'desktop', 'loginDesktop'], [390, 844, 'mobile', 'loginMobile']]) {
      const destination = '/invitations/' + state.tokens[name];
      const loginPath = '/login?redirectTo=' + encodeURIComponent(destination);
      await check(label + ' authentication modes preserve the invitation destination', async () => {
        await setActor(null); await browser('set', 'viewport', String(width), String(height));
        await browser('open', origin + destination); await browser('wait', 'a[href^="/login?"]'); await browser('click', 'a[href^="/login?"]');
        await browser('wait', 'input[name=email]'); assert.equal(new URL(await browser('get', 'url').then((data) => data.url)).searchParams.get('redirectTo'), destination);
        for (const path of ['/register', '/forgot-password', '/otp-login']) {
          await browser('open', origin + loginPath); await browser('wait', 'input[name=email]');
          const href = await evaluate(`document.querySelector('a[href^="${path}?"]')?.getAttribute('href')`);
          assert.equal(new URL(href, origin).searchParams.get('redirectTo'), destination, path + ' lost destination');
          await browser('click', 'a[href^="' + path + '?"]'); await browser('wait', 'input[name=email]');
          assert.equal(new URL((await browser('get', 'url')).url).searchParams.get('redirectTo'), destination);
          const back = await evaluate('document.querySelector(\'a[href^="/login?"]\')?.getAttribute("href")');
          assert.equal(new URL(back, origin).searchParams.get('redirectTo'), destination, path + ' return link lost destination');
        }
        assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
      });
      await check(label + ' actual password login returns to the pending invitation', async () => {
        await browser('open', origin + loginPath); await browser('wait', 'input[name=password]');
        await browser('fill', 'input[name=email]', recipient.email); await browser('fill', 'input[name=password]', state.password);
        await browser('click', 'button[type=submit]'); await browser('wait', '--url', origin + destination); await browser('wait', 'button[formaction]');
        assert.equal((await status()).invitations[name], 'pending');
      });
    }
    await check('foreign authenticated page/API/actions deny details and retain current state', async () => {
      await setActor(foreign); const before = await status(); await browser('open', origin + '/invitations/' + state.tokens.guard);
      await browser('wait', '--text', 'not available to this account');
      assert.equal(await evaluate('document.querySelector("button[type=submit]") === null'), true);
      assert(!(await evaluate('document.body.innerText')).includes(recipient.email));
      for (const operation of [undefined, 'accept', 'decline']) assert.equal((await api('guard', operation, !!operation)).status, 403);
      assert.deepEqual((await status()).tables, before.tables);
    });
    await setActor(recipient);
    await check('recipient GET returns the safe resource without domain writes', async () => {
      const before = await status(); await browser('open', origin + '/invitations/' + state.tokens.guard); await browser('wait', 'button[formaction]');
      const response = await api('guard'); assert.equal(response.status, 200); assert.equal(response.body.data.invitation.team.name, state.team.name);
      assert(!JSON.stringify(response.body).includes(recipient.email)); assert.equal(response.body.data.invitation.role, 'viewer');
      assert.deepEqual((await status()).tables, before.tables);
    });
    await check('expired/consumed/missing links have honest API and page states', async () => {
      const before = await status();
      for (const [name, expected, message] of [['expired', 410, 'has expired'], ['accepted', 409, 'already been accepted'], [randomUUID(), 404, 'could not be found']]) {
        await browser('open', origin + '/invitations/' + (state.tokens[name] ?? name)); await browser('wait', '--text', message);
        assert.equal(await evaluate('document.querySelector("button[type=submit]") === null'), true);
        for (const operation of [undefined, 'accept', 'decline']) assert.equal((await api(name, operation, !!operation)).status, expected);
      }
      assert.deepEqual((await status()).tables, before.tables);
    });
    await check('missing CSRF returns 419 for both operations without consuming the invitation', async () => {
      const before = await status(); await browser('open', origin + '/invitations/' + state.tokens.guard); await browser('wait', 'button[formaction]');
      for (const operation of ['accept', 'decline']) assert.equal((await api('guard', operation)).status, 419);
      assert.deepEqual((await status()).tables, before.tables);
    });
    await check('desktop production rendering and keyboard accept persist the consumed resource', async () => {
      const before = await status(); assert.equal(before.recipientMemberships.length, 0);
      await browser('set', 'viewport', '1440', '900'); await browser('open', origin + '/invitations/' + state.tokens.accept); await browser('wait', 'button[formaction]');
      assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
      await browser('wait', '--fn', '[...document.querySelectorAll(".auth-frame img")].every(image => image.complete)');
      result.branding = await evaluate('({ frameCount: document.querySelectorAll(".auth-frame").length, heading: document.querySelector(".auth-frame h1")?.textContent?.trim(), images: [...document.querySelectorAll(".auth-frame img")].map(image => ({ src: image.getAttribute("src"), complete: image.complete, naturalWidth: image.naturalWidth })) })');
      await browser('screenshot', join(options.reportDir, 'installed-desktop.png'));
      assertBranding(state.presentation, result.branding);
      const { chromium } = createRequire(join(options.appDir, 'package.json'))('@playwright/test');
      cdpBrowser = await chromium.connectOverCDP(invitationCdpEndpoint(await browser('get', 'cdp-url')), { timeout: 10000 });
      const pages = cdpBrowser.contexts().flatMap((context) => context.pages()).filter((page) => new URL(page.url()).origin === origin);
      assert.equal(pages.length, 1, 'Expected one page for the owned invitation browser session.');
      pendingPage = pages[0]; pendingPage.setDefaultTimeout(10000);
      const acceptance = await pendingFormSubmission(pendingPage, { path: '/invitations/' + state.tokens.accept,
        action: 'accept', spinner: true, fields: { token: state.tokens.accept } }, async () => {
        await browser('focus', 'button[type=submit]'); await browser('press', 'Enter');
      });
      result.pendingForms.push(acceptance.evidence);
      assert.equal((await acceptance.response.json()).type, 'success', 'Accept must complete through the real named action.');
      await browser('wait', '--text', 'Invitation accepted.');
      assert.equal(await evaluate('document.querySelector("button[type=submit]") === null'), true);
      const after = await status(); result.acceptance = { before, after };
      assert.equal(after.invitations.accept, 'accepted'); assert.equal(after.recipientMemberships.length, 1); assert.equal(after.recipientMemberships[0].role, 'viewer');
      assert.equal(after.tables.team_members.count, before.tables.team_members.count + 1);
      await browser('reload'); await browser('wait', '--text', 'already been accepted');
      assert.equal((await api('accept', 'accept', true)).status, 409); assert.deepEqual((await status()).tables, after.tables);
    });
    await check('mobile production named decline removes only the pending invitation', async () => {
      const before = await status(); await browser('set', 'viewport', '390', '844'); await browser('open', origin + '/invitations/' + state.tokens.mobile); await browser('wait', 'button[formaction]');
      assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true); await browser('screenshot', join(options.reportDir, 'installed-mobile.png'));
      const decline = await pendingFormSubmission(pendingPage, { path: '/invitations/' + state.tokens.mobile,
        action: 'decline', spinner: true, fields: { token: state.tokens.mobile } },
        () => browser('find', 'role', 'button', 'click', '--name', 'Decline'));
      result.pendingForms.push(decline.evidence);
      assert.equal((await decline.response.json()).type, 'success', 'Decline must complete through the real named action.');
      await browser('wait', '--text', 'Invitation declined.');
      assert.equal(await evaluate('document.querySelector("button[type=submit]") === null'), true);
      const after = await status(); assert.equal(after.invitations.mobile, 'missing'); assert.deepEqual(after.tables.team_members, before.tables.team_members);
      assert.equal(after.tables.team_invitations.count, before.tables.team_invitations.count - 1);
      await browser('reload'); await browser('wait', '--text', 'could not be found');
    });
    await check('no uncaught production browser errors', async () => { const errors = await browser('errors'); assert(!errors.errors?.length, redact(JSON.stringify(errors), state)); });
    assert(!interrupted, 'Installed certification interrupted.'); assert.equal(result.passed, result.expectedChecks); result.complete = true;
  } catch (error) { failure = error; result.failed = 1; result.failure = redact(error.stack ?? error, state); }
  finally {
    for (const cleanup of [async () => { if (browserOpened) await browser('close'); }, async () => { if (cdpBrowser?.isConnected()) await cdpBrowser.close(); }, async () => { if (server) await stopServer(server); },
      async () => { if (snapshot) assert.deepEqual(await sourceSnapshot(options.appDir), snapshot, 'Original source/config/env changed.'); },
      async () => { if (buildSnapshot) assert.deepEqual(await treeSnapshot(join(options.appDir, 'build')), buildSnapshot, 'Original production output changed.'); },
      async () => { if (result.installation) assert.deepEqual(await installedPreflight(options.appDir), result.installation, 'Installed package or factory changed.'); },
      async () => { if (databaseSnapshot) assert.deepEqual(await databaseDigests(originalDatabase), databaseSnapshot, 'Original database or WAL bytes changed.'); },
      async () => { if (isolation) await rm(isolation.parent, { recursive: true, force: true }); }]) {
      try { await cleanup(); } catch (error) { result.cleanupErrors.push(redact(error.message, state)); }
    }
    if (result.cleanupErrors.length) { result.failed = 1; result.complete = false; }
    process.off('SIGINT', interrupt); process.off('SIGTERM', interrupt);
    result.finishedAt = new Date().toISOString();
    result.notRun = Math.max(0, result.expectedChecks - result.passed - result.failed);
    if (server) await writeFile(join(options.reportDir, 'installed-server.log'), redact(server.tail(), state), { mode: 0o600 });
    await mkdir(options.reportDir, { recursive: true });
    await writeFile(join(options.reportDir, 'installed-summary.json'), JSON.stringify(result, null, 2) + '\n', { mode: 0o600 });
  }
  console.log(`Installed invitation UI: ${result.complete ? 'PASS' : 'FAIL'} (${result.passed} passed, ${result.failed} failed, 0 skipped). Report: ${join(options.reportDir, 'installed-summary.json')}`);
  if (failure) console.error(result.failure);
  if (!result.complete) process.exitCode = 1;
  return result;
}

async function main() {
  const args = process.argv.slice(2);
  const operation = args.find((arg) => arg.startsWith('--fixture-op='));
  if (operation) return fixtureChild(operation.slice('--fixture-op='.length));
  if (args.includes('--help')) {
    console.log('Invitation UI certification\n  --clients=<manifest> [--valibot] --report-dir=<dir> (source-only Vite fixture)\n  --installed-app=<built-app> [--database=<SQLite file>] [--tarball=<candidate.tgz>] --report-dir=<dir> (unchanged installed production app; owned online backup)\nNo core builds, packs, installs or shared app/database writes. Installed preflight fails when routes/APIs/factory/build are missing. --tarball pins the installed manifest and public entries to the immutable artifact.');
    return;
  }
  if (args.some((arg) => arg.startsWith('--installed-app'))) return installedCertification(parseInstalledOptions(args));
  return sourceCertification();
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
