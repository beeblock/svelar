/**
 * Svelar CLI Runner
 */

import { Command } from './Command.js';

export class Cli {
  private commands = new Map<string, Command>();
  private version: string;

  constructor(version: string = '0.1.0') {
    this.version = version;
  }

  /**
   * Register a command
   */
  register(CommandClass: new () => Command): this {
    const cmd = new CommandClass();
    this.commands.set(cmd.name, cmd);
    return this;
  }

  /**
   * Register a command instance
   */
  add(command: Command): this {
    this.commands.set(command.name, command);
    return this;
  }

  /**
   * Execute CLI with process arguments
   */
  async run(argv: string[] = process.argv.slice(2)): Promise<void> {
    const [commandName, ...rest] = argv;

    if (!commandName || commandName === '--help' || commandName === '-h') {
      this.showHelp();
      return;
    }

    if (commandName === '--version' || commandName === '-v') {
      console.log(`Svelar v${this.version}`);
      return;
    }

    const command = this.commands.get(commandName);
    if (!command) {
      console.error(`\x1b[31mUnknown command:\x1b[0m ${commandName}`);
      console.log(`Run \x1b[36msvelar --help\x1b[0m for available commands.`);
      process.exit(1);
      return;
    }

    // Show per-command help
    if (rest.includes('--help') || rest.includes('-h')) {
      this.showCommandHelp(command);
      return;
    }

    let exitCode = 0;
    command.exitCode = 0;
    try {
      const { args, flags } = this.parseArgs(rest, command);
      await command.handle(args, flags);
      exitCode = command.exitCode;
    } catch (error: any) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`\x1b[31mError:\x1b[0m ${msg}`);
      if (error?.stack) console.error(error.stack);
      exitCode = 1;
    } finally {
      await this.teardownRuntime();
    }

    if (exitCode !== 0) {
      process.exit(exitCode);
    }
  }

  /**
   * Finite CLI commands bootstrap the user's app, which may open database
   * connections or start monitoring intervals. Tear those down so commands
   * like `svelar migrate` and `svelar seed:run` exit cleanly.
   */
  private async teardownRuntime(): Promise<void> {
    const teardownTasks: Array<() => Promise<void>> = [
      async () => {
        const { Dashboard } = await import('../dashboard/index.js');
        await Dashboard.shutdown();
      },
      async () => {
        const { Queue } = await import('../queue/index.js');
        await Queue.stop();
      },
      async () => {
        const { Connection } = await import('../database/Connection.js');
        await Connection.disconnect();
      },
    ];

    for (const task of teardownTasks) {
      try {
        await task();
      } catch {
        // Best-effort cleanup: command success should not become failure
        // because an optional runtime service was never configured.
      }
    }
  }

  private parseArgs(
    argv: string[],
    command: Command
  ): { args: string[]; flags: Record<string, any> } {
    const args: string[] = [];
    const flags: Record<string, any> = {};

    // Set defaults
    for (const flag of command.flags) {
      if (flag.default !== undefined) {
        flags[flag.name] = flag.default;
      }
    }

    for (let i = 0; i < argv.length; i++) {
      const arg = argv[i];

      if (arg === '--') {
        args.push(...argv.slice(i + 1));
        break;
      }

      if (arg.startsWith('--')) {
        const raw = arg.slice(2);

        // Support --key=value syntax
        const eqIdx = raw.indexOf('=');
        if (eqIdx !== -1) {
          const key = raw.slice(0, eqIdx);
          const flagDef = command.flags.find((f) => f.name === key);
          if (!flagDef) throw new Error(`Unknown option --${key} for ${command.name}.`);
          const value = raw.slice(eqIdx + 1);
          if (flagDef.type === 'boolean') {
            if (value !== 'true' && value !== 'false') {
              throw new Error(`Option --${key} expects true or false.`);
            }
            flags[key] = value === 'true';
          } else {
            flags[key] = value;
          }
          continue;
        }

        if (raw.startsWith('no-')) {
          const key = raw.slice(3);
          const flagDef = command.flags.find((f) => f.name === key);
          if (flagDef?.type === 'boolean') {
            flags[key] = false;
            continue;
          }
        }

        const key = raw;
        const flagDef = command.flags.find((f) => f.name === key);
        if (!flagDef) throw new Error(`Unknown option --${key} for ${command.name}.`);

        if (flagDef?.type === 'boolean') {
          flags[key] = true;
        } else if (i + 1 < argv.length && !argv[i + 1].startsWith('-')) {
          flags[key] = argv[++i];
        } else {
          throw new Error(`Option --${key} requires a value.`);
        }
      } else if (arg.startsWith('-') && arg.length === 2) {
        const alias = arg.slice(1);
        const flagDef = command.flags.find((f) => f.alias === alias);

        if (!flagDef) throw new Error(`Unknown option -${alias} for ${command.name}.`);
        if (flagDef.type === 'boolean') {
          flags[flagDef.name] = true;
        } else if (i + 1 < argv.length && !argv[i + 1].startsWith('-')) {
          flags[flagDef.name] = argv[++i];
        } else {
          throw new Error(`Option -${alias} requires a value.`);
        }
      } else {
        args.push(arg);
      }
    }

    return { args, flags };
  }

  private showCommandHelp(command: Command): void {
    console.log(`\n\x1b[33mDescription:\x1b[0m`);
    console.log(`  ${command.description}\n`);
    console.log(`\x1b[33mUsage:\x1b[0m`);
    console.log(`  svelar ${command.name} [options]\n`);

    if (command.flags.length > 0) {
      console.log(`\x1b[33mOptions:\x1b[0m`);
      for (const flag of command.flags) {
        const alias = (flag as any).alias ? `-${(flag as any).alias}, ` : '    ';
        const name = `--${flag.name}`;
        const padding = 24 - alias.length - name.length;
        console.log(`  ${alias}${name}${' '.repeat(Math.max(1, padding))}${flag.description}`);
      }
      console.log();
    }
  }

  private showHelp(): void {
    console.log(`
\x1b[36m  ____           _
 / ___|_   _____| | __ _ _ __
 \\___ \\ \\ / / _ \\ |/ _\` | '__|
  ___) \\ V /  __/ | (_| | |
 |____/ \\_/ \\___|_|\\__,_|_|\x1b[0m  v${this.version}

\x1b[33mUsage:\x1b[0m
  svelar <command> [arguments] [options]

\x1b[33mAvailable Commands:\x1b[0m`);

    // Group commands by prefix
    const groups = new Map<string, Command[]>();
    for (const [, cmd] of this.commands) {
      const prefix = cmd.name.includes(':') ? cmd.name.split(':')[0] : 'general';
      if (!groups.has(prefix)) groups.set(prefix, []);
      groups.get(prefix)!.push(cmd);
    }

    for (const [group, commands] of groups) {
      console.log(`\n  \x1b[32m${group}\x1b[0m`);
      for (const cmd of commands) {
        const padding = 30 - cmd.name.length;
        console.log(`    \x1b[36m${cmd.name}\x1b[0m${' '.repeat(Math.max(1, padding))}${cmd.description}`);
      }
    }

    console.log();
  }
}
