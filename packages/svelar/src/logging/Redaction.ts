export const DEFAULT_REDACT_KEYS = [
  'password', 'password_confirmation', 'current_password', 'new_password', 'token',
  'access_token', 'refresh_token', 'api_key', 'apikey', 'secret', 'client_secret',
  'private_key', 'authorization', 'cookie', 'set-cookie', 'signature',
];

export function redactLogText(text: string): string {
  return text
    .replace(/\b(Bearer|Basic)\s+[^\s,;]+/gi, '$1 [REDACTED]')
    .replace(/(\b(?:password|token|api[_-]?key|secret|signature)\s*[=:]\s*)[^\s,;&]+/gi, '$1[REDACTED]')
    .replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[REDACTED]@');
}

export function redactLogContext(value: any, keys = DEFAULT_REDACT_KEYS, seen = new WeakSet<object>(), depth = 0): any {
  if (typeof value === 'string') return redactLogText(value);
  if (typeof value === 'bigint') return value.toString();
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) return redactLogContext({ name: value.name, message: value.message, stack: value.stack }, keys, seen, depth + 1);
  if (seen.has(value)) return '[Circular]';
  if (depth > 8) return '[MaxDepth]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => redactLogContext(item, keys, seen, depth + 1));
  const output: Record<string, any> = {};
  for (const [key, nested] of Object.entries(value)) {
    const normalized = key.toLowerCase().replace(/[-\s]/g, '_');
    output[key] = keys.some((sensitive) => normalized.includes(sensitive.toLowerCase().replace(/[-\s]/g, '_')))
      ? '[REDACTED]' : redactLogContext(nested, keys, seen, depth + 1);
  }
  return output;
}
