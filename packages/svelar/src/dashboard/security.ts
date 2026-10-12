import { singleton } from '../support/singleton.js';
import type { RequestEvent } from '../routing/Controller.js';

export type DashboardOperation = 'view' | 'retryJob' | 'deleteJob' | 'runTask' | 'toggleTask';
export type DashboardAuthorizer = (event: RequestEvent, operation: DashboardOperation) => boolean | Promise<boolean>;

export const dashboardAccess = singleton('svelar.dashboard.access', () => ({
  enabled: true,
  authorize: ((event) => Boolean(event.locals.user && event.locals.user.role === 'admin')) as DashboardAuthorizer,
}));

export async function authorizeDashboard(event: RequestEvent, operation: DashboardOperation = 'view'): Promise<boolean> {
  return dashboardAccess.enabled && Boolean(event.locals.user) && await dashboardAccess.authorize(event, operation);
}

const sensitiveKey = /password|passwd|secret|token|authorization|cookie|credential|privatekey|apikey|signature|sessionid/i;

/** Redact common credential formats without discarding operational stack traces. */
export function redactDashboardText(value: string): string {
  return value
    .replace(/-----BEGIN [\w ]*PRIVATE KEY-----[\s\S]*?-----END [\w ]*PRIVATE KEY-----/g, '[redacted]')
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9+/_=.-]+/gi, '$1 [redacted]')
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[redacted]@')
    .replace(/(["']?[\w.-]*(?:password|passwd|secret|token|authorization|cookie|credential|api[_-]?key|signature|session[_-]?id)[\w.-]*["']?\s*[:=]\s*)("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;&}\]]+)/gi, '$1[redacted]')
    .slice(0, 32_000);
}

/** Bounded, non-mutating serialization for untrusted payloads and log context. */
export function redactDashboardValue(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (depth > 12) return '[redacted: depth limit]';
  if (typeof value === 'string') {
    if (value.length > 32_000) return '[redacted: size limit]';
    if (/^\s*(?:\{\s*"|\[\s*[\[{"])/.test(value)) {
      try { return redactDashboardValue(JSON.parse(value), depth + 1, seen); } catch { return '[redacted: invalid JSON]'; }
    }
    return redactDashboardText(value);
  }
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== 'object') return null;
  if (seen.has(value)) return '[redacted: circular reference]';
  seen.add(value);
  try {
    if (Array.isArray(value)) return value.slice(0, 100).map((item) => redactDashboardValue(item, depth + 1, seen));
    return Object.fromEntries(Object.entries(value).slice(0, 100).map(([key, item]) => [
      key,
      sensitiveKey.test(key.replace(/[^a-z0-9]/gi, '')) ? '[redacted]' : redactDashboardValue(item, depth + 1, seen),
    ]));
  } finally {
    seen.delete(value);
  }
}

export function redactDashboardPayload(payload: string): unknown {
  if (payload.length > 32_000) return '[redacted: size limit]';
  try {
    const data: unknown = JSON.parse(payload);
    if (data === null || typeof data !== 'object') return '[redacted: unstructured payload]';
    return redactDashboardValue(data);
  } catch { return '[redacted: invalid JSON]'; }
}
