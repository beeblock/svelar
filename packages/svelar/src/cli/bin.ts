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

// Code generators
import { MakeModelCommand } from './commands/MakeModelCommand.js';
import { MakeMigrationCommand } from './commands/MakeMigrationCommand.js';
import { MakeControllerCommand } from './commands/MakeControllerCommand.js';
import { MakeMiddlewareCommand } from './commands/MakeMiddlewareCommand.js';
import { MakeProviderCommand } from './commands/MakeProviderCommand.js';
import { MakeSeederCommand } from './commands/MakeSeederCommand.js';
import { MakeServiceCommand } from './commands/MakeServiceCommand.js';
import { MakeRepositoryCommand } from './commands/MakeRepositoryCommand.js';
import { MakeActionCommand } from './commands/MakeActionCommand.js';
import { MakeRequestCommand } from './commands/MakeRequestCommand.js';
import { MakePluginCommand } from './commands/MakePluginCommand.js';
import { MakeTaskCommand } from './commands/MakeTaskCommand.js';
import { MakeJobCommand } from './commands/MakeJobCommand.js';
import { MakeCommandCommand } from './commands/MakeCommandCommand.js';
import { MakeConfigCommand } from './commands/MakeConfigCommand.js';
import { MakeChannelCommand } from './commands/MakeChannelCommand.js';
import { MakeDockerCommand } from './commands/MakeDockerCommand.js';
import { MakeBroadcastingCommand } from './commands/MakeBroadcastingCommand.js';
import { MakeDashboardCommand } from './commands/MakeDashboardCommand.js';
import { MakeResourceCommand } from './commands/MakeResourceCommand.js';
import { MakeSchemaCommand } from './commands/MakeSchemaCommand.js';
import { MakeObserverCommand } from './commands/MakeObserverCommand.js';
import { MakeEventCommand } from './commands/MakeEventCommand.js';
import { MakeListenerCommand } from './commands/MakeListenerCommand.js';
import { MakeRouteCommand } from './commands/MakeRouteCommand.js';
import { RoutesListCommand } from './commands/RoutesListCommand.js';

// Database
import { MigrateCommand } from './commands/MigrateCommand.js';
import { SeedCommand } from './commands/SeedCommand.js';

// Scheduler & Queue
import { ScheduleRunCommand } from './commands/ScheduleRunCommand.js';
import { QueueWorkCommand } from './commands/QueueWorkCommand.js';
import { QueueFailedCommand } from './commands/QueueFailedCommand.js';
import { QueueRetryCommand } from './commands/QueueRetryCommand.js';
import { QueueFlushCommand } from './commands/QueueFlushCommand.js';

// Utilities
import { TinkerCommand } from './commands/TinkerCommand.js';

// Project scaffolding
import { NewCommand } from './commands/NewCommand.js';

// Key generation
import { KeyGenerateCommand } from './commands/KeyGenerateCommand.js';

// Plugins
import { PluginListCommand } from './commands/PluginListCommand.js';
import { PluginPublishCommand } from './commands/PluginPublishCommand.js';
import { PluginInstallCommand } from './commands/PluginInstallCommand.js';

const cli = new Cli('0.1.0');

// Register all built-in commands
cli.register(NewCommand);
cli.register(KeyGenerateCommand);
cli.register(MakeModelCommand);
cli.register(MakeMigrationCommand);
cli.register(MakeControllerCommand);
cli.register(MakeMiddlewareCommand);
cli.register(MakeProviderCommand);
cli.register(MakeSeederCommand);
cli.register(MakeServiceCommand);
cli.register(MakeRepositoryCommand);
cli.register(MakeActionCommand);
cli.register(MakeRequestCommand);
cli.register(MakeResourceCommand);
cli.register(MakeSchemaCommand);
cli.register(MakePluginCommand);
cli.register(MakeTaskCommand);
cli.register(MakeJobCommand);
cli.register(MakeCommandCommand);
cli.register(MakeConfigCommand);
cli.register(MakeChannelCommand);
cli.register(MakeDockerCommand);
cli.register(MakeBroadcastingCommand);
cli.register(MakeDashboardCommand);
cli.register(MakeObserverCommand);
cli.register(MakeEventCommand);
cli.register(MakeListenerCommand);
cli.register(MakeRouteCommand);
cli.register(RoutesListCommand);
cli.register(MigrateCommand);
cli.register(SeedCommand);
cli.register(ScheduleRunCommand);
cli.register(QueueWorkCommand);
cli.register(QueueFailedCommand);
cli.register(QueueRetryCommand);
cli.register(QueueFlushCommand);
cli.register(TinkerCommand);
cli.register(PluginListCommand);
cli.register(PluginPublishCommand);
cli.register(PluginInstallCommand);

// ── Auto-discover user commands ─────────────────────────────
// Scans src/lib/commands/ in the user's project for custom Command classes.
// Each .ts/.js file should export a class extending Command as default or named export.

async function discoverUserCommands(): Promise<void> {
  const { join } = await import('node:path');
  const { existsSync, readdirSync } = await import('node:fs');
  const { pathToFileURL } = await import('node:url');

  const commandsDir = join(process.cwd(), 'src', 'lib', 'shared', 'commands');
  if (!existsSync(commandsDir)) return;

  const files = readdirSync(commandsDir).filter(
    (f) => (f.endsWith('.ts') || f.endsWith('.js')) && !f.startsWith('.')
  );

  for (const file of files) {
    try {
      const filePath = join(commandsDir, file);
      const fileUrl = pathToFileURL(filePath).href;
      const mod = await import(fileUrl);

      // Try default export first, then named exports
      const CommandClass = mod.default ?? Object.values(mod).find(
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

// Discover user commands then run
discoverUserCommands().then(() => cli.run());
