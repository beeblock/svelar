import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// These run against the installed tarball, so exports, discovery and emitted files
// are exercised together instead of calling source command handlers directly.
export const generatorCommands = [
	['make:entity', 'CliRecord', '--module=cli-checks', '--fields=title:string,priority:integer,active:boolean', '--crud', '--public'],
	['make:entity', 'CliDraft', '--module=cli-drafts', '--fields=title:string', '--public'],
	['make:model', 'CliProbe', '--module=cli-probes'],
	['make:model', 'CliFullModel', '--module=cli-full-models', '--all', '--public'],
	['make:schema', 'cli-probe', '--module=cli-probes'],
	['make:dto', 'CreateCliProbe', '--module=cli-probes', '--schema=cli-probe', '--input=CreateCliProbeInput'],
	['make:request', 'CreateCliProbe', '--module=cli-probes'],
	['make:action', 'ProcessCliProbe', '--module=cli-probes', '--dto', '--request', '--schema'],
	['make:controller', 'CliProbe', '--module=cli-probes', '--public'],
	['make:controller', 'CliResourceController', '--module=cli-resource-models', '--model=CliResourceModel', '--resource', '--public'],
	['make:service', 'CliProbe', '--module=cli-probes', '--model=CliProbe', '--crud'],
	['make:repository', 'CliProbe', '--module=cli-probes', '--model=CliProbe'],
	['make:resource', 'CliProbe', '--module=cli-probes', '--model=CliProbe', '--collection'],
	['make:observer', 'CliProbeObserver', '--module=cli-probes', '--model=CliProbe'],
	['make:event', 'CliProbeSaved', '--module=cli-probes'],
	['make:listener', 'HandleCliProbeSaved', '--module=cli-probes', '--event=CliProbeSaved'],
	['make:factory', 'CliProbe', '--model=CliProbe', '--module=cli-probes'],
	['make:route', 'cli-probes', '--api', '--controller=CliProbeController', '--module=cli-probes', '--public'],
	['make:migration', 'create_cli_markers_table'],
	['make:seeder', 'CliProbe'],
	['make:job', 'CliProbeJob'],
	['make:task', 'CliProbeTask'],
	['make:middleware', 'CliProbeMiddleware'],
	['make:provider', 'CliProbeProvider'],
	['make:command', 'CliProbe', '--command=cli:probe'],
	['make:config', 'cli-probes'],
	['make:channel', 'CliProbe'],
	['make:plugin', 'CliProbePlugin'],
	['make:test', 'CliProbe'],
	['make:test', 'CliProbeFeature', '--feature'],
	['make:test', 'CliProbeBrowser', '--e2e'],
	['make:broadcasting', '--sse'],
	['make:dashboard', '--public'],
	['make:ui', 'all'],
	['make:docker', '--db=sqlite'],
	['make:ci'],
	['make:infra'],
	['make:deploy', '--db=sqlite'],
];

export const runtimeCommands = [
	['migrate', '--status'], ['seed:run', '--class=CliProbeSeeder'], ['routes:list', '--json'],
	['schedule:run', '--once'], ['schedule:work', '--once'], ['schedule:list', '--json'], ['deploy:migrate', '--check'], ['queue:work', '--once'], ['queue:failed'],
	['queue:retry', '--all'], ['queue:flush'], ['plugin:list'],
	['cli:probe', '--dry-run'], ['key:generate', '--show'], ['lint:architecture', '--json'],
];

export function cliExecutionGates() {
	return {
		...Object.fromEntries(generatorCommands.map(([name]) => [name, 'installed generator + app type check'])),
		...Object.fromEntries(runtimeCommands.filter(([name]) => name !== 'cli:probe').map(([name]) => [name, 'installed runtime command'])),
		new: 'packed scaffold across DDD/flat and Zod/Valibot',
		update: 'packed scaffold update and published-baseline upgrade',
		tinker: 'installed REPL with model loading',
		'search:setup': 'cli-search-setup.test.ts + Meilisearch smoke',
		'plugin:install': 'cli-plugin-commands.test.ts (isolated installer)',
		'plugin:publish': 'cli-plugin-commands.test.ts (isolated publisher)',
		'infra:setup': 'cli-deployment.test.ts (isolated SSH process)',
		...Object.fromEntries(['dev:up', 'dev:down', 'dev:logs', 'dev:restart',
			'prod:up', 'prod:down', 'prod:logs', 'prod:restart', 'prod:deploy']
			.map((name) => [name, 'cli-deployment.test.ts (isolated Docker process)'])),
	};
}

export function certifyGenerators(appDir, env = {}) {
	for (const command of generatorCommands) runCli(appDir, command, env);
	const ddd = existsSync(join(appDir, 'src/lib/modules'));
	const controllerPath = ddd
		? 'src/lib/modules/cli-probes/interface/http/controllers/CliProbeController.ts'
		: 'src/lib/controllers/CliProbeController.ts';
	for (const path of [controllerPath, 'src/lib/factories/CliProbeFactory.ts', 'src/routes/api/cli-probes/+server.ts',
		'tests/unit/CliProbe.test.ts', 'tests/feature/CliProbeFeature.test.ts', 'tests/e2e/CliProbeBrowser.spec.ts',
		'Dockerfile', 'docker-compose.yml', '.github/workflows/deploy.yml', 'infra/setup-droplet.sh']) {
		if (!existsSync(join(appDir, path))) throw new Error(`CLI certification: missing generated ${path}`);
	}
	const factory = readFileSync(join(appDir, 'src/lib/factories/CliProbeFactory.ts'), 'utf8');
	const expectedImport = ddd ? '$lib/modules/cli-probes/domain/models/CliProbe.js' : '$lib/models/CliProbe.js';
	if (!factory.includes(expectedImport)) throw new Error('CLI certification: factory model import is incorrect');
	const migrations = readdirSync(join(appDir, 'src/lib/database/migrations'));
	if (!migrations.some((file) => file.endsWith('_create_cli_markers_table.ts'))) {
		throw new Error('CLI certification: make:migration did not create its table migration');
	}
}

export function certifyRuntimeCommands(appDir, env = {}) {
	for (const command of runtimeCommands) runCli(appDir, command, env);
	const result = runCli(appDir, ['tinker'], env, 'console.log("CLI_TINKER_OK", typeof CliProbe);\n.exit\n');
	if (!result.stdout.includes('CLI_TINKER_OK function')) throw new Error('Tinker did not preload the generated model');
	const cliPath = join(appDir, 'node_modules/@beeblock/svelar/dist/cli/bin.js');
	const failure = spawnSync(process.execPath, [cliPath, 'make:model'], {
		cwd: appDir, encoding: 'utf8', env: { ...process.env, ...env }, timeout: 30_000,
	});
	if (failure.status === 0 || !failure.stderr.includes('Please provide a model name')) {
		throw new Error('CLI certification: invalid invocation did not report a nonzero failure');
	}
}

function runCli(appDir, args, env, input) {
	console.log(`$ svelar ${args.join(' ')}`);
	const result = spawnSync(process.execPath, [join(appDir, 'node_modules/@beeblock/svelar/dist/cli/bin.js'), ...args], {
		cwd: appDir, encoding: 'utf8', env: { ...process.env, ...env }, input,
		timeout: 60_000, maxBuffer: 8 * 1024 * 1024,
	});
	recordVerificationStep(appDir, `svelar ${args.join(' ')}`, result.status === 0 && !result.error);
	if (result.status !== 0 || result.error) {
		throw new Error(`CLI ${args[0]} failed (${result.status}): ${result.error?.message ?? ''}\n${result.stdout}\n${result.stderr}`);
	}
	return result;
}

export function recordVerificationStep(appDir, command, success) {
	const directory = join(appDir, 'docs');
	mkdirSync(directory, { recursive: true });
	const path = join(directory, 'certification-timeline.md');
	if (!existsSync(path)) appendFileSync(path, '# Local Certification Timeline\n\n');
	appendFileSync(path, `- ${new Date().toISOString()} | ${success ? 'PASS' : 'FAIL'} | \`${command}\`\n`);
}
