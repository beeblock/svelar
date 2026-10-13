import { mkdir, realpath } from 'node:fs/promises';
import lockfile from 'proper-lockfile';

const queues = new Map<string, Promise<unknown>>();

/** All file-store operations share one canonical-root lock, including flush and journal recovery. */
export async function serializeFileCache<T>(root: string, operation: (assertOwned: () => void) => Promise<T>): Promise<T> {
  await mkdir(root, { recursive: true });
  const canonicalRoot = await realpath(root);
  const previous = queues.get(canonicalRoot) ?? Promise.resolve();
  const current = previous.catch(() => {}).then(async () => {
    let compromised: Error | undefined;
    const release = await lockfile.lock(canonicalRoot, {
      lockfilePath: `${canonicalRoot}.lock`,
      stale: 30_000,
      update: 5_000,
      retries: { retries: 500, factor: 1, minTimeout: 10, maxTimeout: 20, randomize: true },
      onCompromised: (error) => { compromised = error; },
    });
    const deadline = performance.now() + 10_000;
    const assertOwned = () => {
      if (compromised) throw compromised;
      if (performance.now() > deadline) throw new Error('File-cache critical section exceeded its safe lock duration.');
    };
    const result = await Promise.resolve().then(() => operation(assertOwned)).then(
      (value) => { assertOwned(); return { ok: true as const, value }; },
    ).catch((error: unknown) => ({ ok: false as const, error }));
    try {
      await release();
    } catch (error) {
      if (!result.ok) throw new AggregateError([result.error, error], 'File-cache operation and lock release failed.');
      throw error;
    }
    if (!result.ok) throw result.error;
    return result.value;
  });
  queues.set(canonicalRoot, current);
  try {
    return await current;
  } finally {
    if (queues.get(canonicalRoot) === current) queues.delete(canonicalRoot);
  }
}
