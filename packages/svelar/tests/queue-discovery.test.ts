import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Connection } from '../src/database/Connection.js';
import { Migrator } from '../src/database/Migration.js';
import { svelarCoreMigrations } from '../src/database/CoreMigrations.js';
import { Job, Queue, type QueueConfig } from '../src/queue/index.js';

class DiscoveryJob extends Job { async handle() {} }
const config: QueueConfig = { default: 'sql', connections: { sql: { driver: 'database', queue: 'default' }, other: { driver: 'database' } } };

beforeEach(async () => {
  await Queue.stop();
  Connection.configure({ default: 'sqlite', connections: { sqlite: { driver: 'sqlite', filename: ':memory:' } } });
  await new Migrator().fresh(svelarCoreMigrations());
  Queue.configure(config);
});
afterEach(async () => { await Queue.stop(); await Connection.disconnect(); vi.restoreAllMocks(); });

describe('Safe bounded queue discovery', () => {
  it('exposes a paged allowlist configuration catalog without opening any driver', () => {
    Queue.configure({ default: 'redis', connections: {
      redis: { driver: 'redis', queue: 'reports', url: 'redis://user:secret@host.invalid:9999', password: 'private', prefix: 'internal' },
      memory: { driver: 'memory' },
    } });
    const catalog = Queue.configuredConnections({ limit: 1 });
    expect(catalog).toEqual({ connections: [{ name: 'memory', driver: 'memory', queue: 'default', isDefault: false }], total: 2, limit: 1, offset: 0, hasMore: true });
    const next = Queue.configuredConnections({ limit: 1, offset: 1 });
    expect(next.connections).toEqual([{ name: 'redis', driver: 'redis', queue: 'reports', isDefault: true }]);
    expect(next.hasMore).toBe(false);
    expect(JSON.stringify(next)).not.toMatch(/secret|private|internal|host\.invalid/);
    expect(() => Queue.configuredConnections({ limit: 1001 })).toThrow('limit');
    expect(() => Queue.configuredConnections({ offset: -1 })).toThrow('offset');
  });

  it('does not present unexpected runtime driver values as healthy supported connections', () => {
    Queue.configure({ default: 'future', connections: { future: { driver: 'future' } } } as unknown as QueueConfig);
    expect(Queue.configuredConnections().connections[0].driver).toBe('unknown');
  });

  it('rejects oversized Redis cursor counters before acquiring a client', async () => {
    Queue.configure({ default: 'redis', connections: { redis: { driver: 'redis', url: 'redis://host.invalid:1' } } });
    for (const position of [{ scan: '18446744073709551616', skip: 0 }, { scan: '0', skip: Number.MAX_SAFE_INTEGER }]) {
      const cursor = Buffer.from(JSON.stringify({ version: 1, connection: 'redis', driver: 'redis', limit: 1, position })).toString('base64url');
      await expect(Queue.discoverQueuesPage('redis', { limit: 1, cursor })).rejects.toThrow('cursor');
    }
  });

  it('bounds the compatibility inventory without retaining partial discovered state', async () => {
    const before = Queue.queues();
    const page = vi.spyOn(Queue, 'discoverQueuesPage').mockResolvedValue({ queues: [{ name: 'partial', connection: 'sql' }], total: null,
      complete: false, nextCursor: 'still-scanning', coverage: 'instrumented' });
    await expect(Queue.discoverQueues('sql')).rejects.toThrow('compatibility scan limit');
    expect(page).toHaveBeenCalledTimes(10);
    expect(Queue.queues()).toEqual(before);
  });

  it('paginates SQL queue names by keyset, preserves registry metadata, and remains read-only', async () => {
    Queue.registerQueue({ name: 'b', connection: 'sql', label: 'Invoices', metadata: { integration: 'billing' } });
    for (const name of ['a', 'b', 'b', 'c', 'd']) await Queue.dispatch(new DiscoveryJob(), { connection: 'sql', queue: name });
    await Queue.dispatch(new DiscoveryJob(), { connection: 'other', queue: 'foreign' });
    await Queue.stop(); Queue.configure(config);
    const before = Queue.queues();
    const first = await Queue.discoverQueuesPage('sql', { limit: 2 });
    expect(first).toMatchObject({ total: null, complete: false, coverage: 'instrumented' });
    expect(first.queues).toEqual([{ name: 'a', connection: 'sql' }, { name: 'b', connection: 'sql', label: 'Invoices', metadata: { integration: 'billing' } }]);
    const second = await Queue.discoverQueuesPage('sql', { limit: 2, cursor: first.nextCursor! });
    expect(second.queues.map(queue => queue.name)).toEqual(['c', 'd']);
    expect(second).toMatchObject({ nextCursor: null, complete: true, total: null });
    expect(Queue.queues()).toEqual(before);
    expect((await Queue.discoverQueuesPage('other')).queues.map(queue => queue.name)).toEqual(['foreign']);
  });

  it('validates malformed, cross-connection, changed-limit and changed-driver cursors before querying', async () => {
    for (const queue of ['a', 'b']) await Queue.dispatch(new DiscoveryJob(), { connection: 'sql', queue });
    const first = await Queue.discoverQueuesPage('sql', { limit: 1 });
    const query = vi.spyOn(Connection, 'raw');
    for (const cursor of ['', 'not-json', first.nextCursor! + '=', 'x'.repeat(4097)]) {
      await expect(Queue.discoverQueuesPage('sql', { limit: 1, cursor })).rejects.toThrow('cursor');
    }
    await expect(Queue.discoverQueuesPage('other', { limit: 1, cursor: first.nextCursor! })).rejects.toThrow('cursor');
    await expect(Queue.discoverQueuesPage('sql', { limit: 2, cursor: first.nextCursor! })).rejects.toThrow('cursor');
    Queue.configure({ default: 'sql', connections: { sql: { driver: 'redis', url: 'redis://host.invalid:1' } } });
    await expect(Queue.discoverQueuesPage('sql', { limit: 1, cursor: first.nextCursor! })).rejects.toThrow('cursor');
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects nonshared discovery and invalid limits instead of silently claiming empty healthy broker state', async () => {
    Queue.configure({ default: 'memory', connections: { memory: { driver: 'memory' } } });
    await expect(Queue.discoverQueuesPage()).rejects.toThrow('unsupported');
    await expect(Queue.discoverQueuesPage('memory', { limit: 0 })).rejects.toThrow('limit');
    await expect(Queue.discoverQueuesPage('unknown')).rejects.toThrow('not defined');
    expect(await Queue.discoverQueues('memory')).toEqual(expect.arrayContaining([{ name: 'default', connection: 'memory' }]));
  });
});
