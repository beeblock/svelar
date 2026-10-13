import { config } from '../config/index.js';
import { Connection } from '../database/Connection.js';
import { Cache, type CacheDriver } from '../cache/index.js';
import { Queue } from '../queue/index.js';
import { Search } from '../search/index.js';
import { PDF } from '../pdf/index.js';
import { Broadcast } from '../broadcasting/index.js';
import { createDashboardDependencyObserver, type DashboardDependencyProbe } from './dependencies.js';

function configuredNames(key: string): string[] {
  const value: unknown = config.get(key, {});
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid dependency configuration registry.');
  const names = Object.keys(value);
  if (names.length > 100) throw new RangeError('Dependency configuration registry exceeds 100 names.');
  return names;
}

export interface DashboardDependencyInventory {
  /** Safe names/drivers copied from the same object passed to Cache.configure, never inferred from store names. */
  cacheStores?: readonly { name: string; driver: CacheDriver }[];
}

function configuredProbes(inventory: DashboardDependencyInventory): DashboardDependencyProbe[] {
  const probes: DashboardDependencyProbe[] = [];
  const databaseNames = configuredNames('database.connections');
  let databaseConfigured = false;
  try { Connection.getConfig(); databaseConfigured = true; } catch { /* Unconfigured database remains unknown. */ }
  probes.push({ name: 'database', scope: databaseConfigured ? Connection.getDriver() === 'sqlite' ? 'process' : 'shared' : 'unknown', ...(databaseConfigured ? {
    check: async () => { await Connection.raw('SELECT 1'); return 'healthy' as const; },
  } : {}) });
  for (const name of new Set(databaseNames)) probes.push({ name: 'database:' + name, scope: Connection.getDriver(name) === 'sqlite' ? 'process' : 'shared', check: async () => {
    // Constant reachability query is driver infrastructure, never application persistence or a table scan.
    await Connection.raw('SELECT 1', [], name); return 'healthy';
  } });
  const cacheDefault = config.get<string>('cache.default', process.env.CACHE_DRIVER ?? 'memory');
  if (inventory.cacheStores && (inventory.cacheStores.length > 100 || new Set(inventory.cacheStores.map((store) => store.name)).size !== inventory.cacheStores.length
    || inventory.cacheStores.some((store) => !store || typeof store.name !== 'string' || !store.name || !['redis', 'memory', 'file', 'null'].includes(store.driver)))) {
    throw new TypeError('Invalid runtime cache dependency inventory.');
  }
  const cacheNames = inventory.cacheStores ? inventory.cacheStores.map((store) => store.name) : [...configuredNames('cache.stores'), cacheDefault];
  if (!cacheNames.length) probes.push({ name: 'cache', scope: 'unknown' });
  for (const name of new Set(cacheNames)) {
    const driver = inventory.cacheStores?.find((store) => store.name === name)?.driver;
    probes.push({ name: 'cache:' + name, scope: driver === 'redis' ? 'shared' : driver === 'memory' || driver === 'file' ? 'process' : 'unknown',
      ...(driver !== 'null' ? { check: async () => { await Cache.store(name).get('svelar:dashboard:reachability'); return driver ? 'healthy' as const : 'unknown' as const; } } : {}) });
  }
  const connections = Queue.configuredConnections({ limit: 100, offset: 0 });
  if (connections.hasMore) throw new RangeError('Configured queue dependency registry exceeds 100 names.');
  for (const connection of connections.connections) {
    const driver = connection.driver;
    probes.push({ name: 'queue:' + connection.name, scope: driver === 'redis' || driver === 'database' ? 'shared' : driver === 'unknown' ? 'unknown' : 'process',
      ...(driver === 'redis' || driver === 'database' ? { check: async () => { await Queue.adapter(undefined, connection.name).counts(); return 'healthy' as const; } } : {}) });
  }
  probes.push({ name: 'search', scope: Search.isConfigured() ? 'shared' : 'unknown', ...(Search.isConfigured() ? {
    check: async () => (await Search.health()).status === 'available' ? 'healthy' as const : 'unavailable' as const,
  } : {}) });
  probes.push({ name: 'pdf:' + PDF.driver, scope: PDF.driver === 'gotenberg' ? 'shared' : 'process',
    check: async () => (await PDF.health()).status === 'up' ? 'healthy' : 'unavailable' });
  const storage = configuredNames('storage.disks');
  for (const name of storage.length ? storage : ['unconfigured']) probes.push({ name: 'storage:' + name, scope: 'unknown' });
  const mailDefault = config.get<string>('mail.default', config.get<string>('mail.driver', process.env.MAIL_DRIVER ?? 'log'));
  for (const name of new Set([...configuredNames('mail.mailers'), mailDefault])) probes.push({ name: 'mail:' + name, scope: 'unknown' });
  const realtime = configuredNames('broadcasting.drivers');
  for (const name of realtime.length ? realtime : ['default']) probes.push({ name: 'realtime:' + name, scope: 'unknown' });
  // Subscription failures are observable, but ready() alone does not prove browser delivery or Pusher reachability.
  probes.push({ name: 'realtime:subscription', scope: 'unknown', check: async () => { await Broadcast.ready(); return 'unknown'; } });
  return probes;
}

/** Snapshot after bootstrap, on the first health read. Monitoring limits must not prevent app startup. */
export function createConfiguredDashboardDependencyObserver(inventory: DashboardDependencyInventory = {}) {
  let observe: ReturnType<typeof createDashboardDependencyObserver> | undefined;
  return async () => {
    if (!observe) { const probes = configuredProbes(inventory); observe = createDashboardDependencyObserver(() => probes); }
    return observe();
  };
}
