import type { SessionActivityStatus } from '@beeblock/svelar/session';

export interface SessionActivityClientState {
  status: SessionActivityStatus | null;
  expired: boolean;
  renewing: boolean;
  error: string | null;
}

export interface SessionActivityBus {
  subscribe(refresh: () => void): () => void;
  publish(): void;
}

export interface SessionActivityClientOptions {
  baseUrl: string;
  statusUrl: string;
  renewUrl: string;
  csrfToken: () => string | null;
  csrfHeader?: string;
  initial?: SessionActivityStatus;
  bus?: SessionActivityBus;
  fetch?: typeof globalThis.fetch;
}

function parseStatus(value: unknown): SessionActivityStatus {
  if (!value || typeof value !== 'object') throw new Error('Invalid session status.');
  const record = value as Record<string, unknown>;
  for (const key of ['serverTime', 'createdAt', 'lastActivityAt', 'idleExpiresAt', 'expiresAt', 'warningAt', 'remainingSeconds']) {
    if (typeof record[key] !== 'number' || !Number.isFinite(record[key])) throw new Error('Invalid session status.');
  }
  if ((record.absoluteExpiresAt !== null && (typeof record.absoluteExpiresAt !== 'number' || !Number.isFinite(record.absoluteExpiresAt)))
    || typeof record.expired !== 'boolean' || typeof record.canRenew !== 'boolean' || typeof record.remembered !== 'boolean'
    || (record.reason !== null && record.reason !== 'idle' && record.reason !== 'absolute' && record.reason !== 'invalid')) throw new Error('Invalid session status.');
  return value as SessionActivityStatus;
}

/** Broadcast messages invalidate a view; only an authenticated server response can extend its deadline. */
export class SessionActivityClient {
  private state: SessionActivityClientState;
  private listeners = new Set<(state: SessionActivityClientState) => void>();
  private checking?: Promise<void>;
  private renewal?: Promise<void>;
  private unsubscribe?: () => void;
  private offset = 0;
  private disposed = false;
  private abort = new AbortController();
  private statusUrl: string;
  private renewUrl: string;

  constructor(private options: SessionActivityClientOptions) {
    const base = new URL(options.baseUrl);
    const endpoint = (value: string) => {
      const url = new URL(value, base);
      if (url.origin !== base.origin || !['https:', 'http:'].includes(url.protocol)) throw new Error('Session endpoints must be same-origin HTTP URLs.');
      return url.href;
    };
    this.statusUrl = endpoint(options.statusUrl);
    this.renewUrl = endpoint(options.renewUrl);
    this.state = { status: options.initial ?? null, expired: options.initial?.expired ?? false, renewing: false, error: null };
    if (options.initial) this.offset = options.initial.serverTime - Date.now();
    this.unsubscribe = options.bus?.subscribe(() => { void this.refresh(); });
  }

  subscribe(listener: (state: SessionActivityClientState) => void): () => void {
    this.listeners.add(listener); listener(this.snapshot());
    return () => { this.listeners.delete(listener); };
  }

  snapshot(): SessionActivityClientState { return { ...this.state }; }
  remainingSeconds(): number | null {
    return this.state.status ? Math.max(0, Math.ceil((this.state.status.expiresAt - Date.now() - this.offset) / 1000)) : null;
  }

  refresh(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (!this.checking) this.checking = this.request(false).finally(() => { this.checking = undefined; });
    return this.checking;
  }

  renew(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (!this.renewal) {
      this.state.renewing = true; this.emit();
      this.renewal = this.request(true).finally(() => { this.renewal = undefined; this.state.renewing = false; this.emit(); });
    }
    return this.renewal;
  }

  dispose(): void { this.disposed = true; this.abort.abort(); this.unsubscribe?.(); this.listeners.clear(); }

  private async request(renew: boolean): Promise<void> {
    try {
      const token = renew ? this.options.csrfToken() : null;
      if (renew && !token) throw new Error('CSRF unavailable.');
      const request = {
        method: renew ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store', signal: this.abort.signal,
        headers: { 'X-Svelar-Session-Activity': 'false', ...(renew ? { 'Content-Type': 'application/json', [this.options.csrfHeader ?? 'X-CSRF-Token']: token! } : {}) },
        ...(renew ? { body: '{}' } : {}),
      } satisfies NonNullable<Parameters<typeof globalThis.fetch>[1]> & { cache: 'no-store' };
      const response = await (this.options.fetch ?? globalThis.fetch)(renew ? this.renewUrl : this.statusUrl, request);
      if (this.disposed) return;
      if (response.status === 401) {
        this.state.expired = true; this.state.error = null; this.emit(); return;
      }
      if (!response.ok) throw new Error('Session unavailable.');
      const body: unknown = await response.json();
      if (!body || typeof body !== 'object' || !('data' in body)) throw new Error('Invalid session status.');
      const status = parseStatus(body.data);
      if (this.disposed) return;
      if (this.state.status && status.serverTime < this.state.status.serverTime) return;
      this.offset = status.serverTime - Date.now();
      this.state.status = status; this.state.expired = status.expired; this.state.error = null; this.emit();
      if (renew) this.options.bus?.publish();
    } catch {
      if (!this.disposed) { this.state.error = renew ? 'Unable to renew your session. Please try again.' : 'Unable to check your session. Please try again.'; this.emit(); }
    }
  }

  private emit(): void { if (!this.disposed) for (const listener of this.listeners) listener(this.snapshot()); }
}

export function sessionCsrfToken(cookies: string, name = 'XSRF-TOKEN'): string | null {
  for (const part of cookies.split(';')) {
    const separator = part.indexOf('=');
    if (part.slice(0, separator).trim() === name) {
      try { return decodeURIComponent(part.slice(separator + 1)); } catch { return null; }
    }
  }
  return null;
}
