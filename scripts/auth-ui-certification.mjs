#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseEnv } from 'node:util';

const scriptPath = fileURLToPath(import.meta.url);
const resultPrefix = 'AUTH_UI_FIXTURE_RESULT:';
export const fixturePolicy = Object.freeze({ idle: 90, absolute: 600, remember: 300, rememberAbsolute: 1200, warning: 60 });
export const fixtureRenewalTiming = Object.freeze({ remainingSeconds: Math.floor(fixturePolicy.warning * 0.75), pacedRequestSlots: 12, intervalMs: 1800, processingSlackMs: 10000 });
export const authUiMessages = Object.freeze({ invalidOtp: 'Invalid or expired code' });
export const surfaces = Object.freeze([
  { path: '/login', heading: 'Sign In', form: true },
  { path: '/register', heading: 'Create Account', form: true },
  { path: '/forgot-password', heading: 'Forgot Password', form: true },
  { path: '/reset-password?token=auth-ui-invalid&email=unknown%40example.test', heading: 'Reset Password', form: true },
  { path: '/otp-login', heading: 'Sign In with Code', form: true },
  { path: '/verify-email', heading: 'Email Verification', form: false },
]);

export function parseOptions(args) {
  const options = { phase: 'full', port: 5897, noServer: false, headed: false };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--help') options.help = true;
    else if (arg === '--no-server') options.noServer = true;
    else if (arg === '--headed') options.headed = true;
    else if (['--app-dir', '--base-url', '--phase', '--port', '--report-dir', '--database', '--fixture-op'].includes(arg)) {
      const value = args[++index];
      assert(value && !value.startsWith('--'), `Missing value for ${arg}`);
      options[{ '--app-dir': 'appDir', '--base-url': 'baseUrl', '--phase': 'phase', '--port': 'port', '--report-dir': 'reportDir', '--database': 'database', '--fixture-op': 'fixtureOp' }[arg]] = value;
    } else throw new Error(`Unknown option ${arg}`);
  }
  if (options.help || options.fixtureOp) return options;
  assert(options.appDir, '--app-dir must point to an installed, production-built app.');
  options.appDir = resolve(options.appDir);
  options.port = Number(options.port);
  assert(Number.isInteger(options.port) && options.port > 1024 && options.port <= 65535, 'Invalid non-default port.');
  assert(['baseline', 'full'].includes(options.phase), '--phase must be baseline or full.');
  if (options.noServer) {
    assert(options.baseUrl, '--no-server requires --base-url.');
    assert(options.phase === 'baseline', '--no-server is read-only; use --phase baseline. Full cases require the isolated server.');
  } else {
    options.baseUrl ??= `http://127.0.0.1:${options.port}`;
    const url = new URL(options.baseUrl);
    assert(url.hostname === '127.0.0.1' && url.protocol === 'http:' && Number(url.port) === options.port && url.pathname === '/', 'Owned server URL must match http://127.0.0.1:<port>.');
  }
  const url = new URL(options.baseUrl);
  assert(['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash, 'Expected a bare server origin.');
  options.baseUrl = url.origin;
  return options;
}

export async function assertPortAvailable(port) {
  await new Promise((accept, reject) => {
    const probe = createServer();
    probe.once('error', () => reject(new Error(`Port ${port} is occupied; no existing process was stopped.`)));
    probe.listen(port, '127.0.0.1', () => probe.close((error) => error ? reject(error) : accept()));
  });
}

export async function withCleanup(work, cleanup) {
  let failure;
  let result;
  try { result = await work(); } catch (error) { failure = error; }
  try { await cleanup(); } catch (error) { failure = failure ? new AggregateError([failure, error], 'Certification and cleanup failed.') : error; }
  if (failure) throw failure;
  return result;
}

export function createRequestPacer(intervalMs = fixtureRenewalTiming.intervalMs, clock = { now: Date.now, sleep: (ms) => new Promise((accept) => setTimeout(accept, ms)) }) {
  let next = 0;
  return async () => {
    const now = clock.now();
    const scheduled = Math.max(now, next);
    next = scheduled + intervalMs;
    if (scheduled > now) await clock.sleep(scheduled - now);
  };
}

async function paceContext(context, pace) {
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (!url.pathname.startsWith('/_app/') && !/\.(?:ico|png|jpg|jpeg|webp|svg|woff2?|css|js)$/.test(url.pathname)) await pace();
    await route.continue();
  });
}

export function pendingFormSnapshot({ formSelector = 'form', loadingText } = {}) {
  const form = document.querySelector(formSelector);
  const visible = (element) => element.getClientRects().length > 0;
  const buttons = [...(form?.querySelectorAll('button[type=submit]') ?? [])].filter(visible);
  const inputs = [...(form?.querySelectorAll('input:not([type=hidden]), textarea, select') ?? [])].filter(visible);
  return { visible: !!form && visible(form), submitCount: buttons.length, inputCount: inputs.length,
    submitsDisabled: buttons.length > 0 && buttons.every((button) => button.disabled),
    inputsDisabled: inputs.every((input) => input.disabled),
    busy: buttons.some((button) => button.getAttribute('aria-busy') === 'true'),
    loading: !!loadingText && buttons.some((button) => button.textContent.trim() === loadingText),
    spinner: buttons.some((button) => [...button.querySelectorAll('svg.animate-spin')].some(visible)),
  };
}

export function assertPendingForm(snapshot, { loadingText, spinner = false } = {}) {
  assert(snapshot.visible && snapshot.submitCount > 0, 'Pending form must remain visible.');
  assert(snapshot.submitsDisabled && snapshot.inputsDisabled, 'Pending form must disable all visible inputs and submit controls.');
  assert(loadingText ? snapshot.loading : snapshot.busy, 'Pending form must show visible loading feedback.');
  if (spinner) assert(snapshot.spinner, 'Pending form must show its loading spinner.');
}

// Hold the real browser POST, never its response; release to the unchanged server after observing pending UI.
export async function pendingFormSubmission(page, { path, action, formSelector = 'form', loadingText, spinner = false, fields = {} }, submit, observe = async () => {}) {
  const origin = new URL(page.url()).origin;
  const matchesUrl = (value) => {
    const url = new URL(String(value));
    return url.origin === origin && url.pathname === path && (!action || url.searchParams.has('/' + action));
  };
  const matches = (request) => request.method() === 'POST' && matchesUrl(request.url());
  let release; let captured; let rejectRoute; let forwarded; let heldRoute = false; let writes = 0; let timer; let snapshot;
  const gate = new Promise((accept) => { release = accept; });
  const intercepted = new Promise((accept) => { captured = accept; });
  const routeFailure = new Promise((_, reject) => { rejectRoute = reject; });
  const completed = new Promise((accept) => { forwarded = accept; });
  routeFailure.catch(() => {});
  const count = (request) => { if (matches(request)) writes++; };
  const handler = async (route) => {
    if (!matches(route.request())) return route.fallback();
    heldRoute = true;
    try {
      const request = route.request();
      const form = await new Response(request.postDataBuffer(), { headers: { 'content-type': request.headers()['content-type'] } }).formData();
      for (const [name, value] of Object.entries(fields)) assert(form.get(name) === value, `Actual submitted ${name} did not match the valid fixture input.`);
      captured(); await gate; await route.fallback();
    } catch (error) { rejectRoute(error); await route.abort('failed'); }
    finally { forwarded(); }
  };
  page.on('request', count);
  await page.route(matchesUrl, handler);
  const response = page.waitForResponse((value) => matches(value.request()), { timeout: 10000 });
  response.catch(() => {});
  try {
    await submit();
    await Promise.race([intercepted, routeFailure, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Valid ${path} form did not submit its POST.`)), 5000);
    })]);
    clearTimeout(timer);
    const settings = { formSelector, loadingText };
    await page.waitForFunction((settings) => {
      const form = document.querySelector(settings.formSelector);
      const buttons = [...(form?.querySelectorAll('button[type=submit]') ?? [])].filter((button) => button.getClientRects().length > 0);
      return buttons.some((button) => settings.loadingText ? button.textContent.trim() === settings.loadingText : button.getAttribute('aria-busy') === 'true');
    }, settings, { timeout: 10000 });
    snapshot = await page.evaluate(pendingFormSnapshot, settings);
    assertPendingForm(snapshot, { loadingText, spinner });
    await observe();
    await page.keyboard.press('Enter');
    assert.equal(writes, 1, 'Pending form dispatched a duplicate POST.');
    release();
    const actual = await Promise.race([response, routeFailure]);
    assert.equal(writes, 1, 'Form dispatched more than one POST after release.');
    return { response: actual, evidence: { path, action: action ?? 'default', posts: writes, ...snapshot, validatedFields: Object.keys(fields) } };
  } finally {
    clearTimeout(timer); release();
    page.off('request', count);
    if (heldRoute) await completed;
    await page.unroute(matchesUrl, handler);
  }
}

export async function sourceSnapshot(appDir) {
  const snapshot = {};
  async function visit(path, key) {
    if (!existsSync(path)) return;
    const entries = await readdir(path, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      assert(!entry.isSymbolicLink(), `Refusing source symlink: ${key}/${entry.name}`);
      const nextKey = `${key}/${entry.name}`;
      if (entry.isDirectory()) await visit(join(path, entry.name), nextKey);
      else if (entry.isFile()) snapshot[nextKey] = createHash('sha256').update(await readFile(join(path, entry.name))).digest('hex');
    }
  }
  for (const directory of ['src', 'config']) await visit(join(appDir, directory), directory);
  for (const name of ['.env', 'package.json', 'svelar.database.json']) {
    if (existsSync(join(appDir, name))) snapshot[name] = createHash('sha256').update(await readFile(join(appDir, name))).digest('hex');
  }
  return snapshot;
}

export function fixtureIdentity(runId = randomUUID()) {
  assert(/^[a-zA-Z0-9-]{8,80}$/.test(runId), 'Invalid fixture identity.');
  const suffix = `+${runId}@example.test`;
  return { runId, password: `Fixture-${randomBytes(16).toString('hex')}!`,
    accounts: Object.fromEntries(['eligible', 'disabled', 'locked', 'unverified', 'unavailable'].map((kind) => [kind, { email: `auth-ui-${kind}${suffix}` }])) };
}

// Test setup uses the installed model/query builder; it never creates tables or changes seed accounts.
export async function fixtureRecords(dependencies, operation, state, input = {}) {
  const { Connection, QueryBuilder, User, Hash, DatabaseSessionStore } = dependencies;
  const identity = fixtureIdentity(state.runId);
  for (const [kind, account] of Object.entries(state.accounts)) {
    assert(account.email === identity.accounts[kind]?.email, 'Fixture account is not owned by this run.');
  }
  async function ownedSession() {
    assert(typeof input.sessionId === 'string' && /^[a-zA-Z0-9_-]{16,200}$/.test(input.sessionId), 'Invalid session identifier.');
    const store = new DatabaseSessionStore();
    const payload = await store.read(input.sessionId);
    assert(payload && Object.values(state.accounts).some((account) => account.id !== undefined && String(account.id) === String(payload.auth_user_id)), 'Refusing to modify a foreign or expired session.');
    return { store, payload };
  }
  if (operation === 'create') {
    await Connection.transaction(async () => {
      const password = await Hash.make(state.password);
      for (const [kind, account] of Object.entries(state.accounts)) {
        assert(!await User.where('email', account.email).first(), 'Fixture account already exists.');
        const user = await User.create({ name: `Auth UI ${kind}`, email: account.email, password, role: 'user' });
        account.id = user.getAttribute('id');
        await User.where('id', account.id).where('email', account.email).update({
          disabled_at: kind === 'disabled' ? new Date().toISOString() : null,
          locked_until: kind === 'locked' ? new Date(Date.now() + 3600000).toISOString() : null,
          email_verified_at: kind === 'unverified' ? null : new Date().toISOString(),
        });
      }
    });
    return state;
  }
  if (operation === 'session-warning' || operation === 'session-absolute') {
    const { store, payload } = await ownedSession();
    const now = Date.now();
    const idle = payload._svelar_remember ? fixturePolicy.remember : fixturePolicy.idle;
    const absolute = payload._svelar_remember ? fixturePolicy.rememberAbsolute : fixturePolicy.absolute;
    if (operation === 'session-absolute') payload._svelar_created_at = now - (absolute - 45) * 1000;
    payload._svelar_last_activity_at = operation === 'session-warning' ? now - (idle - fixtureRenewalTiming.remainingSeconds) * 1000 : now;
    if (operation === 'session-warning') {
      assert(typeof payload._svelar_created_at === 'number' && Number.isFinite(payload._svelar_created_at), 'Owned session is missing its creation timestamp.');
      // A freshly signed-in fixture must be aged too; activity cannot precede creation.
      payload._svelar_created_at = Math.min(payload._svelar_created_at, payload._svelar_last_activity_at);
    }
    payload._svelar_last_touched_at = now;
    await store.write(input.sessionId, payload, 60);
    return { createdAt: payload._svelar_created_at, absoluteExpiresAt: payload._svelar_created_at + absolute * 1000 };
  }
  if (operation === 'otp-fixture') {
    const account = state.accounts.eligible;
    const user = await User.where('id', account.id).where('email', account.email).first();
    assert(user, 'Missing owned OTP user.');
    assert(typeof dependencies.tokenSecret === 'string' && dependencies.tokenSecret.length >= 16, 'Missing fixture token secret.');
    assert(typeof input.code === 'string' && /^\d{6}$/.test(input.code), 'Invalid fixture OTP.');
    await Connection.transaction(async () => {
      const query = () => new QueryBuilder('otp_codes').where('email', account.email).where('purpose', 'login');
      await query().delete();
      await new QueryBuilder('otp_codes').insert({ email: account.email, purpose: 'login', code: createHmac('sha256', dependencies.tokenSecret).update(input.code).digest('hex'),
        expires_at: new Date(Date.now() + 600000).toISOString(), created_at: new Date().toISOString(), used_at: null });
    });
    return { seeded: true };
  }
  if (operation === 'cleanup') {
    await Connection.transaction(async () => {
      for (const account of Object.values(state.accounts)) {
        const user = await User.where('email', account.email).first();
        if (!user) continue;
        assert(account.id !== undefined && String(user.getAttribute('id')) === String(account.id), 'Refusing cleanup of a replacement account.');
        for (const table of ['password_resets', 'otp_codes']) await new QueryBuilder(table).where('email', account.email).delete();
        await new QueryBuilder('email_verifications').where('user_id', String(account.id)).delete();
        await User.where('id', account.id).where('email', account.email).delete();
      }
    });
    return { cleaned: true };
  }
  throw new Error(`Unknown fixture operation ${operation}`);
}

function installedRequire(appDir) { return createRequire(join(appDir, 'package.json')); }
async function installedImport(appDir, subpath) {
  const manifestPath = installedRequire(appDir).resolve('@beeblock/svelar/package.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const target = manifest.exports?.[`./${subpath}`]?.import;
  assert(typeof target === 'string' && target.startsWith('./'), `Installed Svelar has no public import export for ${subpath}.`);
  return import(pathToFileURL(resolve(dirname(manifestPath), target)).href);
}

export async function installationProvenance(appDir) {
  const manifestPath = installedRequire(appDir).resolve('@beeblock/svelar/package.json');
  const bytes = await readFile(manifestPath);
  const manifest = JSON.parse(bytes.toString('utf8'));
  const authEntry = manifest.exports?.['./auth']?.import;
  assert(typeof authEntry === 'string' && authEntry.startsWith('./'), 'Missing installed public auth entry.');
  const digest = (value) => createHash('sha256').update(value).digest('hex');
  return { version: manifest.version, manifestSha256: digest(bytes), authEntrySha256: digest(await readFile(resolve(dirname(manifestPath), authEntry))),
    buildEntrySha256: existsSync(join(appDir, 'build/index.js')) ? digest(await readFile(join(appDir, 'build/index.js'))) : null };
}

async function fixtureChild(operation) {
  let raw = '';
  for await (const chunk of process.stdin) {
    raw += chunk;
    assert(raw.length < 32768, 'Fixture input too large.');
  }
  const { state, input } = JSON.parse(raw);
  const appDir = process.cwd();
  const { Command } = await installedImport(appDir, 'cli');
  const { Connection } = await installedImport(appDir, 'database');
  const { QueryBuilder } = await installedImport(appDir, 'orm');
  const { Hash } = await installedImport(appDir, 'hashing');
  const { DatabaseSessionStore } = await installedImport(appDir, 'session');
  const { config } = await installedImport(appDir, 'config');
  class FixtureCommand extends Command {
    name = 'auth-ui:fixture';
    description = 'Private certification fixture';
    async handle() {
      await this.bootstrap();
      const candidates = ['src/lib/modules/auth/domain/models/User.ts', 'src/lib/models/User.ts'];
      const userPath = candidates.map((path) => join(appDir, path)).find(existsSync);
      assert(userPath, 'Generated User model not found (DDD or flat).');
      const { User } = await this.importUserModule(userPath);
      return fixtureRecords({ Connection, QueryBuilder, User, Hash, DatabaseSessionStore, tokenSecret: config.get('auth.jwt.secret', process.env.JWT_SECRET ?? process.env.APP_KEY) }, operation, state, input);
    }
  }
  try {
    const result = await new FixtureCommand().handle();
    process.stdout.write(`${resultPrefix}${JSON.stringify(result)}\n`);
  } finally { await Connection.disconnect(); }
}

export async function runFixtureCommand(appDir, env, operation, state, input = {}) {
  const child = spawn(process.execPath, [scriptPath, '--fixture-op', operation], { cwd: appDir, env, stdio: ['pipe', 'pipe', 'pipe'] });
  let output = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { output = (output + chunk).slice(-131072); });
  child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-4000); });
  let forcedExit;
  const timer = setTimeout(() => { child.kill('SIGTERM'); forcedExit = setTimeout(() => child.kill('SIGKILL'), 5000); }, 30000);
  try {
    const code = await new Promise((accept, reject) => {
      child.once('error', reject);
      child.once('exit', accept);
      child.stdin.end(JSON.stringify({ state, input }));
    });
    // Do not echo application output: mail/log sinks may contain credentials.
    assert(code === 0, `Installed fixture command ${operation} failed (${code}): ${redactSecrets(stderr.slice(-4000), state)}`);
    const lines = output.split('\n').filter((value) => value.startsWith(resultPrefix));
    assert.equal(lines.length, 1, 'Installed fixture command must produce one unambiguous result.');
    return JSON.parse(lines[0].slice(resultPrefix.length));
  } finally { clearTimeout(timer); clearTimeout(forcedExit); }
}

export function redactSecrets(value, state) {
  let result = String(value);
  for (const secret of [state?.password, ...Object.values(state?.accounts ?? {}).map((account) => account.email)].filter(Boolean)) result = result.replaceAll(secret, '[fixture-redacted]');
  return result;
}

export function assertCookieDeadline(cookie, status) {
  if (!status.remembered && cookie.expires === -1) return;
  assert(cookie.expires > 0, 'Remembered sessions must have a persistent cookie.');
  assert(cookie.expires * 1000 <= status.expiresAt + 1500, `Cookie exceeded session deadline by ${Math.ceil(cookie.expires * 1000 - status.expiresAt)}ms.`);
}

export async function assertSessionRenewal(response, before) {
  assert.equal(response.status(), 200, 'Explicit session renewal must succeed before warning dismissal.');
  const result = await response.json();
  assert(result.data && result.data.expired === false && result.data.canRenew === true
    && result.data.expiresAt > before.expiresAt, 'Renewal response must extend a renewable authenticated idle deadline.');
  assert.equal(result.data.absoluteExpiresAt, before.absoluteExpiresAt, 'Renewal response changed the absolute deadline.');
  return result.data;
}

async function overlayConfig(appDir, name, expression) {
  const directory = join(appDir, 'config');
  await mkdir(directory, { recursive: true });
  const original = ['ts', 'js'].map((extension) => join(directory, `${name}.${extension}`)).filter(existsSync);
  assert(original.length <= 1, `Ambiguous ${name} config.`);
  let prelude = 'const original = {};\n';
  if (original.length) {
    const hiddenName = `.auth-ui-original-${basename(original[0])}`;
    await rename(original[0], join(directory, hiddenName));
    prelude = `import original from './${hiddenName}';\n`;
  }
  await writeFile(join(directory, `${name}.js`), `${prelude}export default ${expression};\n`, { mode: 0o600 });
}

export async function prepareIsolatedApp(options, state) {
  const snapshot = await sourceSnapshot(options.appDir);
  const parent = await mkdtemp(join(tmpdir(), 'svelar-auth-ui-'));
  const appDir = join(parent, 'app');
  try {
    await mkdir(appDir, { mode: 0o700 });
    assert(existsSync(join(options.appDir, 'build/index.js')), 'Missing adapter-node production build/index.js; build the installed app before certification.');
    for (const entry of await readdir(options.appDir, { withFileTypes: true })) {
      if (['node_modules', '.git', 'storage', 'docs'].includes(entry.name) || /\.(db|sqlite|sqlite3)(-wal|-shm)?$/.test(entry.name)) continue;
      assert(!entry.isSymbolicLink(), `Refusing app symlink ${entry.name}.`);
      await cp(join(options.appDir, entry.name), join(appDir, entry.name), { recursive: true });
    }
    await symlink(join(options.appDir, 'node_modules'), join(appDir, 'node_modules'), 'dir');
    const appEnv = existsSync(join(appDir, '.env')) ? parseEnv(await readFile(join(appDir, '.env'), 'utf8')) : {};
    assert((appEnv.DB_DRIVER ?? 'sqlite') === 'sqlite', 'Full isolation currently supports SQLite only; no-server baseline supports any driver.');
    assert(options.database || !existsSync(join(appDir, 'config/database.ts')) && !existsSync(join(appDir, 'config/database.js')), 'Custom database config requires an explicit --database SQLite file.');
    const originalDatabase = resolve(options.appDir, options.database ?? appEnv.DB_PATH ?? 'database.db');
    assert(existsSync(originalDatabase), 'SQLite fixture source is missing.');
    const database = join(appDir, 'auth-ui.sqlite');
    // SQLite online backup is infrastructure, not CRUD; readonly prevents writes to the shared database.
    const SQLite = installedRequire(options.appDir)('better-sqlite3');
    const source = new SQLite(originalDatabase, { readonly: true, fileMustExist: true });
    try { await source.backup(database); } finally { source.close(); }
    await overlayConfig(appDir, 'database', `{ ...original, default: 'sqlite', connections: { sqlite: { driver: 'sqlite', filename: ${JSON.stringify(database)} } } }`);
    for (const [name, expression] of Object.entries({
      mail: "{ ...original, default: 'null' }", cache: "{ ...original, default: 'memory' }", queue: "{ ...original, default: 'memory' }",
      auth: `{ ...original, emailVerification: { ...original.emailVerification, required: true }, eligibility: { ...original.eligibility, disabledAtColumn: 'disabled_at', lockedUntilColumn: 'locked_until', requireVerifiedEmail: true, check: async (user) => user.getAttribute('email') === ${JSON.stringify(state.accounts.unavailable.email)} ? { eligible: false, reason: 'temporarily_unavailable' } : { eligible: true } }, brand: { name: 'Auth UI Certification', title: 'Fixture Identity', description: 'Private authentication fixture', accentColor: '#176b45' }, providers: [ { id: 'fixture-oidc', label: 'Fixture SSO', configured: true, protocol: 'oidc', loginUrl: '/auth/fixture-oidc', available: true }, { id: 'fixture-disabled', label: 'Unavailable SSO', configured: true, protocol: 'saml', loginUrl: '/auth/fixture-disabled', available: false }, { id: 'fixture-unconfigured', label: 'Unconfigured SSO', configured: false, protocol: 'oauth2', loginUrl: '/auth/fixture-unconfigured', available: true } ] }`,
    })) await overlayConfig(appDir, name, expression);
    const env = { ...process.env, ...appEnv, DB_DRIVER: 'sqlite', DB_PATH: database, APP_URL: options.baseUrl, ORIGIN: options.baseUrl,
      HOST: '127.0.0.1', PORT: String(options.port), MAIL_DRIVER: 'null', CACHE_DRIVER: 'memory', QUEUE_DRIVER: 'memory', RATE_LIMIT_STORE: 'memory',
      AUTH_OTP_ENABLED: 'true', AUTH_EMAIL_VERIFICATION_REQUIRED: 'true', SESSION_LIFETIME: String(fixturePolicy.idle), SESSION_IDLE_LIFETIME: String(fixturePolicy.idle),
      SESSION_ABSOLUTE_LIFETIME: String(fixturePolicy.absolute), SESSION_REMEMBER_LIFETIME: String(fixturePolicy.remember),
      SESSION_REMEMBER_ABSOLUTE_LIFETIME: String(fixturePolicy.rememberAbsolute), SESSION_WARNING_BEFORE: String(fixturePolicy.warning), SESSION_TOUCH_THROTTLE: '0' };
    for (const key of ['MEILISEARCH_HOST', 'MEILISEARCH_KEY', 'BROADCAST_BACKPLANE', 'DATABASE_URL']) delete env[key];
    // Keep the copied .env consistent for CLI loaders; the original is never written.
    await writeFile(join(appDir, '.env'), Object.entries(env).filter(([key]) => key in appEnv || key.startsWith('SESSION_') || ['DB_DRIVER', 'DB_PATH', 'APP_URL', 'ORIGIN', 'AUTH_OTP_ENABLED', 'AUTH_EMAIL_VERIFICATION_REQUIRED', 'MAIL_DRIVER', 'CACHE_DRIVER', 'QUEUE_DRIVER', 'RATE_LIMIT_STORE'].includes(key)).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join('\n'), { mode: 0o600 });
    return { appDir, env, parent, snapshot };
  } catch (error) { await rm(parent, { recursive: true, force: true }); throw error; }
}

export function startServer(appDir, env) {
  const child = spawn(process.execPath, ['build/index.js'], { cwd: appDir, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let tail = '';
  child.on('error', (error) => { tail = `Server spawn failed: ${error.message}`; });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', (chunk) => { tail = (tail + chunk).slice(-6000); });
  return { child, tail: () => tail };
}

export async function stopServer(server) {
  if (!server || !server.child.pid || server.child.exitCode !== null || server.child.signalCode !== null) return;
  const child = server.child;
  const ended = new Promise((accept) => child.once('exit', accept));
  try { process.kill(-child.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  const timer = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already exited */ } }, 5000);
  try { await ended; } finally { clearTimeout(timer); }
}

async function waitForServer(baseUrl, server, state) {
  for (let attempt = 0; attempt < 80; attempt++) {
    if (server.child.exitCode !== null || server.child.signalCode !== null) throw new Error(`Owned server exited: ${redactSecrets(server.tail(), state)}`);
    try {
      const response = await fetch(`${baseUrl}/login`, { signal: AbortSignal.timeout(1000) });
      assert(response.status !== 429, 'Server quota exhausted during startup; not retrying.');
      if (response.ok) return;
      throw new Error(`Startup returned HTTP ${response.status}: ${redactSecrets(server.tail(), state)}`);
    } catch (error) {
      if (error instanceof assert.AssertionError || !['ECONNREFUSED', 'UND_ERR_CONNECT_TIMEOUT'].includes(error.cause?.code)) throw error;
    }
    await new Promise((accept) => setTimeout(accept, 250));
  }
  throw new Error('Owned production server did not start.');
}

export async function checkSurface(page, surface, { full = false } = {}) {
  await page.getByText(surface.heading, { exact: true }).first().waitFor();
  const form = page.locator('form');
  assert(await form.count() === (surface.form ? 1 : 0), `${surface.path}: unexpected form count.`);
  const result = await page.evaluate(() => {
    const inputs = [...document.querySelectorAll('input:not([type=hidden])')];
    return { width: document.documentElement.scrollWidth, viewport: innerWidth,
      required: inputs.filter((input) => input.required).map((input) => input.name),
      unlabeled: inputs.filter((input) => !input.labels?.length && !input.getAttribute('aria-label')).map((input) => input.name),
      native: [...document.forms].some((form) => !form.noValidate),
      overlaps: inputs.some((input) => { const box = input.getBoundingClientRect(); return box.width <= 0 || box.left < -1 || box.right > innerWidth + 1; }),
    };
  });
  assert(result.width <= result.viewport + 1 && !result.overlaps, `${surface.path}: horizontal overflow.`);
  assert.deepEqual(result.required, [], `${surface.path}: HTML required duplicates shared-schema validation.`);
  assert.deepEqual(result.unlabeled, [], `${surface.path}: missing input label.`);
  assert(!result.native, `${surface.path}: form must opt out of duplicate native validation.`);
  if (surface.form) {
    const first = page.locator('input:not([type=hidden])').first();
    await first.focus();
    await page.keyboard.press('Tab');
    assert(await page.evaluate(() => document.activeElement !== document.body), `${surface.path}: keyboard focus lost.`);
  }
  if (surface.path === '/login') {
    await page.getByLabel('Password', { exact: true }).fill('visibility-fixture');
    await page.getByRole('button', { name: 'Show password', exact: true }).click();
    assert.equal(await page.getByLabel('Password', { exact: true }).getAttribute('type'), 'text');
    await page.getByRole('button', { name: 'Hide password', exact: true }).click();
    assert.equal(await page.getByLabel('Password', { exact: true }).getAttribute('type'), 'password');
    await page.getByLabel('Password', { exact: true }).fill('');
    assert.equal(await page.getByRole('checkbox', { name: 'Remember me' }).isChecked(), false, 'Remember must default to false.');
  }
  if (full) {
    await page.getByText('Fixture Identity', { exact: true }).waitFor();
    const providers = page.getByRole('navigation', { name: 'Other sign-in methods' });
    assert.equal(await providers.getByRole('link').count(), surface.path === '/login' ? 1 : 0, 'Only configured available providers may render on the sign-in surface.');
    if (surface.path === '/login') assert.equal(await providers.getByRole('link', { name: 'Fixture SSO' }).getAttribute('href'), '/auth/fixture-oidc');
    assert.equal(await page.getByText('Unavailable SSO', { exact: true }).count(), 0);
    assert.equal(await page.getByText('Unconfigured SSO', { exact: true }).count(), 0);
    if (surface.form) {
      const existingAlerts = await page.getByRole('alert').count();
      await form.locator('[type=submit]').click();
      await form.locator('[aria-invalid=true]').first().waitFor();
      assert.equal(await page.getByRole('alert').count(), existingAlerts, `${surface.path}: inline validation produced duplicate alerts.`);
      for (const input of await form.locator('input[autocomplete*=password]').all()) assert.equal(await input.inputValue(), '', 'Invalid form retained a password.');
    }
  }
}

async function goto(page, options, path) {
  const response = await page.goto(`${options.baseUrl}${path}`, { waitUntil: 'networkidle' });
  assert(response?.ok(), `${path.split('?')[0]} returned HTTP ${response?.status()}; no retries.`);
}

async function sessionId(context) {
  const cookie = (await context.cookies()).find((value) => value.name === 'svelar_session');
  assert(cookie, 'Missing signed session cookie.');
  return { id: decodeURIComponent(cookie.value).split('.')[0], cookie };
}

async function sessionStatus(page) {
  const result = await page.evaluate(async () => {
    const response = await fetch('/api/auth/session', { headers: { 'x-svelar-session-activity': 'false' } });
    return { status: response.status, body: await response.json() };
  });
  assert.equal(result.status, 200, 'Session status must be authenticated.');
  return result.body.data;
}

async function login(page, options, state, kind = 'eligible', remember = false, loading = false) {
  await goto(page, options, '/login');
  await page.getByLabel('Email', { exact: true }).fill(state.accounts[kind].email);
  await page.getByLabel('Password', { exact: true }).fill(state.password);
  if (remember) await page.getByRole('checkbox', { name: 'Remember me' }).check();
  if (loading) {
    await pendingFormSubmission(page, { path: '/login', fields: { email: state.accounts[kind].email, password: state.password } },
      () => page.getByRole('button', { name: 'Sign In', exact: true }).click(), async () => {
        assert(await page.getByLabel('Password', { exact: true }).isDisabled(), 'Pending login must disable secret input.');
        assert(await page.getByRole('button', { name: 'Show password', exact: true }).isDisabled(), 'Pending login must disable visibility control.');
      });
  } else await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  await page.waitForURL((url) => url.pathname !== '/login');
}

async function logout(page) {
  await page.getByRole('button', { name: 'Logout', exact: true }).click();
  await page.getByRole('button', { name: 'Login', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Logout', exact: true }).count(), 0, 'Logout retained authenticated navigation.');
}

function monitorContext(context, errors, responses) {
  context.setDefaultTimeout(10000);
  context.setDefaultNavigationTimeout(15000);
  context.on('page', (page) => {
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('response', (response) => { if (response.status() === 429 || response.status() >= 500) responses.push(response); });
  });
}

async function fullCases(browser, options, fixture, state, checks, runtimeErrors, errorResponses, expectedResponses, pace, pendingForms) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  monitorContext(context, runtimeErrors, errorResponses);
  await paceContext(context, pace);
  const page = await context.newPage();
  try {
    await goto(page, options, '/forgot-password');
    await page.getByLabel('Email', { exact: true }).fill(state.accounts.eligible.email);
    const recovery = await pendingFormSubmission(page, { path: '/forgot-password', loadingText: 'Sending...', fields: { email: state.accounts.eligible.email } },
      () => page.locator('form [type=submit]').click());
    pendingForms.push(recovery.evidence);
    assert.equal((await recovery.response.json()).type, 'success', 'Recovery must finish through the real action.');
    await page.getByText('If that email exists, a reset link has been sent. Check your inbox.', { exact: true }).waitFor();
    assert.equal(await page.locator('form').count(), 0, 'Recovery success retained duplicate-submit controls.');
    checks.push('recovery-pending-and-real-success');
    await goto(page, options, '/reset-password?token=auth-ui-invalid&email=unknown%40example.test');
    await page.getByLabel('New Password', { exact: true }).fill(state.password);
    await page.getByLabel('Confirm Password', { exact: true }).fill(state.password);
    const reset = await pendingFormSubmission(page, { path: '/reset-password', loadingText: 'Resetting...',
      fields: { password: state.password, password_confirmation: state.password } }, () => page.locator('form [type=submit]').click());
    pendingForms.push(reset.evidence);
    await page.getByText('Invalid or expired reset link. Please request a new one.', { exact: true }).waitFor();
    for (const input of await page.locator('input[autocomplete*=password]').all()) assert.equal(await input.inputValue(), '', 'Reset failure retained secret.');
    assert.equal(await page.getByRole('alert').count(), 1);
    checks.push('invalid-reset-clears-both-passwords');
    await goto(page, options, '/otp-login');
    await page.getByLabel('Email', { exact: true }).fill(state.accounts.eligible.email);
    const send = await pendingFormSubmission(page, { path: '/otp-login', action: 'send', loadingText: 'Sending...', fields: { email: state.accounts.eligible.email } },
      () => page.locator('form [type=submit]').click());
    pendingForms.push(send.evidence);
    await page.getByLabel('Verification Code', { exact: true }).waitFor();
    await runFixtureCommand(fixture.appDir, fixture.env, 'otp-fixture', state, { code: '123456' });
    await page.getByLabel('Verification Code', { exact: true }).fill('654321');
    const verify = await pendingFormSubmission(page, { path: '/otp-login', action: 'verify', loadingText: 'Verifying...', fields: { email: state.accounts.eligible.email, code: '654321' } },
      () => page.locator('form [type=submit]').click());
    pendingForms.push(verify.evidence);
    const invalidOtp = await verify.response.json();
    assert.equal(invalidOtp.type, 'failure', 'Invalid OTP must remain an action failure.');
    assert.equal(invalidOtp.status, 401, 'Invalid OTP must preserve its authentication failure status.');
    await page.getByText(authUiMessages.invalidOtp, { exact: true }).waitFor();
    assert.equal(await page.getByLabel('Verification Code', { exact: true }).inputValue(), '', 'OTP failure retained code.');
    assert.equal(await page.getByRole('alert').count(), 1);
    await page.getByLabel('Verification Code', { exact: true }).fill('123456');
    await page.locator('form [type=submit]').click();
    await page.waitForURL((url) => url.pathname !== '/otp-login');
    checks.push('real-otp-two-step-error-and-success');
    await logout(page);
    const replay = await page.evaluate(async ({ email }) => {
      const csrf = document.cookie.split('; ').find((value) => value.startsWith('XSRF-TOKEN='))?.slice('XSRF-TOKEN='.length);
      const response = await fetch('/api/auth/otp/verify', { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': decodeURIComponent(csrf ?? '') },
        body: JSON.stringify({ email, code: '123456' }) });
      const body = await response.json();
      return { status: response.status, message: body.meta?.message, authenticatedStatus: (await fetch('/api/auth/me')).status };
    }, { email: state.accounts.eligible.email });
    assert.equal(replay.status, 401, 'A consumed OTP must not be accepted again.');
    assert.equal(replay.message, authUiMessages.invalidOtp);
    assert.equal(replay.authenticatedStatus, 401, 'OTP replay must not create an authenticated session.');
    checks.push('consumed-otp-replay-denied');
    await login(page, options, state, 'eligible', false, true);
    let status = await sessionStatus(page);
    assert.equal(status.remembered, false);
    assert.equal(status.absoluteExpiresAt - status.createdAt, fixturePolicy.absolute * 1000);
    const normalCookie = (await sessionId(context)).cookie;
    assertCookieDeadline(normalCookie, status);
    checks.push('login-loading-and-normal-cookie');
    await logout(page);
    for (const [kind, message, statusCode] of [
      ['invalid', 'Invalid email or password.', 401], ['disabled', 'This account is disabled.', 403], ['locked', 'This account is temporarily locked.', 403],
      ['unverified', 'Verify your email before signing in.', 403], ['unavailable', 'Sign-in is temporarily unavailable. Please retry.', 503],
    ]) {
      await goto(page, options, '/login');
      await page.getByLabel('Email', { exact: true }).fill(state.accounts[kind === 'invalid' ? 'eligible' : kind].email);
      await page.getByLabel('Password', { exact: true }).fill(kind === 'invalid' ? `${state.password}-wrong` : state.password);
      const responsePromise = page.waitForResponse((response) => new URL(response.url()).pathname === '/login' && response.request().method() === 'POST');
      await page.getByRole('button', { name: 'Sign In', exact: true }).click();
      const response = await responsePromise;
      const action = await response.json();
      assert.equal(action.type, 'failure', `${kind}: expected SvelteKit action failure.`);
      assert.equal(action.status, statusCode, `${kind}: incorrect application status.`);
      if (kind === 'unavailable' && response.status() === 503) expectedResponses.add(response);
      await page.getByText(message, { exact: true }).waitFor();
      assert.equal(await page.getByLabel('Password', { exact: true }).inputValue(), '', `${kind}: password retained.`);
      assert.equal(await page.getByRole('alert').count(), 1, `${kind}: duplicate error feedback.`);
      assert.equal(new URL(page.url()).pathname, '/login');
      checks.push(`denial-${kind}-clears-secret`);
      // A genuine successful attempt clears the per-login failure budget, not an artificial quota reset.
      await login(page, options, state); await logout(page);
    }
    await login(page, options, state, 'eligible', true);
    status = await sessionStatus(page);
    assert.equal(status.remembered, true);
    assert.equal(status.idleExpiresAt - status.lastActivityAt, fixturePolicy.remember * 1000);
    assert.equal(status.absoluteExpiresAt - status.createdAt, fixturePolicy.rememberAbsolute * 1000);
    const owned = await sessionId(context);
    assertCookieDeadline(owned.cookie, status);
    checks.push('remember-checkbox-policy-and-cookie');
    const peer = await context.newPage();
    await goto(peer, options, '/');
    await runFixtureCommand(fixture.appDir, fixture.env, 'session-warning', state, { sessionId: owned.id });
    for (const tab of [page, peer]) await tab.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    const warning = page.getByRole('dialog');
    await warning.getByText('Your session is about to expire', { exact: true }).waitFor();
    await peer.getByRole('dialog').getByText('Your session is about to expire', { exact: true }).waitFor();
    const before = await sessionStatus(page);
    const renewalResponse = page.waitForResponse((response) => response.request().method() === 'POST'
      && new URL(response.url()).pathname === '/api/auth/session');
    await warning.getByRole('button', { name: 'Stay signed in', exact: true }).click();
    const response = await renewalResponse;
    await assertSessionRenewal(response, before);
    await warning.waitFor({ state: 'hidden' });
    await peer.getByRole('dialog').waitFor({ state: 'hidden' });
    const renewed = await sessionStatus(peer);
    assert(renewed.expiresAt > before.expiresAt, 'Renewal must extend idle deadline.');
    assert.equal(renewed.absoluteExpiresAt, before.absoluteExpiresAt, 'Renewal cannot extend the absolute cap.');
    checks.push('real-session-warning-renewal-and-multitab');
    const cap = await runFixtureCommand(fixture.appDir, fixture.env, 'session-absolute', state, { sessionId: owned.id });
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    const capped = await sessionStatus(page);
    assert.equal(capped.absoluteExpiresAt, cap.absoluteExpiresAt);
    const renewal = await page.evaluate(async () => {
      const csrf = document.cookie.split('; ').find((value) => value.startsWith('XSRF-TOKEN='))?.slice('XSRF-TOKEN='.length);
      const response = await fetch('/api/auth/session', { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': decodeURIComponent(csrf ?? '') }, body: '{}' });
      return { status: response.status, body: await response.json() };
    });
    assert.equal(renewal.status, 200, 'Renewal must pass real CSRF/auth.');
    assert.equal(renewal.body.data.absoluteExpiresAt, cap.absoluteExpiresAt);
    assert((await sessionId(context)).cookie.expires * 1000 <= cap.absoluteExpiresAt + 1500, 'Renewed cookie exceeded absolute TTL.');
    checks.push('absolute-ttl-cookie-after-real-renewal');
  } finally { await context.close(); }
}

export async function runCertification(options) {
  await mkdir(options.reportDir ??= await mkdtemp(join(tmpdir(), 'svelar-auth-ui-report-')), { recursive: true });
  const report = { phase: options.phase, appDir: options.appDir, baseUrl: options.baseUrl, startedAt: new Date().toISOString(), complete: false, checks: [], pendingForms: [], failures: [], screenshots: [],
    scope: { authSurfaces: 6, forms: 5, verificationStatusPage: 1, federation: 'presentation only; no external provider callbacks', mail: 'null transport in isolated full mode' } };
  const state = fixtureIdentity();
  let fixture;
  let server;
  let browser;
  let created = false;
  const runtimeErrors = [];
  const errorResponses = [];
  const expectedResponses = new WeakSet();
  // Pace upfront below the default quota; a received 429 still fails without a retry.
  const pace = createRequestPacer();
  let interrupted = false;
  const interrupt = () => { interrupted = true; void browser?.close().catch(() => {}); void stopServer(server).catch(() => {}); };
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', interrupt);
  try {
    await withCleanup(async () => {
      if (!options.noServer) {
        await assertPortAvailable(options.port);
        fixture = await prepareIsolatedApp(options, state);
        assert(!interrupted, 'Certification interrupted.');
        if (options.phase === 'full') { Object.assign(state, await runFixtureCommand(fixture.appDir, fixture.env, 'create', state)); created = true; }
        server = startServer(fixture.appDir, fixture.env);
        await waitForServer(options.baseUrl, server, state);
      }
      assert(!interrupted, 'Certification interrupted.');
      report.installation = await installationProvenance(options.appDir);
      const { chromium } = installedRequire(options.appDir)('@playwright/test');
      browser = await chromium.launch({ headless: !options.headed });
      for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
        const context = await browser.newContext({ viewport });
        monitorContext(context, runtimeErrors, errorResponses);
        await paceContext(context, pace);
        const page = await context.newPage();
        if (options.phase === 'baseline') await page.route('**/*', (route) => {
          if (!['GET', 'HEAD'].includes(route.request().method())) { runtimeErrors.push('Read-only baseline attempted a mutation.'); return route.abort(); }
          return route.fallback();
        });
        try {
          for (const surface of surfaces) {
            await goto(page, options, surface.path);
            await checkSurface(page, surface, { full: options.phase === 'full' });
            const image = join(options.reportDir, `${viewport.width}-${surface.path.split('?')[0].slice(1)}.png`);
            await page.screenshot({ path: image, fullPage: true });
            report.screenshots.push(image);
            report.checks.push(`${viewport.width}:${surface.path.split('?')[0]}:layout-keyboard-validation-contract`);
            console.log(`[auth-ui] ${report.checks.at(-1)}`);
          }
        } finally { await context.close(); }
      }
      if (options.phase === 'full') await fullCases(browser, options, fixture, state, report.checks, runtimeErrors, errorResponses, expectedResponses, pace, report.pendingForms);
      for (const response of errorResponses) if (!expectedResponses.has(response)) runtimeErrors.push(`HTTP ${response.status()} ${new URL(response.url()).pathname}`);
      assert.deepEqual(runtimeErrors, [], 'Browser runtime/quota errors; not retried.');
      assert(!interrupted, 'Certification interrupted.');
      report.complete = options.phase === 'full';
      report.passed = true;
    }, async () => {
      await withCleanup(async () => { await browser?.close(); }, async () => {
        await withCleanup(async () => { await stopServer(server); }, async () => {
          if (fixture) await withCleanup(async () => {
            if (created) await runFixtureCommand(fixture.appDir, fixture.env, 'cleanup', state);
          }, async () => {
            await rm(fixture.parent, { recursive: true, force: true });
            assert.deepEqual(await sourceSnapshot(options.appDir), fixture.snapshot, 'Original app source/config changed during certification.');
          });
        });
      });
    });
  } catch (error) {
    report.passed = false;
    report.failures.push(redactSecrets(error.stack ?? error, state));
  } finally {
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', interrupt);
    report.finishedAt = new Date().toISOString();
    report.runtimeErrors = [...runtimeErrors, ...errorResponses.filter((response) => !expectedResponses.has(response)).map((response) => `HTTP ${response.status()} ${new URL(response.url()).pathname}`)];
  }
  await writeFile(join(options.reportDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  return report;
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  if (options.help) {
    console.log('Auth UI certification (requires installed Playwright Chromium and adapter-node build)\n  --app-dir <app> [--port 5897] [--phase full|baseline] [--report-dir <dir>]\n  --app-dir <app> --base-url <origin> --no-server --phase baseline\nFull mode uses a disposable SQLite online backup, null mail, owned ORM users and private config.\nBaseline is read-only and never claims full certification. No builds, installs, quota retries or shared config writes.');
    return;
  }
  if (options.fixtureOp) return fixtureChild(options.fixtureOp);
  const report = await runCertification(options);
  console.log(`Auth UI ${report.phase}: ${report.passed ? 'PASS' : 'FAIL'} (${report.checks.length} checks; full certification ${report.complete ? 'yes' : 'no'}). Report: ${join(options.reportDir, 'report.json')}`);
  if (!report.passed) { console.error(report.failures.join('\n')); process.exitCode = 1; }
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
