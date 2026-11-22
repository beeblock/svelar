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
import { logRedactKeys } from './Redaction.js';
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
  /** Disable channel output while retaining its original name in the viewer. */
  output?: boolean;
  /** Disable viewer capture for this channel. */
  viewer?: boolean;
}

export interface LogWriteOptions {
  output?: boolean;
  viewer?: boolean;
}

/** Runs in order on raw explicit context, before ambient enrichment and redaction. Null discards. */
export type LogProcessor = (entry: LogEntry) => LogEntry | null | Promise<LogEntry | null>;

export interface LogConfig {
  default: string;
  channels: Record<string, LogChannelConfig>;
  /** Context attached to every log entry after request/job context is applied. */
  context?: Record<string, any>;
  /** Sensitive context keys to redact before writing to channels/viewers. */
  redactKeys?: string[];
  viewer?: LogViewerConfig;
  processors?: LogProcessor[];
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

// ── Null Channel ───────────────────────────────────────────

class NullChannel implements Channel {
  minLevel: LogLevel = 'debug';
  constructor(config: LogChannelConfig) { this.minLevel = config.level ?? 'debug'; }
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
  private redactKeys = logRedactKeys();
  private processors: LogProcessor[] = [];

  /**
   * Configure the logger
   */
  configure(config: LogConfig): void {
    this.config = config;
    this.context = config.context ?? {};
    this.redactKeys = logRedactKeys([...(config.redactKeys ?? [])]);
    this.processors = [...(config.processors ?? [])];
    this.channels.clear();
    if (config.viewer) LogViewer.configure(config.viewer);
  }

  /**
   * Get a specific channel
   */
  channel(name: string): LoggerFacade {
    this.resolveChannel(name);
    return new LoggerFacade((entry, options) => this.writeToChannel(name, entry, options));
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

  debug(message: string, context: Record<string, any> = {}, options: LogWriteOptions = {}): Promise<void> {
    return this.writeToDefault({ level: 'debug', message, context, timestamp: now() }, options);
  }

  info(message: string, context: Record<string, any> = {}, options: LogWriteOptions = {}): Promise<void> {
    return this.writeToDefault({ level: 'info', message, context, timestamp: now() }, options);
  }

  warn(message: string, context: Record<string, any> = {}, options: LogWriteOptions = {}): Promise<void> {
    return this.writeToDefault({ level: 'warn', message, context, timestamp: now() }, options);
  }

  error(message: string, context: Record<string, any> = {}, options: LogWriteOptions = {}): Promise<void> {
    return this.writeToDefault({ level: 'error', message, context, timestamp: now() }, options);
  }

  fatal(message: string, context: Record<string, any> = {}, options: LogWriteOptions = {}): Promise<void> {
    return this.writeToDefault({ level: 'fatal', message, context, timestamp: now() }, options);
  }

  // ── Private ──

  private writeToDefault(entry: LogEntry, options: LogWriteOptions): Promise<void> {
    return this.writeToChannel(this.config.default, entry, options);
  }

  private async writeToChannel(name: string, entry: LogEntry, options: LogWriteOptions): Promise<void> {
    const channel = this.resolveChannel(name);
    if (LOG_LEVELS[entry.level] < LOG_LEVELS[channel.minLevel]) return;

    const config = this.config.channels[name];
    const viewer = (options.viewer ?? config.viewer ?? true) && LogViewer.enabled;
    let outputs = this.outputChannels(name, entry.level, options.output);
    if (!viewer && outputs.length === 0) return;

    let processed: LogEntry | null = { ...entry, channel: name };
    for (const processor of this.processors) {
      processed = await processor(processed);
      if (processed === null) return;
      if (!processed || !Object.hasOwn(LOG_LEVELS, processed.level)) throw new Error('Invalid log processor result.');
    }
    if (LOG_LEVELS[processed.level] < LOG_LEVELS[channel.minLevel]) return;
    if (processed.level !== entry.level) outputs = this.outputChannels(name, processed.level, options.output);
    if (!viewer && outputs.length === 0) return;

    const safe = LogViewer.prepareEntry({ ...processed, channel: name, context: this.enrichContext(processed.context) }, this.redactKeys);
    if (viewer) await LogViewer.addEntry(safe);
    for (const output of outputs) await output.write(safe);
  }

  private outputChannels(name: string, level: LogLevel, override?: boolean, ancestors = new Set<string>()): Channel[] {
    if (ancestors.has(name)) throw new Error(`Circular log stack at "${name}".`);
    const channel = this.resolveChannel(name);
    const config = this.config.channels[name];
    if ((override ?? config.output) === false || LOG_LEVELS[level] < LOG_LEVELS[channel.minLevel] || config.driver === 'null') return [];
    if (config.driver !== 'stack') return [channel];
    ancestors.add(name);
    try { return (config.channels ?? []).flatMap((child) => this.outputChannels(child, level, undefined, ancestors)); }
    finally { ancestors.delete(name); }
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

    return { ...standardContext, ...this.context, ...context };
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
      case 'null':
        return new NullChannel(config);
      default:
        throw new Error(`Unknown log driver: ${(config as any).driver}`);
    }
  }
}

// ── Logger Facade (for specific channels) ──────────────────

class LoggerFacade {
  constructor(
    private write: (entry: LogEntry, options: LogWriteOptions) => Promise<void>,
  ) {}

  debug(message: string, context: Record<string, any> = {}, options: LogWriteOptions = {}): Promise<void> {
    return this.write({ level: 'debug', message, context, timestamp: now() }, options);
  }
  info(message: string, context: Record<string, any> = {}, options: LogWriteOptions = {}): Promise<void> {
    return this.write({ level: 'info', message, context, timestamp: now() }, options);
  }
  warn(message: string, context: Record<string, any> = {}, options: LogWriteOptions = {}): Promise<void> {
    return this.write({ level: 'warn', message, context, timestamp: now() }, options);
  }
  error(message: string, context: Record<string, any> = {}, options: LogWriteOptions = {}): Promise<void> {
    return this.write({ level: 'error', message, context, timestamp: now() }, options);
  }
  fatal(message: string, context: Record<string, any> = {}, options: LogWriteOptions = {}): Promise<void> {
    return this.write({ level: 'fatal', message, context, timestamp: now() }, options);
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
export type { LogFilter, LogStats, LogPage, LogViewerConfig, LogEntryInput, LogPruneOptions } from './LogViewer.js';
