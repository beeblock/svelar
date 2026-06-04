#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const corePackageRoot = join(repoRoot, 'packages/svelar');
const testingRoot = resolve(repoRoot, '../svelar-testing-area');
const appsRoot = join(testingRoot, 'apps');
const artifactsRoot = join(testingRoot, '.artifacts');

const args = new Set(process.argv.slice(2));
const appArg = valueFor('--app') ?? 'all';
const skipInstall = args.has('--skip-install');
const skipShadcn = args.has('--skip-shadcn');
const skipMigrate = args.has('--skip-migrate');
const skipTests = args.has('--skip-tests');
const skipBuild = args.has('--skip-build');
const keepExisting = args.has('--keep-existing');

if (args.has('--help') || args.has('-h')) {
	console.log(`Usage: node scripts/release-smoke.mjs [options]

Options:
  --app all|ddd|flat      Which scaffold shape to test. Default: all.
  --keep-existing        Do not delete existing generated app folders.
  --skip-install         Scaffold only; skip npm install and later checks.
  --skip-shadcn          Skip shadcn-svelte component generation.
  --skip-migrate         Skip migrations and seeders.
  --skip-tests           Skip generated app tests.
  --skip-build           Skip generated app production build.
`);
	process.exit(0);
}

if (!['all', 'ddd', 'flat'].includes(appArg)) {
	fail(`Invalid --app value "${appArg}". Use all, ddd, or flat.`);
}

mkdirSync(appsRoot, { recursive: true });
mkdirSync(artifactsRoot, { recursive: true });

section('Building local @beeblock/svelar');
run('npm', ['run', 'build', '-w', 'packages/svelar'], { cwd: repoRoot });

section('Packing local @beeblock/svelar');
const tarballPath = packLocalCore();
console.log(`Packed ${tarballPath}`);

const targets =
	appArg === 'all'
		? [
				{ name: 'svelar-smoke-ddd', flat: false, port: 5179 },
				{ name: 'svelar-smoke-flat', flat: true, port: 5180 },
			]
		: [{ name: `svelar-smoke-${appArg}`, flat: appArg === 'flat', port: appArg === 'flat' ? 5180 : 5179 }];

for (const target of targets) {
	smokeApp(target, tarballPath);
}

section('Smoke complete');
console.log(`Generated apps are in ${appsRoot}`);

function smokeApp(target, tarballPath) {
	const appDir = join(appsRoot, target.name);

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
		run('npx', ['svelar', 'migrate'], { cwd: appDir });
		run('npx', ['svelar', 'seed:run'], { cwd: appDir });
	}

	if (!skipTests) {
		section(`Testing ${target.name}`);
		run('npm', ['run', 'test'], { cwd: appDir });
	}

	if (!skipBuild) {
		section(`Building ${target.name}`);
		run('npm', ['run', 'build'], { cwd: appDir });
	}
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

	return join(artifactsRoot, tarballName);
}

function patchAppPackage(appDir, tarballPath, port) {
	const packagePath = join(appDir, 'package.json');
	const pkg = JSON.parse(readFileSync(packagePath, 'utf8'));
	const localTarball = relative(appDir, tarballPath).replaceAll('\\', '/');

	pkg.dependencies ??= {};
	pkg.scripts ??= {};
	pkg.dependencies['@beeblock/svelar'] = `file:${localTarball}`;
	pkg.scripts['smoke:serve'] = `vite dev --host 127.0.0.1 --port ${port}`;

	writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
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
