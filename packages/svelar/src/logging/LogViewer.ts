import type { LogLevel } from './index.js';
import { QueryBuilder } from '../orm/QueryBuilder.js';
import { singleton } from '../support/singleton.js';
import { redactLogContext, redactLogText } from './Redaction.js';

export interface LogEntry {
  id?: number;
  timestamp: string;
  level: LogLevel;
  channel: string;
  message: string;
  context: Record<string, any>;
}
export interface LogFilter {
  level?: LogLevel;
  channel?: string;
  since?: Date;
  until?: Date;
  search?: string;
  correlationId?: string;
  tenantId?: string | number;
  limit?: number;
  offset?: number;
  /** Exclusive entry ID, stable while other processes append entries. */
  cursor?: number;
}
export interface LogStats {
  totalEntries: number;
  byLevel: Record<string, number>;
  byChannel: Record<string, number>;
}
export interface LogPage {
  data: LogEntry[];
  meta: { nextCursor: number | null; hasMore: boolean; total: number; scope: 'process' | 'shared database' };
}
export interface LogViewerConfig {
  driver: 'memory' | 'database';
  connection?: string;
  maxEntries?: number;
  retentionSeconds?: number;
  tailIntervalMs?: number;
  /** Reports tail failures without recursively logging to the failed backend. */
  onTailError?: (error: unknown) => void;
}
const levels: LogLevel[] = ['debug', 'info', 'warn', 'error', 'fatal'];
type TailCallback = (entry: LogEntry) => void;

export class LogViewerService {
  private config: LogViewerConfig = { driver: 'memory' };
  private entries: LogEntry[] = [];
  private nextId = 1;
  private subscribers = new Set<TailCallback>();

  configure(config: LogViewerConfig): void {
    if (!['memory', 'database'].includes(config.driver)) throw new Error('Unknown log viewer driver.');
    for (const [name, value, minimum] of [
      ['maxEntries', config.maxEntries, 1], ['retentionSeconds', config.retentionSeconds, 1], ['tailIntervalMs', config.tailIntervalMs, 25],
    ] as const) {
      if (value !== undefined && (!Number.isSafeInteger(value) || value < minimum)) throw new Error(`Invalid log viewer ${name}.`);
    }
    if (this.subscribers.size) throw new Error('Close log tails before reconfiguring the viewer.');
    this.config = { ...config };
    this.entries = [];
    this.nextId = 1;
  }
  get scope(): 'process' | 'shared database' { return this.config.driver === 'database' ? 'shared database' : 'process'; }

  async addEntry(entry: Omit<LogEntry, 'channel'> & { channel?: string }): Promise<void> {
    if (!levels.includes(entry.level) || !Number.isFinite(new Date(entry.timestamp).getTime())) throw new Error('Invalid log entry.');
    const safe: LogEntry = { timestamp: new Date(entry.timestamp).toISOString(), level: entry.level,
      channel: entry.channel ?? 'default', message: redactLogText(entry.message), context: redactLogContext(entry.context) };
    if (this.config.driver === 'database') {
      await this.table().insert({ recorded_at: safe.timestamp, level: safe.level, channel: safe.channel,
        message: safe.message, context: JSON.stringify(safe.context),
        correlation_id: safe.context.correlationId == null ? null : String(safe.context.correlationId),
        tenant_id: safe.context.tenantId == null ? null : String(safe.context.tenantId) });
      return;
    }
    safe.id = this.nextId++;
    this.entries.push(safe);
    if (this.entries.length > (this.config.maxEntries ?? 10_000)) this.entries.shift();
    for (const callback of this.subscribers) {
      try { callback(structuredClone(safe)); } catch (error) { this.config.onTailError?.(error); }
    }
  }

  async query(filter: LogFilter = {}): Promise<LogEntry[]> {
    this.validateFilter(filter);
    const limit = filter.limit ?? 100;
    if (this.config.driver === 'memory') return this.filtered(filter).slice(filter.offset ?? 0, (filter.offset ?? 0) + limit).map((entry) => structuredClone(entry));
    const rows = await this.filteredQuery(filter).orderBy('id').offset(filter.offset ?? 0).limit(limit).get();
    return rows.map((row) => this.hydrate(row));
  }
  async page(filter: LogFilter = {}): Promise<LogPage> {
    this.validateFilter(filter);
    const limit = filter.limit ?? 100;
    const data = await this.query({ ...filter, limit: limit + 1 });
    const hasMore = data.length > limit;
    if (hasMore) data.pop();
    const total = this.config.driver === 'memory' ? this.filtered({ ...filter, cursor: undefined }).length
      : await this.filteredQuery({ ...filter, cursor: undefined }).count();
    return { data, meta: { nextCursor: hasMore ? data.at(-1)!.id! : null, hasMore, total, scope: this.scope } };
  }
  async getStats(): Promise<LogStats> {
    const stats: LogStats = { totalEntries: 0, byLevel: {}, byChannel: {} };
    if (this.config.driver === 'memory') {
      for (const entry of this.entries) {
        stats.totalEntries++;
        stats.byLevel[entry.level] = (stats.byLevel[entry.level] ?? 0) + 1;
        stats.byChannel[entry.channel] = (stats.byChannel[entry.channel] ?? 0) + 1;
      }
      return stats;
    }
    for (const key of ['level', 'channel'] as const) {
      const rows = await this.table().select(key).selectRaw('COUNT(*) AS total').groupBy(key).get();
      for (const row of rows) {
        const count = Number(row.total);
        if (key === 'level') { stats.byLevel[row.level] = count; stats.totalEntries += count; }
        else stats.byChannel[row.channel] = count;
      }
    }
    return stats;
  }
  async getRecentErrors(limit = 10): Promise<LogEntry[]> {
    this.validateFilter({ limit });
    if (this.config.driver === 'memory') return this.filtered({ level: 'error' }).slice(-limit).reverse().map((entry) => structuredClone(entry));
    return (await this.filteredQuery({ level: 'error' }).orderBy('id', 'desc').limit(limit).get()).map((row) => this.hydrate(row));
  }
  async clear(): Promise<void> {
    if (this.config.driver === 'database') await this.table().delete();
    else this.entries = [];
  }
  async prune(now = new Date()): Promise<number> {
    if (!Number.isFinite(now.getTime())) throw new Error('Invalid retention clock.');
    const cutoff = new Date(now.getTime() - (this.config.retentionSeconds ?? 30 * 86400) * 1000);
    if (this.config.driver === 'database') return this.table().where('recorded_at', '<', cutoff.toISOString()).delete();
    const before = this.entries.length;
    this.entries = this.entries.filter((entry) => new Date(entry.timestamp) >= cutoff);
    return before - this.entries.length;
  }

  /** Durable polling fans in entries from web, workers and scheduler; resume uses an entry ID. */
  tail(callback: TailCallback, filter: LogFilter = {}): () => void {
    this.validateFilter(filter);
    const listener = (entry: LogEntry) => { if (this.matches(entry, filter)) callback(entry); };
    this.subscribers.add(listener);
    if (this.config.driver === 'memory') return () => { this.subscribers.delete(listener); };
    let stopped = false;
    let busy = false;
    let cursor = filter.cursor;
    const tick = async () => {
      if (busy || stopped) return;
      busy = true;
      try {
        if (cursor === undefined) {
          const latest = await this.table().select('id').orderBy('id', 'desc').first();
          cursor = Number(latest?.id ?? 0);
        } else {
          const rows = await this.query({ ...filter, cursor, offset: 0, limit: 500 });
          for (const entry of rows) {
            if (stopped) break;
            cursor = entry.id!;
            try { listener(entry); } catch (error) { this.config.onTailError?.(error); }
          }
        }
      } catch (error) { this.config.onTailError?.(error); }
      finally { busy = false; }
    };
    void tick();
    const timer = setInterval(() => { void tick(); }, this.config.tailIntervalMs ?? 1000);
    timer.unref();
    return () => { stopped = true; clearInterval(timer); this.subscribers.delete(listener); };
  }

  private table(): QueryBuilder { return new QueryBuilder('svelar_logs', undefined, this.config.connection); }
  private filteredQuery(filter: LogFilter): QueryBuilder {
    const query = this.table();
    if (filter.level) query.whereIn('level', levels.slice(levels.indexOf(filter.level)));
    if (filter.channel) query.where('channel', filter.channel);
    if (filter.since) query.where('recorded_at', '>=', filter.since.toISOString());
    if (filter.until) query.where('recorded_at', '<=', filter.until.toISOString());
    if (filter.cursor !== undefined) query.where('id', '>', filter.cursor);
    if (filter.correlationId !== undefined) query.where('correlation_id', filter.correlationId);
    if (filter.tenantId !== undefined) query.where('tenant_id', String(filter.tenantId));
    if (filter.search) query.whereNested((nested) => nested.whereRaw('LOWER(message) LIKE ?', [`%${filter.search!.toLowerCase()}%`])
      .orWhereRaw('LOWER(context) LIKE ?', [`%${filter.search!.toLowerCase()}%`]));
    return query;
  }
  private hydrate(row: any): LogEntry {
    return { id: Number(row.id), timestamp: new Date(row.recorded_at).toISOString(), level: row.level,
      channel: row.channel, message: row.message, context: JSON.parse(row.context) };
  }
  private filtered(filter: LogFilter): LogEntry[] { return this.entries.filter((entry) => this.matches(entry, filter)); }
  private matches(entry: LogEntry, filter: LogFilter): boolean {
    return (!filter.level || levels.indexOf(entry.level) >= levels.indexOf(filter.level)) &&
      (!filter.channel || entry.channel === filter.channel) && (!filter.since || new Date(entry.timestamp) >= filter.since) &&
      (!filter.until || new Date(entry.timestamp) <= filter.until) && (filter.cursor === undefined || entry.id! > filter.cursor) &&
      (filter.correlationId === undefined || entry.context.correlationId === filter.correlationId) &&
      (filter.tenantId === undefined || String(entry.context.tenantId) === String(filter.tenantId)) &&
      (!filter.search || `${entry.message} ${JSON.stringify(entry.context)}`.toLowerCase().includes(filter.search.toLowerCase()));
  }
  private validateFilter(filter: LogFilter): void {
    if (filter.level && !levels.includes(filter.level)) throw new Error('Invalid log level.');
    for (const [key, min, max] of [['limit', 1, 10_001], ['offset', 0, 1_000_000], ['cursor', 0, Number.MAX_SAFE_INTEGER]] as const) {
      const value = filter[key];
      if (value !== undefined && (!Number.isSafeInteger(value) || value < min || value > max)) throw new Error(`Invalid log ${key}.`);
    }
    for (const date of [filter.since, filter.until]) if (date && !Number.isFinite(date.getTime())) throw new Error('Invalid log date.');
  }
}
export const LogViewer = singleton('svelar.logViewer', () => new LogViewerService());
