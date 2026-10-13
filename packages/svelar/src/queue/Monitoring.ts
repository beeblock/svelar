import type { WorkerTelemetrySnapshot } from './BullMQTelemetry.js';

export type QueueJobStatus = 'waiting' | 'active' | 'completed' | 'failed' | 'delayed';
export interface QueueMetadataFilter {
  tenantId?: string | number;
  accountId?: string | number;
  resourceId?: string | number;
  correlationId?: string;
}
export interface QueueJobFilter extends QueueMetadataFilter {
  status?: QueueJobStatus;
  jobClass?: string;
  offset?: number;
  limit?: number;
}
export interface QueueLockObservation {
  source: 'worker-observation' | 'database-lease' | 'unavailable';
  state: 'observed' | 'expired' | 'none' | 'unknown';
  expiresAt: number | null;
  owner: string | null;
}
export interface QueueJobSnapshot {
  id: string;
  connection: string;
  queue: string;
  jobClass: string;
  status: QueueJobStatus;
  attempts: number;
  /** Native starts, including stalled attempts; distinct from completed/failed attempts. */
  attemptsStarted?: number;
  maxAttempts: number;
  stalledCount: number;
  createdAt: number;
  processedAt?: number;
  finishedAt?: number;
  delayedUntil?: number;
  metadata?: Record<string, any>;
  progress?: unknown;
  payload: string;
  error?: string;
  /** Redacted diagnostic traces, oldest to newest, bounded to the latest five / 32 KiB. */
  stacktrace?: readonly string[];
  stacktraceMeta?: { total: number; truncated: boolean };
  replayRecordId?: string;
  lock: QueueLockObservation;
}
export interface QueueJobPage {
  items: QueueJobSnapshot[];
  offset: number;
  limit: number;
  /** Index entries, not a claim that expired/foreign broker jobs were counted. */
  indexedCount: number;
  coverage: 'instrumented';
}
export interface QueueAdapterCounts {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  deadLetter: number;
}
export interface QueueSharedMetrics {
  source: 'redis' | 'database';
  completed: number;
  failed: number;
  completedPerMinute: number[];
  failedPerMinute: number[];
  /** Retained minute buckets, not process-local observations. */
  minutes: number;
}
export interface QueueAdapterRuntime {
  paused: boolean | null;
  workers: WorkerTelemetrySnapshot | null;
  globalConcurrency: number | null;
  observedConcurrency: number | null;
  effectiveConcurrency: number | null;
  oldestWaitingAt: number | null;
  lag: number | null;
  stalled: number | null;
  expiredLocks: number | null;
  /** False means foreign/missing lease observations or a bounded scan was incomplete. */
  locksComplete: boolean;
  coverage: 'instrumented';
}
export interface QueueTimelineEvent {
  id: string;
  event: string;
  at: number;
  attempt?: number;
  replayJobId?: string;
}
export interface QueueJobReference { id: string; source: 'live' | 'dead-letter'; }
export interface QueueMutationResult extends QueueJobReference {
  outcome: 'accepted' | 'missing' | 'busy' | 'not-failed' | 'protected';
  replayJobId?: string;
}
export interface QueueBatchResult {
  results: QueueMutationResult[];
  failures: Array<QueueJobReference & { error: string }>;
}
export interface QueueDeadLetterRecord {
  id: string;
  connection: string | null;
  queue: string;
  jobClass: string;
  payload: string;
  context?: Record<string, any>;
  metadata?: Record<string, any>;
  maxAttempts?: number;
  retryDelay?: number;
  priority?: number;
  exception: string;
  /** Unix seconds, matching the existing failed-job ledger contract. */
  failedAt: number;
  originalJobId?: string;
  replayJobId?: string;
  replayedAt?: number;
}
export interface QueueMonitoringAdapter {
  readonly connection: string;
  readonly queue: string;
  readonly driver: 'redis' | 'database' | 'memory' | 'sync';
  readonly capabilities: Readonly<{ shared: boolean; indexedMetadata: boolean; durableReplay: boolean; pause: boolean }>;
  counts(): Promise<QueueAdapterCounts>;
  list(filter?: QueueJobFilter): Promise<QueueJobPage>;
  get(id: string): Promise<QueueJobSnapshot | null>;
  runtime(): Promise<QueueAdapterRuntime>;
  metrics(minutes?: number): Promise<QueueSharedMetrics>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  timeline(reference: QueueJobReference, limit?: number): Promise<QueueTimelineEvent[]>;
  retry(reference: QueueJobReference): Promise<QueueMutationResult>;
  remove(reference: QueueJobReference): Promise<QueueMutationResult>;
  retryMany(references: readonly QueueJobReference[]): Promise<QueueBatchResult>;
  cleanup(references: readonly QueueJobReference[]): Promise<QueueBatchResult>;
  deadLetters(filter?: QueueJobFilter & { includeReplayed?: boolean }): Promise<QueueDeadLetterRecord[]>;
  deadLetter(id: string): Promise<QueueDeadLetterRecord | null>;
  reconcile(limit?: number): Promise<{ indexed: number; complete: boolean; deadLettersIndexed?: number }>;
  recover(): Promise<number>;
}

export class QueueCapabilityError extends Error {
  constructor(capability: string, driver: string) {
    super(`${capability} is unsupported by the ${driver} queue driver.`);
    this.name = 'QueueCapabilityError';
  }
}

export function pageOptions(filter: QueueJobFilter = {}): { offset: number; limit: number } {
  const offset = filter.offset ?? 0;
  const limit = filter.limit ?? 50;
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 0 || limit > 1000 || !Number.isSafeInteger(offset + limit)) {
    throw new RangeError('Queue pages require a non-negative offset and limit 0..1000.');
  }
  if (filter.status !== undefined && !['waiting', 'active', 'completed', 'failed', 'delayed'].includes(filter.status)) throw new TypeError('Invalid queue status.');
  return { offset, limit };
}

export function boundedLimit(value = 100, max = 1000): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > max) throw new RangeError(`Queue operation limit must be 1..${max}.`);
  return value;
}
