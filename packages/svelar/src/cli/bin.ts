#!/usr/bin/env node

/**
 * Svelar CLI — Laravel-like Artisan for SvelteKit
 *
 * Re-launches with --import ts-resolver.mjs so that dynamic imports of
 * user .ts files (tasks, commands, seeders) resolve .js → .ts correctly.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { register } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { createJiti } from 'jiti';

// Load .env file (zero-dependency, won't override existing env vars)
const envPath = join(process.cwd(), '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    // Strip surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

// Register the TS resolve hook so dynamic imports of .ts files work
const __dir = dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(join(__dir, 'ts-resolve-hook.mjs')).href, import.meta.url);

import { Cli } from './Cli.js';
import { BUILTIN_COMMANDS } from './BuiltinCommands.js';

// Read version from package.json so we never hardcode it
const __binDir = dirname(fileURLToPath(import.meta.url));
const pkgPath = join(__binDir, '..', '..', 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
const cli = new Cli(pkg.version);

// Register all built-in commands
for (const CommandClass of BUILTIN_COMMANDS) {
  cli.register(CommandClass);
}

// ── Auto-discover user commands ─────────────────────────────
// Scans user command folders for custom Command classes.
// Each .ts/.js file should export a class extending Command as default or named export.

async function discoverUserCommands(): Promise<void> {
  const { join } = await import('node:path');
  const { existsSync, readdirSync } = await import('node:fs');

  const commandDirs = [
    join(process.cwd(), 'src', 'lib', 'shared', 'commands'),
    join(process.cwd(), 'src', 'lib', 'commands'),
  ].filter((dir, index, dirs) => existsSync(dir) && dirs.indexOf(dir) === index);

  if (commandDirs.length === 0) return;

  const libPath = join(process.cwd(), 'src', 'lib');
  let jiti: ReturnType<typeof createJiti>;
  try {
    jiti = createJiti(pathToFileURL(join(process.cwd(), 'svelar-cli.mjs')).href, {
      alias: {
        '$lib': libPath,
        '$lib/*': `${libPath}/*`,
      },
      tsconfigPaths: true,
    });
  } catch {
    return;
  }

  for (const commandsDir of commandDirs) {
    const files = readdirSync(commandsDir).filter(
      (f) => (f.endsWith('.ts') || f.endsWith('.js')) && !f.startsWith('.')
    );

    for (const file of files) {
      try {
        const filePath = join(commandsDir, file);
        const mod = filePath.endsWith('.ts')
          ? await jiti.import(filePath)
          : await import(pathToFileURL(filePath).href);

        const CommandClass = [mod.default, ...Object.values(mod)].find(
          (v: any) => typeof v === 'function' && v.prototype && 'handle' in v.prototype
        );

        if (CommandClass && typeof CommandClass === 'function') {
          cli.add(new (CommandClass as any)());
        }
      } catch {
        // Skip files that fail to import (may need compilation, etc.)
      }
    }
  }
}

// Discover user commands then run. Finite CLI commands can bootstrap app
// services that leave open handles; force a clean process exit after the
// command has completed and Cli teardown has run.
discoverUserCommands()
  .then(() => cli.run())
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
