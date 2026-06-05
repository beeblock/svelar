#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const args = new Set(process.argv.slice(2));
const fast = args.has('--fast');
const inventoryOnly = args.has('--inventory') || args.has('--list');

const cliCommands = [
	'new',
	'update',
	'key:generate',
	'make:model',
	'make:migration',
	'make:controller',
	'make:middleware',
	'make:provider',
	'make:seeder',
	'make:service',
	'make:repository',
	'make:action',
	'make:request',
	'make:resource',
	'make:schema',
	'make:plugin',
	'make:task',
	'make:job',
	'make:command',
	'make:config',
	'make:channel',
	'make:docker',
	'make:ci',
	'make:infra',
	'infra:setup',
	'make:deploy',
	'make:broadcasting',
	'make:dashboard',
	'make:test',
	'make:factory',
	'make:observer',
	'make:event',
	'make:listener',
	'make:route',
	'routes:list',
	'migrate',
	'seed:run',
	'schedule:run',
	'queue:work',
	'queue:failed',
	'queue:retry',
	'queue:flush',
	'tinker',
	'plugin:list',
	'plugin:publish',
	'plugin:install',
	'dev:up',
	'dev:down',
	'dev:logs',
	'dev:restart',
	'prod:up',
	'prod:down',
	'prod:logs',
	'prod:restart',
	'prod:deploy',
];

const featureGates = [
	['CLI command parser/help', 'packages/svelar/tests/cli-command.test.ts'],
	['CLI generators', 'packages/svelar/tests/cli-make-commands.test.ts + generated-app certification'],
	['Migrations/seeders/schema builder', 'packages/svelar/tests/database.test.ts + npm run smoke:db'],
	['SQLite/PostgreSQL/MySQL portability', 'npm run smoke:db'],
	['Production adapter-node browser flow', 'npm run smoke:db:prod'],
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
	['Teams roles/members/invitations', 'packages/svelar/tests/teams.test.ts + generated-app certification'],
	['Broadcasting SSE public/private/presence', 'generated-app certification + browser smoke'],
	['Notifications email/database/custom channels', 'packages/svelar/tests/notifications.test.ts + generated-app certification'],
	['Scheduler locks/tasks', 'packages/svelar/tests/scheduler-lock.test.ts + generated app build'],
	['Logging/LogViewer/errors', 'packages/svelar/tests/logging.test.ts + packages/svelar/tests/errors.test.ts + generated-app certification'],
	['Storage/cache/config/container/services', 'package unit tests'],
	['Mail transports', 'packages/svelar/tests/mail.test.ts + generated-app certification'],
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
