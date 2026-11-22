import { createHash } from 'node:crypto';
import { redactLogText } from '../logging/Redaction.js';
import { indexedMetadata, metadataFields, metadataKeys, metadataValue } from './Metadata.js';
import { boundedLimit, pageOptions, type QueueJobFilter, type QueueJobPage, type QueueJobSnapshot, type QueueJobStatus, type QueueTimelineEvent } from './Monitoring.js';
import { operationsIndexPolicy, type QueueOperationsIndexPolicy } from './OperationsIndexPolicy.js';

const retentionScript = `
local function remove(prefix, id)
 local raw = redis.call('HGET', prefix .. ':jobs', id)
 if raw then
  local data = cjson.decode(raw)
  for _, key in ipairs(data.indexKeys) do redis.call('ZREM', key, id) end
  redis.call('HDEL', prefix .. ':jobs', id)
 end
 redis.call('ZREM', prefix .. ':all', id)
 redis.call('DEL', prefix .. ':timeline:' .. id)
end
local function prune(prefix, now, age, maximum, limit)
 local removed = 0
 local complete = true
 for _, state in ipairs({'completed', 'failed'}) do
  local key = prefix .. ':status:' .. state
  local count = redis.call('ZCARD', key)
  local entries = redis.call('ZRANGE', key, 0, limit - 1, 'WITHSCORES')
  for i = 1, #entries, 2 do
   local id = entries[i]
   local raw = redis.call('HGET', prefix .. ':jobs', id)
   if not raw then
    remove(prefix, id)
    redis.call('ZREM', key, id)
    count = count - 1
    removed = removed + 1
   else
    local data = cjson.decode(raw)
    if data.status ~= state then
     redis.call('ZREM', key, id)
     count = count - 1
    else
     local at = tonumber(data.finishedAt) or tonumber(entries[i + 1])
     if at ~= tonumber(entries[i + 1]) then
      -- Backfill v1 terminal indexes which used creation time, not finish time.
      redis.call('ZADD', key, at, id)
     elseif at <= now - age or count > maximum then
      remove(prefix, id)
      count = count - 1
      removed = removed + 1
     else break end
    end
   end
  end
  local first = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  if count > maximum or (#first > 0 and tonumber(first[2]) <= now - age) then complete = false end
 end
 return {removed, complete and 1 or 0}
end
`;
const indexScript = retentionScript + `
local old = redis.call('HGET', KEYS[1], ARGV[1])
local data = cjson.decode(ARGV[2])
local time = redis.call('TIME')
local at = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
if old then
 local previous = cjson.decode(old)
 if (previous.attemptsStarted or 0) > (data.attemptsStarted or 0) and ARGV[3] ~= 'retried' then return 0 end
 if previous.finishedAt and not data.finishedAt and previous.attemptsStarted == data.attemptsStarted and ARGV[3] ~= 'retried' then return 0 end
 for _, key in ipairs(previous.indexKeys) do redis.call('ZREM', key, ARGV[1]) end
 if data.status == 'active' then data.lock = previous.lock end
end
if ARGV[8] ~= '' and data.status == 'active' then
 data.lock = {source='worker-observation', state='observed', expiresAt=at+tonumber(ARGV[8]), owner=ARGV[9]}
end
local terminal = data.status == 'completed' or data.status == 'failed'
for _, key in ipairs(data.indexKeys) do
 local score = terminal and key == ARGV[5] .. ':status:' .. data.status and (data.finishedAt or at) or data.createdAt
 redis.call('ZADD', key, score, ARGV[1])
end
redis.call('HSET', KEYS[1], ARGV[1], cjson.encode(data))
if ARGV[3] ~= '' then
 redis.call('XADD', KEYS[2], 'MAXLEN', '=', 100, '*', 'event', ARGV[3], 'at', at, 'attempt', ARGV[4])
end
prune(ARGV[5], at, tonumber(ARGV[6]), tonumber(ARGV[7]), 100)
return 1
`;
const removeScript = retentionScript + `
remove(ARGV[2], ARGV[1])
return 1
`;
const lockScript = `
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
for i = 3, #ARGV do
 local raw = redis.call('HGET', KEYS[1], ARGV[i])
 if raw then
  local data = cjson.decode(raw)
  if data.status == 'active' then
   data.lock = {source='worker-observation', state='observed', expiresAt=now+tonumber(ARGV[1]), owner=ARGV[2]}
   redis.call('HSET', KEYS[1], ARGV[i], cjson.encode(data))
  end
 end
end
return 1
`;
const pruneScript = retentionScript + `
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
return prune(ARGV[1], now, tonumber(ARGV[2]), tonumber(ARGV[3]), tonumber(ARGV[4]))
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
  constructor(private provider: () => Promise<any>, readonly connection: string, readonly queueName: string,
    private policy: QueueOperationsIndexPolicy | (() => QueueOperationsIndexPolicy | undefined) = 'full') {}
  private options() { return operationsIndexPolicy(typeof this.policy === 'function' ? this.policy() : this.policy); }
  private tracked(job: any, event: string, current?: QueueJobStatus): boolean {
    const mode = this.options().mode;
    if (mode === 'off') return false;
    return mode === 'full' || ['retrying', 'failed', 'stalled', 'retried', 'lock-renewal-failed'].includes(event)
      || current === 'failed' || job.data?.svelarOperationsTracked === true || !!job.data?.replayRecordId
      || !!job.failedReason || job.stacktrace?.length > 0 || job.stalledCounter > 0 || job.attemptsStarted > 1
      || job.attemptsMade > (event === 'completed' || current === 'completed' ? 1 : 0);
  }
  private async resources() {
    const queue = await this.provider();
    return { queue, client: await queue.client, prefix: queue.toKey('svelar:operations:v1') as string };
  }
  async capture(job: any, event = '', forcedStatus?: QueueJobStatus,
    lock?: { duration: number; owner: string }): Promise<boolean> {
    if (!this.tracked(job, event, forcedStatus)) return false;
    const current = forcedStatus ?? status(await job.getState());
    if (!current || !this.tracked(job, event, current)) return false;
    if (this.options().mode === 'failures-only' && !job.data?.svelarOperationsTracked && current !== 'completed' && current !== 'failed') {
      // Persist once on an exceptional path so a different worker can finish its history.
      const data = { ...job.data, svelarOperationsTracked: true };
      await job.updateData(data);
      job.data = data;
    }
    const { client, prefix } = await this.resources();
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
    const options = this.options();
    return Number(await client.eval(indexScript, 2, `${prefix}:jobs`, `${prefix}:timeline:${info.id}`, info.id,
      JSON.stringify({ ...info, indexKeys, indexed: indexedMetadata(job.data?.metadata, job.data?.context) }), event, info.attempts,
      prefix, options.maxAgeSeconds * 1000, options.maxJobs, lock?.duration ?? '', lock?.owner ?? '')) === 1;
  }
  async refresh(id: string, event = ''): Promise<void> {
    if (this.options().mode === 'off') return;
    const queue = await this.provider(); const job = await queue.getJob(id);
    if (job) await this.capture(job, event);
  }
  async observeLocks(ids: readonly string[], duration: number, owner: string): Promise<void> {
    if (this.options().mode === 'off' || !ids.length) return;
    if (this.options().mode === 'failures-only') {
      if (duration > 0) return;
      for (const id of ids) await this.refresh(id, 'lock-renewal-failed');
    }
    const { client, prefix } = await this.resources();
    await client.eval(lockScript, 1, `${prefix}:jobs`, duration, owner, ...ids);
  }
  async snapshot(job: any, filter?: QueueJobFilter): Promise<QueueJobSnapshot | null> {
    if (this.options().mode === 'off') return null;
    const current = status(await job.getState()); if (!current) return null;
    if (!this.tracked(job, '', current)) return null;
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
    const { client, prefix } = await this.resources(); await client.eval(removeScript, 1, `${prefix}:jobs`, id, prefix);
  }
  async prune(limit = 100): Promise<{ removed: number; complete: boolean }> {
    boundedLimit(limit, 1000);
    const { client, prefix } = await this.resources();
    const options = this.options();
    const [removed, complete] = await client.eval(pruneScript, 1, `${prefix}:jobs`, prefix, options.maxAgeSeconds * 1000, options.maxJobs, limit);
    return { removed: Number(removed), complete: Number(complete) === 1 };
  }
  async list(filter: QueueJobFilter = {}): Promise<QueueJobPage> {
    const { offset, limit } = pageOptions(filter);
    if (this.options().mode === 'off') return { items: [], offset, limit, indexedCount: 0, coverage: 'instrumented' };
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
    if (this.options().mode === 'off') return [];
    const { client, prefix } = await this.resources();
    const rows = await client.xrevrange(`${prefix}:timeline:${id}`, '+', '-', 'COUNT', limit);
    return rows.map(([entryId, fields]: [string, string[]]) => {
      const data = Object.fromEntries(Array.from({ length: fields.length / 2 }, (_, index) => [fields[index * 2], fields[index * 2 + 1]]));
      return { id: entryId, event: data.event, at: Number(data.at), attempt: Number(data.attempt) };
    });
  }
  async reconcile(limit = 1000): Promise<{ indexed: number; complete: boolean }> {
    boundedLimit(limit, 10000);
    if (this.options().mode === 'off') return { indexed: 0, complete: true };
    const queue = await this.provider();
    const jobs = await queue.getJobs(['wait', 'paused', 'prioritized', 'active', 'completed', 'failed', 'delayed'], 0, limit);
    let indexed = 0;
    for (const job of jobs.slice(0, limit)) if (job && await this.capture(job)) indexed++;
    return { indexed, complete: jobs.length <= limit };
  }
  async readyAges(): Promise<{ oldest: number | null; stalled: number | null; expiredLocks: number | null; complete: boolean }> {
    if (this.options().mode !== 'full') {
      const queue = await this.provider();
      const counts = await queue.getJobCounts('waiting', 'paused', 'prioritized', 'active');
      const complete = (counts.waiting ?? 0) + (counts.paused ?? 0) + (counts.prioritized ?? 0) + (counts.active ?? 0) === 0;
      return { oldest: null, stalled: complete ? 0 : null, expiredLocks: complete ? 0 : null, complete };
    }
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
