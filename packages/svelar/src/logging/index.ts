/**
 * Svelar Logger
 *
 * Structured logging with channels (console, file, custom).
 *
 * @example
 * ```ts
 * import { Log } from '@beeblock/svelar/logging';
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
import { LogViewer, type LogViewerConfig } from './LogViewer.js';
import { DEFAULT_REDACT_KEYS, redactLogContext, redactLogText } from './Redaction.js';
import { ApplicationContext, type ApplicationContextSnapshot } from '../support/Context.js';

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
  /** Context attached to every log entry after request/job context is applied. */
  context?: Record<string, any>;
  /** Sensitive context keys to redact before writing to channels/viewers. */
  redactKeys?: string[];
  viewer?: LogViewerConfig;
}

interface LogEntry {
  level: LogLevel;
  message: string;
  context: Record<string, any>;
  timestamp: string;
  channel?: string;
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
  private resolver: (name: string) => Channel;

  constructor(config: LogChannelConfig, resolver: (name: string) => Channel) {
    this.channelNames = config.channels ?? [];
    this.resolver = resolver;
    this.minLevel = config.level ?? 'debug';
  }

  async write(entry: LogEntry): Promise<void> {
    for (const name of this.channelNames) {
      const channel = this.resolver(name);
      await channel.write(entry);
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
  private context: Record<string, any> = {};
  private redactKeys = DEFAULT_REDACT_KEYS;

  /**
   * Configure the logger
   */
  configure(config: LogConfig): void {
    this.config = config;
    this.context = config.context ?? {};
    this.redactKeys = [...DEFAULT_REDACT_KEYS, ...(config.redactKeys ?? [])];
    this.channels.clear();
    if (config.viewer) LogViewer.configure(config.viewer);
  }

  /**
   * Get a specific channel
   */
  channel(name: string): LoggerFacade {
    return new LoggerFacade(this.resolveChannel(name), name, (context) => this.enrichContext(context));
  }

  /**
   * Add context to every subsequent log entry in this process.
   */
  setContext(context: Record<string, any>): void {
    this.context = { ...this.context, ...context };
  }

  /**
   * Clear process-wide logger context.
   */
  clearContext(): void {
    this.context = {};
  }

  /**
   * Run a callback with async-local log context.
   */
  withContext<T>(context: ApplicationContextSnapshot, callback: () => T | Promise<T>): T | Promise<T> {
    return ApplicationContext.run(context, callback);
  }

  // ── Log Methods ──

  debug(message: string, context: Record<string, any> = {}): Promise<void> {
    return this.writeToDefault({ level: 'debug', message, context, timestamp: now() });
  }

  info(message: string, context: Record<string, any> = {}): Promise<void> {
    return this.writeToDefault({ level: 'info', message, context, timestamp: now() });
  }

  warn(message: string, context: Record<string, any> = {}): Promise<void> {
    return this.writeToDefault({ level: 'warn', message, context, timestamp: now() });
  }

  error(message: string, context: Record<string, any> = {}): Promise<void> {
    return this.writeToDefault({ level: 'error', message, context, timestamp: now() });
  }

  fatal(message: string, context: Record<string, any> = {}): Promise<void> {
    return this.writeToDefault({ level: 'fatal', message, context, timestamp: now() });
  }

  // ── Private ──

  private writeToDefault(entry: LogEntry): Promise<void> {
    return this.writeToChannel(this.config.default, entry);
  }

  private async writeToChannel(name: string, entry: LogEntry): Promise<void> {
    const channel = this.resolveChannel(name);
    if (LOG_LEVELS[entry.level] < LOG_LEVELS[channel.minLevel]) return;

    const entryWithChannel = { ...entry, message: redactLogText(entry.message), context: this.enrichContext(entry.context), channel: name };
    await LogViewer.addEntry(entryWithChannel);
    await channel.write(entryWithChannel);
  }

  private enrichContext(context: Record<string, any>): Record<string, any> {
    const snapshot = ApplicationContext.snapshot();
    const standardContext: Record<string, any> = {};

    if (snapshot.requestId != null) standardContext.requestId = snapshot.requestId;
    if (snapshot.correlationId != null) standardContext.correlationId = snapshot.correlationId;
    if (snapshot.jobId != null) standardContext.jobId = snapshot.jobId;
    if (snapshot.teamId != null) standardContext.teamId = snapshot.teamId;
    if (snapshot.tenantId != null) standardContext.tenantId = snapshot.tenantId;
    if (snapshot.userId != null) standardContext.userId = snapshot.userId;
    if (snapshot.actorId != null) standardContext.actorId = snapshot.actorId;
    if (snapshot.integration != null) standardContext.integration = snapshot.integration;

    if (standardContext.tenantId == null && snapshot.teamId != null) {
      standardContext.tenantId = snapshot.teamId;
    }
    if (standardContext.actorId == null && snapshot.userId != null) {
      standardContext.actorId = snapshot.userId;
    }

    return redactLogContext({ ...standardContext, ...this.context, ...context }, this.redactKeys);
  }

  private resolveChannel(name: string): Channel {
    if (this.channels.has(name)) {
      return this.channels.get(name)!;
    }

    const channelConfig = this.config.channels[name];
    if (!channelConfig) {
      throw new Error(`Log channel "${name}" is not defined.`);
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
        throw new Error(`Unknown log driver: ${(config as any).driver}`);
    }
  }
}

// ── Logger Facade (for specific channels) ──────────────────

class LoggerFacade {
  constructor(
    private channel: Channel,
    private name: string,
    private enrichContext: (context: Record<string, any>) => Record<string, any>,
  ) {}

  debug(message: string, context: Record<string, any> = {}): Promise<void> {
    return this.write({ level: 'debug', message, context, timestamp: now() });
  }
  info(message: string, context: Record<string, any> = {}): Promise<void> {
    return this.write({ level: 'info', message, context, timestamp: now() });
  }
  warn(message: string, context: Record<string, any> = {}): Promise<void> {
    return this.write({ level: 'warn', message, context, timestamp: now() });
  }
  error(message: string, context: Record<string, any> = {}): Promise<void> {
    return this.write({ level: 'error', message, context, timestamp: now() });
  }
  fatal(message: string, context: Record<string, any> = {}): Promise<void> {
    return this.write({ level: 'fatal', message, context, timestamp: now() });
  }

  private async write(entry: LogEntry): Promise<void> {
    if (LOG_LEVELS[entry.level] < LOG_LEVELS[this.channel.minLevel]) return;

    const entryWithChannel = { ...entry, message: redactLogText(entry.message), context: this.enrichContext(entry.context), channel: this.name };
    await LogViewer.addEntry(entryWithChannel);
    await this.channel.write(entryWithChannel);
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
export { LogViewer, LogViewerService } from './LogViewer.js';
export type { LogFilter, LogStats, LogPage, LogViewerConfig } from './LogViewer.js';
