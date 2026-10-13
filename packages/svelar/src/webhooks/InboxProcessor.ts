import { createHash, randomUUID } from 'node:crypto';
import { Connection } from '../database/Connection.js';
import { QueryBuilder } from '../orm/QueryBuilder.js';
import { ApplicationContext } from '../support/Context.js';
import { redactLogContext, redactLogText } from '../logging/Redaction.js';
import type { WebhookInboxEntry, WebhookInboxReceiveResult, WebhookInboxVerifier } from './index.js';
import { normalizeWebhookInboxTenantId, webhookInboxDeduplicationKey } from './InboxIdentity.js';

export interface IncomingWebhookSource {
  verifier: WebhookInboxVerifier;
  resolveTenant: (payload: unknown, headers: Record<string, string>) => string | number | null | Promise<string | number | null>;
  handler: (entry: WebhookInboxEntry) => Promise<void>;
  idempotencyKey?: (payload: unknown, headers: Record<string, string>) => string;
  orderingKey?: (payload: unknown, headers: Record<string, string>) => string;
  version?: (payload: unknown, headers: Record<string, string>) => number;
  deduplicationWindowSeconds?: number;
  actorId?: string | number;
  requireTenant?: boolean;
  /** Process only the latest waiting version, preserving each received event for inspection. */
  coalesce?: boolean;
  maxAttempts?: number;
  retrySeconds?: number;
  leaseSeconds?: number;
  maxBodyBytes?: number;
  ackStatus?: 200 | 202 | 204;
  reconcile?: () => Promise<void>;
  /** Remove sensitive data only after successful processing. Replay receives the redacted payload. */
  redactAfterProcessing?: readonly string[];
}

export interface InboxProcessorRepository {
  durable(): boolean;
  query(): QueryBuilder;
  table(): string;
  hydrate(row: any): WebhookInboxEntry;
  receive(input: any): Promise<WebhookInboxReceiveResult>;
}

export class WebhookInboxProcessor {
  private sources = new Map<string, IncomingWebhookSource>();
  constructor(private repository: InboxProcessorRepository) {}

  register(name: string, definition: IncomingWebhookSource): void {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(name) || typeof definition.verifier !== 'function' ||
      typeof definition.resolveTenant !== 'function' || typeof definition.handler !== 'function') throw new Error('Invalid incoming webhook source.');
    for (const key of ['maxAttempts', 'retrySeconds', 'leaseSeconds', 'maxBodyBytes', 'deduplicationWindowSeconds'] as const) {
      const value = definition[key];
      const maximum = key === 'maxBodyBytes' ? 16_777_216 : key === 'maxAttempts' ? 1000 : 31_536_000;
      if (value !== undefined && (!Number.isSafeInteger(value) || value < 1 || value > maximum)) throw new Error(`Invalid webhook ${key}.`);
    }
    if (definition.ackStatus !== undefined && ![200, 202, 204].includes(definition.ackStatus)) throw new Error('Invalid webhook acknowledgement status.');
    this.sources.set(name, { ...definition });
  }

  hasSource(name: string): boolean { return this.sources.has(name); }
  names(): string[] { return [...this.sources.keys()].sort(); }
  ackStatus(name: string): 200 | 202 | 204 { return this.source(name).ackStatus ?? 202; }

  async capture(name: string, request: Request): Promise<WebhookInboxReceiveResult> {
    this.assertDurable();
    const source = this.source(name);
    const bytes = await readWebhookBody(request, source.maxBodyBytes ?? 1_048_576);
    const headers = Object.fromEntries(request.headers);
    let rawBody: string;
    try { rawBody = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch { throw new IncomingWebhookError(400, 'Expected a UTF-8 JSON webhook payload.'); }
    if (!await source.verifier({ source: name, rawBody, rawBytes: bytes, headers })) throw new IncomingWebhookError(401, 'Invalid webhook signature.');
    let payload: unknown;
    try { payload = JSON.parse(rawBody); } catch { throw new IncomingWebhookError(400, 'Expected a valid JSON webhook payload.'); }
    const tenantId = normalizeWebhookInboxTenantId(await source.resolveTenant(payload, headers));
    if ((source.requireTenant ?? true) && (tenantId === null || tenantId === undefined || tenantId === '')) {
      throw new IncomingWebhookError(403, 'Webhook tenant could not be resolved.');
    }
    const orderingKey = source.orderingKey?.(payload, headers);
    const version = source.version?.(payload, headers);
    if (version !== undefined && (!Number.isSafeInteger(version) || version < 0)) throw new IncomingWebhookError(422, 'Invalid webhook version.');
    const group = orderingKey === undefined ? null : createHash('sha256').update(JSON.stringify([name, tenantId, orderingKey])).digest('hex');
    const idempotencyKey = source.idempotencyKey?.(payload, headers) ?? createHash('sha256').update(bytes).digest('hex');
    return Connection.transaction(async () => {
      if (source.deduplicationWindowSeconds !== undefined) {
        const key = webhookInboxDeduplicationKey(name, tenantId, idempotencyKey);
        let query = this.repository.query().where('deduplication_key', key);
        if (Connection.getDriver() !== 'sqlite') query = query.forUpdate();
        const existing = await query.first();
        const terminal = existing && (['processed', 'ignored'].includes(existing.status) ||
          (existing.status === 'failed' && existing.available_at == null));
        if (terminal &&
          Number(existing.created_at) + source.deduplicationWindowSeconds * 1000 <= Date.now()) {
          await this.repository.query().where('id', existing.id).where('deduplication_key', key).update({
            deduplication_key: createHash('sha256').update(JSON.stringify([key, existing.id, 'expired'])).digest('hex'),
          });
        }
      }
      return this.repository.receive({ source: name, rawBody: bytes, headers, tenantId, actorId: source.actorId, idempotencyKey, managed: true,
        orderingKey: group, version, verifier: () => true, metadata: {
          correlationId: ApplicationContext.get('correlationId'), requestId: ApplicationContext.get('requestId'),
        } });
    });
  }

  async process(name: string, limit = 100): Promise<{ processed: number; failed: number; ignored: number }> {
    this.assertDurable();
    const source = this.source(name);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new Error('Invalid webhook processing batch.');
    const result = { processed: 0, failed: 0, ignored: 0 };
    const table = this.repository.table();
    const leaseMs = (source.leaseSeconds ?? 60) * 1000;
    for (let i = 0; i < limit; i++) {
      const owner = randomUUID();
      const row = await Connection.transaction(async () => {
        let query = this.eligible(name, source).whereRaw(
          `(${table}.ordering_key IS NULL OR NOT EXISTS (SELECT 1 FROM ${table} older WHERE older.managed = ? AND older.ordering_key = ${table}.ordering_key AND older.status NOT IN (?, ?) AND ((older.event_version IS NOT NULL AND ${table}.event_version IS NOT NULL AND older.event_version < ${table}.event_version) OR ((older.event_version IS NULL OR ${table}.event_version IS NULL OR older.event_version = ${table}.event_version) AND (older.created_at < ${table}.created_at OR (older.created_at = ${table}.created_at AND older.id < ${table}.id))))))`,
          [true, 'processed', 'ignored'],
        ).orderBy('created_at').orderBy('id');
        if (Connection.getDriver() !== 'sqlite') query = query.forUpdate().skipLocked();
        const candidate = await query.first();
        if (!candidate) return null;
        if (candidate.ordering_key) {
          const active = await this.repository.query().where('ordering_key', candidate.ordering_key).where('status', 'processing').where('locked_until', '>', Date.now()).exists();
          if (active) return null;
          if (source.coalesce) {
            const latest = await this.repository.query().where('ordering_key', candidate.ordering_key).where('managed', true)
              .whereIn('status', ['received', 'queued', 'failed']).orderBy('event_version', 'desc').orderBy('created_at', 'desc').orderBy('id', 'desc').first();
            if (latest && latest.id !== candidate.id) {
              await this.repository.query().where('id', candidate.id).update({ status: 'ignored', processed_at: Date.now(), updated_at: Date.now(), error: 'Coalesced into a newer waiting event.' });
              return { ignored: true };
            }
          }
          if (candidate.event_version !== null) {
            const newer = await this.repository.query().where('ordering_key', candidate.ordering_key).where('status', 'processed').where('event_version', '>=', Number(candidate.event_version)).exists();
            if (newer) {
              await this.repository.query().where('id', candidate.id).update({ status: 'ignored', processed_at: Date.now(), updated_at: Date.now(), error: 'Stale event version.' });
              return { ignored: true };
            }
          }
        }
        const changed = await this.eligible(name, source).where('id', candidate.id).update({ status: 'processing', lock_owner: owner,
          locked_until: Date.now() + leaseMs, attempts: Number(candidate.attempts) + 1, updated_at: Date.now() });
        return changed === 1 ? candidate : null;
      });
      if (!row) break;
      if (row.ignored) { result.ignored++; continue; }
      const owned = () => this.repository.query().where('id', row.id).where('status', 'processing').where('lock_owner', owner);
      let renewal: Promise<void> | undefined;
      let renewing = false;
      let leaseError: unknown;
      const heartbeat = setInterval(() => {
        if (renewing) return;
        renewing = true;
        renewal = owned().update({ locked_until: Date.now() + leaseMs }).then((count) => {
          if (count !== 1) leaseError = new Error('Webhook processing lease lost.');
        }).catch((error) => { leaseError = error; }).finally(() => { renewing = false; });
      }, Math.max(100, leaseMs / 3));
      heartbeat.unref();
      try {
        const entry = this.repository.hydrate(row);
        await ApplicationContext.runIsolated({ teamId: entry.tenantId, tenantId: entry.tenantId, actorId: entry.actorId,
          integration: name, correlationId: entry.metadata?.correlationId, webhookId: entry.id }, () => source.handler(entry));
        clearInterval(heartbeat); await renewal;
        if (leaseError) throw leaseError;
        const changes: Record<string, unknown> = { status: 'processed', processed_at: Date.now(), updated_at: Date.now(), error: null, lock_owner: null, locked_until: null };
        if (source.redactAfterProcessing?.length) {
          const safe = redactLogContext(entry.payload, [...source.redactAfterProcessing]);
          changes.payload = JSON.stringify(safe); changes.raw_body = JSON.stringify(safe);
        }
        if (await owned().update(changes) !== 1) throw new Error('Webhook processing lease lost.');
        result.processed++;
      } catch (error) {
        clearInterval(heartbeat); await renewal;
        const attempt = Number(row.attempts) + 1;
        await owned().update({ status: 'failed', updated_at: Date.now(), lock_owner: null, locked_until: null,
          available_at: attempt >= (source.maxAttempts ?? 5) ? null : Date.now() + Math.min(3600, (source.retrySeconds ?? 10) * 2 ** Math.min(attempt - 1, 10)) * 1000,
          error: redactLogText(error instanceof Error ? error.message : String(error)).slice(0, 2000) });
        result.failed++;
      } finally { clearInterval(heartbeat); await renewal; }
    }
    return result;
  }

  async reconcile(name: string): Promise<void> { await this.source(name).reconcile?.(); }

  async prune(before: number): Promise<number> {
    this.assertDurable();
    if (!Number.isSafeInteger(before) || before < 0) throw new Error('Invalid webhook retention cutoff.');
    return this.repository.query().whereIn('status', ['processed', 'ignored']).where('updated_at', '<', before).delete();
  }

  async stats(name?: string) {
    this.assertDurable();
    const query = this.repository.query().where('managed', true);
    if (name) query.where('source', name);
    const statuses = await query.clone().select('status').selectRaw('COUNT(*) AS total').groupBy('status').get();
    const oldest = await query.clone().whereIn('status', ['received', 'queued', 'failed']).orderBy('created_at').first();
    return { byStatus: Object.fromEntries(statuses.map((row) => [row.status, Number(row.total)])), oldestPendingAt: oldest ? Number(oldest.created_at) : null,
      lagMs: oldest ? Math.max(0, Date.now() - Number(oldest.created_at)) : 0 };
  }

  private eligible(name: string, source: IncomingWebhookSource): QueryBuilder {
    return this.repository.query().where('managed', true).where('source', name).whereNested((query) => {
      query.whereNested((pending) => { pending.whereIn('status', ['received', 'queued']).whereNested((due) => { due.whereNull('available_at').orWhere('available_at', '<=', Date.now()); }); });
      query.orWhereNested((retry) => { retry.where('status', 'failed').where('attempts', '<', source.maxAttempts ?? 5).whereNotNull('available_at').where('available_at', '<=', Date.now()); });
      query.orWhereNested((expired) => { expired.where('status', 'processing').where('locked_until', '<=', Date.now()); });
    });
  }

  private source(name: string) {
    const source = this.sources.get(name);
    if (!source) throw new IncomingWebhookError(404, 'Incoming webhook source is not registered.');
    return source;
  }
  private assertDurable() { if (!this.repository.durable()) throw new Error('Webhook processing requires the migrated database inbox driver.'); }

}

export async function readWebhookBody(request: Request, maxBytes: number): Promise<Uint8Array> {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 16_777_216) throw new Error('Invalid webhook body limit.');
    if (!request.body) return new Uint8Array();
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const result = await reader.read();
        if (result.done) break;
        size += result.value.byteLength;
        if (size > maxBytes) { await reader.cancel(); throw new IncomingWebhookError(413, 'Webhook body is too large.'); }
        chunks.push(result.value);
      }
    } finally { reader.releaseLock(); }
    return new Uint8Array(Buffer.concat(chunks));
}

export class IncomingWebhookError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
