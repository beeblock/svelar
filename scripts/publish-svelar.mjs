#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(new URL('..', import.meta.url).pathname);
const corePackagePath = resolve(root, 'packages/svelar/package.json');

const args = process.argv.slice(2);
const options = {
  dryRun: args.includes('--dry-run'),
  skipValidation: args.includes('--skip-validation'),
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

if (!options.skipValidation) {
  run('npm', ['run', 'lint', '-w', 'packages/svelar']);
  run('npm', ['run', 'test', '-w', 'packages/svelar']);
  run('npm', ['run', 'build', '-w', 'packages/svelar']);
}

if (options.dryRun) {
  run('npm', ['pack', '--dry-run', '-w', 'packages/svelar']);
  console.log(`\nDry run complete: @beeblock/svelar ${corePackage.version}`);
  process.exit(0);
}

const publishArgs = ['publish', '--tag', options.tag];
if (options.otp) publishArgs.push('--otp', options.otp);

run('npm', [...publishArgs, '-w', 'packages/svelar']);

console.log(`\nPublished: @beeblock/svelar ${corePackage.version}`);
