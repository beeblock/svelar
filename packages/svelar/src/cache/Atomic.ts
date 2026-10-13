export const MAX_ATOMIC_TTL_SECONDS = 31_536_000;
export const MAX_CAPACITY_CLAIMS = 16;

export interface CacheCapacityRequest {
  key: string;
  capacity: number;
  /** Positive TTL in seconds; the first successful claim starts the window. */
  ttl: number;
  amount?: number;
}

export interface CacheCapacityResult {
  allowed: boolean;
  value: number;
  remaining: number;
  expiresAt: number | null;
}

export interface AtomicEntry {
  value: unknown;
  expiresAt: number | null;
}

export class CacheAtomicUnavailableError extends Error {
  constructor() {
    super('The null cache store cannot coordinate atomic operations.');
    this.name = 'CacheAtomicUnavailableError';
  }
}

export function validateAtomicKey(key: string): void {
  if (typeof key !== 'string' || key.length === 0 || Buffer.byteLength(key) > 1024) {
    throw new TypeError('Atomic cache keys must contain 1 to 1024 bytes.');
  }
}

export function ttlMilliseconds(ttl: number, allowForever = false): number {
  if (!Number.isFinite(ttl) || ttl < (allowForever ? 0 : 0.001) || ttl > MAX_ATOMIC_TTL_SECONDS) {
    throw new RangeError(`Cache TTL must be ${allowForever ? '0' : 'at least 0.001'} to ${MAX_ATOMIC_TTL_SECONDS} seconds.`);
  }
  return Math.ceil(ttl * 1000);
}

export function validateAmount(amount: number, positive = false): void {
  if (!Number.isSafeInteger(amount) || (positive && amount <= 0)) {
    throw new RangeError('Cache amounts must be safe integers, positive for capacity claims.');
  }
}

export function validateOwner(owner: string): void {
  if (typeof owner !== 'string' || !owner || Buffer.byteLength(owner) > 256) {
    throw new TypeError('Lock owners must contain 1 to 256 bytes.');
  }
}

export function lockKey(key: string): string {
  return `__svelar_owner_lock__:${JSON.stringify(key)}`;
}

/** CAS uses canonical JSON value equality; undefined is reserved for an absent key. */
export function serializedValue(value: unknown): string {
  const raw = JSON.stringify(value, (_key, item: unknown) => {
    if (typeof item === 'number' && !Number.isFinite(item)) throw new TypeError('Atomic values require finite JSON numbers.');
    return item;
  });
  if (raw === undefined || Buffer.byteLength(raw) > 1_048_576) {
    throw new TypeError('Atomic values must be JSON-serializable and at most 1 MiB.');
  }
  const sorted = (item: unknown): string => {
    if (Array.isArray(item)) return `[${item.map(sorted).join(',')}]`;
    if (item !== null && typeof item === 'object') {
      const object = item as Record<string, unknown>;
      return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${sorted(object[key])}`).join(',')}}`;
    }
    return JSON.stringify(item);
  };
  return sorted(JSON.parse(raw));
}

export function validateCompare(key: string, expected: unknown, next: unknown, ttl?: number): void {
  validateAtomicKey(key);
  if (expected !== undefined) serializedValue(expected);
  serializedValue(next);
  if (ttl !== undefined) ttlMilliseconds(ttl);
}

export function validateClaims(claims: readonly CacheCapacityRequest[]): void {
  if (!Array.isArray(claims) || claims.length < 1 || claims.length > MAX_CAPACITY_CLAIMS) {
    throw new RangeError(`Capacity reservations require 1 to ${MAX_CAPACITY_CLAIMS} claims.`);
  }
  const keys = new Set<string>();
  for (const claim of claims) {
    validateAtomicKey(claim.key);
    if (keys.has(claim.key)) throw new TypeError('A capacity batch cannot repeat a key.');
    keys.add(claim.key);
    if (!Number.isSafeInteger(claim.capacity) || claim.capacity <= 0) throw new RangeError('Capacity must be a positive safe integer.');
    validateAmount(claim.amount ?? 1, true);
    ttlMilliseconds(claim.ttl);
  }
}

export function capacityPlan(claims: readonly CacheCapacityRequest[], entries: readonly (AtomicEntry | null)[], now: number): CacheCapacityResult[] {
  const values = entries.map((entry) => {
    if (!entry) return 0;
    if (typeof entry.value !== 'number' || !Number.isSafeInteger(entry.value) || entry.value < 0) {
      throw new TypeError('Capacity keys must contain nonnegative safe integer counters.');
    }
    return entry.value;
  });
  const allowed = claims.every((claim, index) => (claim.amount ?? 1) <= claim.capacity - values[index]);
  return claims.map((claim, index) => {
    const value = values[index] + (allowed ? claim.amount ?? 1 : 0);
    return {
      allowed, value, remaining: Math.max(0, claim.capacity - value),
      expiresAt: allowed ? entries[index]?.expiresAt ?? now + ttlMilliseconds(claim.ttl) : entries[index]?.expiresAt ?? null,
    };
  });
}

export const REDIS_COMPARE_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if ARGV[1] == 'missing' then
  if raw then return 0 end
elseif raw ~= ARGV[2] then
  return 0
end
local ttl = tonumber(ARGV[4])
if ttl == -1 then ttl = redis.call('PTTL', KEYS[1]) end
if ttl >= 0 then
  redis.call('SET', KEYS[1], ARGV[3], 'PX', math.max(1, ttl))
else
  redis.call('SET', KEYS[1], ARGV[3])
end
return 1
`;

export const REDIS_ACQUIRE_SCRIPT = `
if redis.call('SET', KEYS[1], ARGV[1], 'NX', 'PX', ARGV[2]) then return 1 end
return 0
`;

export const REDIS_RELEASE_SCRIPT = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
return redis.call('DEL', KEYS[1])
`;

export const REDIS_CAPACITY_SCRIPT = `
local timestamp = redis.call('TIME')
local now = tonumber(timestamp[1]) * 1000 + math.floor(tonumber(timestamp[2]) / 1000)
local counts = {}
local ttls = {}
local allowed = true
for i = 1, #KEYS do
  local raw = redis.call('GET', KEYS[i])
  local value = 0
  if raw then
    local ok, decoded = pcall(cjson.decode, raw)
    if not ok then return redis.error_reply('Invalid capacity counter') end
    if type(decoded) == 'table' then value = decoded['value'] else value = decoded end
    if type(value) ~= 'number' or value < 0 or value > 9007199254740991 or value ~= math.floor(value) then
      return redis.error_reply('Invalid capacity counter')
    end
  end
  counts[i] = value
  ttls[i] = redis.call('PTTL', KEYS[i])
  local base = (i - 1) * 3
  if tonumber(ARGV[base + 3]) > tonumber(ARGV[base + 1]) - value then allowed = false end
end
local result = {}
for i = 1, #KEYS do
  local base = (i - 1) * 3
  local value = counts[i]
  local ttl = ttls[i]
  if allowed then
    value = value + tonumber(ARGV[base + 3])
    if ttl < 0 then ttl = tonumber(ARGV[base + 2]) end
    redis.call('SET', KEYS[i], '{"value":' .. string.format('%.0f', value) .. '}', 'PX', math.max(1, ttl))
  end
  result[i] = {allowed and 1 or 0, value, math.max(0, tonumber(ARGV[base + 1]) - value), ttl >= 0 and now + math.max(1, ttl) or -1}
end
return result
`;
