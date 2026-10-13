export interface WorkerHeartbeatConfig {
  intervalMs?: number;
  staleAfterMs?: number;
  retentionMs?: number;
}

export interface WorkerHeartbeatInfo {
  id: string;
  queue: string;
  concurrency: number;
  lockDuration: number;
  stalledInterval: number;
  running: boolean;
  paused: boolean;
  draining: boolean;
  startedAt: number;
  lastSeenAt: number;
  staleAt: number;
  expiresAt: number;
  status: 'live' | 'stale';
}

export interface WorkerTelemetrySnapshot {
  source: 'heartbeat' | 'unavailable';
  complete: boolean;
  observedAt: number | null;
  limit: number;
  invalidRecords: number;
  reason: 'unavailable' | 'truncated' | 'invalid-records' | null;
  records: WorkerHeartbeatInfo[];
  coverage: 'instrumented' | 'exclusive';
  /** Counts and capacity of observed records only, not an uninstrumented pool. */
  observed: { live: number; active: number; paused: number; draining: number; stale: number; concurrency: number } | null;
}

interface HeartbeatStop {
  id: string | null;
  (): Promise<void>;
  drain(): Promise<void>;
  refresh(): Promise<void>;
}

const recordBytes = 2048;
const namespace = 'svelar:workers:v1';
const workerIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const defaultWorkerTelemetryLimit = 100;
export const maxWorkerTelemetryLimit = 1000;

export function heartbeatConfig(config: WorkerHeartbeatConfig = {}): Required<WorkerHeartbeatConfig> {
  const options = { intervalMs: 5000, staleAfterMs: 15000, retentionMs: 60000, ...config };
  if (!Number.isSafeInteger(options.intervalMs) || options.intervalMs < 1000 || options.intervalMs > 60000
    || !Number.isSafeInteger(options.staleAfterMs) || options.staleAfterMs < options.intervalMs * 2 || options.staleAfterMs > 300000
    || !Number.isSafeInteger(options.retentionMs) || options.retentionMs < options.staleAfterMs + options.intervalMs || options.retentionMs > 3600000) {
    throw new RangeError('Worker heartbeat requires intervalMs 1000..60000, staleAfterMs >= 2 intervals (<=300000), and retentionMs >= staleAfterMs + intervalMs (<=3600000).');
  }
  return options;
}

// Redis server time avoids clock skew between workers and the web process. The
// atomic write prunes at most 100 expired registrations, never a whole backlog.
const publishScript = `
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
local data = cjson.decode(ARGV[2])
data.startedAt = tonumber(ARGV[3]) > 0 and tonumber(ARGV[3]) or now
data.lastSeenAt = now
data.staleAt = now + tonumber(ARGV[4])
data.expiresAt = now + tonumber(ARGV[5])
redis.call('SET', KEYS[2], cjson.encode(data), 'PX', ARGV[5])
redis.call('ZADD', KEYS[1], data.expiresAt, ARGV[1])
local markerTtl = redis.call('PTTL', KEYS[3])
redis.call('SET', KEYS[3], '1', 'PX', math.max(markerTtl, tonumber(ARGV[5])))
local ttl = redis.call('PTTL', KEYS[1])
if ttl < tonumber(ARGV[5]) then redis.call('PEXPIRE', KEYS[1], ARGV[5]) end
local expired = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', now, 'LIMIT', 0, 100)
for _, id in ipairs(expired) do redis.call('ZREM', KEYS[1], id) end
return data.startedAt
`;

const removeScript = `
redis.call('DEL', KEYS[2])
return redis.call('ZREM', KEYS[1], ARGV[1])
`;

function integer(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
}

/** Attach to an actual BullMQ worker; unsupported test doubles publish nothing. */
export async function startWorkerHeartbeat(worker: any, queue: string, config: WorkerHeartbeatConfig | false = {}): Promise<HeartbeatStop> {
  if (config === false || typeof worker.toKey !== 'function' || !('client' in worker)) {
    return Object.assign(async () => {}, { id: null, drain: async () => {}, refresh: async () => {} });
  }
  const options = heartbeatConfig(config);
  const workerClient = await worker.client;
  // Native close disconnects the worker client immediately after drain. Telemetry
  // must remain usable until cleanup completes, without delaying acquisition stop.
  const ownsClient = typeof workerClient?.duplicate === 'function';
  const client = ownsClient ? workerClient.duplicate({
    lazyConnect: true, enableOfflineQueue: false, maxRetriesPerRequest: 1,
    connectTimeout: 1000, commandTimeout: 2000, retryStrategy: () => null,
  }) : workerClient;
  if (ownsClient) {
    client.on('error', () => {});
    try { await client.connect(); }
    catch { client.disconnect(); throw new Error('Redis worker heartbeat client is unavailable.'); }
  }
  if (typeof client?.eval !== 'function') throw new Error('Redis worker heartbeat client is unavailable.');
  const id = crypto.randomUUID();
  const index = worker.toKey(namespace);
  const recordKey = worker.toKey(`${namespace}:${id}`);
  const marker = worker.toKey(`${namespace}:seen`);
  let startedAt = 0;
  let stopped = false;
  let draining = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: Promise<void> | null = null;

  const publish = async () => {
    const data = {
      version: 1, id, queue,
      concurrency: worker.concurrency,
      lockDuration: worker.opts?.lockDuration,
      stalledInterval: worker.opts?.stalledInterval,
      running: worker.isRunning(), paused: worker.isPaused(), draining,
    };
    if (!integer(data.concurrency, 1, 1000000) || !integer(data.lockDuration, 1)
      || !integer(data.stalledInterval, 1) || typeof data.running !== 'boolean' || typeof data.paused !== 'boolean') {
      throw new Error('Redis worker heartbeat options are invalid.');
    }
    startedAt = Number(await client.eval(publishScript, 3, index, recordKey, marker,
      id, JSON.stringify(data), startedAt, options.staleAfterMs, options.retentionMs));
    if (!integer(startedAt, 1)) throw new Error('Redis worker heartbeat timestamp is invalid.');
  };

  const schedule = () => {
    if (stopped) return;
    timer = setTimeout(() => {
      timer = null;
      inFlight = publish().then(schedule).catch(() => {
        // Do not continue advertising the last successful observation as live.
        stopped = true;
        worker.emit('svelar:error', new Error('Redis worker heartbeat publication failed.'));
      });
    }, options.intervalMs);
    timer.unref?.();
  };

  try {
    await publish();
  } catch {
    await client.eval(removeScript, 2, index, recordKey, id).catch(() => {});
    if (ownsClient) client.disconnect();
    throw new Error('Redis worker heartbeat publication failed.');
  }
  schedule();
  let cleanup: Promise<void> | null = null;
  const stop = () => cleanup ??= (async () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    await inFlight?.catch(() => {});
    try {
      await client.eval(removeScript, 2, index, recordKey, id);
    } catch {
      throw new Error('Redis worker heartbeat cleanup failed; records will expire.');
    } finally {
      if (ownsClient) client.disconnect();
    }
  })();
  return Object.assign(stop, {
    id,
    refresh: async () => {
      if (stopped) return;
      if (timer) clearTimeout(timer);
      timer = null;
      await inFlight;
      if (stopped) return;
      inFlight = publish().then(schedule);
      try { await inFlight; }
      catch { stopped = true; throw new Error('Redis worker heartbeat publication failed.'); }
    },
    drain: async () => {
      if (stopped || draining) return;
      draining = true;
      if (timer) clearTimeout(timer);
      timer = null;
      await inFlight;
      if (stopped) return;
      if (timer) clearTimeout(timer);
      timer = null;
      inFlight = publish().then(schedule);
      try {
        await inFlight;
      } catch {
        stopped = true;
        throw new Error('Redis worker draining heartbeat publication failed.');
      }
    },
  });
}

function redisTime(time: unknown): number {
  if (!Array.isArray(time) || time.length !== 2) throw new Error('Invalid Redis time.');
  const timestamp = Number(time[0]) * 1000 + Math.floor(Number(time[1]) / 1000);
  if (!integer(timestamp, 1)) throw new Error('Invalid Redis time.');
  return timestamp;
}

function parseRecord(raw: unknown, id: string, queue: string, now: number): WorkerHeartbeatInfo | null {
  if (typeof raw !== 'string' || raw.length > recordBytes) return null;
  try {
    const data = JSON.parse(raw);
    if (!data || data.version !== 1 || data.id !== id || data.queue !== queue
      || !integer(data.concurrency, 1, 1000000) || !integer(data.lockDuration, 1) || !integer(data.stalledInterval, 1)
      || typeof data.running !== 'boolean' || typeof data.paused !== 'boolean' || typeof data.draining !== 'boolean'
      || !integer(data.startedAt, 1) || !integer(data.lastSeenAt, data.startedAt, now)
      || !integer(data.staleAt, data.lastSeenAt + 1, data.lastSeenAt + 300000)
      || !integer(data.expiresAt, data.staleAt + 1, data.lastSeenAt + 3600000)) return null;
    // Never return arbitrary properties from stored JSON or raw Redis client info.
    return {
      id, queue, concurrency: data.concurrency, lockDuration: data.lockDuration,
      stalledInterval: data.stalledInterval, running: data.running, paused: data.paused, draining: data.draining,
      startedAt: data.startedAt, lastSeenAt: data.lastSeenAt, staleAt: data.staleAt,
      expiresAt: data.expiresAt, status: now < data.staleAt ? 'live' : 'stale',
    };
  } catch {
    return null;
  }
}

export async function readWorkerTelemetry(queue: any, queueName: string, limit: number,
  coverage: 'instrumented' | 'exclusive' = 'instrumented'): Promise<WorkerTelemetrySnapshot> {
  if (!integer(limit, 1, maxWorkerTelemetryLimit)) {
    throw new RangeError(`Worker telemetry limit must be 1..${maxWorkerTelemetryLimit}.`);
  }
  const snapshot: WorkerTelemetrySnapshot = {
    source: 'unavailable', complete: false, observedAt: null,
    limit, invalidRecords: 0, reason: 'unavailable', records: [], coverage, observed: null,
  };
  if (typeof queue.toKey !== 'function' || !('client' in queue)) return snapshot;
  try {
    const client = await queue.client;
    if (typeof client?.getrange !== 'function' || typeof client.time !== 'function'
      || typeof client.zrangebyscore !== 'function') return snapshot;
    if (await client.getrange(queue.toKey(`${namespace}:seen`), 0, 1) !== '1') return snapshot;
    const since = redisTime(await client.time());
    const members: string[] = await client.zrangebyscore(queue.toKey(namespace), since, '+inf',
      'WITHSCORES', 'LIMIT', 0, limit + 1);
    const truncated = members.length > limit * 2;
    const selected: Array<{ id: string; expiresAt: number }> = [];
    for (let index = 0; index < Math.min(members.length, limit * 2); index += 2) {
      const id = members[index];
      const expiresAt = Number(members[index + 1]);
      if (!workerIdPattern.test(id) || !integer(expiresAt, 1)) snapshot.invalidRecords++;
      else selected.push({ id, expiresAt });
    }
    const commands = selected.map(({ id }) => ['getrange', queue.toKey(`${namespace}:${id}`), 0, recordBytes]);
    const results = typeof client.pipeline === 'function'
      ? await client.pipeline(commands).exec()
      : await Promise.all(commands.map(async ([, key, start, end]) => [null, await client.getrange(key, start, end)]));
    const now = redisTime(await client.time());
    snapshot.observedAt = now;
    for (let index = 0; index < selected.length; index++) {
      const { id, expiresAt } = selected[index];
      if (expiresAt <= now) continue;
      const result = results?.[index];
      const record = result && !result[0] ? parseRecord(result[1], id, queueName, now) : null;
      if (record && record.expiresAt > now) snapshot.records.push(record);
      else snapshot.invalidRecords++;
    }
    snapshot.source = 'heartbeat';
    snapshot.complete = !truncated && snapshot.invalidRecords === 0;
    snapshot.reason = truncated ? 'truncated' : snapshot.invalidRecords ? 'invalid-records' : null;
    const live = snapshot.records.filter(worker => worker.status === 'live');
    const active = live.filter(worker => worker.running && !worker.paused && !worker.draining);
    snapshot.observed = {
      live: live.length, active: active.length,
      paused: live.filter(worker => worker.paused).length,
      draining: live.filter(worker => worker.draining).length,
      stale: snapshot.records.length - live.length,
      concurrency: active.reduce((sum, worker) => sum + worker.concurrency, 0),
    };
    return snapshot;
  } catch {
    return { ...snapshot, source: 'unavailable', complete: false, reason: 'unavailable', records: [], observed: null };
  }
}
