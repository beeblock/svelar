#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const corePackageRoot = join(repoRoot, 'packages/svelar');
const testingRoot = resolve(repoRoot, '../svelar-testing-area');
const appsRoot = join(testingRoot, 'apps');
const artifactsRoot = join(testingRoot, '.artifacts');
const dockerConfigRoot = join(testingRoot, '.docker-config');

const args = new Set(process.argv.slice(2));
const appArg = valueFor('--app') ?? 'all';
const dbArg = valueFor('--db') ?? 'sqlite';
const useServices = args.has('--services') || args.has('--docker-services');
const skipInstall = args.has('--skip-install');
const skipShadcn = args.has('--skip-shadcn');
const skipMigrate = args.has('--skip-migrate');
const skipTests = args.has('--skip-tests');
const skipBuild = args.has('--skip-build');
const runBrowser = args.has('--browser');
const productionServer = args.has('--prod') || args.has('--production');
const headed = args.has('--headed');
const slowMo = valueFor('--slow-mo');
const keepExisting = args.has('--keep-existing');

if (args.has('--help') || args.has('-h')) {
	console.log(`Usage: node scripts/release-smoke.mjs [options]

Options:
  --app all|ddd|flat      Which scaffold shape to test. Default: all.
  --db sqlite|postgres|mysql|all
                         Which database driver to test. Default: sqlite.
  --services             Start Docker services with random host ports for postgres/mysql.
  --keep-existing        Do not delete existing generated app folders.
  --skip-install         Scaffold only; skip npm install and later checks.
  --skip-shadcn          Skip shadcn-svelte component generation.
  --skip-migrate         Skip migrations and seeders.
  --skip-tests           Skip generated app tests.
  --skip-build           Skip generated app production build.
  --browser              Run real browser smoke after app checks.
  --prod                 When used with --browser, test the adapter-node production server.
  --headed               Open a visible Chromium window for browser smoke.
  --slow-mo <ms>         Delay browser actions during browser smoke.
`);
	process.exit(0);
}

if (!['all', 'ddd', 'flat'].includes(appArg)) {
	fail(`Invalid --app value "${appArg}". Use all, ddd, or flat.`);
}
if (!['all', 'sqlite', 'postgres', 'mysql'].includes(dbArg)) {
	fail(`Invalid --db value "${dbArg}". Use all, sqlite, postgres, or mysql.`);
}
if (productionServer && skipBuild) {
	fail('--prod requires a production build. Remove --skip-build.');
}

class SmokeServices {
	containers = [];
	suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

	async envFor(driver) {
		if (driver === 'postgres') {
			const service = await this.startPostgres();
			return {
				DB_DRIVER: 'postgres',
				DB_HOST: '127.0.0.1',
				DB_PORT: String(service.port),
				DB_NAME: 'svelar_db',
				DB_USER: 'svelar',
				DB_PASSWORD: 'secret',
				QUEUE_DRIVER: process.env.QUEUE_DRIVER ?? 'sync',
			};
		}
		if (driver === 'mysql') {
			const service = await this.startMysql();
			return {
				DB_DRIVER: 'mysql',
				DB_HOST: '127.0.0.1',
				DB_PORT: String(service.port),
				DB_NAME: 'svelar_db',
				DB_USER: 'svelar',
				DB_PASSWORD: 'secret',
				QUEUE_DRIVER: process.env.QUEUE_DRIVER ?? 'sync',
			};
		}
		return databaseEnv(driver);
	}

	async startPostgres() {
		const name = `svelar-smoke-postgres-${this.suffix}`;
		const id = docker([
			'run',
			'-d',
			'--rm',
			'--name',
			name,
			'-e',
			'POSTGRES_DB=svelar_db',
			'-e',
			'POSTGRES_USER=svelar',
			'-e',
			'POSTGRES_PASSWORD=secret',
			'-p',
			'127.0.0.1::5432',
			'postgres:17-alpine',
		]).trim();
		this.containers.push(name);
		const port = publishedPort(name, '5432/tcp');
		await waitForDocker(name, ['pg_isready', '-U', 'svelar', '-d', 'svelar_db']);
		console.log(`PostgreSQL ${id.slice(0, 12)} ready on 127.0.0.1:${port}`);
		return { name, port };
	}

	async startMysql() {
		const name = `svelar-smoke-mysql-${this.suffix}`;
		const id = docker([
			'run',
			'-d',
			'--rm',
			'--name',
			name,
			'-e',
			'MYSQL_DATABASE=svelar_db',
			'-e',
			'MYSQL_USER=svelar',
			'-e',
			'MYSQL_PASSWORD=secret',
			'-e',
			'MYSQL_ROOT_PASSWORD=rootsecret',
			'-p',
			'127.0.0.1::3306',
			'mysql:8.0',
		]).trim();
		this.containers.push(name);
		const port = publishedPort(name, '3306/tcp');
		await waitForDocker(name, ['mysqladmin', 'ping', '-h', '127.0.0.1', '-uroot', '-prootsecret']);
		console.log(`MySQL ${id.slice(0, 12)} ready on 127.0.0.1:${port}`);
		return { name, port };
	}

	stop() {
		for (const name of this.containers.reverse()) {
			spawnSync('docker', ['stop', name], {
				env: dockerEnv(),
				stdio: 'ignore',
				timeout: 30_000,
				killSignal: 'SIGKILL',
			});
		}
	}
}

mkdirSync(appsRoot, { recursive: true });
mkdirSync(artifactsRoot, { recursive: true });

const services = new SmokeServices();

try {
	section('Building local @beeblock/svelar');
	run('npm', ['run', 'build', '-w', 'packages/svelar'], { cwd: repoRoot });

	section('Packing local @beeblock/svelar');
	const tarballPath = packLocalCore();
	console.log(`Packed ${tarballPath}`);

	const targets = buildTargets(appArg, dbArg);

	for (const target of targets) {
		if (useServices && target.db !== 'sqlite') {
			target.env = await services.envFor(target.db);
		} else {
			target.env = databaseEnv(target.db);
		}
		smokeApp(target, tarballPath);
	}

	section('Smoke complete');
	console.log(`Generated apps are in ${appsRoot}`);
} finally {
	services.stop();
}

function smokeApp(target, tarballPath) {
	const appDir = join(appsRoot, target.name);
	const env = target.env ?? {};

	section(`Scaffolding ${target.name}`);
	if (existsSync(appDir) && !keepExisting) {
		rmSync(appDir, { recursive: true, force: true });
	}
	if (existsSync(appDir)) {
		console.log(`Reusing existing app directory: ${appDir}`);
	} else {
		const cliPath = join(corePackageRoot, 'dist/cli/bin.js');
		const scaffoldArgs = [cliPath, 'new', target.name, '--no-install'];
		if (target.flat) scaffoldArgs.push('--flat');
		run(process.execPath, scaffoldArgs, { cwd: appsRoot });
	}

	patchAppPackage(appDir, tarballPath, target.port);

	if (skipInstall) return;

	section(`Installing ${target.name}`);
	run('npm', ['install'], { cwd: appDir });

	if (!skipShadcn) {
		section(`Installing UI components for ${target.name}`);
		run('npm', ['run', 'ui:install'], { cwd: appDir });
	}

	if (!skipMigrate) {
		section(`Migrating ${target.name}`);
		run('npx', ['svelar', 'migrate'], { cwd: appDir, env });
		run('npx', ['svelar', 'seed:run'], { cwd: appDir, env });
	}

	if (!skipTests) {
		section(`Testing ${target.name}`);
		run('npm', ['run', 'test'], { cwd: appDir, env });
	}

	if (!skipBuild) {
		section(`Building ${target.name}`);
		run('npm', ['run', 'build'], { cwd: appDir, env });
	}

	if (runBrowser) {
		section(`Browser smoke ${target.name}`);
		const browserArgs = [
			join(repoRoot, 'scripts/browser-smoke.mjs'),
			'--app-dir',
			appDir,
			'--port',
			String(target.port),
		];
		if (productionServer) browserArgs.push('--server-script', 'smoke:serve:prod');
		if (headed) browserArgs.push('--headed');
		if (slowMo) browserArgs.push('--slow-mo', slowMo);
		run(process.execPath, browserArgs, { env });
	}
}

function buildTargets(app, db) {
	const appTargets =
		app === 'all'
			? [
					{ key: 'ddd', flat: false, port: 5179 },
					{ key: 'flat', flat: true, port: 5180 },
				]
			: [{ key: app, flat: app === 'flat', port: app === 'flat' ? 5180 : 5179 }];
	const dbTargets = db === 'all' ? ['sqlite', 'postgres', 'mysql'] : [db];
	const targets = [];

	for (const dbName of dbTargets) {
		for (const appTarget of appTargets) {
			const nameSuffix = dbName === 'sqlite' ? appTarget.key : `${appTarget.key}-${dbName}`;
			const dbOffset = dbName === 'postgres' ? 10 : dbName === 'mysql' ? 20 : 0;
			targets.push({
				name: `svelar-smoke-${nameSuffix}`,
				flat: appTarget.flat,
				db: dbName,
				port: appTarget.port + dbOffset,
			});
		}
	}

	return targets;
}

function databaseEnv(driver) {
	if (driver === 'sqlite') {
		return {
			DB_DRIVER: 'sqlite',
			DB_PATH: 'database.db',
			QUEUE_DRIVER: process.env.QUEUE_DRIVER ?? 'sync',
		};
	}
	return {
		DB_DRIVER: driver,
		DB_HOST: process.env.DB_HOST ?? '127.0.0.1',
		DB_PORT: process.env.DB_PORT,
		DB_NAME: process.env.DB_NAME ?? 'svelar_db',
		DB_USER: process.env.DB_USER ?? (driver === 'mysql' ? 'root' : 'postgres'),
		DB_PASSWORD: process.env.DB_PASSWORD ?? 'secret',
		QUEUE_DRIVER: process.env.QUEUE_DRIVER ?? 'sync',
	};
}

function packLocalCore() {
	rmSync(artifactsRoot, { recursive: true, force: true });
	mkdirSync(artifactsRoot, { recursive: true });

	const result = spawnSync('npm', ['pack', '--pack-destination', artifactsRoot], {
		cwd: corePackageRoot,
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'inherit'],
	});

	if (result.status !== 0) {
		fail(`npm pack failed with exit code ${result.status ?? 'unknown'}`);
	}

	const tarballName = result.stdout
		.split(/\r?\n/)
		.map((line) => line.trim())
		.findLast((line) => line.endsWith('.tgz'));

	if (!tarballName) {
		fail('Could not find npm pack tarball name in npm output.');
	}

	const tarballPath = join(artifactsRoot, tarballName);
	const uniqueTarballPath = join(
		artifactsRoot,
		tarballName.replace(/\.tgz$/, `-${Date.now()}.tgz`)
	);
	renameSync(tarballPath, uniqueTarballPath);
	return uniqueTarballPath;
}

function patchAppPackage(appDir, tarballPath, port) {
	const packagePath = join(appDir, 'package.json');
	const pkg = JSON.parse(readFileSync(packagePath, 'utf8'));
	const localTarball = relative(appDir, tarballPath).replaceAll('\\', '/');

	pkg.dependencies ??= {};
	pkg.scripts ??= {};
	pkg.dependencies['@beeblock/svelar'] = `file:${localTarball}`;
	pkg.scripts['smoke:serve'] = `vite dev --host 127.0.0.1 --port ${port}`;
	pkg.scripts['smoke:serve:prod'] = 'node build';

	writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
	rmSync(join(appDir, 'node_modules', '@beeblock', 'svelar'), { recursive: true, force: true });
}

function run(command, commandArgs, options = {}) {
	console.log(`$ ${command} ${commandArgs.join(' ')}`);
	const result = spawnSync(command, commandArgs, {
		cwd: options.cwd ?? testingRoot,
		env: { ...process.env, ...(options.env ?? {}) },
		stdio: 'inherit',
	});

	if (result.status !== 0) {
		fail(`${command} ${commandArgs.join(' ')} failed with exit code ${result.status ?? 'unknown'}`);
	}
}

function section(title) {
	console.log(`\n==> ${title}`);
}

function fail(message) {
	console.error(`\nSmoke failed: ${message}`);
	process.exit(1);
}

function valueFor(name) {
	const argv = process.argv.slice(2);
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === name) return argv[i + 1];
		if (arg.startsWith(`${name}=`)) return arg.slice(name.length + 1);
	}
	return undefined;
}

function docker(commandArgs) {
	const result = spawnSync('docker', commandArgs, {
		cwd: testingRoot,
		encoding: 'utf8',
		env: dockerEnv(),
		stdio: ['ignore', 'pipe', 'pipe'],
		timeout: 180_000,
		killSignal: 'SIGKILL',
	});
	if (result.error) {
		fail(`docker ${commandArgs.join(' ')} failed: ${result.error.message}`);
	}
	if (result.status !== 0) {
		fail(`docker ${commandArgs.join(' ')} failed: ${result.stderr.trim()}`);
	}
	return result.stdout;
}

function dockerEnv() {
	mkdirSync(dockerConfigRoot, { recursive: true });
	const configPath = join(dockerConfigRoot, 'config.json');
	if (!existsSync(configPath)) {
		writeFileSync(configPath, '{}\n');
	}
	return {
		...process.env,
		DOCKER_CONFIG: dockerConfigRoot,
	};
}

function publishedPort(container, privatePort) {
	const output = docker(['port', container, privatePort]).trim();
	const match = output.match(/:(\d+)$/);
	if (!match) fail(`Could not resolve published port for ${container} ${privatePort}`);
	return Number(match[1]);
}

async function waitForDocker(container, commandArgs) {
	const deadline = Date.now() + 90_000;
	while (Date.now() < deadline) {
		const result = spawnSync('docker', ['exec', container, ...commandArgs], {
			cwd: testingRoot,
			env: dockerEnv(),
			stdio: 'ignore',
			timeout: 10_000,
			killSignal: 'SIGKILL',
		});
		if (result.status === 0) return;
		await new Promise((resolve) => setTimeout(resolve, 1000));
	}
	fail(`Timed out waiting for Docker service ${container}`);
}
