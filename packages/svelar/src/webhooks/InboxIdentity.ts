import { createHash } from 'node:crypto';

export function normalizeWebhookInboxTenantId(tenantId: string | number | null | undefined): string | undefined {
  if (tenantId == null) return undefined;
  if (typeof tenantId === 'number' && Number.isSafeInteger(tenantId)) return String(tenantId);
  if (typeof tenantId === 'string') return tenantId;
  throw new TypeError('Webhook inbox tenantId must be a string, a safe integer, or null.');
}

export function webhookInboxDeduplicationKey(source: string, tenantId: string | number | null | undefined, idempotencyKey: string): string {
  return createHash('sha256')
    .update(JSON.stringify([source, normalizeWebhookInboxTenantId(tenantId) ?? null, idempotencyKey]))
    .digest('hex');
}
