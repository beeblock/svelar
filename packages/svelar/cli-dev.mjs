#!/usr/bin/env node

/**
 * Development CLI runner — runs the CLI directly from TypeScript source
 * using ts-node/esm loader. Use this when dist/ is not available or stale.
 *
 * Usage: node --loader ts-node/esm cli-dev.mjs <command> [args]
 */

import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

// Register ts-node ESM loader programmatically (Node v20+ way)
register('ts-node/esm', pathToFileURL('./'));

// Now import the CLI from source
const { Cli } = await import('./src/cli/Cli.js');
const { MigrateCommand } = await import('./src/cli/commands/MigrateCommand.js');
const { SeedCommand } = await import('./src/cli/commands/SeedCommand.js');
const { MakeModelCommand } = await import('./src/cli/commands/MakeModelCommand.js');
const { MakeMigrationCommand } = await import('./src/cli/commands/MakeMigrationCommand.js');
const { MakeControllerCommand } = await import('./src/cli/commands/MakeControllerCommand.js');
const { MakeMiddlewareCommand } = await import('./src/cli/commands/MakeMiddlewareCommand.js');
const { MakeProviderCommand } = await import('./src/cli/commands/MakeProviderCommand.js');
const { MakeSeederCommand } = await import('./src/cli/commands/MakeSeederCommand.js');
const { TinkerCommand } = await import('./src/cli/commands/TinkerCommand.js');

const cli = new Cli('0.1.0');

cli.register(MakeModelCommand);
cli.register(MakeMigrationCommand);
cli.register(MakeControllerCommand);
cli.register(MakeMiddlewareCommand);
cli.register(MakeProviderCommand);
cli.register(MakeSeederCommand);
cli.register(MigrateCommand);
cli.register(SeedCommand);
cli.register(TinkerCommand);

cli.run();
