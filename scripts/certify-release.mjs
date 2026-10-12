#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = new Set(process.argv.slice(2));
const fast = args.has('--fast');
const inventoryOnly = args.has('--inventory') || args.has('--list');

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const cliCommands = readBuiltinCommandNames();

const featureGates = [
	['CLI command parser/help', 'packages/svelar/tests/cli-command.test.ts'],
	['Every built-in CLI command is registered and has help output', 'packages/svelar/tests/cli-command.test.ts + npm run certify:inventory'],
	['CLI generators', 'packages/svelar/tests/cli-make-commands.test.ts + generated-app certification'],
	['Fresh app creation from packed package', 'npm run smoke:ddd + npm run smoke:flat'],
	['Existing app scaffold upgrade safety', 'npm run smoke:ddd + npx svelar update --dry-run/--force certification'],
	['Migrations/seeders/schema builder', 'packages/svelar/tests/database.test.ts + npm run smoke:db'],
	['SQLite/PostgreSQL/MySQL portability', 'npm run smoke:db'],
	['Production adapter-node browser flow', 'npm run smoke:db:prod'],
	['Package publish dry-run for @beeblock/svelar and npx svelar', 'npm run release:dry-run'],
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
	['API key create/validate/revoke/rotate and Bearer auth fallback', 'packages/svelar/tests/api-keys.test.ts + generated-app certification'],
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

if (args.has('--help') || args.has('-h')) {
	console.log(`Usage: node scripts/certify-release.mjs [options]

Options:
  --fast       Run unit tests and DB smoke without production browser checks.
  --inventory  Print the certification inventory without running checks.
`);
	process.exit(0);
}

printInventory();

if (inventoryOnly) {
	process.exit(0);
}

run('npm', ['run', 'test', '-w', 'packages/svelar']);
run('npm', ['run', 'security:audit']);
run('npm', ['run', 'release:dry-run']);
run('npm', ['run', 'smoke:redis']);
run('npm', ['run', 'smoke:pdf']);
run('npm', ['run', 'smoke:search']);
run('npm', ['run', 'smoke:pgbouncer']);
run('npm', ['run', 'smoke:s3']);
run('npm', ['run', fast ? 'smoke:db' : 'smoke:db:prod']);

console.log('\nRelease certification checks passed.');

function printInventory() {
	console.log('\nSvelar release certification inventory');
	console.log('\nCLI commands:');
	for (const command of cliCommands) {
		console.log(`  - ${command}`);
	}

	console.log('\nFeature gates:');
	for (const [feature, gate] of featureGates) {
		console.log(`  - ${feature}: ${gate}`);
	}
}

function run(command, commandArgs) {
	console.log(`\n$ ${command} ${commandArgs.join(' ')}`);
	const result = spawnSync(command, commandArgs, {
		stdio: 'inherit',
		env: process.env,
	});

	if (result.status !== 0) {
		process.exit(result.status ?? 1);
	}
}

function readBuiltinCommandNames() {
	const registryPath = join(repoRoot, 'packages/svelar/src/cli/BuiltinCommands.ts');
	const source = readFileSync(registryPath, 'utf8');
	const match = source.match(/export const BUILTIN_COMMANDS[\s\S]*?=\s*\[([\s\S]*?)\];/);
	if (!match) {
		throw new Error(`Could not read built-in command registry from ${registryPath}`);
	}

	const commandClasses = [...match[1].matchAll(/\b([A-Z]\w+Command)\b/g)].map((item) => item[1]);
	const names = commandClasses.map((className) => {
		const commandPath = join(repoRoot, 'packages/svelar/src/cli/commands', `${className}.ts`);
		const commandSource = readFileSync(commandPath, 'utf8');
		const name = commandSource.match(/\bname\s*=\s*['"]([^'"]+)['"]/);
		if (!name) {
			throw new Error(`Could not read CLI command name from ${commandPath}`);
		}
		return name[1];
	});

	const duplicates = names.filter((name, index) => names.indexOf(name) !== index);
	if (duplicates.length > 0) {
		throw new Error(`Duplicate CLI command names in registry: ${[...new Set(duplicates)].join(', ')}`);
	}

	return names;
}
