#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';
import { cliExecutionGates } from './cli-certification.mjs';
import { parseTarballArgument, prepareSmokeArtifact, verifySmokeArtifact } from './release-smoke.mjs';
import { redactEvidence, runCommand, runNativeGate } from './runtime-certification.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const coreRoot = join(repoRoot, 'packages/svelar');
const appsRoot = resolve(repoRoot, '../svelar-testing-area/apps');

export const featureGates = [
	['CLI command parser/help', 'packages/svelar/tests/cli-command.test.ts'],
	['Every built-in CLI command is registered and has help output', 'packages/svelar/tests/cli-command.test.ts + npm run certify:inventory'],
	['CLI generators', 'packages/svelar/tests/cli-make-commands.test.ts + generated-app certification'],
	['Installed CLI execution, custom commands, tinker and artifact type checks (DDD/flat, Zod/Valibot)', 'npm run smoke:cli'],
	['Fresh app creation from the selected immutable package (four layouts/providers)', 'fresh new/CLI matrix with --tarball'],
	['Native process recovery, distributed admission/SSE, SQL leases, search outages and deploy traffic (zero skips)', 'runtime-certification.mjs: SOURCE gate; installed native clients only, not immutable core proof'],
	['Existing app scaffold upgrade safety', 'npm run smoke:ddd + npx svelar update --dry-run/--force certification'],
	['Published-version upgrade preserving source, secrets and seeded data (DDD/flat, Zod/Valibot)', 'npm run smoke:upgrade'],
	['Migrations/seeders/schema builder', 'packages/svelar/tests/database.test.ts + npm run smoke:db'],
	['SQLite/PostgreSQL/MySQL portability', 'npm run smoke:db'],
	['Production adapter-node browser flow', 'npm run smoke:db:prod'],
	['Package publish dry-run for the selected archive and its bundled svelar binary', 'npm publish <selected tarball> --dry-run --ignore-scripts'],
	['High/critical dependency vulnerabilities', 'npm run security:audit'],
	['Route -> controller -> DTO/schema -> action -> service -> repository -> model -> resource', 'generated-app certification'],
	['Complex ORM queries, soft deletes, and UUID/ULID model identifiers', 'packages/svelar/tests/query-builder.test.ts + generated-app certification'],
	['Events/listeners/model observer lifecycle/provider wiring', 'packages/svelar/tests/events.test.ts + generated-app certification'],
	['Middleware and rate limits', 'packages/svelar/tests/middleware*.test.ts + generated-app certification'],
	['Sessions', 'packages/svelar/tests/session.test.ts + generated-app certification'],
	['Queues sync/memory/database', 'packages/svelar/tests/queue.test.ts + generated-app certification'],
	['Redis cache/sessions/BullMQ queues', 'npm run smoke:redis'],
	['PDFKit/Gotenberg PDF generation', 'npm run smoke:pdf'],
	['Meilisearch indexing and search', 'npm run smoke:search'],
	['PgBouncer and pg_stat_statements', 'npm run smoke:pgbouncer'],
	['S3-compatible storage', 'npm run smoke:s3'],
	['Auth, gates, and recovery tokens', 'packages/svelar/tests/auth*.test.ts + browser smoke'],
	['Auth presentation, eligibility and six-form desktop/mobile browser workflows', 'auth-ui-certification.mjs --phase full on fresh DDD Zod AND Valibot before service phases'],
	['UI patterns and cross-browser operations using the installed artifact', 'ui-pattern-certification.mjs --clients=<fresh DDD package.json> before service phases'],
	['Installed invitation page/API acceptance with preserved source and database (both providers)', 'invitation-ui-certification.mjs --installed-app=<fresh DDD> --tarball=<selected archive>'],
	['Populated operations browser acceptance using the installed immutable package', 'browser-smoke.mjs --operational-deep --expected-core-sha256=<selected SHA> before service phases'],
	['Operational browser fixture isolation, ownership and failure contracts', 'node --test scripts/operational-browser-fixtures.test.mjs: SOURCE gate, outside Vitest'],
	['Million-record bounded search reindex (optional, zero skips when enabled)', '--million or SVELAR_TEST_SEARCH_MILLION=1'],
	['Strict generated operator bindings (optional, zero skips when enabled)', '--type-deps=<installed node_modules> or SVELAR_DASHBOARD_TYPE_DEPS'],
	['API key create/validate/revoke/rotate and fail-closed Bearer authentication', 'packages/svelar/tests/api-keys.test.ts + generated-app certification'],
	['Feature flags memory/database/overrides/rollouts', 'packages/svelar/tests/feature-flags.test.ts'],
	['Teams roles/members/invitations', 'packages/svelar/tests/teams.test.ts + generated-app certification'],
	['Outgoing webhooks registration/signing/delivery/retry', 'packages/svelar/tests/webhooks.test.ts'],
	['Broadcasting SSE public/private/presence', 'generated-app certification + browser smoke'],
	['Notifications email/database/custom channels', 'packages/svelar/tests/notifications.test.ts + generated-app certification'],
	['Audit memory/log/database drivers and auditable hooks', 'packages/svelar/tests/audit.test.ts'],
	['Scheduler locks/tasks', 'packages/svelar/tests/scheduler-lock.test.ts + generated app build'],
	['Logging/LogViewer/errors', 'packages/svelar/tests/logging.test.ts + packages/svelar/tests/errors.test.ts + generated-app certification'],
	['Excel import/export/streaming/builder', 'packages/svelar/tests/excel.test.ts'],
	['HTTP utilities and fluent HTTP client', 'packages/svelar/tests/http.test.ts'],
	['Forms and i18n helpers', 'packages/svelar/tests/forms-i18n.test.ts'],
	['UI/SEO/pagination component compile contract and toast store', 'packages/svelar/tests/ui-seo.test.ts'],
	['Testing helpers, factories, request events, and database assertions', 'packages/svelar/tests/testing-helpers.test.ts'],
	['Storage/cache/config/container/services', 'package unit tests'],
	['Mail transports', 'packages/svelar/tests/mail.test.ts + generated-app certification'],
	['Deployment CLI and Docker compose command construction', 'packages/svelar/tests/cli-deployment.test.ts'],
];

export function parseCertificationOptions(argv, cwd = process.cwd(), env = process.env) {
	const options = { fast: false, inventory: false, help: false, million: env.SVELAR_TEST_SEARCH_MILLION === '1',
		typeDeps: env.SVELAR_DASHBOARD_TYPE_DEPS ? resolve(cwd, env.SVELAR_DASHBOARD_TYPE_DEPS) : undefined,
		tarball: parseTarballArgument(argv, cwd), reportDir: resolve(repoRoot, '../svelar-testing-area/artifacts/release-certification') };
	const values = new Set();
	for (let index = 0; index < argv.length; index++) {
		const arg = argv[index];
		if (arg === '--tarball') { index++; continue; }
		if (arg.startsWith('--tarball=')) continue;
		if (arg === '--fast') options.fast = true;
		else if (arg === '--inventory' || arg === '--list') options.inventory = true;
		else if (arg === '--help' || arg === '-h') options.help = true;
		else if (arg === '--million') options.million = true;
		else if (['--type-deps', '--report-dir'].some((name) => arg === name || arg.startsWith(`${name}=`))) {
			const name = arg.split('=')[0];
			if (values.has(name)) throw new Error(`Specify ${name} only once.`);
			values.add(name);
			const value = arg === name ? argv[++index] : arg.slice(name.length + 1);
			if (!value || value.startsWith('--')) throw new Error(`${name} requires a path.`);
			options[name === '--type-deps' ? 'typeDeps' : 'reportDir'] = resolve(cwd, value);
		} else throw new Error(`Unknown certification option: ${arg}`);
	}
	return options;
}

export function verifyCommandInventory(names, gates = cliExecutionGates()) {
	if (!Array.isArray(names) || !names.length || new Set(names).size !== names.length) throw new Error('Invalid or duplicate CLI command inventory.');
	for (const name of names) if (!gates[name]) throw new Error(`CLI command ${name} has no execution certification gate.`);
	for (const name of Object.keys(gates)) if (!names.includes(name)) throw new Error(`CLI execution gate ${name} is stale.`);
}

export function selectCertificationArtifact(tarball, prepare = prepareSmokeArtifact) {
	const selected = prepare(tarball);
	if (selected.supplied) return selected;
	// Default preparation builds/packs once; all gates still execute the packed CLI, never repository dist.
	try { return prepare(selected.tarballPath); }
	finally { selected.cleanup(); }
}

export function validateTypeDependencies(path) {
	if (!path || !existsSync(path) || !lstatSync(path).isDirectory()) throw new Error('--type-deps must name an existing installed node_modules directory.');
	for (const packageName of ['typescript', 'svelte', 'svelte-check']) {
		if (!existsSync(join(path, packageName, 'package.json'))) throw new Error(`Missing ${packageName} in --type-deps; install isolated type-check dependencies first.`);
	}
	if (!existsSync(join(path, 'svelte-check/bin/svelte-check'))) throw new Error('Missing svelte-check executable in --type-deps.');
}

export function verifyInstalledArtifactClient(appDir, artifact) {
	const manifest = JSON.parse(readFileSync(join(appDir, 'package.json'), 'utf8'));
	const dependency = manifest.dependencies?.['@beeblock/svelar'];
	if (typeof dependency !== 'string' || !dependency.startsWith('file:')
		|| realpathSync(resolve(appDir, dependency.slice(5))) !== realpathSync(artifact.tarballPath)) {
		throw new Error(`Client ${appDir} does not reference the selected archive.`);
	}
	const installedPath = join(appDir, 'node_modules/@beeblock/svelar');
	if (!lstatSync(installedPath).isDirectory()) throw new Error('Installed artifact must not be a linked repository package.');
	const installed = JSON.parse(readFileSync(join(installedPath, 'package.json'), 'utf8'));
	if (installed.name !== artifact.manifest.name || installed.version !== artifact.manifest.version) throw new Error('Installed client artifact identity/version mismatch.');
	const lock = JSON.parse(readFileSync(join(appDir, 'package-lock.json'), 'utf8'));
	const expected = `sha512-${createHash('sha512').update(readFileSync(artifact.tarballPath)).digest('base64')}`;
	if (lock.packages?.['node_modules/@beeblock/svelar']?.integrity !== expected) throw new Error('Installed client lock integrity does not match the selected artifact bytes.');
}

export function certificationPlan(options, artifact, reportDirectory, applicationRoot = appsRoot) {
	if (!/^[a-f0-9]{64}$/.test(artifact.sha256 ?? '')) throw new Error('Certification plan requires the selected artifact SHA256.');
	const client = join(applicationRoot, 'svelar-smoke-ddd');
	const valibot = join(applicationRoot, 'svelar-smoke-ddd-valibot');
	const node = (id, script, args, scope = 'artifact', extra = {}) => ({ id, scope, command: process.execPath, args: [join(scriptDir, script), ...args], ...extra });
	const smoke = (id, args) => node(id, 'release-smoke.mjs', [`--tarball=${artifact.tarballPath}`, ...args]);
	const gates = [
		{ id: 'core-unit', scope: 'source', command: 'npm', args: ['run', 'test', '-w', 'packages/svelar'] },
		{ id: 'security-audit', scope: 'source', command: 'npm', args: ['run', 'security:audit'] },
		{ id: 'artifact-publish-dry-run', scope: 'artifact', command: 'npm', args: ['publish', artifact.tarballPath, '--dry-run', '--ignore-scripts', '--tag=svelar-certification', '--json'] },
		smoke('fresh-new-cli-four', ['--app=all', '--validation=all', '--cli-execution', '--skip-cli-help', ...(!options.fast ? ['--browser', '--prod'] : [])]),
		{ id: 'operational-browser-fixtures', scope: 'source', command: process.execPath, args: ['--test', join(scriptDir, 'operational-browser-fixtures.test.mjs')] },
	];
	if (!options.fast) gates.push(
		node('auth-ui-zod', 'auth-ui-certification.mjs', ['--app-dir', client, '--phase', 'full', '--port', '5897', '--report-dir', join(reportDirectory, 'auth-ui-zod')], 'artifact', { client }),
		node('auth-ui-valibot', 'auth-ui-certification.mjs', ['--app-dir', valibot, '--phase', 'full', '--port', '5898', '--report-dir', join(reportDirectory, 'auth-ui-valibot')], 'artifact', { client: valibot }),
		node('ui-patterns', 'ui-pattern-certification.mjs', [`--clients=${join(client, 'package.json')}`, `--report-dir=${join(reportDirectory, 'ui-patterns')}`], 'artifact', { client }),
		node('invitation-ui-zod', 'invitation-ui-certification.mjs', [`--installed-app=${client}`, `--tarball=${artifact.tarballPath}`, `--report-dir=${join(reportDirectory, 'invitation-ui-zod')}`], 'artifact', { client }),
		node('invitation-ui-valibot', 'invitation-ui-certification.mjs', [`--installed-app=${valibot}`, `--tarball=${artifact.tarballPath}`, `--report-dir=${join(reportDirectory, 'invitation-ui-valibot')}`], 'artifact', { client: valibot }),
		node('populated-operations', 'browser-smoke.mjs', [`--app-dir=${client}`, '--server-script=smoke:serve:prod', '--operational-deep', `--expected-core-sha256=${artifact.sha256}`, '--port=5826', `--evidence-dir=${join(reportDirectory, 'populated-operations')}`], 'artifact', { client }),
	);
	gates.push(node('native-source-runtime', 'runtime-certification.mjs', [`--clients=${join(client, 'package.json')}`, `--report-dir=${join(reportDirectory, 'native-source-runtime')}`], 'source', { client }));
	if (options.million) gates.push({ id: 'million-search', scope: 'source', files: ['search-large-keyset.test.ts'], env: { SVELAR_TEST_SEARCH_MILLION: '1', SVELAR_TEST_SEARCH_LARGE_EVIDENCE_DIR: join(reportDirectory, 'million-search') } });
	if (options.typeDeps) gates.push({ id: 'operator-types', scope: 'source', files: ['dashboard-operational-types.test.ts'], env: { SVELAR_DASHBOARD_TYPE_DEPS: options.typeDeps } });
	gates.push(
		smoke('historical-upgrade-four', ['--app=all', '--validation=all', '--upgrade-from=0.7.9', '--skip-cli-help', '--skip-shadcn']),
		smoke('redis', ['--app=ddd', '--db=sqlite', '--redis', '--skip-shadcn', '--skip-build']),
		smoke('pdf', ['--app=ddd', '--db=sqlite', '--gotenberg', '--skip-shadcn', '--skip-build']),
		smoke('search', ['--app=ddd', '--db=sqlite', '--meilisearch', '--skip-shadcn', '--skip-build']),
		smoke('pgbouncer', ['--app=ddd', '--db=postgres', '--pgbouncer', '--skip-shadcn', '--skip-build']),
		smoke('s3', ['--app=ddd', '--db=sqlite', '--s3', '--skip-shadcn', '--skip-build']),
		smoke('database-drivers', ['--app=ddd', '--db=all', '--services', ...(!options.fast ? ['--browser', '--prod'] : [])]),
	);
	return gates;
}

function printInventory(cliCommands) {
	const commandGates = cliExecutionGates();
	console.log('\nSvelar release certification inventory');
	console.log('\nCLI commands:');
	for (const command of cliCommands) {
		console.log(`  - ${command}: ${commandGates[command]}`);
	}

	console.log('\nFeature gates:');
	for (const [feature, gate] of featureGates) {
		console.log(`  - ${feature}: ${gate}`);
	}
}

async function readBuiltinCommandNames() {
	const registryPath = join(repoRoot, 'packages/svelar/src/cli/BuiltinCommands.ts');
	const { builtinCommandNames } = await createJiti(import.meta.url).import(registryPath);
	const names = builtinCommandNames();

	const duplicates = names.filter((name, index) => names.indexOf(name) !== index);
	if (duplicates.length > 0) {
		throw new Error(`Duplicate CLI command names in registry: ${[...new Set(duplicates)].join(', ')}`);
	}

	return names;
}

export async function certifyRelease(options, { prepare = prepareSmokeArtifact, execute = runCommand,
	readNames = readBuiltinCommandNames, verifyClient = verifyInstalledArtifactClient, environment = process.env,
	applicationRoot = appsRoot, log = console.log } = {}) {
	let artifact;
	let report;
	let reportDirectory;
	let failure;
	const abort = new AbortController();
	const interrupt = () => abort.abort(new Error('Release certification interrupted.'));
	process.on('SIGINT', interrupt);
	process.on('SIGTERM', interrupt);
	const persist = () => {
		if (reportDirectory) writeFileSync(join(reportDirectory, 'manifest.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
	};
	try {
		if (options.help) {
			log('Usage: node scripts/certify-release.mjs [--tarball <archive> | --tarball=<archive>] [--fast] [--inventory] [--million] [--type-deps <node_modules>] [--report-dir <directory>]\nDefault: build/pack core ONCE, then certify the exact archive. --tarball never builds/packs core. --fast omits browser gates, not source/native or installed checks. Optional million/type gates fail on skips. Native runtime tests SOURCE using installed clients, not immutable core.');
		} else if (options.inventory && !options.tarball) {
			const names = await readNames(); verifyCommandInventory(names); printInventory(names);
		} else {
			// Invalid supplied archives and missing opt-in prerequisites fail before any gate or app mutation.
			if (options.typeDeps) validateTypeDependencies(options.typeDeps);
			artifact = selectCertificationArtifact(options.tarball, prepare);
			verifySmokeArtifact(artifact);
			verifyCommandInventory(artifact.commandNames);
			printInventory(artifact.commandNames);
			log(`Selected @beeblock/svelar@${artifact.manifest.version}; sha256 ${artifact.sha256}; ${artifact.tarballPath}`);
			if (!options.inventory) {
				reportDirectory = join(options.reportDir, randomUUID());
				mkdirSync(reportDirectory, { recursive: true });
				const gates = certificationPlan(options, artifact, reportDirectory, applicationRoot);
				report = { status: 'running', mode: options.fast ? 'fast-without-browser' : 'full', startedAt: new Date().toISOString(),
					artifact: { name: artifact.manifest.name, version: artifact.manifest.version, sha256: artifact.sha256, path: artifact.tarballPath },
					sourceRuntime: { enabled: true, immutableArtifactProof: false },
					optional: { million: options.million, typeDeps: options.typeDeps ?? null },
					gates: gates.map(({ id, scope }) => ({ id, scope, status: 'not-run' })) };
				persist();
				const env = { ...environment };
				delete env.SVELAR_TEST_SEARCH_MILLION;
				delete env.SVELAR_DASHBOARD_TYPE_DEPS;
				for (const [index, gate] of gates.entries()) {
					abort.signal.throwIfAborted();
					verifySmokeArtifact(artifact);
					const record = report.gates[index];
					record.status = 'running'; persist();
					try {
						if (gate.client) verifyClient(gate.client, artifact);
						log(`\n[${gate.scope}] ${gate.id}`);
						if (gate.files) {
							const directory = join(reportDirectory, gate.id); mkdirSync(directory);
							record.result = await runNativeGate({ name: gate.id, files: gate.files }, {
								cwd: coreRoot, env: { ...env, ...gate.env }, signal: abort.signal, timeoutMs: 360000,
								temporaryDirectory: artifact.extractionRoot, reportDirectory: directory, vitest: join(repoRoot, 'node_modules/vitest/vitest.mjs'),
							}, execute);
						} else {
							log(`$ ${gate.command} ${gate.args.join(' ')}`);
							await execute(gate.command, gate.args, { cwd: repoRoot, env, signal: abort.signal, timeoutMs: 10800000, stream: true, maxBytes: 64 * 1024 * 1024 });
						}
						verifySmokeArtifact(artifact);
						record.status = 'passed'; persist();
					} catch (error) { record.status = 'failed'; record.error = redactEvidence(error.message ?? String(error)); throw error; }
				}
				report.status = 'passed';
			}
		}
	} catch (error) { failure = error; if (report) { report.status = 'failed'; report.error = redactEvidence(error.message ?? String(error)); } }
	finally {
		process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt);
		try { artifact?.cleanup(); if (report) report.cleanup = 'completed'; }
		catch (error) { failure = failure ? new AggregateError([failure, error], 'Certification and artifact cleanup failed.') : error; if (report) { report.status = 'failed'; report.cleanup = 'failed'; } }
		try { if (report) { report.finishedAt = new Date().toISOString(); persist(); } }
		catch (error) { failure = failure ? new AggregateError([failure, error], 'Certification evidence could not be preserved.') : error; }
	}
	if (failure) throw failure;
	if (report) log(`\nRelease certification passed (${report.mode}). Evidence: ${reportDirectory}`);
	return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	try { await certifyRelease(parseCertificationOptions(process.argv.slice(2))); }
	catch (error) { console.error(redactEvidence(error.stack ?? String(error))); process.exitCode = 1; }
}
