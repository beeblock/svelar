interface RedisConfig { url?: string; host?: string; port?: number; password?: string; db?: number; }

export function redisConnection(config: RedisConfig): Record<string, any> {
  if (config.url) {
    const url = new URL(config.url);
    if (!['redis:', 'rediss:'].includes(url.protocol)) throw new TypeError('Redis queue URL must use redis:// or rediss://.');
    const database = url.pathname.replace(/^\//, '');
    if (database && !/^\d+$/.test(database)) throw new TypeError('Redis queue URL database must be a non-negative integer.');
    const db = database ? Number(database) : config.db ?? 0;
    if (!Number.isSafeInteger(db) || db < 0) throw new TypeError('Invalid Redis database.');
    return { host: url.hostname || 'localhost', port: Number(url.port) || 6379,
      username: url.username ? decodeURIComponent(url.username) : undefined,
      password: url.password ? decodeURIComponent(url.password) : config.password || undefined, db,
      ...(url.protocol === 'rediss:' ? { tls: {} } : {}) };
  }
  return { host: config.host ?? 'localhost', port: config.port ?? 6379, password: config.password, db: config.db ?? 0 };
}
