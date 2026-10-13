import { singleton } from '../support/singleton.js';

export interface SessionActivityPolicy {
  idleLifetime: number;
  absoluteLifetime?: number;
  touchThrottle: number;
  warningBefore: number;
  rememberLifetime?: number;
  rememberAbsoluteLifetime?: number;
}

export interface SessionActivityStatus {
  serverTime: number;
  createdAt: number;
  lastActivityAt: number;
  idleExpiresAt: number;
  absoluteExpiresAt: number | null;
  expiresAt: number;
  warningAt: number;
  remainingSeconds: number;
  expired: boolean;
  reason: 'idle' | 'absolute' | 'invalid' | null;
  remembered: boolean;
  canRenew: boolean;
}

export const sessionTimingKeys = ['_svelar_created_at', '_svelar_last_activity_at', '_svelar_last_touched_at'] as const;

export function sessionActivityStatus(data: Record<string, unknown>, policy: SessionActivityPolicy, now = Date.now()): SessionActivityStatus {
  const createdAt = data._svelar_created_at;
  const lastActivityAt = data._svelar_last_activity_at;
  const remembered = data._svelar_remember === true;
  const valid = (!remembered || policy.rememberLifetime !== undefined) && typeof createdAt === 'number' && Number.isFinite(createdAt) && createdAt > 0 && createdAt <= now
    && typeof lastActivityAt === 'number' && Number.isFinite(lastActivityAt) && lastActivityAt >= createdAt && lastActivityAt <= now;
  const idle = remembered ? policy.rememberLifetime ?? policy.idleLifetime : policy.idleLifetime;
  const absolute = remembered ? policy.rememberAbsoluteLifetime ?? policy.absoluteLifetime : policy.absoluteLifetime;
  const start = valid ? createdAt : 0;
  const activity = valid ? lastActivityAt : 0;
  const idleExpiresAt = activity + idle * 1000;
  const absoluteExpiresAt = absolute === undefined ? null : start + absolute * 1000;
  const expiresAt = Math.min(idleExpiresAt, absoluteExpiresAt ?? Infinity);
  const reason = !valid ? 'invalid' : absoluteExpiresAt !== null && now >= absoluteExpiresAt ? 'absolute' : now >= idleExpiresAt ? 'idle' : null;
  return {
    serverTime: now, createdAt: start, lastActivityAt: activity, idleExpiresAt, absoluteExpiresAt, expiresAt,
    warningAt: expiresAt - policy.warningBefore * 1000,
    remainingSeconds: Math.max(0, Math.ceil((expiresAt - now) / 1000)),
    expired: reason !== null, reason, remembered, canRenew: reason === null,
  };
}

/** Client activity headers may opt out, but cannot turn a background request into navigation. */
export function isSessionActivityRequest(request: Request): boolean {
  const accept = request.headers.get('accept')?.toLowerCase() ?? '';
  if (accept.includes('text/event-stream')) return false;
  const explicit = request.headers.get('x-svelar-session-activity')?.toLowerCase();
  if (explicit === 'false' || explicit === '0') return false;
  const method = request.method.toUpperCase();
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) return true;
  return method === 'GET' && request.headers.get('sec-fetch-mode') === 'navigate'
    && ['document', null, ''].includes(request.headers.get('sec-fetch-dest'));
}

const expiredSessionErrors = singleton('svelar.session.expired-errors', () => new WeakSet<object>());

export function isSessionExpiredError(value: unknown): value is SessionExpiredError {
  return typeof value === 'object' && value !== null && expiredSessionErrors.has(value);
}

export class SessionExpiredError extends Error {
  constructor() {
    super('Session expired. Sign in again.');
    this.name = 'SessionExpiredError';
    expiredSessionErrors.add(this);
  }
}
