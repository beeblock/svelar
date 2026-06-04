#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(new URL('..', import.meta.url).pathname);
const corePackagePath = resolve(root, 'packages/svelar/package.json');
const cliPackagePath = resolve(root, 'packages/svelar-cli/package.json');

const args = process.argv.slice(2);
const options = {
  dryRun: args.includes('--dry-run'),
  skipValidation: args.includes('--skip-validation'),
  syncOnly: args.includes('--sync-only'),
  tag: valueFor('--tag') ?? 'latest',
  otp: valueFor('--otp'),
};

function valueFor(name) {
  const prefixed = args.find((arg) => arg.startsWith(`${name}=`));
  if (prefixed) return prefixed.slice(name.length + 1);

  const index = args.indexOf(name);
  if (index !== -1 && args[index + 1]) return args[index + 1];

  return undefined;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function run(command, commandArgs, env = {}) {
  console.log(`\n$ ${[command, ...commandArgs].join(' ')}`);
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, ...env },
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

const corePackage = readJson(corePackagePath);
const cliPackage = readJson(cliPackagePath);

cliPackage.version = corePackage.version;
cliPackage.dependencies ??= {};
cliPackage.dependencies['@beeblock/svelar'] = corePackage.version;
writeJson(cliPackagePath, cliPackage);

run('npm', ['install', '--package-lock-only', '--ignore-scripts']);

console.log(`\nSynced svelar CLI shim to @beeblock/svelar ${corePackage.version}.`);

if (options.syncOnly) {
  process.exit(0);
}

if (!options.skipValidation) {
  run('npm', ['run', 'lint', '-w', 'packages/svelar']);
  run('npm', ['run', 'test', '-w', 'packages/svelar']);
  run('npm', ['run', 'build', '-w', 'packages/svelar']);
}

if (options.dryRun) {
  run('npm', ['pack', '--dry-run', '-w', 'packages/svelar']);
  run('npm', ['pack', '--dry-run', '-w', 'packages/svelar-cli']);
  console.log(`\nDry run complete: @beeblock/svelar and svelar ${corePackage.version}`);
  process.exit(0);
}

const publishArgs = ['publish', '--tag', options.tag];
if (options.otp) publishArgs.push('--otp', options.otp);

run('npm', [...publishArgs, '-w', 'packages/svelar']);
run('npm', [...publishArgs, '-w', 'packages/svelar-cli']);

console.log(`\nPublished: @beeblock/svelar and svelar ${corePackage.version}`);
