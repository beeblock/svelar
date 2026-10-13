#!/usr/bin/env node
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer as createPortProbe } from 'node:net';
import { fileURLToPath } from 'node:url';
import { assertOperationalBatch, assertSafeOperationalJob, bounded, fixtureSecret, prepareOperationalFixture, validateDeepTarget } from './operational-browser-fixtures.mjs';
import { authUiMessages } from './auth-ui-certification.mjs';

const args = process.argv.slice(2);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const defaultAppDir = resolve(repoRoot, '../svelar-testing-area/apps/svelar-smoke-ddd');

let appDir = resolve(valueFor('--app-dir') ?? defaultAppDir);
const port = Number(valueFor('--port') ?? 5179);
const baseUrl = valueFor('--base-url') ?? `http://127.0.0.1:${port}`;
const noServer = has('--no-server');
const operationalDeep = has('--operational-deep');
const serverScript = valueFor('--server-script') ?? 'smoke:serve';
const headed = has('--headed');
const slowMo = Number(valueFor('--slow-mo') ?? (headed ? 250 : 0));
let appEnv = loadDotEnv(appDir);
const internalSecret = process.env.INTERNAL_SECRET ?? appEnv.INTERNAL_SECRET;
const rateBudgets = new WeakMap();
const rateBudgetRecorders = new WeakMap();

if (has('--help') || has('-h')) {
	console.log(`Usage: node scripts/browser-smoke.mjs [options]

Options:
  --app-dir <path>       Generated app directory. Default: ../svelar-testing-area/apps/svelar-smoke-ddd.
  --port <port>          Port used by npm run smoke:serve. Default: 5179.
  --base-url <url>       Existing app URL. Default: http://127.0.0.1:<port>.
  --no-server            Do not start npm run smoke:serve; test the existing base URL.
  --operational-deep     Run only populated operational acceptance in an owned disposable SQLite/Redis copy.
  --evidence-dir <path>  Deep-mode JSON timeline and desktop/mobile screenshots destination.
  --expected-core-sha256 <sha>  Require the installed lockfile's core tarball to match this immutable SHA.
  --server-script <name> npm script used to start the app. Default: smoke:serve.
  --headed               Open a visible Chromium window instead of running headless.
  --slow-mo <ms>         Delay browser actions. Default: 250 in headed mode, 0 otherwise.
`);
	process.exit(0);
}

if (!existsSync(join(appDir, 'package.json'))) {
	fail(`Generated app not found at ${appDir}. Run npm run smoke:ddd first.`);
}

const appRequire = createRequire(join(appDir, 'package.json'));
let chromium;
try {
	({ chromium } = appRequire('@playwright/test'));
} catch {
	fail(`Could not load @playwright/test from ${appDir}. Run npm install in the generated app.`);
}

let server;
let operationalFixture;
let smokeFailure;
try {
	if (operationalDeep) {
		validateDeepTarget({ noServer, port, baseUrl });
		await assertPortAvailable(port);
		operationalFixture = await prepareOperationalFixture(appDir, { baseUrl, evidenceDir: valueFor('--evidence-dir'), expectedCoreSha256: valueFor('--expected-core-sha256') });
		appDir = operationalFixture.appDir;
		appEnv = operationalFixture.env;
		await operationalFixture.start();
		server = operationalFixture.startWeb(port).child;
		await operationalFixture.persist();
	} else if (!noServer) {
		await assertPortAvailable(port);
		server = startServer();
	}

	await waitForServer(baseUrl, server);
	if (operationalDeep) await runOperationalBrowserSmoke(operationalFixture);
	else await runBrowserSmoke();
	console.log(`Browser smoke passed for ${baseUrl}`);
} catch (error) {
	smokeFailure = error;
	throw error;
} finally {
	if (server && !operationalDeep) {
		await stopServer(server);
	}
	if (operationalFixture) {
		await operationalFixture.close(smokeFailure);
		console.log(`Operational browser evidence: ${join(operationalFixture.evidenceDir, 'evidence.json')}`);
	}
}

async function runOperationalBrowserSmoke(fixture) {
	const browser = await chromium.launch({ headless: !headed, slowMo });
	const errors = [];
	let page, readerPage;
	try {
		const operator = await browser.newContext({ viewport: { width: 1280, height: 900 } });
		const reader = await browser.newContext({ viewport: { width: 1280, height: 900 } });
		page = await operator.newPage();
		readerPage = await reader.newPage();
	} catch (error) { await browser.close(); throw error; }
	const scope = new URLSearchParams(fixture.evidence.scope);
	const queueUrl = (extra = {}) => `${baseUrl}/admin/dashboard?` + new URLSearchParams({ tab: 'queues', ...fixture.evidence.scope, status: 'failed', limit: '25', ...extra });
	const jobs = fixture.evidence.jobs;
	for (const observed of [page, readerPage]) {
		rateBudgetRecorders.set(observed, (details) => fixture.record('observed-global-rate-budget-wait', details));
		observed.on('pageerror', (error) => errors.push(error));
		observed.on('response', (response) => {
			if (!response.url().startsWith(baseUrl)) return;
			for (const budgetPage of [page, readerPage]) observeRateBudget(budgetPage, response);
			if (response.status() === 429 || response.status() >= 500) errors.push(new Error(`Unexpected ${response.status()} ${response.url()}; no failed request was retried.`));
		});
	}
	async function acceptance(label, run) {
		const check = { label, startedAt: new Date().toISOString(), status: 'running' };
		fixture.evidence.checks.push(check);
		await fixture.persist();
		try { await run(); check.status = 'passed'; }
		catch (error) {
			check.status = 'failed'; check.error = error.message; errors.push(error);
			await screenshot(page, `failed-check-${fixture.evidence.checks.length}`).catch(() => {});
		}
		check.finishedAt = new Date().toISOString();
		await fixture.persist();
	}
	async function screenshot(target, name) {
		const path = join(fixture.evidenceDir, name + '.png');
		await target.screenshot({ path, fullPage: true });
		fixture.evidence.screenshots.push(path);
	}
	async function open(target, url) {
		await respectRateBudget(target, 15);
		const response = await target.goto(url, { waitUntil: 'domcontentloaded' });
		if (!response || response.status() >= 400) throw new Error(`Operational navigation returned ${response?.status()}: ${url}`);
		await visible(target.getByRole('heading', { level: 1 }), 'operational page heading');
	}
	async function login(target, credentials) {
		await open(target, `${baseUrl}/login`);
		await target.getByLabel('Email', { exact: true }).fill(credentials.email);
		await target.getByLabel('Password', { exact: true }).fill(credentials.password);
		await Promise.all([target.waitForURL('**/dashboard'), target.getByRole('button', { name: 'Sign In', exact: true }).click()]);
	}
	async function inspect(target) {
		await open(target, queueUrl());
		const row = target.getByRole('region', { name: 'Queue jobs', exact: true }).getByRole('row').filter({ has: target.getByRole('checkbox', { name: 'Select ' + jobs.inspect, exact: true }) });
		await visible(row, 'actual retained failed job');
		const response = target.waitForResponse((response) => new URL(response.url()).pathname === '/api/admin/queue/' + jobs.inspect);
		await row.getByRole('button', { name: 'Inspect job', exact: true }).click();
		const result = await response;
		if (result.status() !== 200) throw new Error('Failed job inspection was not accepted.');
		const body = await result.json();
		fixture.record('failed-job-contract-observed', { id: body.data?.id, traceCount: body.data?.stacktrace?.length ?? null,
			redacted: !JSON.stringify(body).includes(fixtureSecret), status: body.data?.status });
		assertSafeOperationalJob(body.data);
		fixture.record('safe-failed-job-inspected', { id: body.data.id, ...fixture.evidence.scope,
			stacktraceMeta: body.data.stacktraceMeta, traceCount: body.data.stacktrace.length });
		const inspector = target.locator('section[aria-label="Job inspection"]');
		await visible(inspector.getByRole('heading', { name: 'Retained stack traces', exact: true }), 'visible retained stack diagnostics');
		await visible(inspector.getByText(/Operational fixture mail failure/).first(), 'safe visible failure');
		if ((await inspector.innerText()).includes(fixtureSecret)) throw new Error('Inspector rendered a private fixture credential.');
		if (new URL(target.url()).searchParams.get('job') !== jobs.inspect) throw new Error('Inspection did not keep its named job URL.');
		await assertPageWidth(target, 'Populated failed-job inspection');
	}
	async function batch(remove) {
		const operation = remove ? 'cleanup' : 'retry';
		const source = remove ? 'dead-letter' : 'live';
		const acceptedId = remove ? fixture.evidence.deadLetters['cleanup-safe'] : jobs['retry-safe'];
		const busyId = remove ? fixture.evidence.deadLetters['cleanup-busy'] : jobs['retry-busy'];
		const path = '/api/admin/queue/batch/' + operation;
		await open(page, queueUrl({ status: remove ? 'dead-letter' : 'failed' }));
		for (const id of [acceptedId, busyId]) await page.getByRole('checkbox', { name: 'Select ' + id, exact: true }).check();
		const command = page.getByRole('button', { name: remove ? 'Remove selected' : 'Retry selected', exact: true });
		const dialog = page.locator('dialog[aria-labelledby="confirmation-title"]');
		let writes = 0;
		const countWrite = (request) => { if (new URL(request.url()).pathname === path && request.method() === 'POST') writes++; };
		page.on('request', countWrite);
		let release;
		const gate = new Promise((done) => { release = done; });
		let intercepted;
		const captured = new Promise((done) => { intercepted = done; });
		let forwarded;
		let rejectRoute;
		const routeFailure = new Promise((_, reject) => { rejectRoute = reject; });
		routeFailure.catch(() => {});
		const routePattern = new RegExp('/api/admin/queue/batch/' + operation + '\\?');
		const routeHandler = (route) => {
			forwarded = (async () => {
				try { intercepted(); await gate; await fixture.makeBusy(busyId, source); await route.continue(); }
				catch (error) { rejectRoute(error); await route.abort('failed'); }
			})();
			return forwarded;
		};
		let responsePromise;
		try {
			await command.click();
			await visible(dialog, 'batch explicit confirmation');
			if (writes !== 0) throw new Error('Batch submitted before confirmation.');
			await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
			await dialog.waitFor({ state: 'hidden' });
			if (writes !== 0) throw new Error('Cancelled batch submitted a request.');
			fixture.record('batch-cancelled', { operation, writes, viewport: page.viewportSize() });
			await page.route(routePattern, routeHandler);
			await command.click();
			await visible(dialog, 'batch reconfirmation');
			responsePromise = page.waitForResponse((response) => new URL(response.url()).pathname === path && response.request().method() === 'POST', { timeout: 45000 });
			responsePromise.catch(() => {});
			await dialog.getByRole('button', { name: 'Confirm', exact: true }).click();
			await bounded(() => captured, 15000, 'Actual batch request interception');
			await visible(page.getByRole('status').filter({ hasText: 'Processing queue-batch' }), 'batch loading feedback');
			if (!await command.isDisabled()) throw new Error('Pending batch command remained enabled.');
			await screenshot(page, `batch-${operation}-loading-${page.viewportSize().width}`);
			release();
			const response = await Promise.race([responsePromise, routeFailure]);
			const body = await response.json();
			if (response.status() !== 200 || !response.request().headers()['x-csrf-token']) throw new Error('Confirmed batch did not reach the real controller with valid CSRF.');
			if (body.meta?.auditWarning) throw new Error('Batch completion audit failed.');
			assertOperationalBatch(body, acceptedId, busyId, source);
			if (writes !== 1) throw new Error('Confirmed batch submitted more than once.');
			await visible(page.getByRole('status').filter({ hasText: '1 accepted; 1 not accepted.' }), 'partial batch success feedback');
			await visible(page.getByRole('alert').filter({ hasText: 'Some records were not accepted.' }), 'partial batch busy feedback');
			const state = await fixture.state();
			if (state.replays[remove ? 'cleanup-busy' : 'retry-busy']?.status !== 'active') throw new Error('Busy replay was not retained.');
			if (remove && state.deadLetters['cleanup-safe'] !== null || !remove && state.replays['retry-safe']?.status !== 'waiting') throw new Error('Accepted batch result did not persist.');
			fixture.record('batch-partial-outcome', { operation, results: body.data.data.results, viewport: page.viewportSize(), writes });
			await assertPageWidth(page, 'Populated batch feedback');
			await screenshot(page, `batch-${operation}-feedback-${page.viewportSize().width}`);
		} finally {
			release();
			if (forwarded) await forwarded;
			if (responsePromise) await responsePromise.catch(() => {});
			await page.unroute(routePattern, routeHandler);
			page.off('request', countWrite);
		}
	}
	try {
		await login(page, fixture.credentials.operator);
		await acceptance('Populated same-connection multiworker observations', async () => {
			await open(page, queueUrl());
			const stats = await browserApi(page, '/api/admin/stats');
			const queue = stats.body.data?.queue?.topology?.find((entry) => entry.name === 'default' && entry.connection === 'redis');
			if (stats.status !== 200 || queue?.runtime?.workers?.observed?.live < 2 || queue?.counts?.active < 2
				|| queue.runtime.observedConcurrency < 2 || queue.runtime.effectiveConcurrency !== null) throw new Error('Dashboard did not expose actual observed workers without manufacturing full-pool capacity.');
			const row = page.getByRole('region', { name: 'Registered queues', exact: true }).getByRole('row').filter({ hasText: 'default / redis' });
			await visible(row, 'populated named Redis topology');
			await visible(row.getByText(/2 \/ 2 \/ 0/), 'two live and active worker observations');
			fixture.record('browser-worker-observations', { runtime: queue.runtime, counts: queue.counts });
			await screenshot(page, 'operational-queues-desktop');
		});
		await acceptance('Desktop redacted failed-job error and retained stack', async () => { await inspect(page); await screenshot(page, 'operational-inspector-desktop'); });
		await acceptance('Actual failed-job pagination keeps the queue and connection', async () => {
			await open(page, queueUrl({ limit: '2' }));
			const first = await page.getByRole('region', { name: 'Queue jobs', exact: true }).getByRole('checkbox').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label')));
			if (first.length !== 2) throw new Error('Pagination requires two actual first-page jobs.');
			await page.getByRole('button', { name: 'Next jobs', exact: true }).click();
			await page.waitForURL('**/admin/dashboard?**offset=2');
			const url = new URL(page.url());
			if (url.searchParams.get('connection') !== 'redis' || url.searchParams.get('queue') !== 'default') throw new Error('Job pagination lost the named scope.');
			const second = await page.getByRole('region', { name: 'Queue jobs', exact: true }).getByRole('checkbox').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label')));
			if (second.length !== 2 || second.some((id) => first.includes(id))) throw new Error('Job pagination did not display the next actual retained records.');
			fixture.record('job-pagination', { first, second, offset: 2, ...fixture.evidence.scope });
		});
		await acceptance('Desktop batch retry cancel, loading, partial busy outcome', () => batch(false));
		await page.setViewportSize({ width: 390, height: 844 });
		await acceptance('Mobile 390 populated inspector and bounded scrolling', async () => {
			await inspect(page);
			await assertScrollableRegion(page, page.getByRole('region', { name: 'Queue jobs', exact: true }), 'Queue jobs');
			await screenshot(page, 'operational-inspector-mobile');
		});
		await acceptance('Mobile 390 batch cleanup cancel, loading, partial busy outcome', () => batch(true));
		await login(readerPage, fixture.credentials.reader);
		for (const width of [1280, 390]) {
			await readerPage.setViewportSize({ width, height: width === 390 ? 844 : 900 });
			await acceptance(`Read-only role mutation controls at ${width}px`, async () => {
				await open(readerPage, queueUrl());
				await readerPage.getByRole('checkbox', { name: 'Select ' + jobs.inspect, exact: true }).check();
				for (const name of ['Retry selected', 'Remove selected', 'Retry job', 'Remove job', 'Pause queue']) {
					const buttons = readerPage.getByRole('button', { name, exact: true });
					for (const button of await buttons.all()) if (await button.isVisible() && !await button.isDisabled()) throw new Error(`Read-only ${name} remained actionable.`);
				}
				await assertPageWidth(readerPage, 'Populated read-only console');
				await screenshot(readerPage, `operational-reader-${width}`);
			});
		}
		await acceptance('Read-only direct HTTP mutations are 403 with valid browser CSRF', async () => {
			const before = await fixture.state();
			const references = [{ id: jobs.inspect, source: 'live' }];
			const denied = [];
			for (const [path, method, body] of [
				['/api/admin/queue/' + jobs.inspect + '/retry?' + scope, 'POST', undefined],
				['/api/admin/queue/' + jobs.inspect + '?' + scope, 'DELETE', { confirmed: true }],
				['/api/admin/queue/batch/retry?' + scope, 'POST', { references, confirmed: true }],
				['/api/admin/queue/batch/cleanup?' + scope, 'POST', { references, confirmed: true }],
				['/api/admin/queue/control/pause?' + scope, 'POST', { paused: true, confirmed: true }],
			]) {
				const responsePromise = readerPage.waitForResponse((response) => new URL(response.url()).pathname === new URL(path, baseUrl).pathname && response.request().method() === method);
				const result = await browserApi(readerPage, path, { method, body, csrf: true });
				const response = await responsePromise;
				if (result.status !== 403 || !response.request().headers()['x-csrf-token']) throw new Error(`Read-only ${method} ${path} did not return 403 with valid CSRF (${result.status}).`);
				denied.push({ path, method, status: result.status, csrfSent: true });
			}
			const after = await fixture.state();
			if (JSON.stringify(before.jobs) !== JSON.stringify(after.jobs) || before.runtime.paused !== after.runtime.paused) throw new Error('Denied read-only requests mutated queue state.');
			fixture.record('read-only-direct-http', { denied, mutationOccurred: false });
		});
		if (errors.length) throw new AggregateError(errors, errors.map((error) => error.message).join('\n'));
	} finally {
		await browser.close();
	}
}

async function runBrowserSmoke() {
	let browser;
	try {
		browser = await chromium.launch({ headless: !headed, slowMo });
	} catch (error) {
		if (String(error?.message ?? error).includes('Executable doesn')) {
			fail(`Playwright Chromium is not installed. Run: cd ${appDir} && npx playwright install chromium`);
		}
		throw error;
	}

	const pageErrors = [];
	const serverErrors = [];
	const recentResponses = [];
	const page = await browser.newPage();
	let registeredUser;

	page.on('pageerror', (error) => pageErrors.push(error.message));
	page.on('response', (response) => {
		const url = response.url();
		if (url.startsWith(baseUrl)) {
			observeRateBudget(page, response);
			recentResponses.push(`${response.status()} ${url}`);
			if (recentResponses.length > 20) recentResponses.shift();
		}
		if (url.startsWith(baseUrl) && response.status() >= 500) {
			serverErrors.push(`${response.status()} ${url}`);
		}
	});

	try {
		await goto(page, baseUrl);
		await visible(page.getByRole('heading', { name: /Welcome to/i }), 'home heading');

		registeredUser = await runAuthPagesBrowserSmoke(page, (user) => { registeredUser = user; });

			await goto(page, `${baseUrl}/login`);
			await page.locator('input[name="email"]').fill('admin@svelar.dev');
			await page.locator('input[name="password"]').fill('admin123');
			try {
				await Promise.all([
					page.waitForURL('**/dashboard', { timeout: 15_000 }),
					page.getByRole('button', { name: 'Sign In' }).click(),
				]);
			} catch (error) {
				const bodyText = await page.locator('body').innerText().catch(() => '');
				const message = [
					`Login did not reach /dashboard: ${error.message}`,
					`Current URL: ${page.url()}`,
					`Visible page text:\n${bodyText.slice(0, 2000)}`,
					`Recent responses:\n${recentResponses.join('\n')}`,
					`Page errors:\n${pageErrors.join('\n') || '(none)'}`,
				].join('\n\n');
				throw new Error(message);
			}
			await visible(page.getByRole('heading', { name: /^Dashboard$/ }), 'dashboard heading');
			await respectRateBudget(page, 40);
			await runSseBrowserSmoke(page, internalSecret);

		await goto(page, `${baseUrl}/dashboard/api-keys`);
		await visible(page.getByRole('heading', { name: /^API Keys$/ }), 'api keys heading');
		await assertPageWidth(page, 'API keys');
		const keyName = `Browser smoke ${Date.now()}`;
		await page.getByRole('button', { name: 'Create New Key' }).click();
		await visible(page.getByLabel('Key Name', { exact: true }), 'API key name label');
		await visible(page.getByLabel('Permissions', { exact: true }), 'API key permissions label');
		await page.locator('input[name="name"]').fill(keyName);
		await page.locator('input[name="permissions"]').fill('read,write');
		await page.getByRole('button', { name: 'Create Key' }).click();
		await visible(page.getByText('API Key Created', { exact: true }), 'api key created alert');
		await visible(page.getByText(keyName), 'created api key row');
		page.once('dialog', (dialog) => dialog.accept());
		await page.getByRole('button', { name: 'Revoke' }).first().click();
		await page.waitForLoadState('networkidle');

		await goto(page, `${baseUrl}/dashboard/team`);
		await visible(page.getByRole('heading', { name: /^Team$/ }), 'team heading');
		await visible(page.getByText('Team Info'), 'team info card');
		const inviteEmail = `browser-smoke-${Date.now()}@example.com`;
		await page.getByRole('button', { name: 'Invite Member' }).click();
		await page.locator('form[action="?/invite"] input[name="email"]').fill(inviteEmail);
		await page.getByRole('button', { name: 'Send Invite' }).click();
		await visible(page.getByText(`Invitation sent to ${inviteEmail}`), 'team invitation success');

		await runDashboardConsoleSmoke(page);
		await runDashboardAccessSmoke(page, registeredUser);
		await runDashboardResponsiveSmoke(page);
		await removeRegisteredUser(page, registeredUser);

		await goto(page, `${baseUrl}/dashboard`);
		await Promise.all([
			page.waitForURL(baseUrl + '/', { timeout: 15_000 }),
			page.getByRole('button', { name: 'Logout' }).click(),
		]);
		await visible(page.getByRole('button', { name: 'Login' }), 'logged-out login button');
		await runLoginThrottleSmoke(page);
	} finally {
		if (registeredUser && !registeredUser.cleaned) {
			try {
				await ensureAdminSession(page);
				await cleanupRoleProfile(page, registeredUser);
				await removeRegisteredUser(page, registeredUser);
			} catch (error) {
				console.error(`Owned browser fixture cleanup failed for user ${registeredUser.id}/${registeredUser.email}: ${error.message}`);
			}
		}
		await browser.close();
	}

	if (pageErrors.length > 0) {
		fail(`Browser page errors:\n${pageErrors.join('\n')}`);
	}
	if (serverErrors.length > 0) {
		fail(`Server errors during browser smoke:\n${serverErrors.join('\n')}`);
	}
}

async function runAuthPagesBrowserSmoke(page, onRegistered) {
	await goto(page, `${baseUrl}/login`);
	await visible(page.getByRole('heading', { name: /^Sign In$/ }), 'login heading');
	await visible(page.getByRole('link', { name: 'Forgot your password?' }), 'forgot password link');
	await visible(page.getByRole('link', { name: 'Sign in with a code instead' }), 'otp login link');
	await visible(page.getByRole('link', { name: 'Create one' }), 'register link');
	await visible(page.getByLabel('Email', { exact: true }), 'login email label');
	await visible(page.getByLabel('Password', { exact: true }), 'login password label');
	await page.getByRole('button', { name: 'Sign In' }).click();
	await visible(page.locator('#email[aria-invalid="true"]'), 'empty email inline validation');
	await visible(page.locator('#password[aria-invalid="true"]'), 'empty password inline validation');
	if (await page.getByRole('alert').count() !== 0) {
		throw new Error('Empty login duplicated inline validation with an alert/toast.');
	}

	await page.locator('input[name="email"]').fill('admin@svelar.dev');
	await page.locator('input[name="password"]').fill('wrong-password');
	await page.getByRole('button', { name: 'Sign In' }).click();
	await visible(page.getByText('Invalid email or password'), 'invalid login message');
	if (await page.locator('input[name="password"]').inputValue() !== '') {
		throw new Error('Failed login retained the password in the enhanced form.');
	}

	await goto(page, `${baseUrl}/forgot-password`);
	await visible(page.getByRole('heading', { name: /^Forgot Password$/ }), 'forgot password heading');
	await page.locator('input[name="email"]').fill('demo@svelar.dev');
	await page.getByRole('button', { name: 'Send Reset Link' }).click();
	await visible(page.getByText('If that email exists, a reset link has been sent. Check your inbox.'), 'forgot password success');

	await goto(page, `${baseUrl}/reset-password`);
	await page.waitForURL('**/forgot-password', { timeout: 15_000 });

	await goto(page, `${baseUrl}/reset-password?token=invalid-token&email=demo%40svelar.dev`);
	await visible(page.getByRole('heading', { name: /^Reset Password$/ }), 'reset password heading');
	await page.locator('input[name="password"]').fill('new-password');
	await page.locator('input[name="password_confirmation"]').fill('new-password');
	await page.getByRole('button', { name: 'Reset Password' }).click();
	await visible(page.getByText('Invalid or expired reset link. Please request a new one.'), 'reset password invalid token message');

	await goto(page, `${baseUrl}/otp-login`);
	await visible(page.getByRole('heading', { name: /^Sign In with Code$/ }), 'otp login heading');
	await page.locator('input[name="email"]').fill('demo@svelar.dev');
	await page.getByRole('button', { name: 'Send Code' }).click();
	await visible(page.getByText('Enter the 6-digit code sent to demo@svelar.dev'), 'otp code sent state');
	await page.locator('input[name="code"]').fill('000000');
	await assertInvalidOtp(page);

	const userEmail = `browser-smoke-${Date.now()}@example.com`;
	await goto(page, `${baseUrl}/register`);
	await visible(page.getByRole('heading', { name: /^Create Account$/ }), 'register heading');
	await page.locator('input[name="name"]').fill('Browser Smoke');
	await page.locator('input[name="email"]').fill(userEmail);
	await page.locator('input[name="password"]').fill('password');
	await page.locator('input[name="password_confirmation"]').fill('password');
	await Promise.all([
		page.waitForURL('**/dashboard', { timeout: 15_000 }),
		page.getByRole('button', { name: 'Create Account' }).click(),
	]);
	await visible(page.getByRole('heading', { name: /^Dashboard$/ }), 'registered user dashboard heading');
	const registered = await browserApi(page, '/api/auth/me');
	if (registered.status !== 200 || !registered.body.data?.id) throw new Error('Registration did not expose the authenticated user identity.');
	const userId = String(registered.body.data.id);
	onRegistered?.({ id: userId, email: userEmail });
	console.log(`Registered browser fixture ${userId}: ${userEmail}`);
	await Promise.all([
		page.waitForURL(baseUrl + '/', { timeout: 15_000 }),
		page.getByRole('button', { name: 'Logout' }).click(),
	]);
	await visible(page.getByRole('button', { name: 'Login' }), 'logged out after registration');
	return { id: userId, email: userEmail };
}

async function assertInvalidOtp(page) {
	const responsePromise = page.waitForResponse((response) => new URL(response.url()).pathname === '/otp-login' && response.request().method() === 'POST');
	await page.getByRole('button', { name: 'Verify & Sign In' }).click();
	const action = await (await responsePromise).json();
	if (action.type !== 'failure' || action.status !== 401) {
		throw new Error('Invalid OTP must return an enhanced action failure with status 401.');
	}
	await visible(page.getByText(authUiMessages.invalidOtp, { exact: true }), 'otp invalid code message');
	const alert = page.getByRole('alert');
	if (await alert.count() !== 1) throw new Error('Invalid OTP must show exactly one visible alert.');
	await visible(alert, 'single OTP failure alert');
	if (await page.locator('input[name="code"]').inputValue() !== '') {
		throw new Error('Invalid OTP retained the code in the enhanced form.');
	}
	if ((await browserApi(page, '/api/auth/me')).status !== 401) {
		throw new Error('Invalid OTP established an authenticated session.');
	}
}

async function assertPageWidth(page, name) {
	const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
	if (overflow) throw new Error(`${name} overflows the browser viewport.`);
}

async function runDashboardResponsiveSmoke(page) {
	const desktop = page.viewportSize();
	const screenshots = join(appDir, 'docs', 'browser-certification');
	mkdirSync(screenshots, { recursive: true });
	try {
		await page.setViewportSize({ width: 390, height: 844 });
		for (const tab of ['overview', 'users', 'roles', 'permissions', 'queue', 'scheduler', 'logs', 'features']) {
			await goto(page, `${baseUrl}/admin?tab=${tab}`);
			await assertPageWidth(page, `Mobile admin ${tab}`);
			if (new URL(page.url()).pathname !== '/admin/dashboard') throw new Error('Legacy admin did not redirect to the single console.');
			if (tab === 'scheduler') await page.screenshot({ path: join(screenshots, 'admin-scheduler-mobile.png'), fullPage: true });
			const label = { users: 'User directory', roles: 'Permission roles', permissions: 'Permission roles', queue: 'Queue jobs', scheduler: 'Scheduler tasks', logs: 'Persistent logs', features: 'Feature switches' }[tab];
			if (label) {
				const region = page.getByRole('region', { name: label });
				await visible(region, `mobile ${label}`);
				await assertScrollableRegion(page, region, label);
			}
		}
		await goto(page, `${baseUrl}/admin/dashboard?tab=scheduler`);
		await assertPageWidth(page, 'Mobile operational scheduler');
		const table = page.getByRole('region', { name: 'Scheduler tasks' });
		await visible(table, 'scheduler scroll region');
		await assertScrollableRegion(page, table, 'Scheduler tasks');
		await page.screenshot({ path: join(screenshots, 'operational-scheduler-mobile.png'), fullPage: true });
		await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click();
		await visible(page.getByRole('navigation', { name: 'Console sections' }), 'mobile console drawer');
		await page.getByRole('link', { name: 'Users', exact: true }).click();
		await visible(page.getByRole('heading', { name: 'Users', exact: true }), 'mobile drawer navigation');
		if (await page.getByRole('navigation', { name: 'Console sections' }).isVisible()) throw new Error('Mobile drawer did not close after navigation.');
		await page.screenshot({ path: join(screenshots, 'operational-users-mobile.png'), fullPage: true });
	} finally {
		if (desktop) await page.setViewportSize(desktop);
	}
}

async function assertScrollableRegion(page, region, label) {
	if (!await region.evaluate((node) => node.scrollWidth > node.clientWidth)) throw new Error(`${label} does not provide bounded mobile table scrolling.`);
	await region.focus();
	await page.keyboard.press('ArrowRight');
	await page.waitForFunction((name) => [...document.querySelectorAll('[role="region"]')].some((node) => node.getAttribute('aria-label') === name && node.scrollLeft > 0), label);
}

async function browserApi(page, path, options = {}) {
	await respectRateBudget(page);
	return page.evaluate(async ({ path, options }) => {
		const headers = { ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }), ...options.headers };
		if (options.csrf) {
			const cookie = document.cookie.split(';').map((value) => value.trim()).find((value) => value.startsWith('XSRF-TOKEN='));
			if (!cookie) throw new Error('Authenticated browser has no CSRF cookie.');
			headers['X-CSRF-Token'] = decodeURIComponent(cookie.slice('XSRF-TOKEN='.length));
		}
		const response = await fetch(path, { method: options.method ?? 'GET', headers,
			...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }) });
		return { status: response.status, body: await response.json() };
	}, { path, options });
}

async function confirmConsoleMutation(page, path, method, expectedStatus = 200) {
	await respectRateBudget(page);
	const dialog = page.locator('dialog[aria-labelledby="confirmation-title"]');
	await visible(dialog, 'explicit console confirmation');
	const responsePromise = page.waitForResponse((response) => new URL(response.url()).pathname === path && response.request().method() === method);
	await dialog.getByRole('button', { name: 'Confirm', exact: true }).click();
	const response = await responsePromise;
	const body = await response.json();
	if (response.status() !== expectedStatus) throw new Error(`${method} ${path} returned ${response.status()}: ${JSON.stringify(body)}`);
	if (!response.request().headers()['x-csrf-token']) throw new Error(`${method} ${path} did not send the browser CSRF token.`);
	if (body.meta?.auditWarning) throw new Error(`Audit did not complete: ${body.meta.auditWarning}`);
	await dialog.waitFor({ state: 'hidden' });
	return body;
}

async function runDashboardConsoleSmoke(page) {
	const panels = [
		['overview', 'Overview', 'Dependency observations'], ['users', 'Users', 'User directory'],
		['roles', 'Roles & permissions', 'Permission roles'], ['permissions', 'Roles & permissions', 'Capability catalog'],
		['queue', 'Queues', 'Queue jobs'], ['scheduler', 'Scheduler', 'Scheduler tasks'],
		['logs', 'Logs', 'Persistent logs'], ['features', 'Features', 'Feature switches'],
	];
	for (const [tab, title, region] of panels) {
		await goto(page, `${baseUrl}/admin?tab=${tab}`);
		const location = new URL(page.url());
		if (location.pathname !== '/admin/dashboard' || location.searchParams.get('tab') !== ({ roles: 'permissions', queue: 'queues' }[tab] ?? tab)) throw new Error(`Legacy ${tab} tab was not preserved by its redirect.`);
		await visible(page.getByRole('heading', { name: title, exact: true }), `console ${tab} heading`);
		await visible(page.getByRole('region', { name: region }), `console ${tab} region`);
		await assertPageWidth(page, `Desktop console ${tab}`);
		if (await page.getByRole('navigation', { name: 'Console sections' }).count() !== 1) throw new Error('Console has duplicated navigation chrome.');
	}
	await goto(page, `${baseUrl}/admin?tab=queue&queue=default&connection=database&status=failed&offset=0`);
	for (const [name, value] of [['queue', 'default'], ['connection', 'database'], ['status', 'failed'], ['offset', '0']]) {
		if (new URL(page.url()).searchParams.get(name) !== value) throw new Error(`Admin redirect lost queue ${name}.`);
	}
	const stats = await browserApi(page, '/api/admin/stats');
	if (stats.status !== 200) throw new Error('Console stats failed.');
	for (const queue of stats.body.data.queue.topology) {
		if (queue.runtime && queue.runtime.workers === null && queue.runtime.effectiveConcurrency !== null) throw new Error('Unknown worker state manufactured effective concurrency.');
	}
	await goto(page, `${baseUrl}/admin/dashboard?tab=scheduler`);
	const scheduler = await browserApi(page, '/api/admin/scheduler');
	if (scheduler.status !== 200) throw new Error('Scheduler panel failed.');
	const task = scheduler.body.data.tasks.find((item) => item.enabled && !item.isRunning);
	if (!task) throw new Error('Scheduler smoke requires a registered enabled task in this generated app.');
	const row = page.getByRole('region', { name: 'Scheduler tasks' }).getByRole('row').filter({ hasText: task.name });
	await row.getByRole('button', { name: 'Run now', exact: true }).click();
	const run = await confirmConsoleMutation(page, '/api/admin/scheduler/' + encodeURIComponent(task.name) + '/run', 'POST');
	if (!run.data.queued || !run.data.data?.id || !['pending', 'running', 'succeeded'].includes(run.data.data.state)) throw new Error('Run-now did not return a durable queued request.');
	await row.getByRole('button', { name: 'Refresh run request', exact: true }).click();
	await visible(row.getByText(/pending|running|succeeded/, { exact: true }), 'persistent run-request state');
}

async function runDashboardAccessSmoke(page, user) {
	const roleName = `browser-smoke-${Date.now()}`;
	const roleLabel = `Browser role ${Date.now()}`;
	user.roleName = roleName;
	user.roleLabel = roleLabel;
	const scope = { scope: 'platform' };
	const roleBody = { ...scope, name: roleName, label: roleLabel, confirmed: true };
	const createPath = '/api/admin/permissions/roles';
	const missingCsrf = await browserApi(page, createPath, { method: 'POST', body: roleBody });
	if (missingCsrf.status !== 419) throw new Error(`Missing-CSRF console mutation returned ${missingCsrf.status}, expected 419.`);
	const forged = await browserApi(page, createPath, { method: 'POST', body: roleBody, headers: { Authorization: 'Bearer forged-browser-credential' } });
	if (![401, 403, 419].includes(forged.status)) throw new Error(`Forged Bearer without CSRF was not denied (${forged.status}).`);
	const rejected = await browserApi(page, '/api/admin/permissions?search=' + encodeURIComponent(roleName));
	if (rejected.status !== 200 || rejected.body.data.items.length) throw new Error('A rejected CSRF mutation created a role.');
	await goto(page, `${baseUrl}/admin/dashboard?tab=permissions`);
	await page.getByRole('button', { name: 'Create role', exact: true }).click();
	const modal = page.locator('dialog.management-dialog');
	await visible(modal, 'role create modal');
	await modal.getByRole('combobox', { name: 'Assignment scope', exact: true }).selectOption('platform');
	await modal.getByRole('button', { name: 'Create role', exact: true }).click();
	await visible(modal.locator('#new-role-name[aria-invalid="true"]'), 'role name inline error');
	await visible(modal.locator('#new-role-label[aria-invalid="true"]'), 'role label inline error');
	if (await page.locator('dialog[aria-labelledby="confirmation-title"][open]').count()) throw new Error('Invalid role form opened a confirmation.');
	await modal.getByLabel(/^Role name/).fill('owner');
	await modal.getByLabel(/^Label/).fill(roleLabel);
	await modal.getByRole('button', { name: 'Create role', exact: true }).click();
	await visible(modal.getByText('Reserved platform identity cannot be created'), 'reserved role inline error');
	await modal.getByLabel(/^Role name/).fill(roleName);
	let writes = 0;
	const countWrite = (request) => { if (new URL(request.url()).pathname === createPath && request.method() === 'POST') writes++; };
	page.on('request', countWrite);
	try {
		await modal.getByRole('button', { name: 'Create role', exact: true }).click();
		const confirmation = page.locator('dialog[aria-labelledby="confirmation-title"]');
		await visible(confirmation, 'role confirmation');
		if (writes !== 0) throw new Error('Role was submitted before confirmation.');
		await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
		await confirmation.waitFor({ state: 'hidden' });
		if (writes !== 0) throw new Error('Cancelled confirmation submitted a role.');
		await modal.getByRole('button', { name: 'Create role', exact: true }).click();
		const created = await confirmConsoleMutation(page, createPath, 'POST');
		if (writes !== 1) throw new Error('Role creation submitted more than once.');
		user.roleId = created.data.data.id;
	} finally { page.off('request', countWrite); }
	await modal.waitFor({ state: 'hidden' });
	const profile = await browserApi(page, `/api/admin/permissions/roles/${user.roleId}/profile?scope=platform`);
	if (profile.status !== 200 || profile.body.data.profile.kind !== 'custom' || profile.body.data.selected.length) throw new Error('New role did not create an empty exact scoped profile.');
	const catalog = await browserApi(page, '/api/admin/permissions');
	const capability = catalog.body.data.catalog.find((item) => item.scope === 'platform' && item.kind === 'screen');
	if (!capability) throw new Error('Generated console manifest has no platform screen capability.');
	await goto(page, `${baseUrl}/admin/dashboard?tab=permissions&roleSearch=${encodeURIComponent(roleName)}`);
	const roleRow = page.getByRole('region', { name: 'Permission roles' }).getByRole('row').filter({ hasText: roleName });
	await roleRow.getByRole('button', { name: 'Edit permission profile', exact: true }).click();
	const editor = page.locator('.profile-editor');
	await editor.getByRole('combobox', { name: 'Scope', exact: true }).selectOption('platform');
	await editor.getByRole('button', { name: 'Load profile', exact: true }).click();
	await visible(editor.getByRole('region', { name: 'Capabilities', exact: true }), 'granular capability editor');
	await editor.getByRole('checkbox', { name: capability.label, exact: true }).check();
	await editor.getByRole('button', { name: 'Save profile', exact: true }).click();
	await confirmConsoleMutation(page, `/api/admin/permissions/roles/${user.roleId}/profile`, 'PUT');
	const selected = await browserApi(page, `/api/admin/permissions/roles/${user.roleId}/profile?scope=platform`);
	if (selected.body.data.selected.length !== 1 || selected.body.data.selected[0] !== capability.name) throw new Error('Granular custom profile did not save its exact selection.');
	await goto(page, `${baseUrl}/admin/dashboard?tab=users&userSearch=${encodeURIComponent(user.email)}`);
	const userRow = page.getByRole('region', { name: 'User directory' }).getByRole('row').filter({ hasText: user.email });
	await userRow.getByRole('button', { name: 'Manage user access', exact: true }).click();
	await visible(modal, 'scoped user access modal');
	await modal.getByRole('combobox', { name: 'Assignment scope', exact: true }).selectOption('platform');
	await modal.getByRole('button', { name: 'Load access', exact: true }).click();
	await visible(modal.getByLabel(/^Search roles/), 'user role controls');
	await modal.getByLabel(/^Search roles/).fill(roleName);
	await modal.getByRole('button', { name: 'Search', exact: true }).click();
	await modal.getByRole('combobox', { name: 'Role', exact: true }).locator(`option[value="${user.roleId}"]`).waitFor({ state: 'attached' });
	await modal.getByRole('combobox', { name: 'Role', exact: true }).selectOption(String(user.roleId));
	await modal.getByRole('button', { name: 'Assign role', exact: true }).click();
	await confirmConsoleMutation(page, `/api/admin/users/${user.id}/roles`, 'POST');
	await visible(modal.getByRole('button', { name: 'Detach ' + roleLabel, exact: true }), 'assigned role detach control');
	let snapshot = await browserApi(page, `/api/admin/users/${user.id}/access?scope=platform`);
	if (!snapshot.body.data.roles.some((role) => role.id === user.roleId)) throw new Error('Role assignment was not persisted.');
	await modal.getByRole('combobox', { name: 'Capability', exact: true }).selectOption(capability.name);
	await modal.getByRole('button', { name: 'Grant capability', exact: true }).click();
	await confirmConsoleMutation(page, `/api/admin/users/${user.id}/capabilities`, 'POST');
	await visible(modal.getByRole('button', { name: 'Revoke ' + capability.name, exact: true }), 'direct capability revoke control');
	snapshot = await browserApi(page, `/api/admin/users/${user.id}/access?scope=platform`);
	if (!snapshot.body.data.directCapabilities.includes(capability.name)) throw new Error('Direct capability grant was not persisted.');
	const me = await browserApi(page, '/api/auth/me');
	const self = await browserApi(page, `/api/admin/users/${me.body.data.id}/roles`, { method: 'POST', csrf: true, body: { ...scope, roleId: user.roleId, confirmed: true } });
	if (self.status !== 403) throw new Error('Protected self assignment was not denied.');
	const unknown = await browserApi(page, `/api/admin/users/${user.id}/capabilities`, { method: 'POST', csrf: true, body: { ...scope, capability: 'unknown.browser.grant', confirmed: true } });
	if (unknown.status !== 422) throw new Error('Unknown capability grant was not denied.');
	await modal.getByRole('button', { name: 'Revoke ' + capability.name, exact: true }).click();
	await confirmConsoleMutation(page, `/api/admin/users/${user.id}/capabilities`, 'DELETE');
	await modal.getByRole('button', { name: 'Detach ' + roleLabel, exact: true }).click();
	await confirmConsoleMutation(page, `/api/admin/users/${user.id}/roles`, 'DELETE');
	snapshot = await browserApi(page, `/api/admin/users/${user.id}/access?scope=platform`);
	if (snapshot.body.data.directCapabilities.includes(capability.name) || snapshot.body.data.roles.some((role) => role.id === user.roleId)) throw new Error('Scoped detach/revoke did not persist.');
	await modal.getByRole('button', { name: 'Close access management', exact: true }).click();
	const directory = await browserApi(page, '/api/admin/users?search=' + encodeURIComponent(user.email));
	if (directory.body.data.items[0]?.globalRole !== 'user') throw new Error('Configurable grants changed the trusted physical user role.');
	await cleanupRoleProfile(page, user);
}

async function cleanupRoleProfile(page, user) {
	if (!user.roleName || user.roleCleaned) return;
	const catalog = await browserApi(page, '/api/admin/permissions?search=' + encodeURIComponent(user.roleName));
	if (catalog.status !== 200) throw new Error('Unable to identify the owned cleanup role.');
	const role = catalog.body.data.items.find((entry) => entry.name === user.roleName);
	if (!role) { user.roleCleaned = true; return; }
	user.roleId = role.id;
	const current = await browserApi(page, `/api/admin/permissions/roles/${role.id}/profile?scope=platform`);
	if (current.status !== 200) throw new Error('Unable to inspect the owned cleanup profile.');
	if (current.body.data.profile === null && !current.body.data.selected.length) { user.roleCleaned = true; return; }
	await goto(page, `${baseUrl}/admin/dashboard?tab=permissions&roleSearch=${encodeURIComponent(user.roleName)}`);
	await page.getByRole('region', { name: 'Permission roles' }).getByRole('row').filter({ hasText: user.roleName }).getByRole('button', { name: 'Edit permission profile', exact: true }).click();
	const editor = page.locator('.profile-editor');
	await editor.getByRole('combobox', { name: 'Scope', exact: true }).selectOption('platform');
	await editor.getByRole('button', { name: 'Load profile', exact: true }).click();
	await visible(editor.getByRole('button', { name: 'Remove role', exact: true }), 'scoped role cleanup');
	await editor.getByRole('button', { name: 'Remove role', exact: true }).click();
	await confirmConsoleMutation(page, `/api/admin/permissions/roles/${role.id}`, 'DELETE');
	const removed = await browserApi(page, `/api/admin/permissions/roles/${role.id}/profile?scope=platform`);
	if (removed.status !== 200 || removed.body.data.profile !== null || removed.body.data.selected.length) throw new Error('Owned role profile/grants were not cleaned up.');
	user.roleCleaned = true;
	console.log(`Cleaned scoped role ${role.id}; shared catalog record retained by the role-removal contract.`);
}

async function ensureAdminSession(page) {
	const me = await browserApi(page, '/api/auth/me');
	if (me.status === 200 && me.body.data?.email === 'admin@svelar.dev') return;
	await goto(page, `${baseUrl}/login`);
	await page.locator('input[name="email"]').fill('admin@svelar.dev');
	await page.locator('input[name="password"]').fill('admin123');
	await Promise.all([page.waitForURL('**/dashboard'), page.getByRole('button', { name: 'Sign In', exact: true }).click()]);
}

async function removeRegisteredUser(page, user) {
	await goto(page, `${baseUrl}/admin/dashboard?tab=users&userSearch=${encodeURIComponent(user.email)}`);
	const row = page.getByRole('region', { name: 'User directory' }).getByRole('row').filter({ hasText: user.email });
	await row.getByRole('button', { name: 'Delete user', exact: true }).click();
	await confirmConsoleMutation(page, `/api/admin/users/${user.id}`, 'DELETE');
	await row.waitFor({ state: 'hidden' });
	const users = await browserApi(page, '/api/admin/users?search=' + encodeURIComponent(user.email));
	if (users.status !== 200 || users.body.data.items.some((entry) => String(entry.id) === user.id)) throw new Error('Owned registered user was not cleaned up.');
	user.cleaned = true;
}

async function runLoginThrottleSmoke(page) {
	await goto(page, `${baseUrl}/login`);
	for (let attempt = 0; attempt < 5; attempt += 1) {
		await page.locator('input[name="email"]').fill('admin@svelar.dev');
		await page.locator('input[name="password"]').fill(`wrong-${attempt}`);
		const response = page.waitForResponse((res) => res.request().method() === 'POST' && new URL(res.url()).pathname === '/login');
		await page.getByRole('button', { name: 'Sign In' }).click();
		await response;
		await visible(page.getByText('Invalid email or password'), `invalid login message ${attempt + 1}`);
	}
	await page.locator('input[name="password"]').fill('still-wrong');
	const response = page.waitForResponse((res) => res.request().method() === 'POST' && new URL(res.url()).pathname === '/login');
	await page.getByRole('button', { name: 'Sign In' }).click();
	const throttled = await response;
	const action = await throttled.json();
	if (action.type !== 'failure' || action.status !== 429) {
		throw new Error(`Login throttle did not return a 429 action failure (HTTP ${throttled.status()}, action ${action.type}/${action.status}).`);
	}
	await visible(page.getByText('Too many attempts. Please try again later.'), 'login throttle message');
}

async function goto(page, url) {
	await respectRateBudget(page);
	let lastError;
	for (let attempt = 0; attempt < 3; attempt++) {
		try {
			const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15_000 });
			if (response?.status() === 429) throw new Error(`Unexpected navigation rate limit at ${url}; Retry-After=${response.headers()['retry-after'] ?? 'unknown'}. No failed assertion was retried.`);
			await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});
			return;
		} catch (error) {
			lastError = error;
			if (!String(error?.message ?? error).includes('ERR_ABORTED')) break;
			await new Promise((resolve) => setTimeout(resolve, 500));
		}
	}
	throw lastError;
}

function observeRateBudget(page, response) {
	const headers = response.headers();
	if (!headers['x-ratelimit-remaining'] || !headers['x-ratelimit-reset']) return;
	const remaining = Number(headers['x-ratelimit-remaining']);
	const resetAt = Number(headers['x-ratelimit-reset']) * 1000;
	if (!Number.isSafeInteger(remaining) || remaining < 0 || !Number.isSafeInteger(resetAt) || resetAt <= Date.now()) return;
	const previous = rateBudgets.get(page);
	if (previous?.resetAt > resetAt) return;
	rateBudgets.set(page, { remaining: previous?.resetAt === resetAt ? Math.min(previous.remaining, remaining) : remaining, resetAt });
}

async function respectRateBudget(page, reserve = 25) {
	const budget = rateBudgets.get(page);
	if (!budget || budget.remaining >= reserve) return;
	const delay = budget.resetAt - Date.now() + 500;
	if (delay <= 0) { rateBudgets.delete(page); return; }
	if (delay > 120_000) throw new Error('Observed global rate-limit reset exceeds the bounded browser smoke wait.');
	console.log(`Respecting global rate budget: ${budget.remaining} remaining; waiting ${Math.ceil(delay / 1000)}s before the next workflow.`);
	rateBudgetRecorders.get(page)?.({ remaining: budget.remaining, waitMs: delay, resetAt: budget.resetAt, reserve });
	await new Promise((resolve) => setTimeout(resolve, delay));
	rateBudgets.delete(page);
}

async function visible(locator, label) {
	try {
		await locator.waitFor({ state: 'visible', timeout: 10_000 });
	} catch (error) {
		throw new Error(`Could not find ${label}: ${error.message}`);
	}
}

async function runSseBrowserSmoke(page, secret) {
	if (!secret) {
		throw new Error('INTERNAL_SECRET is required for browser SSE smoke.');
	}

	const result = await page.evaluate(async ({ internalSecret }) => {
		const userResponse = await fetch('/api/auth/me');
		if (!userResponse.ok) {
			throw new Error(`Could not load authenticated user: ${userResponse.status}`);
		}
		const userPayload = await userResponse.json();
		const user = userPayload.data ?? userPayload;
		const userId = user.id;

		const sources = [];
		const summaries = [];

		function subscribe(channel) {
			const events = [];
			const source = new EventSource(`/api/broadcasting/${encodeURIComponent(channel)}`);
			sources.push(source);

			for (const eventName of [
				'connected',
				'certification-browser-public',
				'certification-browser-private',
				'member:joined',
				'member:left',
			]) {
				source.addEventListener(eventName, (event) => {
					events.push({
						event: eventName,
						data: JSON.parse(event.data),
					});
				});
			}

			return { channel, events, source };
		}

		async function waitFor(subscription, eventName, predicate = () => true) {
			const deadline = Date.now() + 10_000;
			while (Date.now() < deadline) {
				const event = subscription.events.find((candidate) => {
					return candidate.event === eventName && predicate(candidate.data);
				});
				if (event) return event;
				await new Promise((resolve) => setTimeout(resolve, 50));
			}
			throw new Error(
				`Timed out waiting for ${eventName} on ${subscription.channel}; received ${JSON.stringify(subscription.events)}`
			);
		}

		async function broadcast(channel, eventName, data) {
			const response = await fetch('/api/internal/broadcast', {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					'x-internal-secret': internalSecret,
				},
				body: JSON.stringify({ channel, eventName, data }),
			});
			if (!response.ok) {
				throw new Error(`Internal broadcast failed (${response.status}): ${await response.text()}`);
			}
			return response.json();
		}

		try {
			const publicChannel = `browser-public-${Date.now()}`;
			const publicSubscription = subscribe(publicChannel);
			await waitFor(publicSubscription, 'connected', (data) => data.channel === publicChannel);
			await broadcast(publicChannel, 'certification-browser-public', { ok: true });
			await waitFor(publicSubscription, 'certification-browser-public', (data) => data.ok === true);
			summaries.push('public');

			const privateChannel = `private-user-${userId}`;
			const privateSubscription = subscribe(privateChannel);
			await waitFor(privateSubscription, 'connected', (data) => data.channel === privateChannel);
			await broadcast(privateChannel, 'certification-browser-private', { userId });
			await waitFor(privateSubscription, 'certification-browser-private', (data) => String(data.userId) === String(userId));
			summaries.push('private');

			const presenceOne = subscribe('presence-admin');
			await waitFor(presenceOne, 'connected', (data) => data.channel === 'presence-admin');

			const presenceTwo = subscribe('presence-admin');
			await waitFor(presenceOne, 'member:joined', (data) => String(data.id) === String(userId));
			await waitFor(presenceTwo, 'connected', (data) => {
				return data.channel === 'presence-admin'
					&& Array.isArray(data.members)
					&& data.members.some((member) => String(member.id) === String(userId));
			});

			presenceTwo.source.close();
			await waitFor(presenceOne, 'member:left', (data) => String(data.id) === String(userId));
			summaries.push('presence');

			return summaries;
		} finally {
			for (const source of sources) source.close();
		}
	}, { internalSecret: secret });

	if (!Array.isArray(result) || !['public', 'private', 'presence'].every((name) => result.includes(name))) {
		throw new Error(`Browser SSE smoke returned an unexpected result: ${JSON.stringify(result)}`);
	}
}

async function assertPortAvailable(port) {
	await new Promise((resolve, reject) => {
		const probe = createPortProbe();
		probe.once('error', (error) => reject(new Error(`Browser smoke port ${port} is unavailable: ${error.message}. No existing server was stopped.`)));
		probe.listen(port, '127.0.0.1', () => probe.close((error) => error ? reject(error) : resolve()));
	});
}

function startServer() {
	const serverArgs = ['run', serverScript];
	if (serverScript === 'smoke:serve') serverArgs.push('--', '--port', String(port), '--strictPort');
	const child = spawn('npm', serverArgs, {
		cwd: appDir,
		env: {
			...appEnv,
			...process.env,
			AUTH_OTP_ENABLED: 'true',
			APP_URL: baseUrl,
			HOST: '127.0.0.1',
			PORT: String(port),
			ORIGIN: baseUrl,
		},
		stdio: ['ignore', 'pipe', 'pipe'],
		detached: true,
	});

	child.stdout.on('data', (data) => process.stdout.write(data));
	child.stderr.on('data', (data) => process.stderr.write(data));
	child.on('exit', (code) => {
		if (code !== null && code !== 0) {
			console.error(`${serverScript} exited with code ${code}`);
		}
	});

	return child;
}

async function stopServer(child) {
	const pid = child.pid;
	if (!pid) return;

	try {
		process.kill(-pid, 'SIGTERM');
	} catch {
		child.kill('SIGTERM');
	}

	await new Promise((resolve) => setTimeout(resolve, 1000));

	if (child.exitCode === null && child.signalCode === null) {
		try {
			process.kill(-pid, 'SIGKILL');
		} catch {
			child.kill('SIGKILL');
		}
	}
}

function loadDotEnv(dir) {
	const envPath = join(dir, '.env');
	if (!existsSync(envPath)) return {};

	const env = {};
	for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) continue;
		const separator = trimmed.indexOf('=');
		if (separator === -1) continue;
		const key = trimmed.slice(0, separator).trim();
		const value = trimmed.slice(separator + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
		env[key] = value;
	}
	return env;
}

async function waitForServer(url, child) {
	const deadline = Date.now() + 60_000;
	while (Date.now() < deadline) {
		if (child && (child.exitCode !== null || child.signalCode !== null)) fail('Test server exited before becoming ready.');
		try {
			const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
			if (response.status < 500) return;
		} catch {
			// Keep waiting while Vite starts.
		}
		await new Promise((resolve) => setTimeout(resolve, 500));
	}
	fail(`Timed out waiting for ${url}`);
}

function has(name) {
	return args.includes(name);
}

function valueFor(name) {
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === name) return args[i + 1];
		if (arg.startsWith(`${name}=`)) return arg.slice(name.length + 1);
	}
	return undefined;
}

function fail(message) {
	throw new Error(`Browser smoke failed: ${message}`);
}
