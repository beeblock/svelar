import { createHash } from 'node:crypto';
import type { QueueMetadataFilter } from './Monitoring.js';

export const metadataFields = ['tenantId', 'accountId', 'resourceId', 'correlationId'] as const;
export const metadataColumns = { tenantId: 'metadata_tenant', accountId: 'metadata_account', resourceId: 'metadata_resource', correlationId: 'metadata_correlation' } as const;

export function metadataValue(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' && (typeof value !== 'number' || !Number.isFinite(value))) throw new TypeError('Indexed queue metadata must be a string or finite number.');
  const result = String(value);
  if (Buffer.byteLength(result) > 512 || result.includes('\0')) throw new RangeError('Indexed queue metadata must not exceed 512 bytes or contain NUL.');
  return result;
}
export function indexedMetadata(metadata?: Record<string, any>, context?: Record<string, any>): QueueMetadataFilter {
  return { tenantId: metadata?.tenantId ?? context?.teamId ?? context?.tenantId, accountId: metadata?.accountId ?? context?.accountId,
    resourceId: metadata?.resourceId ?? context?.resourceId, correlationId: metadata?.correlationId ?? context?.correlationId };
}
export function metadataRow(metadata?: Record<string, any>, context?: Record<string, any>): Record<string, string | null> {
  const indexed = indexedMetadata(metadata, context);
  return Object.fromEntries(metadataFields.map(field => [metadataColumns[field], metadataDigest(indexed[field])]));
}
export function metadataDigest(value: unknown): string | null {
  const normalized = metadataValue(value);
  return normalized === null ? null : createHash('sha256').update(normalized).digest('hex');
}
export function metadataKeys(prefix: string, filter: QueueMetadataFilter): string[] {
  return metadataFields.flatMap(field => {
    const value = metadataValue(filter[field]);
    return value === null ? [] : [`${prefix}:meta:${field}:${createHash('sha256').update(value).digest('hex')}`];
  });
}
