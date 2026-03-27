/**
 * Log Viewer
 *
 * Utility for inspecting and filtering logs from the admin dashboard.
 * Stores recent logs in a ring buffer and provides live tailing support.
 *
 * @example
 * ```ts
 * import { LogViewer } from 'svelar/logging';
 *
 * // Query logs with filtering
 * const errors = LogViewer.getRecentErrors(10);
 *
 * // Get stats
 * const stats = LogViewer.getStats();
 *
 * // Live tailing
 * const unsubscribe = LogViewer.tail((entry) => {
 *   console.log(`${entry.level}: ${entry.message}`);
 * });
 *
 * // Stop tailing
 * unsubscribe();
 * ```
 */

import type { LogLevel } from './index.js';
import { singleton } from '../support/singleton.js';

// ── Types ──────────────────────────────────────────────────

export interface LogEntry {
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
  limit?: number;
  offset?: number;
}

export interface LogStats {
  totalEntries: number;
  byLevel: Record<string, number>;
  byChannel: Record<string, number>;
}

type TailCallback = (entry: LogEntry) => void;

// ── Log Viewer Service ─────────────────────────────────────

class LogViewerService {
  private ringBuffer: LogEntry[] = [];
  private maxSize = 10000;
  private currentIndex = 0;
  private tailSubscribers: TailCallback[] = [];

  /**
   * Add a log entry to the ring buffer.
   * Called internally by the logging system.
   */
  addEntry(entry: Omit<LogEntry, 'channel'> & { channel?: string }): void {
    const logEntry: LogEntry = {
      timestamp: entry.timestamp,
      level: entry.level,
      channel: entry.channel ?? 'default',
      message: entry.message,
      context: entry.context,
    };

    // Add to ring buffer
    if (this.ringBuffer.length < this.maxSize) {
      this.ringBuffer.push(logEntry);
    } else {
      this.ringBuffer[this.currentIndex] = logEntry;
      this.currentIndex = (this.currentIndex + 1) % this.maxSize;
    }

    // Notify tail subscribers
    for (const callback of this.tailSubscribers) {
      try {
        callback(logEntry);
      } catch {
        // Silently ignore subscriber errors to prevent cascading failures
      }
    }
  }

  /**
   * Query logs with filtering and pagination.
   */
  query(filter: LogFilter = {}): LogEntry[] {
    let results = this.getAllEntries();

    // Filter by level
    if (filter.level) {
      const levelMap: Record<LogLevel, number> = {
        debug: 0,
        info: 1,
        warn: 2,
        error: 3,
        fatal: 4,
      };
      const minLevel = levelMap[filter.level];
      results = results.filter((entry) => levelMap[entry.level] >= minLevel);
    }

    // Filter by channel
    if (filter.channel) {
      results = results.filter((entry) => entry.channel === filter.channel);
    }

    // Filter by date range
    if (filter.since) {
      const sinceTime = filter.since.getTime();
      results = results.filter((entry) => new Date(entry.timestamp).getTime() >= sinceTime);
    }

    if (filter.until) {
      const untilTime = filter.until.getTime();
      results = results.filter((entry) => new Date(entry.timestamp).getTime() <= untilTime);
    }

    // Filter by search string (case-insensitive)
    if (filter.search) {
      const searchLower = filter.search.toLowerCase();
      results = results.filter(
        (entry) =>
          entry.message.toLowerCase().includes(searchLower) ||
          JSON.stringify(entry.context).toLowerCase().includes(searchLower),
      );
    }

    // Apply pagination
    const offset = filter.offset ?? 0;
    const limit = filter.limit ?? 100;

    return results.slice(offset, offset + limit);
  }

  /**
   * Get log statistics.
   */
  getStats(): LogStats {
    const entries = this.getAllEntries();
    const stats: LogStats = {
      totalEntries: entries.length,
      byLevel: {},
      byChannel: {},
    };

    for (const entry of entries) {
      stats.byLevel[entry.level] = (stats.byLevel[entry.level] ?? 0) + 1;
      stats.byChannel[entry.channel] = (stats.byChannel[entry.channel] ?? 0) + 1;
    }

    return stats;
  }

  /**
   * Get recent errors and critical logs (shortcut).
   */
  getRecentErrors(limit: number = 10): LogEntry[] {
    const entries = this.getAllEntries();
    return entries
      .filter((entry) => entry.level === 'error' || entry.level === 'fatal')
      .slice(-limit)
      .reverse();
  }

  /**
   * Clear all stored logs.
   */
  clear(): void {
    this.ringBuffer = [];
    this.currentIndex = 0;
  }

  /**
   * Register a callback for live log tailing.
   * Returns an unsubscribe function.
   */
  tail(callback: TailCallback, filter?: LogFilter): () => void {
    // If a filter is provided, wrap the callback to apply filtering
    const wrappedCallback = filter
      ? (entry: LogEntry) => {
          if (this.matchesFilter(entry, filter)) {
            callback(entry);
          }
        }
      : callback;

    this.tailSubscribers.push(wrappedCallback);

    // Return unsubscribe function
    return () => {
      const index = this.tailSubscribers.indexOf(wrappedCallback);
      if (index > -1) {
        this.tailSubscribers.splice(index, 1);
      }
    };
  }

  // ── Private Methods ────────────────────────────────────

  /**
   * Get all entries from the ring buffer in chronological order.
   */
  private getAllEntries(): LogEntry[] {
    if (this.ringBuffer.length < this.maxSize) {
      // Buffer not yet full, entries are in order
      return [...this.ringBuffer];
    }

    // Buffer is full, entries wrap around
    // currentIndex points to the oldest entry
    return [
      ...this.ringBuffer.slice(this.currentIndex),
      ...this.ringBuffer.slice(0, this.currentIndex),
    ];
  }

  /**
   * Check if a log entry matches the given filter.
   */
  private matchesFilter(entry: LogEntry, filter: LogFilter): boolean {
    if (filter.level) {
      const levelMap: Record<LogLevel, number> = {
        debug: 0,
        info: 1,
        warn: 2,
        error: 3,
        fatal: 4,
      };
      const minLevel = levelMap[filter.level];
      if (levelMap[entry.level] < minLevel) return false;
    }

    if (filter.channel && entry.channel !== filter.channel) {
      return false;
    }

    if (filter.since) {
      const sinceTime = filter.since.getTime();
      if (new Date(entry.timestamp).getTime() < sinceTime) return false;
    }

    if (filter.until) {
      const untilTime = filter.until.getTime();
      if (new Date(entry.timestamp).getTime() > untilTime) return false;
    }

    if (filter.search) {
      const searchLower = filter.search.toLowerCase();
      const matches =
        entry.message.toLowerCase().includes(searchLower) ||
        JSON.stringify(entry.context).toLowerCase().includes(searchLower);
      if (!matches) return false;
    }

    return true;
  }
}

// ── Singleton Export ────────────────────────────────────

/**
 * Global LogViewer singleton
 */
export const LogViewer = singleton('svelar.logViewer', () => new LogViewerService());
