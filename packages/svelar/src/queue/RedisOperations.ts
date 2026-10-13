import { createHash } from 'node:crypto';
import { redactLogText } from '../logging/Redaction.js';
import { indexedMetadata, metadataFields, metadataKeys, metadataValue } from './Metadata.js';
import { boundedLimit, pageOptions, type QueueJobFilter, type QueueJobPage, type QueueJobSnapshot, type QueueJobStatus, type QueueTimelineEvent } from './Monitoring.js';

const indexScript = `
local old = redis.call('HGET', KEYS[1], ARGV[1])
local data = cjson.decode(ARGV[2])
if old then
 local previous = cjson.decode(old)
 for _, key in ipairs(previous.indexKeys) do redis.call('ZREM', key, ARGV[1]) end
 if data.status == 'active' then data.lock = previous.lock end
end
for _, key in ipairs(data.indexKeys) do redis.call('ZADD', key, data.createdAt, ARGV[1]) end
redis.call('HSET', KEYS[1], ARGV[1], cjson.encode(data))
if ARGV[3] ~= '' then
 local time = redis.call('TIME')
 local at = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
 redis.call('XADD', KEYS[2], 'MAXLEN', '=', 100, '*', 'event', ARGV[3], 'at', at, 'attempt', ARGV[4])
end
return 1
`;
const removeScript = `
local raw = redis.call('HGET', KEYS[1], ARGV[1])
if raw then
 local data = cjson.decode(raw)
 for _, key in ipairs(data.indexKeys) do redis.call('ZREM', key, ARGV[1]) end
 redis.call('HDEL', KEYS[1], ARGV[1])
end
return 1
`;
const lockScript = `
local raw = redis.call('HGET', KEYS[1], ARGV[1])
if not raw then return 0 end
local data = cjson.decode(raw)
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
data.lock = {source='worker-observation', state='observed', expiresAt=now+tonumber(ARGV[2]), owner=ARGV[3]}
redis.call('HSET', KEYS[1], ARGV[1], cjson.encode(data))
return 1
`;
const pageScript = `
if #KEYS > 1 then redis.call('ZINTERSTORE', ARGV[1], #KEYS, unpack(KEYS)); redis.call('PEXPIRE', ARGV[1], 5000) end
local key = #KEYS == 1 and KEYS[1] or ARGV[1]
local total = redis.call('ZCARD', key)
local ids = redis.call('ZREVRANGE', key, ARGV[2], ARGV[3])
if #KEYS > 1 then redis.call('DEL', ARGV[1]) end
return {total, ids}
`;

function status(value: string): QueueJobStatus | null {
  const normalized = ['wait', 'paused', 'prioritized'].includes(value) ? 'waiting' : value;
  return ['waiting', 'active', 'completed', 'failed', 'delayed'].includes(normalized) ? normalized as QueueJobStatus : null;
}

const stackBudget = 32 * 1024;
const inputBudget = 128 * 1024;

function diagnostic(value: string, budget: number): { text: string; truncated: boolean } {
  if (Buffer.byteLength(value) > inputBudget) return { text: '[REDACTED: diagnostic exceeds input limit]', truncated: true };
  // Redact complete values before truncation, including quoted values with spaces.
  const safe = redactLogText(value
    .replace(/-----BEGIN [\w ]*PRIVATE KEY-----[\s\S]*?-----END [\w ]*PRIVATE KEY-----/g, '[REDACTED]')
    .replace(/(\b(?:authorization|cookie|set-cookie)\s*:\s*)[^\r\n]*/gi, '$1[REDACTED]')
    .replace(/(["']?[\w.-]*(?:password|passwd|secret|token|authorization|cookie|credential|api[_-]?key|signature|session[_-]?id)[\w.-]*["']?\s*[:=]\s*)("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;&}\]]+)/gi, '$1[REDACTED]'));
  if (Buffer.byteLength(safe) <= budget) return { text: safe, truncated: false };
  const marker = '\n[truncated]';
  const prefix = Buffer.from(safe).subarray(0, budget - Buffer.byteLength(marker)).toString('utf8').replace(/\uFFFD$/, '');
  return { text: prefix + marker, truncated: true };
}

function stackDiagnostics(value: unknown): Pick<QueueJobSnapshot, 'stacktrace' | 'stacktraceMeta'> {
  if (!Array.isArray(value) || value.length === 0) return {};
  const retained = value.slice(-5);
  let truncated = value.length > retained.length;
  const budget = Math.floor(stackBudget / retained.length);
  const stacktrace = retained.map(trace => {
    if (typeof trace !== 'string') { truncated = true; return '[REDACTED: invalid diagnostic]'; }
    const result = diagnostic(trace, budget);
    truncated ||= result.truncated;
    return result.text;
  });
  return { stacktrace, stacktraceMeta: { total: value.length, truncated } };
}

/** Svelar-owned Redis indexes only; no BullMQ private keys or lock tokens. */
export class RedisQueueOperations {
  constructor(private provider: () => Promise<any>, readonly connection: string, readonly queueName: string) {}
  private async resources() {
    const queue = await this.provider();
    return { queue, client: await queue.client, prefix: queue.toKey('svelar:operations:v1') as string };
  }
  async capture(job: any, event = '', forcedStatus?: QueueJobStatus): Promise<void> {
    const { queue, client, prefix } = await this.resources();
    const latest = await queue.getJob(String(job.id));
    const current = latest ? status(await latest.getState()) : forcedStatus ?? null;
    if (!current) return;
    job = latest ?? job;
    const info: QueueJobSnapshot = {
      id: String(job.id), connection: this.connection, queue: this.queueName, jobClass: job.data?.jobClass ?? job.name,
      status: current, attempts: job.attemptsMade ?? 0, maxAttempts: job.opts?.attempts ?? 3,
      attemptsStarted: Number.isSafeInteger(job.attemptsStarted) && job.attemptsStarted >= 0 ? job.attemptsStarted : undefined,
      stalledCount: job.stalledCounter ?? 0, createdAt: Number(job.timestamp),
      processedAt: job.processedOn, finishedAt: job.finishedOn,
      delayedUntil: job.delay ? job.timestamp + job.delay : undefined,
      metadata: job.data?.metadata, progress: job.progress,
      payload: typeof job.data?.payload === 'string' ? job.data.payload : JSON.stringify(job.data ?? {}),
      error: typeof job.failedReason === 'string' && job.failedReason ? diagnostic(job.failedReason, 8 * 1024).text : undefined,
      ...stackDiagnostics(job.stacktrace), replayRecordId: job.data?.replayRecordId,
      lock: { source: 'unavailable', state: current === 'active' ? 'unknown' : 'none', expiresAt: null, owner: null },
    };
    const indexKeys = [`${prefix}:all`, `${prefix}:status:${current}`,
      ...metadataKeys(prefix, indexedMetadata(job.data?.metadata, job.data?.context)),
      `${prefix}:class:${createHash('sha256').update(info.jobClass).digest('hex')}`];
    await client.eval(indexScript, 2, `${prefix}:jobs`, `${prefix}:timeline:${info.id}`, info.id,
      JSON.stringify({ ...info, indexKeys, indexed: indexedMetadata(job.data?.metadata, job.data?.context) }), event, info.attempts);
  }
  async refresh(id: string, event = ''): Promise<void> {
    const queue = await this.provider(); const job = await queue.getJob(id);
    if (job) await this.capture(job, event);
  }
  async observeLocks(ids: readonly string[], duration: number, owner: string): Promise<void> {
    const { client, prefix } = await this.resources();
    for (const id of ids) await client.eval(lockScript, 1, `${prefix}:jobs`, id, duration, owner);
  }
  async snapshot(job: any, filter?: QueueJobFilter): Promise<QueueJobSnapshot | null> {
    const current = status(await job.getState()); if (!current) return null;
    await this.capture(job, '', current);
    const { client, prefix } = await this.resources();
    const raw = await client.hget(`${prefix}:jobs`, String(job.id));
    if (!raw) return null;
    const { indexKeys: _, indexed, ...info } = JSON.parse(raw);
    if (filter && metadataFields.some(field => filter[field] !== undefined && metadataValue(filter[field]) !== metadataValue(indexed?.[field]))) return null;
    if (info.lock?.state === 'observed') {
      const time = await client.time(); const now = Number(time[0]) * 1000 + Math.floor(Number(time[1]) / 1000);
      if (info.lock.expiresAt <= now) info.lock.state = 'expired';
    }
    return info;
  }
  async removeIndex(id: string): Promise<void> {
    const { client, prefix } = await this.resources(); await client.eval(removeScript, 1, `${prefix}:jobs`, id);
  }
  async list(filter: QueueJobFilter = {}): Promise<QueueJobPage> {
    const { offset, limit } = pageOptions(filter);
    const { queue, client, prefix } = await this.resources();
    const keys = [`${prefix}:all`, ...metadataKeys(prefix, filter)];
    if (filter.status) keys.push(`${prefix}:status:${filter.status}`);
    if (filter.jobClass) keys.push(`${prefix}:class:${createHash('sha256').update(filter.jobClass).digest('hex')}`);
    const [total, ids] = await client.eval(pageScript, keys.length, ...keys, `${prefix}:query:${crypto.randomUUID()}`, offset, offset + Math.max(0, limit - 1));
    const items: QueueJobSnapshot[] = [];
    if (limit) for (const id of ids) {
      const job = await queue.getJob(id);
      if (!job) { await this.removeIndex(id); continue; }
      const info = await this.snapshot(job, filter);
      if (info && (!filter.status || info.status === filter.status)) items.push(info);
    }
    return { items, offset, limit, indexedCount: Number(total), coverage: 'instrumented' };
  }
  async timeline(id: string, limit = 100): Promise<QueueTimelineEvent[]> {
    boundedLimit(limit);
    const { client, prefix } = await this.resources();
    const rows = await client.xrevrange(`${prefix}:timeline:${id}`, '+', '-', 'COUNT', limit);
    return rows.map(([entryId, fields]: [string, string[]]) => {
      const data = Object.fromEntries(Array.from({ length: fields.length / 2 }, (_, index) => [fields[index * 2], fields[index * 2 + 1]]));
      return { id: entryId, event: data.event, at: Number(data.at), attempt: Number(data.attempt) };
    });
  }
  async reconcile(limit = 1000): Promise<{ indexed: number; complete: boolean }> {
    boundedLimit(limit, 10000);
    const queue = await this.provider();
    const jobs = await queue.getJobs(['wait', 'paused', 'prioritized', 'active', 'completed', 'failed', 'delayed'], 0, limit);
    for (const job of jobs.slice(0, limit)) if (job) await this.capture(job);
    return { indexed: Math.min(limit, jobs.length), complete: jobs.length <= limit };
  }
  async readyAges(): Promise<{ oldest: number | null; stalled: number | null; expiredLocks: number | null; complete: boolean }> {
    const { queue, client, prefix } = await this.resources();
    let oldest: number | null = null;
    const waiting: string[] = await client.zrange(`${prefix}:status:waiting`, 0, 99);
    for (const id of waiting) {
      const job = await queue.getJob(id);
      if (!job) { await this.removeIndex(id); continue; }
      if (status(await job.getState()) !== 'waiting') { await this.capture(job); continue; }
      oldest = Number(job.timestamp); break;
    }
    const activeIds: string[] = await client.zrange(`${prefix}:status:active`, 0, 999);
    let expiredLocks = 0;
    let observed = 0;
    let known = true;
    const time = await client.time(); const now = Number(time[0]) * 1000 + Math.floor(Number(time[1]) / 1000);
    for (const id of activeIds) {
      const job = await queue.getJob(id);
      if (!job) { await this.removeIndex(id); continue; }
      if (status(await job.getState()) !== 'active') { await this.capture(job); continue; }
      observed++;
      const raw = await client.hget(`${prefix}:jobs`, id); if (!raw) { known = false; continue; }
      const data = JSON.parse(raw);
      if (data.lock?.expiresAt == null) known = false;
      else if (data.lock.expiresAt <= now) expiredLocks++;
    }
    const complete = known && observed === await queue.getActiveCount();
    return { oldest, stalled: complete ? expiredLocks : null, expiredLocks: complete ? expiredLocks : null, complete };
  }
}
