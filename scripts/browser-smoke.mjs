#!/usr/bin/env node
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const defaultAppDir = resolve(repoRoot, '../svelar-testing-area/apps/svelar-smoke-ddd');

const appDir = resolve(valueFor('--app-dir') ?? defaultAppDir);
const port = Number(valueFor('--port') ?? 5179);
const baseUrl = valueFor('--base-url') ?? `http://127.0.0.1:${port}`;
const noServer = has('--no-server');
const serverScript = valueFor('--server-script') ?? 'smoke:serve';
const headed = has('--headed');
const slowMo = Number(valueFor('--slow-mo') ?? (headed ? 250 : 0));
const appEnv = loadDotEnv(appDir);
const internalSecret = process.env.INTERNAL_SECRET ?? appEnv.INTERNAL_SECRET;

if (has('--help') || has('-h')) {
	console.log(`Usage: node scripts/browser-smoke.mjs [options]

Options:
  --app-dir <path>       Generated app directory. Default: ../svelar-testing-area/apps/svelar-smoke-ddd.
  --port <port>          Port used by npm run smoke:serve. Default: 5179.
  --base-url <url>       Existing app URL. Default: http://127.0.0.1:<port>.
  --no-server            Do not start npm run smoke:serve; test the existing base URL.
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
try {
	if (!noServer) {
		server = startServer();
	}

	await waitForServer(baseUrl);
	await runBrowserSmoke();
	console.log(`Browser smoke passed for ${baseUrl}`);
} finally {
	if (server) {
		await stopServer(server);
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

	page.on('pageerror', (error) => pageErrors.push(error.message));
	page.on('response', (response) => {
		const url = response.url();
		if (url.startsWith(baseUrl)) {
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

		await runAuthPagesBrowserSmoke(page);

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
			await runSseBrowserSmoke(page, internalSecret);

		await goto(page, `${baseUrl}/dashboard/api-keys`);
		await visible(page.getByRole('heading', { name: /^API Keys$/ }), 'api keys heading');
		const keyName = `Browser smoke ${Date.now()}`;
		await page.getByRole('button', { name: 'Create New Key' }).click();
		await page.locator('input[name="name"]').fill(keyName);
		await page.locator('input[name="permissions"]').fill('read,write');
		await page.getByRole('button', { name: 'Create Key' }).click();
		await visible(page.getByText('API Key Created'), 'api key created alert');
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

		for (const [tab, expectedText] of [
			['overview', 'Total Users'],
			['users', 'Assigned Roles'],
			['roles', 'Roles'],
			['permissions', 'Permissions'],
			['queue', 'Queue Actions'],
			['scheduler', 'Scheduled Tasks'],
			['logs', 'Application Logs'],
		]) {
			await goto(page, `${baseUrl}/admin?tab=${tab}`);
			await visible(page.getByRole('heading', { name: /^Admin Dashboard$/ }), `admin ${tab} heading`);
			await visible(page.getByText(expectedText).first(), `admin ${tab} content`);
		}

		await goto(page, `${baseUrl}/dashboard`);
		await Promise.all([
			page.waitForURL(baseUrl + '/', { timeout: 15_000 }),
			page.getByRole('button', { name: 'Logout' }).click(),
		]);
		await visible(page.getByRole('button', { name: 'Login' }), 'logged-out login button');
	} finally {
		await browser.close();
	}

	if (pageErrors.length > 0) {
		fail(`Browser page errors:\n${pageErrors.join('\n')}`);
	}
	if (serverErrors.length > 0) {
		fail(`Server errors during browser smoke:\n${serverErrors.join('\n')}`);
	}
}

async function runAuthPagesBrowserSmoke(page) {
	await page.setExtraHTTPHeaders({ 'x-forwarded-for': `198.51.100.${Math.floor(Math.random() * 200) + 1}` });
	await goto(page, `${baseUrl}/login`);
	await visible(page.getByRole('heading', { name: /^Sign In$/ }), 'login heading');
	await visible(page.getByRole('link', { name: 'Forgot your password?' }), 'forgot password link');
	await visible(page.getByRole('link', { name: 'Sign in with a code instead' }), 'otp login link');
	await visible(page.getByRole('link', { name: 'Create one' }), 'register link');

	for (let attempt = 0; attempt < 5; attempt += 1) {
		await page.locator('input[name="email"]').fill('admin@svelar.dev');
		await page.locator('input[name="password"]').fill(`wrong-${attempt}`);
		await page.getByRole('button', { name: 'Sign In' }).click();
		await visible(page.getByText('Invalid email or password'), `invalid login message ${attempt + 1}`);
	}

	await page.locator('input[name="email"]').fill('admin@svelar.dev');
	await page.locator('input[name="password"]').fill('still-wrong');
	await page.getByRole('button', { name: 'Sign In' }).click();
	await visible(page.getByText('Too many attempts. Please try again later.'), 'login throttle message');
	await page.setExtraHTTPHeaders({});

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
	await page.getByRole('button', { name: 'Verify & Sign In' }).click();
	await visible(page.getByText('Invalid or expired code. Please try again.'), 'otp invalid code message');

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
	await Promise.all([
		page.waitForURL(baseUrl + '/', { timeout: 15_000 }),
		page.getByRole('button', { name: 'Logout' }).click(),
	]);
	await visible(page.getByRole('button', { name: 'Login' }), 'logged out after registration');
}

async function goto(page, url) {
	let lastError;
	for (let attempt = 0; attempt < 3; attempt++) {
		try {
			await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15_000 });
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

function startServer() {
	const child = spawn('npm', ['run', serverScript], {
		cwd: appDir,
		env: {
			...appEnv,
			...process.env,
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

async function waitForServer(url) {
	const deadline = Date.now() + 60_000;
	while (Date.now() < deadline) {
		try {
			const response = await fetch(url);
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
	console.error(`\nBrowser smoke failed: ${message}`);
	process.exit(1);
}
