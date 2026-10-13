import { DEFAULT_REDACT_KEYS, redactLogText } from '../logging/Redaction.js';

export interface AuditValueOptions {
  ignore?: readonly string[];
  redact?: readonly string[];
}

const defaults = [...DEFAULT_REDACT_KEYS, 'password_hash', 'secret_key', 'key_hash'];
const normalized = (key: string): string => key.toLowerCase().replace(/[-_\s]/g, '');

function matches(patterns: readonly string[], key: string, path: string[]): boolean {
  return patterns.some((pattern) => {
    const segments = pattern.split('.');
    if (segments.length === 1) return pattern === '*' || normalized(pattern) === normalized(key);
    return segments.length === path.length && segments.every((segment, i) => segment === '*' || normalized(segment) === normalized(path[i]));
  });
}

/** Produces an owned, JSON-safe snapshot; ignoring always precedes redaction. */
export function auditValues(value: unknown, options: AuditValueOptions = {}, redact = true): unknown {
  const sensitive = [...defaults, ...(options.redact ?? [])];
  const ancestors = new WeakSet<object>();
  const visit = (input: unknown, path: string[]): unknown => {
    if (typeof input === 'string') {
      if (/^\s*[\[{]/.test(input)) {
        try { return JSON.stringify(visit(JSON.parse(input), path)); } catch { /* Not structured JSON. */ }
      }
      return redact ? redactLogText(input) : input;
    }
    if (typeof input === 'bigint') return input.toString();
    if (input === null || typeof input !== 'object') return input;
    if (input instanceof Date) return input.toISOString();
    if (ancestors.has(input)) return '[Circular]';
    if (path.length > 32) return '[MaxDepth]';
    ancestors.add(input);
    try {
      if (Array.isArray(input)) return input.map((item, i) => visit(item, [...path, String(i)]));
      const result: Record<string, unknown> = {};
      for (const [key, nested] of Object.entries(input)) {
        const nestedPath = [...path, key];
        if (matches(options.ignore ?? [], key, nestedPath)) continue;
        Object.defineProperty(result, key, {
          value: redact && matches(sensitive, key, nestedPath) ? '[redacted]' : visit(nested, nestedPath),
          enumerable: true, writable: true, configurable: true,
        });
      }
      return result;
    } finally {
      ancestors.delete(input);
    }
  };
  return visit(value, []);
}

export function auditRecord(value: Record<string, unknown>, options?: AuditValueOptions): Record<string, unknown> {
  return auditValues(value, options) as Record<string, unknown>;
}
