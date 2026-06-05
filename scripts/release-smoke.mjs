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
const skipCertification = args.has('--skip-certification');
const runBrowser = args.has('--browser');
const productionServer = args.has('--prod') || args.has('--production');
const headed = args.has('--headed');
const slowMo = valueFor('--slow-mo');
const keepExisting = args.has('--keep-existing');
const useRedis = args.has('--redis');
const useGotenberg = args.has('--gotenberg');
const useMeilisearch = args.has('--meilisearch') || args.has('--meili');
const usePgBouncer = args.has('--pgbouncer') || args.has('--pg-stat-statements');
const useS3 = args.has('--s3') || args.has('--storage');

if (args.has('--help') || args.has('-h')) {
	console.log(`Usage: node scripts/release-smoke.mjs [options]

Options:
  --app all|ddd|flat      Which scaffold shape to test. Default: all.
  --db sqlite|postgres|mysql|all
                         Which database driver to test. Default: sqlite.
  --services             Start Docker services with random host ports for postgres/mysql.
	  --redis                Start Redis on a random host port and run Redis certification checks.
	  --gotenberg            Start Gotenberg on a random host port and run PDF service checks.
	  --meilisearch          Start Meilisearch on a random host port and run search checks.
	  --pgbouncer            Start PostgreSQL with pg_stat_statements behind PgBouncer.
	  --s3                   Start RustFS on a random host port and run S3 storage checks.
  --keep-existing        Do not delete existing generated app folders.
  --skip-install         Scaffold only; skip npm install and later checks.
  --skip-shadcn          Skip shadcn-svelte component generation.
  --skip-migrate         Skip migrations and seeders.
  --skip-tests           Skip generated app tests.
  --skip-build           Skip generated app production build.
  --skip-certification   Skip injected generated-app certification tests.
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
	networks = [];
	suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
		redisService;
		gotenbergService;
		meilisearchService;
		pgBouncerService;
		s3Service;

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

	async pgBouncerEnv() {
		if (!this.pgBouncerService) {
			this.pgBouncerService = await this.startPgBouncerStack();
		}

		return {
			DB_DRIVER: 'postgres',
			DB_HOST: '127.0.0.1',
			DB_PORT: String(this.pgBouncerService.port),
			DB_NAME: 'svelar_db',
			DB_USER: 'svelar',
			DB_PASSWORD: 'secret',
			DB_PREPARE: 'false',
			PGBOUNCER_CERTIFICATION: '1',
			PG_STAT_STATEMENTS: '1',
			QUEUE_DRIVER: process.env.QUEUE_DRIVER ?? 'sync',
		};
	}

	async startPgBouncerStack() {
		const network = `svelar-smoke-net-${this.suffix}`;
		docker(['network', 'create', network]);
		this.networks.push(network);

		const postgresName = `svelar-smoke-pgstat-${this.suffix}`;
		const postgresId = docker([
			'run',
			'-d',
			'--rm',
			'--name',
			postgresName,
			'--network',
			network,
			'-e',
			'POSTGRES_DB=svelar_db',
			'-e',
			'POSTGRES_USER=svelar',
			'-e',
			'POSTGRES_PASSWORD=secret',
			'postgres:17-alpine',
			'postgres',
			'-c',
			'shared_preload_libraries=pg_stat_statements',
			'-c',
			'pg_stat_statements.track=all',
			'-c',
			'pg_stat_statements.track_utility=on',
		]).trim();
		this.containers.push(postgresName);
		await waitForDocker(postgresName, ['pg_isready', '-U', 'svelar', '-d', 'svelar_db']);
		docker([
			'exec',
			postgresName,
			'psql',
			'-U',
			'svelar',
			'-d',
			'svelar_db',
			'-c',
			'CREATE EXTENSION IF NOT EXISTS pg_stat_statements',
		]);

		const pgbouncerName = `svelar-smoke-pgbouncer-${this.suffix}`;
		const pgbouncerId = docker([
			'run',
			'-d',
			'--rm',
			'--name',
			pgbouncerName,
			'--network',
			network,
			'-e',
			`DATABASE_URL=postgres://svelar:secret@${postgresName}:5432/svelar_db`,
			'-e',
			'LISTEN_PORT=6432',
			'-e',
			'AUTH_TYPE=plain',
			'-e',
			'POOL_MODE=transaction',
			'-e',
			'DEFAULT_POOL_SIZE=10',
			'-e',
			'MAX_CLIENT_CONN=100',
			'-p',
			'127.0.0.1::6432',
			'edoburu/pgbouncer:v1.25.1-p0',
		]).trim();
		this.containers.push(pgbouncerName);
		const port = publishedPort(pgbouncerName, '6432/tcp');
		await waitForDocker(postgresName, [
			'pg_isready',
			'-h',
			pgbouncerName,
			'-p',
			'6432',
			'-U',
			'svelar',
			'-d',
			'svelar_db',
		]);
		console.log(
			`PostgreSQL ${postgresId.slice(0, 12)} with PgBouncer ${pgbouncerId.slice(0, 12)} ready on 127.0.0.1:${port}`
		);
		return { postgresName, pgbouncerName, port };
	}

	async s3Env() {
		if (!this.s3Service) {
			this.s3Service = await this.startS3();
		}

		return {
			STORAGE_DISK: 's3',
			S3_ENDPOINT: `http://127.0.0.1:${this.s3Service.port}`,
			S3_ACCESS_KEY: this.s3Service.accessKey,
			S3_SECRET_KEY: this.s3Service.secretKey,
			S3_BUCKET: this.s3Service.bucket,
			S3_REGION: 'us-east-1',
			S3_CERTIFICATION: '1',
		};
	}

	async startS3() {
		const name = `svelar-smoke-rustfs-${this.suffix}`;
		const accessKey = 'svelar';
		const secretKey = 'svelarsecret';
		const bucket = `svelar-smoke-${this.suffix}`;
		const id = docker([
			'run',
			'-d',
			'--rm',
			'--name',
			name,
			'-e',
			`RUSTFS_ACCESS_KEY=${accessKey}`,
			'-e',
			`RUSTFS_SECRET_KEY=${secretKey}`,
			'-e',
			'RUSTFS_CONSOLE_ENABLE=true',
			'-e',
			'RUSTFS_ADDRESS=:9000',
			'-p',
			'127.0.0.1::9000',
			'rustfs/rustfs:latest',
			'/data',
		]).trim();
		this.containers.push(name);
		const port = publishedPort(name, '9000/tcp');
		await waitForHttpReachable(`http://127.0.0.1:${port}/`);
		console.log(`RustFS ${id.slice(0, 12)} ready on 127.0.0.1:${port}`);
		return { name, port, accessKey, secretKey, bucket };
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

	async redisEnv() {
		if (!this.redisService) {
			this.redisService = await this.startRedis();
		}

		return {
			REDIS_URL: `redis://127.0.0.1:${this.redisService.port}`,
			REDIS_HOST: '127.0.0.1',
			REDIS_PORT: String(this.redisService.port),
			CACHE_DRIVER: 'redis',
		};
	}

	async startRedis() {
		const name = `svelar-smoke-redis-${this.suffix}`;
		const id = docker([
			'run',
			'-d',
			'--rm',
			'--name',
			name,
			'-p',
			'127.0.0.1::6379',
			'redis:7-alpine',
		]).trim();
		this.containers.push(name);
		const port = publishedPort(name, '6379/tcp');
		await waitForDocker(name, ['redis-cli', 'ping']);
		console.log(`Redis ${id.slice(0, 12)} ready on 127.0.0.1:${port}`);
		return { name, port };
	}

	async gotenbergEnv() {
		if (!this.gotenbergService) {
			this.gotenbergService = await this.startGotenberg();
		}

		return {
			PDF_DRIVER: 'gotenberg',
			GOTENBERG_URL: `http://127.0.0.1:${this.gotenbergService.port}`,
			GOTENBERG_TIMEOUT: '60s',
		};
	}

		async startGotenberg() {
		const name = `svelar-smoke-gotenberg-${this.suffix}`;
		const id = docker([
			'run',
			'-d',
			'--rm',
			'--name',
			name,
			'-p',
			'127.0.0.1::3000',
			'gotenberg/gotenberg:8',
		]).trim();
		this.containers.push(name);
		const port = publishedPort(name, '3000/tcp');
		await waitForHttp(`http://127.0.0.1:${port}/health`);
		console.log(`Gotenberg ${id.slice(0, 12)} ready on 127.0.0.1:${port}`);
			return { name, port };
		}

		async meilisearchEnv() {
			if (!this.meilisearchService) {
				this.meilisearchService = await this.startMeilisearch();
			}

			return {
				MEILISEARCH_HOST: `http://127.0.0.1:${this.meilisearchService.port}`,
				MEILISEARCH_KEY: this.meilisearchService.key,
				MEILI_MASTER_KEY: this.meilisearchService.key,
			};
		}

		async startMeilisearch() {
			const name = `svelar-smoke-meilisearch-${this.suffix}`;
			const key = `svelar-smoke-master-key-${this.suffix}`;
			const id = docker([
				'run',
				'-d',
				'--rm',
				'--name',
				name,
				'-e',
				`MEILI_MASTER_KEY=${key}`,
				'-e',
				'MEILI_ENV=development',
				'-e',
				'MEILI_NO_ANALYTICS=true',
				'-p',
				'127.0.0.1::7700',
				'getmeili/meilisearch:v1.13',
			]).trim();
			this.containers.push(name);
			const port = publishedPort(name, '7700/tcp');
			await waitForHttp(`http://127.0.0.1:${port}/health`);
			console.log(`Meilisearch ${id.slice(0, 12)} ready on 127.0.0.1:${port}`);
			return { name, port, key };
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
		for (const name of this.networks.reverse()) {
			spawnSync('docker', ['network', 'rm', name], {
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
			const redisEnv = useRedis ? await services.redisEnv() : {};
			const gotenbergEnv = useGotenberg ? await services.gotenbergEnv() : {};
			const meilisearchEnv = useMeilisearch ? await services.meilisearchEnv() : {};
			const pgBouncerEnv = usePgBouncer ? await services.pgBouncerEnv() : {};
			const s3Env = useS3 ? await services.s3Env() : {};

			for (const target of targets) {
				if (usePgBouncer) {
					target.env = { ...pgBouncerEnv, ...redisEnv, ...gotenbergEnv, ...meilisearchEnv, ...s3Env };
				} else if (useServices && target.db !== 'sqlite') {
					target.env = { ...(await services.envFor(target.db)), ...redisEnv, ...gotenbergEnv, ...meilisearchEnv, ...s3Env };
				} else {
					target.env = { ...databaseEnv(target.db), ...redisEnv, ...gotenbergEnv, ...meilisearchEnv, ...s3Env };
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
	if (!target.flat && !skipCertification) {
		writeCertificationTest(appDir);
	}

	if (skipInstall) return;

	section(`Installing ${target.name}`);
	run('npm', ['install', '--no-audit', '--fund=false'], { cwd: appDir });

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
		if (!skipMigrate) {
			section(`Preparing browser database ${target.name}`);
			run('npx', ['svelar', 'migrate', '--refresh'], { cwd: appDir, env });
			run('npx', ['svelar', 'seed:run'], { cwd: appDir, env });
		}

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
	pkg.dependencies.bullmq ??= '^5.0.0';
	pkg.dependencies.ioredis ??= '^5.0.0';
	pkg.dependencies.meilisearch ??= '^0.44.0';
	pkg.scripts['smoke:serve'] = `vite dev --host 127.0.0.1 --port ${port}`;
	pkg.scripts['smoke:serve:prod'] = 'node build';

	writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
	rmSync(join(appDir, 'node_modules', '@beeblock', 'svelar'), { recursive: true, force: true });
}

function writeCertificationTest(appDir) {
	const testPath = join(appDir, 'tests', 'feature', 'svelar-certification.test.ts');
	writeFileSync(testPath, `${certificationTestSource()}\n`);
}

function certificationTestSource() {
		return `import { existsSync, readFileSync, rmSync } from 'node:fs';
		import { createHmac } from 'node:crypto';
		import { createServer } from 'node:http';
		import { join } from 'node:path';
	import { beforeAll, afterAll, describe, expect, it } from 'vitest';
	import Redis from 'ioredis';
	import { Broadcast } from '@beeblock/svelar/broadcasting';
	import { Cache } from '@beeblock/svelar/cache';
	import { Connection, Schema } from '@beeblock/svelar/database';
	import { ApiKeys } from '@beeblock/svelar/api-keys';
	import { AuthenticateMiddleware } from '@beeblock/svelar/auth';
	import { Event, EventServiceProvider } from '@beeblock/svelar/events';
	import { ErrorHandler, HttpError, ValidationError } from '@beeblock/svelar/errors';
		import { Log } from '@beeblock/svelar/logging';
		import { LogViewer } from '@beeblock/svelar/logging/LogViewer';
		import { Mailer, Mailable } from '@beeblock/svelar/mail';
		import { Notification, Notifier } from '@beeblock/svelar/notifications';
		import { HasUlids, HasUuids, Model, ModelObserver, QueryBuilder, SoftDeletes } from '@beeblock/svelar/orm';
	import { PDF, GeneratePdfJob } from '@beeblock/svelar/pdf';
	import { Search, Searchable } from '@beeblock/svelar/search';
	import { Storage } from '@beeblock/svelar/storage';
	import { Teams } from '@beeblock/svelar/teams';
	import { createRequestEvent, useSvelarTest } from '@beeblock/svelar/testing';
	import { Job, Queue } from '@beeblock/svelar/queue';
import { MiddlewareStack, RateLimitMiddleware, ThrottleMiddleware } from '@beeblock/svelar/middleware';
import { MemorySessionStore, RedisSessionStore, Session } from '@beeblock/svelar/session';
import { rules, z } from '@beeblock/svelar/validation';
import { User } from '../../src/lib/modules/auth/User.js';
import { Post } from '../../src/lib/modules/posts/Post.js';
import { PostController } from '../../src/lib/modules/posts/PostController.js';
import { PostRepository } from '../../src/lib/modules/posts/PostRepository.js';
import { PostResource } from '../../src/lib/modules/posts/PostResource.js';
import { PostService } from '../../src/lib/modules/posts/PostService.js';

beforeAll(async () => {
  process.env.APP_KEY ??= 'svelar-certification-app-key';
  process.env.JWT_SECRET ??= process.env.APP_KEY;
  await import('../../src/app.js');
});

afterAll(async () => {
  Event.flush();
  Post.removeObservers();
  await Queue.stop();
  await Connection.disconnect();
});

describe('Svelar release certification', () => {
  useSvelarTest({ refreshDatabase: true });

  it('runs the route/controller/request/action/service/repository/model/resource flow', async () => {
    const user = await User.create({
      name: 'Certification Admin',
      email: 'certification-admin@example.com',
      password: 'hashed-password',
      role: 'admin',
    });

    const controller = new PostController();
    const response = await controller.store(createRequestEvent({
      method: 'POST',
      url: 'http://localhost/api/posts',
      headers: { 'content-type': 'application/json' },
      body: {
        title: 'Certification Post',
        body: 'This post is created by the release certification suite.',
        published: true,
      },
      locals: { user: { id: user.id, role: user.role } },
    }));

    expect(response.status).toBe(201);
    const payload = await response.json();
    expect(payload.data).toMatchObject({
      title: 'Certification Post',
      slug: 'certification-post',
      published: true,
      user_id: user.id,
    });

    const repository = new PostRepository();
    const service = new PostService();
    const persisted = await repository.findBySlug('certification-post');
    expect(persisted?.title).toBe('Certification Post');
    expect(await service.findByUser(user.id)).toHaveLength(1);
    expect((await service.findPublished()).map((post: any) => post.slug)).toContain('certification-post');

    const resource = await PostResource.make(persisted).toObject();
    expect(resource.data.slug).toBe('certification-post');
  });

	  it('runs complex query builder paths across the configured database driver', async () => {
    const user = await User.create({
      name: 'Query User',
      email: 'query-user@example.com',
      password: 'hashed-password',
      role: 'user',
    });

    await Post.create({
      title: 'Alpha Certification Query',
      slug: 'alpha-certification-query',
      body: 'Alpha body for query certification.',
      published: true,
      user_id: user.id,
    });
    await Post.create({
      title: 'Beta Certification Query',
      slug: 'beta-certification-query',
      body: 'Beta body for query certification.',
      published: false,
      user_id: user.id,
    });

    const rows = await Post.query()
      .select('posts.*')
      .join('users', 'users.id', '=', 'posts.user_id')
      .where('users.email', 'query-user@example.com')
      .whereNested((query) => {
        query.where('posts.published', true).orWhere('posts.slug', 'beta-certification-query');
      })
      .whereIn('posts.slug', ['alpha-certification-query', 'beta-certification-query'])
      .orderBy('posts.slug', 'asc')
      .get();

    expect(rows.map((post: any) => post.slug)).toEqual([
      'alpha-certification-query',
      'beta-certification-query',
    ]);
    expect(await Post.query().where('user_id', user.id).count()).toBe(2);
    expect(await Post.query().where('published', true).exists()).toBe(true);
	  });

	  it('runs soft deletes and UUID/ULID model identifiers in a generated app', async () => {
	    class CertificationSoftPost extends SoftDeletes(Model) {
	      static table = 'certification_soft_posts';
	      static timestamps = false;
	      static fillable = ['title'];
	    }
	    class CertificationUuidPrimary extends HasUuids(Model) {
	      static table = 'certification_uuid_primaries';
	      static timestamps = false;
	      static fillable = ['title'];
	    }
	    class CertificationUlidPrimary extends HasUlids(Model) {
	      static table = 'certification_ulid_primaries';
	      static timestamps = false;
	      static fillable = ['title'];
	    }
	    class CertificationPublicUuid extends Model {
	      static table = 'certification_public_uuids';
	      static timestamps = false;
	      static fillable = ['title'];
	      static uniqueIds = ['uuid'];
	      static uniqueIdType = 'uuid' as const;
	    }
	    class CertificationPublicUlid extends Model {
	      static table = 'certification_public_ulids';
	      static timestamps = false;
	      static fillable = ['title'];
	      static uniqueIds = ['ulid'];
	      static uniqueIdType = 'ulid' as const;
	    }

	    const schema = new Schema();
	    await schema.createTable('certification_soft_posts', (table) => {
	      table.increments('id');
	      table.string('title');
	      table.softDeletes();
	    });
	    await schema.createTable('certification_uuid_primaries', (table) => {
	      table.uuid('id').primary();
	      table.string('title');
	    });
	    await schema.createTable('certification_ulid_primaries', (table) => {
	      table.ulid('id').primary();
	      table.string('title');
	    });
	    await schema.createTable('certification_public_uuids', (table) => {
	      table.increments('id');
	      table.uuid('uuid').unique();
	      table.string('title');
	    });
	    await schema.createTable('certification_public_ulids', (table) => {
	      table.increments('id');
	      table.ulid('ulid').unique();
	      table.string('title');
	    });

	    const live = await CertificationSoftPost.create({ title: 'Live soft-delete row' });
	    const trashed = await CertificationSoftPost.create({ title: 'Trashed soft-delete row' });
	    await trashed.delete();
	    expect(trashed.trashed()).toBe(true);
	    expect(await CertificationSoftPost.count()).toBe(1);
	    expect(await CertificationSoftPost.withTrashed().count()).toBe(2);
	    expect(await CertificationSoftPost.onlyTrashed().count()).toBe(1);
	    await trashed.restore();
	    expect(await CertificationSoftPost.count()).toBe(2);
	    await live.forceDelete();
	    expect(await CertificationSoftPost.withTrashed().count()).toBe(1);

	    const uuidPrimary = await CertificationUuidPrimary.create({ title: 'UUID primary' });
	    const ulidPrimary = await CertificationUlidPrimary.create({ title: 'ULID primary' });
	    expect(rules.uuidv7().safeParse(uuidPrimary.id).success).toBe(true);
	    expect(rules.ulid().safeParse(ulidPrimary.id).success).toBe(true);
	    expect((await CertificationUuidPrimary.find(uuidPrimary.id))?.title).toBe('UUID primary');
	    expect((await CertificationUlidPrimary.find(ulidPrimary.id))?.title).toBe('ULID primary');

	    const publicUuid = await CertificationPublicUuid.create({ title: 'Public UUID' });
	    const publicUlid = await CertificationPublicUlid.create({ title: 'Public ULID' });
	    expect(publicUuid.id).toBe(1);
	    expect(publicUlid.id).toBe(1);
	    expect(rules.uuidv7().safeParse(publicUuid.uuid).success).toBe(true);
	    expect(rules.ulid().safeParse(publicUlid.ulid).success).toBe(true);
	    const routeParams = z.object({ uuid: rules.uuidv7(), ulid: rules.ulid() });
	    expect(routeParams.safeParse({ uuid: publicUuid.uuid, ulid: publicUlid.ulid }).success).toBe(true);
	  });

	  it('runs API key Bearer authentication through generated app auth middleware', async () => {
	    const { auth } = await import('../../src/app.js');
	    const user = await User.create({
	      name: 'API Key Certification User',
	      email: 'api-key-certification-user@example.com',
	      password: 'hashed-password',
	      role: 'user',
	    });

	    const { plainTextKey, record } = await ApiKeys.create({
	      name: 'Certification API Key',
	      userId: user.id,
	      permissions: ['certification:read'],
	    });

	    expect(plainTextKey).toMatch(/^sk_/);
	    expect(record.key).not.toBe(plainTextKey);
	    expect(await ApiKeys.hasPermission(plainTextKey, 'certification:read')).toBe(true);
	    expect(await ApiKeys.hasPermission(plainTextKey, 'certification:write')).toBe(false);

	    const resolved = await auth.resolveFromApiToken(plainTextKey);
	    expect(resolved?.id).toBe(user.id);

	    const middleware = new AuthenticateMiddleware(auth);
	    const ctx = {
	      event: createRequestEvent({
	        method: 'GET',
	        url: 'http://localhost/api/certification',
	        headers: { authorization: \`Bearer \${plainTextKey}\` },
	      }),
	      params: {},
	      locals: {},
	    };

	    let nextCalled = false;
	    await middleware.handle(ctx as any, async () => {
	      nextCalled = true;
	    });

	    expect(nextCalled).toBe(true);
	    expect(ctx.event.locals.user?.id).toBe(user.id);
	  });

	  it('runs generated hook CSRF protections for API routes', async () => {
	    const { handle } = await import('../../src/hooks.server.js');

	    async function request(path: string, options: any = {}) {
	      return handle({
	        event: createRequestEvent({
	          method: options.method ?? 'POST',
	          url: \`http://localhost\${path}\`,
	          headers: options.headers ?? {},
	          body: options.body,
	        }),
	        resolve: async () => new Response('ok'),
	      });
	    }

	    expect((await request('/api/certification')).status).toBe(419);
	    expect((await request('/api/certification', {
	      headers: { authorization: 'Bearer api-token' },
	    })).status).toBe(200);
	    expect((await request('/api/internal/broadcast')).status).toBe(200);
	    expect((await request('/api/webhooks/stripe')).status).toBe(200);
	    expect((await request('/api/certification', {
	      headers: { origin: 'http://evil.example' },
	    })).status).toBe(403);
	  });

	  it('runs auth recovery token flows through generated app migrations', async () => {
	    const { auth } = await import('../../src/app.js');
	    const secret = process.env.JWT_SECRET ?? process.env.APP_KEY;
	    if (!secret) throw new Error('APP_KEY or JWT_SECRET is required for auth recovery certification');
	    const hashToken = (token: string) => createHmac('sha256', secret).update(token).digest('hex');

	    const user = await User.create({
	      name: 'Recovery Certification User',
	      email: 'recovery-certification@example.com',
	      password: 'old-password',
	      role: 'user',
	    });

	    await new QueryBuilder('password_resets').insert({
	      email: 'recovery-certification@example.com',
	      token: hashToken('reset-certification-token'),
	      expires_at: new Date(Date.now() + 60_000).toISOString(),
	      created_at: new Date().toISOString(),
	    });
	    expect(await auth.resetPassword('wrong-token', 'recovery-certification@example.com', 'new-password')).toBe(false);
	    expect(await auth.resetPassword('reset-certification-token', 'recovery-certification@example.com', 'new-password')).toBe(true);
	    expect(await auth.attempt({ email: 'recovery-certification@example.com', password: 'new-password' })).not.toBeNull();

	    await new QueryBuilder('email_verifications').insert({
	      user_id: user.id,
	      token: hashToken('verify-certification-token'),
	      expires_at: new Date(Date.now() + 60_000).toISOString(),
	      created_at: new Date().toISOString(),
	    });
	    expect(await auth.verifyEmail('wrong-token', user.id)).toBe(false);
	    expect(await auth.verifyEmail('verify-certification-token', user.id)).toBe(true);
	    expect(await auth.verifyEmail('verify-certification-token', user.id)).toBe(false);

	    await new QueryBuilder('otp_codes').insert({
	      email: 'recovery-certification@example.com',
	      code: hashToken('123456'),
	      purpose: 'login',
	      expires_at: new Date(Date.now() + 60_000).toISOString(),
	      created_at: new Date().toISOString(),
	      used_at: null,
	    });
	    expect(await auth.verifyOtp('recovery-certification@example.com', '000000')).toBeNull();
	    expect(await auth.verifyOtp('recovery-certification@example.com', '123456')).not.toBeNull();
	    expect(await auth.verifyOtp('recovery-certification@example.com', '123456')).toBeNull();
	  });

	  it('runs Teams roles, members, and invitation lifecycle through generated app migrations', async () => {
	    const owner = await User.create({
	      name: 'Team Owner',
	      email: 'team-owner-certification@example.com',
	      password: 'hashed-password',
	      role: 'admin',
	    });
	    const member = await User.create({
	      name: 'Team Member',
	      email: 'team-member-certification@example.com',
	      password: 'hashed-password',
	      role: 'user',
	    });
	    const invitee = await User.create({
	      name: 'Team Invitee',
	      email: 'team-invitee-certification@example.com',
	      password: 'hashed-password',
	      role: 'user',
	    });

	    const team = await Teams.create({ name: 'Certification Team', ownerId: owner.id });
	    const duplicate = await Teams.create({ name: 'Certification Team', ownerId: owner.id });
	    expect(team.slug).toBe('certification-team');
	    expect(duplicate.slug).toBe('certification-team-2');
	    expect(await Teams.hasRole(team.id, owner.id, 'owner')).toBe(true);

	    await Teams.addMember(team.id, member.id, 'admin');
	    expect(await Teams.hasRole(team.id, member.id, 'admin')).toBe(true);
	    expect(await Teams.updateMemberRole(team.id, owner.id, 'admin')).toBe(false);
	    expect(await Teams.removeMember(team.id, owner.id)).toBe(false);

	    await expect(Teams.addMember(team.id, invitee.id, 'editor')).rejects.toThrow('Invalid team role');
	    const invitation = await Teams.invite(team.id, 'team-invitee-certification@example.com', 'viewer');
	    expect(await Teams.getPendingInvitations(team.id)).toHaveLength(1);
	    expect(await Teams.acceptInvitation(invitation.token, invitee.id)).toBe(true);
	    expect(await Teams.acceptInvitation(invitation.token, member.id)).toBe(false);
	    expect(await Teams.hasRole(team.id, invitee.id, 'viewer')).toBe(true);
	    expect(await Teams.getPendingInvitations(team.id)).toHaveLength(0);
	  });

	  it('runs PostgreSQL through PgBouncer and records pg_stat_statements when configured', async () => {
	    if (!process.env.PGBOUNCER_CERTIFICATION) return;

	    expect(Connection.getDriver()).toBe('postgres');
	    await Connection.raw('SELECT 1 as svelar_pgbouncer_certification');

	    const extensions = await Connection.raw(
	      "SELECT extname FROM pg_extension WHERE extname = 'pg_stat_statements'"
	    );
	    expect(extensions).toHaveLength(1);

	    const statements = await Connection.raw(
	      "SELECT query, calls FROM pg_stat_statements WHERE query LIKE '%svelar_pgbouncer_certification%' ORDER BY calls DESC LIMIT 1"
	    );
	    expect(statements.length).toBeGreaterThan(0);
	    expect(Number(statements[0].calls)).toBeGreaterThan(0);
	  });

	  it('runs model observer lifecycles and EventServiceProvider wiring', async () => {
	    const user = await User.create({
	      name: 'Observer User',
	      email: 'observer-user@example.com',
	      password: 'hashed-password',
	      role: 'user',
	    });

	    const observed: string[] = [];
	    Post.removeObservers();
	    class CertificationPostObserver extends ModelObserver {
	      creating(model: any) { observed.push('creating:' + model.slug); }
	      created(model: any) { observed.push('created:' + model.slug); }
	      saving(model: any) { observed.push('saving:' + model.slug); }
	      saved(model: any) { observed.push('saved:' + model.slug); }
	      updating(model: any) { observed.push('updating:' + model.slug); }
	      updated(model: any) { observed.push('updated:' + model.slug); }
	      deleting(model: any) { observed.push('deleting:' + model.slug); }
	      deleted(model: any) { observed.push('deleted:' + model.slug); }
	    }
	    Post.observe(new CertificationPostObserver());

	    const heard: string[] = [];
	    Event.listen('post.created.certification', (post: any) => {
	      heard.push(post.slug);
	    });

    const post = await Post.create({
      title: 'Observed Certification Post',
      slug: 'observed-certification-post',
      body: 'Observer body for release certification.',
      published: true,
      user_id: user.id,
	    });
	    await Event.emit('post.created.certification', post);
	    await post.update({ title: 'Observed Certification Post Updated' });
	    await post.delete();

	    expect(observed).toEqual([
	      'creating:observed-certification-post',
	      'saving:observed-certification-post',
	      'created:observed-certification-post',
	      'saved:observed-certification-post',
	      'updating:observed-certification-post',
	      'saving:observed-certification-post',
	      'updated:observed-certification-post',
	      'saved:observed-certification-post',
	      'deleting:observed-certification-post',
	      'deleted:observed-certification-post',
	    ]);
	    expect(heard).toContain('observed-certification-post');

	    Post.removeObservers();
	    Event.flush();

	    const providerObserved: string[] = [];
	    const providerHeard: string[] = [];
	    class ProviderPostObserver extends ModelObserver {
	      created(model: any) { providerObserved.push(model.slug); }
	    }
	    class ProviderPostListener {
	      async handle(post: any): Promise<void> {
	        providerHeard.push(post.slug);
	      }
	    }
	    class CertificationEventServiceProvider extends EventServiceProvider {
	      protected listen = {
	        'post.provider.certification': [ProviderPostListener],
	      };
	      protected observers = {
	        Post: [ProviderPostObserver],
	      };
	    }

	    EventServiceProvider.registerModel(Post);
	    await new CertificationEventServiceProvider().boot();

	    const providerPost = await Post.create({
	      title: 'Provider Observed Certification Post',
	      slug: 'provider-observed-certification-post',
	      body: 'Provider observer body for release certification.',
	      published: true,
	      user_id: user.id,
	    });
	    await Event.emit('post.provider.certification', providerPost);

	    expect(providerObserved).toEqual(['provider-observed-certification-post']);
	    expect(providerHeard).toEqual(['provider-observed-certification-post']);
	  });

	  it('runs file logging, LogViewer query/stats, and live tailing', async () => {
	    LogViewer.clear();
	    const logPath = join(process.cwd(), 'storage', 'logs', 'certification.log');
	    rmSync(logPath, { force: true });

	    Log.configure({
	      default: 'file',
	      channels: {
	        file: { driver: 'file', path: logPath, level: 'info', format: 'json' },
	        audit: { driver: 'null', level: 'warn' },
	      },
	    });

	    const tailed: string[] = [];
	    const unsubscribe = LogViewer.tail((entry) => {
	      tailed.push(entry.message);
	    }, { level: 'warn', channel: 'file' });

	    Log.debug('debug should be filtered from certification logs');
	    Log.info('certification log persisted', { requestId: 'cert-log-1' });
	    Log.warn('certification warning tailed', { requestId: 'cert-log-2' });
	    unsubscribe();
	    Log.error('certification error persisted', { requestId: 'cert-log-3' });

	    await waitUntil(() => {
	      if (!existsSync(logPath)) return false;
	      const contents = readFileSync(logPath, 'utf8');
	      return contents.includes('certification log persisted')
	        && contents.includes('certification warning tailed')
	        && contents.includes('certification error persisted')
	        && !contents.includes('debug should be filtered');
	    }, 10_000);

	    const fileLogs = LogViewer.query({ channel: 'file', search: 'certification', limit: 10 });
	    expect(fileLogs.map((entry) => entry.message)).toEqual([
	      'certification log persisted',
	      'certification warning tailed',
	      'certification error persisted',
	    ]);
	    expect(tailed).toEqual(['certification warning tailed']);

	    const stats = LogViewer.getStats();
	    expect(stats.totalEntries).toBe(3);
	    expect(stats.byLevel.info).toBe(1);
	    expect(stats.byLevel.warn).toBe(1);
	    expect(stats.byLevel.error).toBe(1);
	    expect(stats.byChannel.file).toBe(3);

	    const recentErrors = LogViewer.getRecentErrors(5);
	    expect(recentErrors[0].message).toBe('certification error persisted');
	  });

		  it('runs exception handling, reporting, validation payloads, and middleware recovery', async () => {
	    LogViewer.clear();
	    Log.configure({
	      default: 'null',
	      channels: {
	        null: { driver: 'null', level: 'debug' },
	      },
	    });

	    const reported: string[] = [];
	    const handler = new ErrorHandler({
	      debug: false,
	      report: async (error, context) => {
	        reported.push(error.message + ':' + context?.url);
	        throw new Error('reporter failure should not escape');
	      },
	    });
	    const event = createRequestEvent({ url: 'http://localhost/api/certification-errors' });
	    const response = await handler.handle(new Error('database exploded'), event);
	    expect(response.status).toBe(500);
	    expect(await response.json()).toEqual({ message: 'Internal server error' });
	    expect(reported).toEqual(['database exploded:http://localhost/api/certification-errors']);
	    expect(LogViewer.query({ level: 'error', search: 'database exploded' })).toHaveLength(1);

	    const validation = await handler.handle(new ValidationError({ email: ['Required'] }), event);
	    expect(validation.status).toBe(422);
	    expect(await validation.json()).toEqual({
	      message: 'The given data was invalid',
	      errors: { email: ['Required'] },
	    });
	    expect(reported).toEqual(['database exploded:http://localhost/api/certification-errors']);

	    const debugHandler = new ErrorHandler({ debug: true });
	    const debugResponse = await debugHandler.handle(new HttpError(409, 'Already exists', { code: 'duplicate' }), event);
	    expect(debugResponse.status).toBe(409);
	    const debugBody = await debugResponse.json();
	    expect(debugBody).toMatchObject({
	      message: 'Already exists',
	      code: 'duplicate',
	      exception: 'HttpError',
	    });
	    expect(debugBody.stack.length).toBeGreaterThan(0);

	    const middlewareResponse = await handler.middleware()({ event }, async () => {
	      throw new HttpError(418, 'Short and stout');
	    });
	    expect(middlewareResponse?.status).toBe(418);
		    expect(await middlewareResponse?.json()).toEqual({ message: 'Short and stout' });
		  });

		  it('runs Postmark, Resend, and Mailtrap mail transports', async () => {
		    const mailServer = await startMailProviderServer();

		    try {
		      Mailer.configure({
		        default: 'postmark',
		        from: { name: 'Svelar Cert', address: 'noreply@svelar.dev' },
		        mailers: {
		          log: { driver: 'log' },
		          null: { driver: 'null' },
		          postmark: {
		            driver: 'postmark',
		            apiToken: 'postmark-token',
		            messageStream: 'broadcasts',
		            endpoint: \`\${mailServer.url}/postmark\`,
		          },
		          resend: {
		            driver: 'resend',
		            apiKey: 'resend-token',
		            endpoint: \`\${mailServer.url}/resend\`,
		          },
		          mailtrap: {
		            driver: 'mailtrap',
		            apiToken: 'mailtrap-token',
		            endpoint: \`\${mailServer.url}/mailtrap\`,
		          },
		        },
		      });

		      const postmark = await Mailer.send({
		        to: ['alpha@example.com', 'beta@example.com'],
		        cc: 'copy@example.com',
		        bcc: 'hidden@example.com',
		        replyTo: 'reply@example.com',
		        subject: 'Postmark Certification',
		        html: '<p>Postmark works</p>',
		        text: 'Postmark works',
		        tags: { category: 'certification' },
		        attachments: [{ filename: 'postmark.txt', content: 'postmark', contentType: 'text/plain' }],
		      });
		      expect(postmark).toEqual({
		        accepted: ['alpha@example.com', 'beta@example.com'],
		        rejected: [],
		        messageId: 'postmark-cert-id',
		      });

		      class CertificationEmail extends Mailable {
		        build(): this {
		          return this
		            .to('resend@example.com')
		            .replyTo('support@example.com')
		            .subject('Resend Certification')
		            .tag('category', 'certification')
		            .html('<p>Resend works</p>');
		        }
		      }

		      const resend = await Mailer.sendMailable(new CertificationEmail(), 'resend');
		      expect(resend).toEqual({
		        accepted: ['resend@example.com'],
		        rejected: [],
		        messageId: 'resend-cert-id',
		      });

		      const mailtrap = await Mailer.mailer('mailtrap').send({
		        to: 'mailtrap@example.com',
		        replyTo: 'Reply Team <reply@example.com>',
		        subject: 'Mailtrap Certification',
		        html: '<p>Mailtrap works</p>',
		        text: 'Mailtrap works',
		        tags: { category: 'certification' },
		        attachments: [{ filename: 'mailtrap.txt', content: 'mailtrap', contentType: 'text/plain' }],
		      });
		      expect(mailtrap).toEqual({
		        accepted: ['mailtrap@example.com'],
		        rejected: [],
		        messageId: 'mailtrap-cert-id',
		      });

		      expect(mailServer.requests).toHaveLength(3);
		      expect(mailServer.requests[0]).toMatchObject({
		        path: '/postmark',
		        headers: { 'x-postmark-server-token': 'postmark-token' },
		        body: {
		          From: 'Svelar Cert <noreply@svelar.dev>',
		          To: 'alpha@example.com, beta@example.com',
		          Cc: 'copy@example.com',
		          Bcc: 'hidden@example.com',
		          ReplyTo: 'reply@example.com',
		          Subject: 'Postmark Certification',
		          HtmlBody: '<p>Postmark works</p>',
		          TextBody: 'Postmark works',
		          MessageStream: 'broadcasts',
		          Tag: 'certification',
		          Attachments: [{ Name: 'postmark.txt', Content: 'cG9zdG1hcms=', ContentType: 'text/plain' }],
		        },
		      });
		      expect(mailServer.requests[1]).toMatchObject({
		        path: '/resend',
		        headers: { authorization: 'Bearer resend-token' },
		        body: {
		          from: 'Svelar Cert <noreply@svelar.dev>',
		          to: ['resend@example.com'],
		          reply_to: ['support@example.com'],
		          subject: 'Resend Certification',
		          html: '<p>Resend works</p>',
		          tags: [{ name: 'category', value: 'certification' }],
		        },
		      });
		      expect(mailServer.requests[2]).toMatchObject({
		        path: '/mailtrap',
		        headers: { authorization: 'Bearer mailtrap-token' },
		        body: {
		          from: { name: 'Svelar Cert', email: 'noreply@svelar.dev' },
		          to: [{ email: 'mailtrap@example.com' }],
		          reply_to: { name: 'Reply Team', email: 'reply@example.com' },
		          subject: 'Mailtrap Certification',
		          html: '<p>Mailtrap works</p>',
		          text: 'Mailtrap works',
		          category: 'certification',
		          attachments: [{ filename: 'mailtrap.txt', content: 'bWFpbHRyYXA=', type: 'text/plain' }],
		        },
		      });
		    } finally {
		      await mailServer.close();
		    }
		  });

		  it('runs email, database, and custom notification channels', async () => {
		    const sentMail: any[] = [];
		    const deliveredCustom: any[] = [];

		    Mailer.configure({
		      default: 'capture',
		      from: { name: 'Svelar Cert', address: 'noreply@svelar.dev' },
		      mailers: {
		        capture: {
		          driver: 'custom',
		          transport: {
		            async send(message: any) {
		              sentMail.push(message);
		              return {
		                accepted: Array.isArray(message.to) ? message.to : [message.to],
		                rejected: [],
		                messageId: 'notification-mail-cert-id',
		              };
		            },
		          },
		        },
		      },
		    });

		    Notifier.configure({
		      channels: {
		        email: { driver: 'email' },
		        database: { driver: 'database', table: 'notifications' },
		        audit: {
		          driver: 'custom',
		          handler: {
		            async send(notifiable: any, notification: any) {
		              deliveredCustom.push(notification.toChannel?.('audit', notifiable));
		            },
		          },
		        },
		      },
		    });

		    class CertificationNotification extends Notification {
		      channels(): string[] {
		        return ['email', 'database', 'audit'];
		      }

		      toEmail() {
		        return {
		          subject: 'Notification Certification',
		          html: '<p>Notifications work.</p>',
		        };
		      }

		      toDatabase() {
		        return {
		          type: 'certification_notification',
		          title: 'Notification Certification',
		          message: 'Database notifications work.',
		          data: { source: 'release-smoke' },
		        };
		      }

		      toChannel(channel: string, notifiable: any) {
		        return {
		          channel,
		          userId: notifiable.id,
		          source: 'release-smoke',
		        };
		      }
		    }

		    const user = await User.create({
		      name: 'Notification User',
		      email: 'notification-user@example.com',
		      password: 'hashed-password',
		      role: 'user',
		    });

		    await Notifier.notify(user as any, new CertificationNotification());

		    expect(sentMail).toEqual([
		      {
		        to: 'notification-user@example.com',
		        subject: 'Notification Certification',
		        html: '<p>Notifications work.</p>',
		        text: undefined,
		        from: { name: 'Svelar Cert', address: 'noreply@svelar.dev' },
		      },
		    ]);

		    const notifications = await new QueryBuilder('notifications')
		      .where('notifiable_id', String(user.id))
		      .get();
		    expect(notifications).toHaveLength(1);
		    expect(notifications[0].type).toBe('certification_notification');
		    expect(JSON.parse(notifications[0].data)).toEqual({
		      title: 'Notification Certification',
		      message: 'Database notifications work.',
		      source: 'release-smoke',
		    });
		    expect(deliveredCustom).toEqual([
		      { channel: 'audit', userId: user.id, source: 'release-smoke' },
		    ]);
		  });

	  it('runs sync and async queue jobs', async () => {
    const handled: string[] = [];
    const failed: string[] = [];

    class CertificationJob extends Job {
      constructor(private label: string) {
        super();
      }

      async handle(): Promise<void> {
        handled.push(this.label);
      }
    }

    class CertificationFailingJob extends Job {
      maxAttempts = 1;

      async handle(): Promise<void> {
        throw new Error('certification queue failure');
      }

      failed(error: Error): void {
        failed.push(error.message);
      }
    }

    await Queue.dispatchSync(new CertificationJob('sync'));
    expect(handled).toContain('sync');

    Queue.configure({
      default: 'memory',
      connections: { memory: { driver: 'memory' } },
    });
    await Queue.dispatch(new CertificationJob('async'));
    expect(await Queue.size()).toBe(1);
    expect(await Queue.work({ maxJobs: 1, sleep: 0 })).toBe(1);
    expect(handled).toContain('async');

    Queue.register(CertificationFailingJob);
    await Queue.dispatch(new CertificationFailingJob());
    await Queue.work({ maxJobs: 1, sleep: 0 });
    expect(failed).toEqual(['certification queue failure']);
    const failures = await Queue.failed();
    expect(failures.some((job: any) => job.jobClass === 'CertificationFailingJob')).toBe(true);
    expect(await Queue.flushFailed()).toBeGreaterThanOrEqual(1);
  });

  it('runs global and per-route middleware including rate limits', async () => {
    const stack = new MiddlewareStack();
    stack.use(async (ctx, next) => {
      ctx.locals.certified = true;
      return next();
    });
    stack.register('strict-rate-limit', new RateLimitMiddleware({ maxRequests: 1, windowMs: 60_000 }));

    const event = createRequestEvent({ headers: { 'x-forwarded-for': '203.0.113.10' } });
    const ctx = { event, locals: event.locals, params: {} };

    const first = await stack.execute(ctx, async () => new Response('ok'), ['strict-rate-limit']);
    expect(first?.status).toBe(200);
    expect(event.locals.certified).toBe(true);

    const second = await stack.execute(ctx, async () => new Response('ok'), ['strict-rate-limit']);
    expect(second?.status).toBe(429);

    const sharedPrefix = \`certification-rate-limit:\${Date.now()}\`;
    const sharedA = new RateLimitMiddleware({
      maxRequests: 1,
      windowMs: 60_000,
      store: 'cache',
      cacheStore: process.env.REDIS_URL ? 'redis' : undefined,
      prefix: sharedPrefix,
      keyGenerator: () => 'shared-user',
    });
    const sharedB = new RateLimitMiddleware({
      maxRequests: 1,
      windowMs: 60_000,
      store: 'cache',
      cacheStore: process.env.REDIS_URL ? 'redis' : undefined,
      prefix: sharedPrefix,
      keyGenerator: () => 'shared-user',
    });
    const sharedCtx = { event: createRequestEvent(), locals: {}, params: {} };
    expect((await sharedA.handle(sharedCtx, async () => new Response('ok')))?.status).toBe(200);
    expect((await sharedB.handle(sharedCtx, async () => new Response('ok')))?.status).toBe(429);

    const throttlePrefix = \`certification-throttle:\${Date.now()}\`;
    const throttleA = new ThrottleMiddleware({
      maxAttempts: 1,
      decayMinutes: 1,
      store: 'cache',
      cacheStore: process.env.REDIS_URL ? 'redis' : undefined,
      prefix: throttlePrefix,
    });
    const throttleB = new ThrottleMiddleware({
      maxAttempts: 1,
      decayMinutes: 1,
      store: 'cache',
      cacheStore: process.env.REDIS_URL ? 'redis' : undefined,
      prefix: throttlePrefix,
    });
    const throttleEvent = createRequestEvent({
      method: 'POST',
      url: 'http://localhost/login',
      headers: { 'x-forwarded-for': '203.0.113.99' },
    });
    const throttleCtx = { event: throttleEvent, locals: throttleEvent.locals, params: {} };
    expect((await throttleA.handle(throttleCtx, async () => new Response('fail', { status: 401 })))?.status).toBe(401);
    expect((await throttleB.handle(throttleCtx, async () => new Response('ok')))?.status).toBe(429);
  });

  it('runs session store primitives', async () => {
    const store = new MemorySessionStore();
    const session = new Session('certification-session');
    session.set('user_id', 123);
    session.flash('status', 'saved');

    await store.write(session.id, session.toPersist(), 60);
    const persisted = await store.read(session.id);
    expect(persisted?.user_id).toBe(123);
    expect(persisted?._flash.status).toBe('saved');

    const oldId = session.id;
    const newId = session.regenerateId();
    expect(newId).not.toBe(oldId);
    expect(await store.read(oldId)).toBeNull();
  });

	  it('runs SSE broadcasting public, private, and presence channels', async () => {
	    Broadcast.configure({
	      default: 'sse',
	      drivers: { sse: { driver: 'sse' } },
	    });
	    Broadcast.channel('private-user-{id}', async (user: any, params: any) => {
	      return user && String(user.id) === params.id;
	    });
	    Broadcast.channel('private-legacy-*', async (user: any, params: any) => {
	      return user && String(user.id) === params['0'];
	    });
	    Broadcast.channel('presence-admin', async (user: any) => {
	      if (!user || user.role !== 'admin') return false;
	      return { id: user.id, name: user.name };
	    });

	    const readers: ReadableStreamDefaultReader<Uint8Array>[] = [];
	    const openReader = (response: Response) => {
	      if (!response.body) throw new Error('SSE response did not include a readable body.');
	      const reader = response.body.getReader();
	      readers.push(reader);
	      return reader;
	    };

	    try {
	      const publicReader = openReader(Broadcast.subscribe('certification-public', 'guest'));
	      expect(await readSseEvent(publicReader)).toMatchObject({
	        event: 'connected',
	        data: { channel: 'certification-public' },
	      });
	      await Broadcast.to('certification-public').send('certification-event', { ok: true });
	      expect(await readSseEvent(publicReader)).toMatchObject({
	        event: 'certification-event',
	        data: { ok: true },
	      });

	      expect(await Broadcast.authorize('private-user-7', { id: 7 })).toBe(true);
	      expect(await Broadcast.authorize('private-user-7', { id: 8 })).toBe(false);
	      expect(await Broadcast.authorize('private-legacy-9', { id: 9 })).toBe(true);

	      const privateReader = openReader(Broadcast.subscribe('private-user-7', 7));
	      await readSseEvent(privateReader);
	      await Broadcast.to('private-user-7', 7).send('private-event', { userId: 7 });
	      expect(await readSseEvent(privateReader)).toMatchObject({
	        event: 'private-event',
	        data: { userId: 7 },
	      });

	      const adminOne = { id: 'admin-1', name: 'Admin One', role: 'admin' };
	      const adminTwo = { id: 'admin-2', name: 'Admin Two', role: 'admin' };
	      const adminOneInfo = await Broadcast.authorize('presence-admin', adminOne);
	      const adminTwoInfo = await Broadcast.authorize('presence-admin', adminTwo);
	      expect(adminOneInfo).toEqual({ id: 'admin-1', name: 'Admin One' });
	      expect(adminTwoInfo).toEqual({ id: 'admin-2', name: 'Admin Two' });

	      const presenceOne = openReader(Broadcast.subscribe('presence-admin', adminOne.id, adminOneInfo as any));
	      expect(await readSseEvent(presenceOne)).toMatchObject({
	        event: 'connected',
	        data: { channel: 'presence-admin', members: [] },
	      });

	      const presenceTwo = openReader(Broadcast.subscribe('presence-admin', adminTwo.id, adminTwoInfo as any));
	      expect(await readSseEvent(presenceOne)).toMatchObject({
	        event: 'member:joined',
	        data: { id: 'admin-2', name: 'Admin Two' },
	      });
	      expect(await readSseEvent(presenceTwo)).toMatchObject({
	        event: 'connected',
	        data: { channel: 'presence-admin', members: [{ id: 'admin-1', name: 'Admin One' }] },
	      });
	      expect(Broadcast.members('presence-admin')).toEqual([
	        { id: 'admin-1', name: 'Admin One' },
	        { id: 'admin-2', name: 'Admin Two' },
	      ]);

	      await presenceTwo.cancel();
	      expect(await readSseEvent(presenceOne)).toMatchObject({
	        event: 'member:left',
	        data: { id: 'admin-2', name: 'Admin Two' },
	      });
	      expect(Broadcast.members('presence-admin')).toEqual([{ id: 'admin-1', name: 'Admin One' }]);
	    } finally {
	      await Promise.allSettled(readers.map((reader) => reader.cancel()));
	      Broadcast.prune();
	    }
	  });

	  it('runs S3-compatible storage when configured', async () => {
	    if (!process.env.S3_CERTIFICATION) return;

	    const prefix = \`certification/\${Date.now()}-\${Math.random().toString(36).slice(2)}\`;
	    Storage.configure({
	      default: 's3',
	      disks: {
	        s3: {
	          driver: 's3',
	          bucket: process.env.S3_BUCKET,
	          region: process.env.S3_REGION ?? 'us-east-1',
	          endpoint: process.env.S3_ENDPOINT,
	          accessKeyId: process.env.S3_ACCESS_KEY,
	          secretAccessKey: process.env.S3_SECRET_KEY,
	          forcePathStyle: true,
	          prefix,
	        },
	      },
	    });

	    const disk = Storage.s3Disk();
	    await disk.ensureBucket();
	    await Storage.put('reports/alpha.txt', 'hello');
	    await Storage.append('reports/alpha.txt', ' world');
	    expect(await Storage.getText('reports/alpha.txt')).toBe('hello world');
	    expect(await Storage.exists('reports/alpha.txt')).toBe(true);
	    expect(await Storage.size('reports/alpha.txt')).toBe(11);

	    await Storage.copy('reports/alpha.txt', 'reports/beta.txt');
	    expect(await Storage.getText('reports/beta.txt')).toBe('hello world');
	    await Storage.move('reports/beta.txt', 'archive/beta.txt');
	    expect(await Storage.exists('reports/beta.txt')).toBe(false);
	    expect(await Storage.exists('archive/beta.txt')).toBe(true);

	    const files = await Storage.files('reports');
	    expect(files).toEqual(['reports/alpha.txt']);
	    const allFiles = (await Storage.allFiles()).sort();
	    expect(allFiles).toEqual(['archive/beta.txt', 'reports/alpha.txt']);
	    expect(await Storage.directories()).toEqual(['archive', 'reports']);

	    const temporaryUrl = await disk.temporaryUrl('reports/alpha.txt', 60);
	    const response = await fetch(temporaryUrl);
	    expect(response.status).toBe(200);
	    expect(await response.text()).toBe('hello world');

	    await Storage.delete('reports/alpha.txt');
	    await Storage.deleteDirectory('archive');
	    expect(await Storage.allFiles()).toEqual([]);
	  });

	  it('runs PDFKit generation and queued PDF jobs', async () => {
    PDF.configure({ driver: 'pdfkit' });

    const buffer = await PDF.html('<h1>Svelar Certification</h1><p>PDFKit driver</p>').generate();
    expect(buffer.subarray(0, 4).toString()).toBe('%PDF');

    const outputPath = join(process.cwd(), 'storage', 'framework', 'certification-pdf-job.pdf');
    rmSync(outputPath, { force: true });

    Queue.configure({
      default: 'memory',
      connections: { memory: { driver: 'memory' } },
    });
    Queue.register(GeneratePdfJob);
    await PDF.dispatch({
      type: 'html',
      content: '<h1>Queued PDF</h1><p>Generated by GeneratePdfJob.</p>',
      outputPath,
    });
    expect(await Queue.work({ maxJobs: 1, sleep: 0 })).toBe(1);
	    expect(existsSync(outputPath)).toBe(true);
	    rmSync(outputPath, { force: true });
	  });

	  it('runs Meilisearch health, auto-sync, manual indexing, and settings when configured', async () => {
	    if (!process.env.MEILISEARCH_HOST) return;

	    Search.configure({
	      host: process.env.MEILISEARCH_HOST,
	      apiKey: process.env.MEILISEARCH_KEY,
	      indexPrefix: \`cert_\${Date.now()}_\${Math.random().toString(36).slice(2)}\`,
	    });

	    const health = await Search.health();
	    expect(health.status).toBe('available');

	    class SearchCertificationPost extends (Searchable(Post as any) as any) {
	      shouldBeSearchable(): boolean {
	        return this.getAttribute('published') === true;
	      }

	      toSearchableObject(): Record<string, any> {
	        return {
	          id: this.getAttribute('id'),
	          title: this.getAttribute('title'),
	          slug: this.getAttribute('slug'),
	          body: this.getAttribute('body'),
	          published: this.getAttribute('published'),
	        };
	      }
	    }

	    await SearchCertificationPost.configureSearchIndex({
	      filterableAttributes: ['published'],
	      sortableAttributes: ['title'],
	    });

	    const user = await User.create({
	      name: 'Search User',
	      email: 'search-user@example.com',
	      password: 'hashed-password',
	      role: 'user',
	    });

	    const indexed = await SearchCertificationPost.create({
	      title: 'Meilisearch Alpha Certification',
	      slug: 'meilisearch-alpha-certification',
	      body: 'Svelar search certification body.',
	      published: true,
	      user_id: user.id,
	    });
	    await waitForSearchHit(SearchCertificationPost, 'alpha certification', 'meilisearch-alpha-certification');

	    const filtered = await SearchCertificationPost.search('alpha certification', {
	      filter: 'published = true',
	      attributesToRetrieve: ['slug', 'published'],
	    });
	    expect(filtered.hits).toEqual([
	      { slug: 'meilisearch-alpha-certification', published: true },
	    ]);

	    await indexed.update({
	      title: 'Meilisearch Updated Certification',
	      body: 'Updated Svelar search certification body.',
	    });
	    await waitForSearchHit(SearchCertificationPost, 'updated certification', 'meilisearch-alpha-certification');

	    const draft = await SearchCertificationPost.create({
	      title: 'Draft Search Certification',
	      slug: 'draft-search-certification',
	      body: 'This draft should not be indexed yet.',
	      published: false,
	      user_id: user.id,
	    });
	    await waitForSearchEmpty(SearchCertificationPost, 'draft should not be indexed');

	    await draft.update({ published: true, title: 'Published Draft Search Certification' });
	    await waitForSearchHit(SearchCertificationPost, 'published draft', 'draft-search-certification');

	    const unsynced = await Search.withoutSyncing(() =>
	      SearchCertificationPost.create({
	        title: 'Unsynced Search Certification',
	        slug: 'unsynced-search-certification',
	        body: 'This record should only appear after manual indexing.',
	        published: true,
	        user_id: user.id,
	      })
	    );
	    await waitForSearchEmpty(SearchCertificationPost, 'unsynced search certification');
	    await unsynced.searchable();
	    await waitForSearchHit(SearchCertificationPost, 'unsynced search certification', 'unsynced-search-certification');

	    await indexed.delete();
	    await waitForSearchEmpty(SearchCertificationPost, 'updated certification');

	    await Search.withoutSyncing(async () => {
	      await SearchCertificationPost.create({
	        title: 'Bulk Search Certification One',
	        slug: 'bulk-search-certification-one',
	        body: 'Bulk indexing certification one.',
	        published: true,
	        user_id: user.id,
	      });
	      await SearchCertificationPost.create({
	        title: 'Bulk Search Certification Two',
	        slug: 'bulk-search-certification-two',
	        body: 'Bulk indexing certification two.',
	        published: true,
	        user_id: user.id,
	      });
	    });

	    const indexedCount = await SearchCertificationPost.makeAllSearchable(1);
	    expect(indexedCount.indexed).toBe(4);
	    await waitForSearchHit(SearchCertificationPost, 'bulk indexing', 'bulk-search-certification-one');
	    await waitForSearchHit(SearchCertificationPost, 'bulk indexing', 'bulk-search-certification-two');

	    const stats = await SearchCertificationPost.searchIndexStats();
	    expect(stats.numberOfDocuments).toBeGreaterThanOrEqual(4);

	    await SearchCertificationPost.removeAllFromSearch();
	    await waitForSearchEmpty(SearchCertificationPost, 'certification');
	  });

	  it('runs Redis cache, Redis sessions, and BullMQ queues when Redis is configured', async () => {
    if (!process.env.REDIS_URL) return;

      const redis = new Redis(process.env.REDIS_URL);
      const prefix = \`svelar-cert:\${Date.now()}:\${Math.random().toString(36).slice(2)}:\`;

      try {
      await Cache.put('bootstrap-cache-driver', 'redis', 60);
      expect(await Cache.get('bootstrap-cache-driver')).toBe('redis');
      expect(await redis.get('svelar_cache:bootstrap-cache-driver')).not.toBeNull();
      await Cache.forget('bootstrap-cache-driver');

      Cache.configure({
        default: 'redis',
        stores: {
          redis: {
            driver: 'redis',
            client: redis,
            prefix: \`\${prefix}cache:\`,
            ttl: 60,
          },
        },
      });
      await Cache.flush();
      await Cache.put('profile', { id: 7, role: 'admin' }, 60);
      expect(await Cache.get('profile')).toEqual({ id: 7, role: 'admin' });
      expect(await Cache.increment('counter', 2)).toBe(2);
      expect(await Cache.decrement('counter')).toBe(1);
      expect(await Cache.remember('computed', 60, async () => 'cached')).toBe('cached');
      expect(await Cache.remember('computed', 60, async () => 'missed')).toBe('cached');
      expect(await Cache.forget('profile')).toBe(true);
      expect(await Cache.has('profile')).toBe(false);

      const sessionStore = new RedisSessionStore({ client: redis, prefix: \`\${prefix}session:\` });
      await sessionStore.write('redis-session', { user_id: 99, _flash: { status: 'ok' } } as any, 60);
      expect(await sessionStore.read('redis-session')).toMatchObject({ user_id: 99 });
      await sessionStore.destroy('redis-session');
      expect(await sessionStore.read('redis-session')).toBeNull();

      const handled: string[] = [];
      const attempts: string[] = [];
      const timestamps: Record<string, number> = {};

      class CertificationRedisJob extends Job {
        label = 'redis';

        async handle(): Promise<void> {
          timestamps[this.label] = Date.now();
          handled.push(this.label);
        }
      }

      class CertificationRedisRetryJob extends Job {
        label = 'retry';
        maxAttempts = 2;
        retryDelay = 0;

        async handle(): Promise<void> {
          attempts.push(this.label);
          if (attempts.length === 1) {
            throw new Error('retry once');
          }
          timestamps[this.label] = Date.now();
          handled.push(this.label);
        }
      }

      class CertificationRedisDelayedJob extends Job {
        label = 'delayed';

        async handle(): Promise<void> {
          timestamps[this.label] = Date.now();
          handled.push(this.label);
        }
      }

      class CertificationRedisFailedJob extends Job {
        label = 'failed';
        maxAttempts = 1;

        async handle(): Promise<void> {
          throw new Error('redis failed job certification');
        }
      }

      const queueName = \`certification-\${Date.now()}\`;
      Queue.configure({
        default: 'redis',
        connections: {
          redis: {
            driver: 'redis',
            url: process.env.REDIS_URL,
            queue: queueName,
            prefix: \`\${prefix}queue\`,
            defaultJobOptions: {
              removeOnComplete: true,
              removeOnFail: true,
            },
          },
        },
      });
      Queue.register(CertificationRedisJob);
      Queue.register(CertificationRedisRetryJob);
      Queue.register(CertificationRedisDelayedJob);
      Queue.register(CertificationRedisFailedJob);
      const { Queue: BullQueue } = await import('bullmq');
      const redisUrl = new URL(process.env.REDIS_URL);
      const rawBullQueue = new BullQueue(queueName, {
        connection: {
          host: redisUrl.hostname || 'localhost',
          port: Number(redisUrl.port || 6379),
          password: redisUrl.password || undefined,
          db: Number(redisUrl.pathname?.slice(1) || 0),
        },
        prefix: \`\${prefix}queue\`,
      });
      await Queue.dispatch(new CertificationRedisJob(), { queue: queueName });
      await Queue.dispatch(new CertificationRedisRetryJob(), { queue: queueName, maxAttempts: 2 });
      const delayedDispatchedAt = Date.now();
      await Queue.dispatch(new CertificationRedisDelayedJob(), { queue: queueName, delay: 1 });
      await Queue.dispatch(new CertificationRedisFailedJob(), { queue: queueName, maxAttempts: 1 });
      await rawBullQueue.add(
        'UnregisteredRedisCertificationJob',
        { jobClass: 'UnregisteredRedisCertificationJob', payload: '{}' },
        { attempts: 1, removeOnFail: true },
      );
      await rawBullQueue.close();
      expect(await Queue.size(queueName)).toBeGreaterThanOrEqual(1);

      const workPromise = Queue.work({ queue: queueName, concurrency: 1 });
      await waitUntil(() => handled.includes('redis'), 10_000);
      await waitUntil(() => handled.includes('retry'), 10_000);
      await waitUntil(() => handled.includes('delayed'), 10_000);
      await waitUntil(async () => {
        const failures = await Queue.failed();
        return failures.some((job: any) => job.jobClass === 'CertificationRedisFailedJob');
      }, 10_000);
      await waitUntil(async () => {
        const failures = await Queue.failed();
        return failures.some((job: any) => job.jobClass === 'UnregisteredRedisCertificationJob');
      }, 10_000);
      await Queue.stop();
      await workPromise;

      expect(handled).toContain('redis');
      expect(handled).toContain('retry');
      expect(attempts).toEqual(['retry', 'retry']);
      expect(handled).toContain('delayed');
      expect(timestamps.delayed - delayedDispatchedAt).toBeGreaterThanOrEqual(800);
      expect((await Queue.failed()).some((job: any) => job.jobClass === 'CertificationRedisFailedJob')).toBe(true);
      expect((await Queue.failed()).some((job: any) => job.jobClass === 'UnregisteredRedisCertificationJob')).toBe(true);
      expect(await Queue.flushFailed()).toBeGreaterThanOrEqual(2);

      let failedJobsTableRenamed = false;
      try {
        await Connection.raw('ALTER TABLE svelar_failed_jobs RENAME TO svelar_failed_jobs_missing');
        failedJobsTableRenamed = true;

        const failingWorkPromise = Queue.work({ queue: queueName, concurrency: 1 });
        await Queue.dispatch(new CertificationRedisFailedJob(), { queue: queueName, maxAttempts: 1 });

        const redisFailure = await Promise.race([
          failingWorkPromise.then(
            () => {
              throw new Error('Redis worker exited without reporting failed job persistence failure.');
            },
            (error) => error,
          ),
          new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Timed out waiting for Redis failed job persistence failure.')), 10_000);
          }),
        ]);

        expect(redisFailure.message).toContain('svelar_failed_jobs');
      } finally {
        await Queue.stop();
        if (failedJobsTableRenamed) {
          await Connection.raw('ALTER TABLE svelar_failed_jobs_missing RENAME TO svelar_failed_jobs');
        }
      }
    } finally {
      await Queue.stop();
      await redis.quit();
    }
  });

  it('runs Gotenberg PDF, merge, office, and screenshot drivers when Gotenberg is configured', async () => {
    if (!process.env.GOTENBERG_URL) return;

    PDF.configure({
      driver: 'gotenberg',
      gotenberg: {
        url: process.env.GOTENBERG_URL,
        timeout: 60_000,
      },
    });

    const health = await PDF.health();
    expect(health.status).toBe('up');

    const htmlPdf = await PDF.html(\`
      <!doctype html>
      <html>
        <body style="font-family: sans-serif">
          <h1>Svelar Gotenberg Certification</h1>
          <p>HTML to PDF works.</p>
        </body>
      </html>
    \`).margins({ top: '10mm', bottom: '10mm', left: '10mm', right: '10mm' }).generate();
    expectPdf(htmlPdf);

    const markdownPdf = await PDF.markdown('# Svelar Markdown\\n\\n- Gotenberg markdown works.').generate();
    expectPdf(markdownPdf);

    const mergedPdf = await PDF.merge()
      .addPdf(htmlPdf, 'html.pdf')
      .addPdf(markdownPdf, 'markdown.pdf')
      .generate();
    expectPdf(mergedPdf);

    const officePdf = await PDF.office(Buffer.from('Svelar office conversion certification.'), 'certification.txt').generate();
    expectPdf(officePdf);

    const screenshot = await PDF.screenshotHtml('<html><body style="background:#fff"><h1>Svelar Screenshot</h1></body></html>')
      .viewport(640, 360)
      .format('png')
      .generate();
    expect(screenshot.subarray(0, 4).toString('hex')).toBe('89504e47');
  }, 90_000);
});

function expectPdf(buffer: Buffer): void {
  expect(buffer.subarray(0, 4).toString()).toBe('%PDF');
  expect(buffer.length).toBeGreaterThan(1000);
}

async function startMailProviderServer(): Promise<{
  url: string;
  requests: Array<{ path: string; headers: Record<string, string | string[] | undefined>; body: any }>;
  close: () => Promise<void>;
}> {
  const requests: Array<{ path: string; headers: Record<string, string | string[] | undefined>; body: any }> = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    request.on('end', () => {
      const body = chunks.length > 0 ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null;
      requests.push({
        path: request.url ?? '/',
        headers: request.headers,
        body,
      });

      response.setHeader('content-type', 'application/json');
      if (request.url === '/postmark') {
        response.end(JSON.stringify({ MessageID: 'postmark-cert-id' }));
        return;
      }
      if (request.url === '/resend') {
        response.end(JSON.stringify({ id: 'resend-cert-id' }));
        return;
      }
      if (request.url === '/mailtrap') {
        response.end(JSON.stringify({ success: true, message_ids: ['mailtrap-cert-id'] }));
        return;
      }
      response.statusCode = 404;
      response.end(JSON.stringify({ message: 'Not found' }));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Mail provider mock did not bind a TCP port.');

  return {
    url: \`http://127.0.0.1:\${address.port}\`,
    requests,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

async function searchHits(ModelClass: any, query: string, options: Record<string, any> = {}): Promise<any[]> {
  try {
    const results = await ModelClass.search(query, options);
    return results.hits;
  } catch {
    return [];
  }
}

async function waitForSearchHit(ModelClass: any, query: string, slug: string): Promise<void> {
  await waitUntil(async () => {
    const hits = await searchHits(ModelClass, query);
    return hits.some((hit) => hit.slug === slug);
  }, 20_000);
}

async function waitForSearchEmpty(ModelClass: any, query: string): Promise<void> {
  await waitUntil(async () => {
    const hits = await searchHits(ModelClass, query);
    return hits.length === 0;
  }, 20_000);
}

async function readSseEvent(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<{ event: string; data: any; id?: string }> {
  const deadline = Date.now() + 5_000;
  let buffer = '';

  while (Date.now() < deadline) {
    const result = await Promise.race([
      reader.read(),
      new Promise<ReadableStreamReadResult<Uint8Array>>((resolve) => {
        setTimeout(() => resolve({ done: false, value: new Uint8Array() }), 100);
      }),
    ]);
    if (result.done) throw new Error('SSE stream closed before an event was received.');
    if (!result.value?.length) continue;

    buffer += new TextDecoder().decode(result.value);
    const separator = buffer.indexOf('\\n\\n');
    if (separator === -1) continue;

    const raw = buffer.slice(0, separator);
    const event: { event: string; data?: string; id?: string } = { event: 'message' };
    for (const line of raw.split('\\n')) {
      const index = line.indexOf(':');
      if (index === -1) continue;
      const key = line.slice(0, index);
      const value = line.slice(index + 1).trimStart();
      if (key === 'event') event.event = value;
      if (key === 'data') event.data = event.data === undefined ? value : \`\${event.data}\\n\${value}\`;
      if (key === 'id') event.id = value;
    }

    return {
      event: event.event,
      data: event.data ? JSON.parse(event.data) : null,
      id: event.id,
    };
  }

  throw new Error('Timed out waiting for SSE event.');
}

async function waitUntil(assertion: () => boolean | Promise<boolean>, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await assertion()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Timed out waiting for release certification condition.');
}
`;
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

async function waitForHttp(url) {
	const deadline = Date.now() + 120_000;
	while (Date.now() < deadline) {
		try {
			const response = await fetch(url);
			if (response.ok) return;
		} catch {
			// Service is still booting.
		}
		await new Promise((resolve) => setTimeout(resolve, 1000));
	}
	fail(`Timed out waiting for HTTP service ${url}`);
}

async function waitForHttpReachable(url) {
	const deadline = Date.now() + 120_000;
	while (Date.now() < deadline) {
		try {
			const response = await fetch(url);
			if (response.status < 500) return;
		} catch {
			// Service is still booting.
		}
		await new Promise((resolve) => setTimeout(resolve, 1000));
	}
	fail(`Timed out waiting for reachable HTTP service ${url}`);
}
