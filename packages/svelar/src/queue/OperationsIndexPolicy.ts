export type QueueOperationsIndexMode = 'full' | 'failures-only' | 'off';

export type QueueOperationsIndexPolicy = QueueOperationsIndexMode | {
  mode?: QueueOperationsIndexMode;
  /** Terminal snapshots only, in seconds; default seven days. Zero retains none. */
  maxAgeSeconds?: number;
  /** Maximum snapshots per terminal status (completed/failed); default 1000. */
  maxJobs?: number;
};

export function operationsIndexPolicy(policy: QueueOperationsIndexPolicy = 'full') {
  const config: Exclude<QueueOperationsIndexPolicy, string> = typeof policy === 'string' ? { mode: policy } : policy;
  const options = { mode: config.mode ?? 'full', maxAgeSeconds: config.maxAgeSeconds ?? 7 * 86400, maxJobs: config.maxJobs ?? 1000 };
  if (!['full', 'failures-only', 'off'].includes(options.mode)) throw new TypeError('Invalid queue operationsIndex mode.');
  for (const field of ['maxAgeSeconds', 'maxJobs'] as const) {
    const maximum = field === 'maxAgeSeconds' ? Math.floor(Number.MAX_SAFE_INTEGER / 1000) : Number.MAX_SAFE_INTEGER;
    if (!Number.isSafeInteger(options[field]) || options[field] < 0 || options[field] > maximum) {
      throw new RangeError(`Queue operationsIndex ${field} must be a non-negative safe integer within the supported range.`);
    }
  }
  return options;
}
