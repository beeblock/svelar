#!/usr/bin/env node

/**
 * Svelar CLI — Laravel-like Artisan for SvelteKit
 */

import { Cli } from './Cli.js';
import { MakeModelCommand } from './commands/MakeModelCommand.js';
import { MakeMigrationCommand } from './commands/MakeMigrationCommand.js';
import { MakeControllerCommand } from './commands/MakeControllerCommand.js';
import { MakeMiddlewareCommand } from './commands/MakeMiddlewareCommand.js';
import { MakeProviderCommand } from './commands/MakeProviderCommand.js';
import { MakeSeederCommand } from './commands/MakeSeederCommand.js';
import { MigrateCommand } from './commands/MigrateCommand.js';
import { TinkerCommand } from './commands/TinkerCommand.js';
import { SeedCommand } from './commands/SeedCommand.js';

const cli = new Cli('0.1.0');

// Register all built-in commands
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
