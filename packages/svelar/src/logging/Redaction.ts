export const DEFAULT_REDACT_KEYS = [
  'password', 'password_confirmation', 'current_password', 'new_password', 'token',
  'access_token', 'refresh_token', 'api_key', 'apikey', 'secret', 'client_secret',
  'private_key', 'authorization', 'cookie', 'set-cookie', 'signature',
];

type RedactKeys = readonly string[] | ReadonlySet<string>;
const patterns = new WeakMap<object, RegExp>();
const policies = new WeakMap<object, ReadonlySet<string>>();
const normalizeKey = (key: string) => key.toLowerCase().replace(/[-\s]/g, '_');

function normalizedKeys(keys: RedactKeys): ReadonlySet<string> {
  const normalized = new Set(Array.from(keys, normalizeKey));
  patterns.set(normalized, new RegExp(Array.from(normalized, (key) => key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')));
  return normalized;
}

/** Cache a policy snapshot, retaining the built-in sensitive keys. */
export function logRedactKeys(keys: RedactKeys = DEFAULT_REDACT_KEYS): ReadonlySet<string> {
  let policy = policies.get(keys);
  if (!policy) {
    policy = normalizedKeys([...DEFAULT_REDACT_KEYS, ...keys]);
    policies.set(keys, policy);
    policies.set(policy, policy);
  }
  return policy;
}

export function redactLogText(text: string): string {
  return text
    .replace(/\b(Bearer|Basic)\s+[^\s,;]+/gi, '$1 [REDACTED]')
    .replace(/(\b(?:password|token|api[_-]?key|secret|signature)\s*[=:]\s*)[^\s,;&]+/gi, '$1[REDACTED]')
    .replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[REDACTED]@');
}

export function redactLogContext(value: any, keys: RedactKeys = logRedactKeys(), seen = new WeakSet<object>(), depth = 0, freeze = false): any {
  const policy = patterns.has(keys) ? keys as ReadonlySet<string> : normalizedKeys(keys);
  return redact(value, policy, seen, depth, freeze);
}

function redact(value: any, keys: ReadonlySet<string>, seen: WeakSet<object>, depth: number, freeze: boolean): any {
  if (typeof value === 'string') return redactLogText(value);
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'function') return '[Function]';
  if (typeof value === 'symbol') return redactLogText(String(value));
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) return redact({ name: value.name, message: value.message, stack: value.stack }, keys, seen, depth + 1, freeze);
  if (seen.has(value)) return '[Circular]';
  if (depth > 8) return '[MaxDepth]';
  seen.add(value);
  if (Array.isArray(value)) {
    const output = value.map((item) => redact(item, keys, seen, depth + 1, freeze));
    return freeze ? Object.freeze(output) : output;
  }
  const output: Record<string, any> = Object.create(null);
  const pattern = patterns.get(keys)!;
  for (const [key, nested] of Object.entries(value)) {
    const normalized = normalizeKey(key);
    output[key] = (keys.has(normalized) || (keys.size > 0 && pattern.test(normalized)))
      ? '[REDACTED]' : redact(nested, keys, seen, depth + 1, freeze);
  }
  return freeze ? Object.freeze(output) : output;
}
