import type { ApplicationContextSnapshot } from '../support/Context.js';

interface FailedJobPayload {
  payload: string;
  context?: ApplicationContextSnapshot;
  metadata?: Record<string, any>;
  connection?: string;
  maxAttempts?: number;
  retryDelay?: number;
  priority?: number;
}

/** Internal versioned transport in the existing failed_jobs payload column. */
export function decodeFailedJobPayload(payload: string): FailedJobPayload {
  try {
    const data = JSON.parse(payload);
    if (data?.__svelarFailedJob === 1 && typeof data.payload === 'string') {
      return { payload: data.payload, context: data.context, metadata: data.metadata,
        connection: data.connection, maxAttempts: data.maxAttempts, retryDelay: data.retryDelay, priority: data.priority };
    }
  } catch { /* Legacy malformed payloads remain visible, but cannot be replayed. */ }
  return { payload };
}
