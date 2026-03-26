/**
 * Svelar Logger
 *
 * Structured logging with channels (console, file, custom).
 *
 * @example
 * ```ts
 * import { Log } from 'svelar/logging';
 *
 * Log.configure({
 *   default: 'stack',
 *   channels: {
 *     console: { driver: 'console', level: 'debug' },
 *     file: { driver: 'file', path: 'storage/logs/app.log', level: 'info' },
 *     stack: { driver: 'stack', channels: ['console', 'file'] },
 *   },
 * });
 *
 * Log.info('User registered', { userId: 1 });
 * Log.error('Payment failed', { orderId: 123, error: 'insufficient_funds' });
 * Log.channel('file').warn('Disk space low');
 * ```
 */

import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

// ── Types ──────────────────────────────────────────────────

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';
export type LogDriver = 'console' | 'file' | 'stack' | 'null';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  fatal: 4,
};

export interface LogChannelConfig {
  driver: LogDriver;
  level?: LogLevel;
  /** File path for file driver */
  path?: string;
  /** Channel names for stack driver */
  channels?: string[];
  /** Custom formatter */
  format?: 'text' | 'json';
}

export interface LogConfig {
  default: string;
  channels: Record<string, LogChannelConfig>;
}

interface LogEntry {
  level: LogLevel;
  message: string;
  context: Record<string, any>;
  timestamp: string;
}

// ── Channel Interface ──────────────────────────────────────

interface Channel {
  write(entry: LogEntry): void | Promise<void>;
  minLevel: LogLevel;
}

// ── Console Channel ────────────────────────────────────────

class ConsoleChannel implements Channel {
  minLevel: LogLevel;
  private format: 'text' | 'json';

  constructor(config: LogChannelConfig) {
    this.minLevel = config.level ?? 'debug';
    this.format = config.format ?? 'text';
  }

  write(entry: LogEntry): void {
    if (LOG_LEVELS[entry.level] < LOG_LEVELS[this.minLevel]) return;

    if (this.format === 'json') {
      console.log(JSON.stringify(entry));
      return;
    }

    const colors: Record<LogLevel, string> = {
      debug: '\x1b[90m',
      info: '\x1b[34m',
      warn: '\x1b[33m',
      error: '\x1b[31m',
      fatal: '\x1b[35m',
    };
    const reset = '\x1b[0m';
    const color = colors[entry.level] ?? '';
    const levelStr = entry.level.toUpperCase().padEnd(5);

    const contextStr = Object.keys(entry.context).length > 0
      ? ` ${JSON.stringify(entry.context)}`
      : '';

    const method = entry.level === 'error' || entry.level === 'fatal' ? 'error' : 'log';
    console[method](`${color}[${entry.timestamp}] ${levelStr}${reset} ${entry.message}${contextStr}`);
  }
}

// ── File Channel ───────────────────────────────────────────

class FileChannel implements Channel {
  minLevel: LogLevel;
  private path: string;
  private format: 'text' | 'json';
  private initialized = false;

  constructor(config: LogChannelConfig) {
    this.minLevel = config.level ?? 'info';
    this.path = config.path ?? 'storage/logs/app.log';
    this.format = config.format ?? 'text';
  }

  async write(entry: LogEntry): Promise<void> {
    if (LOG_LEVELS[entry.level] < LOG_LEVELS[this.minLevel]) return;

    if (!this.initialized) {
      await mkdir(dirname(this.path), { recursive: true });
      this.initialized = true;
    }

    let line: string;

    if (this.format === 'json') {
      line = JSON.stringify(entry) + '\n';
    } else {
      const levelStr = entry.level.toUpperCase().padEnd(5);
      const contextStr = Object.keys(entry.context).length > 0
        ? ` ${JSON.stringify(entry.context)}`
        : '';
      line = `[${entry.timestamp}] ${levelStr} ${entry.message}${contextStr}\n`;
    }

    await appendFile(this.path, line);
  }
}

// ── Stack Channel ──────────────────────────────────────────

class StackChannel implements Channel {
  minLevel: LogLevel = 'debug';
  private channelNames: string[];
  private resolver: (name: string) => Channel | undefined;

  constructor(config: LogChannelConfig, resolver: (name: string) => Channel | undefined) {
    this.channelNames = config.channels ?? [];
    this.resolver = resolver;
    this.minLevel = config.level ?? 'debug';
  }

  async write(entry: LogEntry): Promise<void> {
    for (const name of this.channelNames) {
      const channel = this.resolver(name);
      if (channel) {
        await channel.write(entry);
      }
    }
  }
}

// ── Null Channel ───────────────────────────────────────────

class NullChannel implements Channel {
  minLevel: LogLevel = 'debug';
  write(): void { /* no-op */ }
}

// ── Logger Manager ─────────────────────────────────────────

class LoggerManager {
  private config: LogConfig = {
    default: 'console',
    channels: {
      console: { driver: 'console', level: 'debug' },
    },
  };
  private channels = new Map<string, Channel>();

  /**
   * Configure the logger
   */
  configure(config: LogConfig): void {
    this.config = config;
    this.channels.clear();
  }

  /**
   * Get a specific channel
   */
  channel(name: string): LoggerFacade {
    return new LoggerFacade(this.resolveChannel(name));
  }

  // ── Log Methods ──

  debug(message: string, context: Record<string, any> = {}): void {
    this.writeToDefault({ level: 'debug', message, context, timestamp: now() });
  }

  info(message: string, context: Record<string, any> = {}): void {
    this.writeToDefault({ level: 'info', message, context, timestamp: now() });
  }

  warn(message: string, context: Record<string, any> = {}): void {
    this.writeToDefault({ level: 'warn', message, context, timestamp: now() });
  }

  error(message: string, context: Record<string, any> = {}): void {
    this.writeToDefault({ level: 'error', message, context, timestamp: now() });
  }

  fatal(message: string, context: Record<string, any> = {}): void {
    this.writeToDefault({ level: 'fatal', message, context, timestamp: now() });
  }

  // ── Private ──

  private writeToDefault(entry: LogEntry): void {
    const channel = this.resolveChannel(this.config.default);
    channel.write(entry);
  }

  private resolveChannel(name: string): Channel {
    if (this.channels.has(name)) {
      return this.channels.get(name)!;
    }

    const channelConfig = this.config.channels[name];
    if (!channelConfig) {
      // Fallback to console
      const fallback = new ConsoleChannel({ driver: 'console' });
      this.channels.set(name, fallback);
      return fallback;
    }

    const channel = this.createChannel(channelConfig);
    this.channels.set(name, channel);
    return channel;
  }

  private createChannel(config: LogChannelConfig): Channel {
    switch (config.driver) {
      case 'console':
        return new ConsoleChannel(config);
      case 'file':
        return new FileChannel(config);
      case 'stack':
        return new StackChannel(config, (name) => this.resolveChannel(name));
      case 'null':
        return new NullChannel();
      default:
        return new ConsoleChannel(config);
    }
  }
}

// ── Logger Facade (for specific channels) ──────────────────

class LoggerFacade {
  constructor(private channel: Channel) {}

  debug(message: string, context: Record<string, any> = {}): void {
    this.channel.write({ level: 'debug', message, context, timestamp: now() });
  }
  info(message: string, context: Record<string, any> = {}): void {
    this.channel.write({ level: 'info', message, context, timestamp: now() });
  }
  warn(message: string, context: Record<string, any> = {}): void {
    this.channel.write({ level: 'warn', message, context, timestamp: now() });
  }
  error(message: string, context: Record<string, any> = {}): void {
    this.channel.write({ level: 'error', message, context, timestamp: now() });
  }
  fatal(message: string, context: Record<string, any> = {}): void {
    this.channel.write({ level: 'fatal', message, context, timestamp: now() });
  }
}

function now(): string {
  return new Date().toISOString();
}

import { singleton } from '../support/singleton.js';

/**
 * Global Log singleton
 */
export const Log = singleton('svelar.log', () => new LoggerManager());

export type { Channel, LogEntry };
