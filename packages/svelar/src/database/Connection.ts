import { AsyncLocalStorage } from 'node:async_hooks';
import { ApplicationContext } from '../support/Context.js';

/**
 * Svelar Database Connection
 *
 * Manages database connections with support for SQLite, PostgreSQL, and MySQL.
 * Wraps Drizzle ORM for the underlying driver.
 */

export type DatabaseDriver = 'sqlite' | 'postgres' | 'mysql';
export type DatabaseDriverAlias = DatabaseDriver | 'postgresql' | 'mysql2';

export interface DatabaseConfig {
  driver: DatabaseDriverAlias;
  /** SQLite file path */
  filename?: string;
  /** Host for postgres/mysql */
  host?: string;
  /** Port for postgres/mysql */
  port?: number;
  /** Database name */
  database?: string;
  /** Database user */
  user?: string;
  /** Database password */
  password?: string;
  /** Connection URL (alternative to individual fields) */
  url?: string;
  /** Enable debug/query logging */
  debug?: boolean;
  /** Enable prepared statements for PostgreSQL. Disable for PgBouncer transaction pooling. */
  prepare?: boolean;
}

export interface ConnectionsConfig {
  default: string;
  connections: Record<string, DatabaseConfig>;
}

const SQL_IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function assertSqlIdentifier(identifier: string, label: string = 'SQL identifier'): string {
  if (!SQL_IDENTIFIER_RE.test(identifier)) {
    throw new Error(`${label} contains invalid characters: "${identifier}"`);
  }
  return identifier;
}

export function normalizeDatabaseDriver(driver: string): DatabaseDriver {
  if (driver === 'postgresql') return 'postgres';
  if (driver === 'mysql2') return 'mysql';
  if (driver === 'sqlite' || driver === 'postgres' || driver === 'mysql') return driver;
  throw new Error(`Unsupported database driver: ${driver}`);
}

function postgresSql(sql: string, bindingCount: number): string {
  let index = 0;
  let result = '';
  let singleQuoted = false;
  let doubleQuoted = false;

  for (let i = 0; i < sql.length; i++) {
    const char = sql[i];
    const next = sql[i + 1];

    if (char === "'" && !doubleQuoted) {
      result += char;
      if (singleQuoted && next === "'") {
        result += next;
        i++;
        continue;
      }
      singleQuoted = !singleQuoted;
      continue;
    }

    if (char === '"' && !singleQuoted) {
      result += char;
      doubleQuoted = !doubleQuoted;
      continue;
    }

    if (char === '?' && !singleQuoted && !doubleQuoted && index < bindingCount) {
      const nextNonSpace = sql.slice(i + 1).match(/\S/)?.[0] ?? '';
      if (nextNonSpace === "'" || nextNonSpace === '"' || nextNonSpace === '?' || nextNonSpace === '|') {
        result += char;
        continue;
      }
      result += `$${++index}`;
      continue;
    }

    result += char;
  }

  return result;
}

const ISO_DATE_TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/;

export function normalizeDatabaseBindings(bindings: any[], driver: DatabaseDriver): any[] {
  return bindings.map((value) => normalizeDatabaseBinding(value, driver));
}

function normalizeDatabaseBinding(value: any, driver: DatabaseDriver): any {
  if (driver === 'sqlite') {
    if (typeof value === 'boolean') return value ? 1 : 0;
    if (value instanceof Date) return value.toISOString();
    return value;
  }

  if (driver === 'mysql') {
    if (value instanceof Date) return formatMySQLDateTime(value);
    if (typeof value === 'string' && ISO_DATE_TIME_RE.test(value)) {
      return formatMySQLDateTime(new Date(value));
    }
  }

  return value;
}

function formatMySQLDateTime(date: Date): string {
  return date.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
}

// Drizzle instance type — we keep it loose since the actual type depends on the driver
export type DrizzleInstance = any;

interface ActiveConnection {
  drizzle: DrizzleInstance;
  config: DatabaseConfig;
  rawClient: any;
}

interface TransactionFrame {
  active: boolean;
  parent?: TransactionFrame;
  childActive?: boolean;
  afterCommit: Array<() => void | Promise<void>>;
}

/** The transaction committed; retrying the original write can duplicate it. */
export class AfterCommitError extends AggregateError {
  readonly committed = true;
  constructor(errors: unknown[]) { super(errors, 'Transaction committed, but an after-commit callback failed.'); }
}

class ConnectionManager {
  private connections = new Map<string, ActiveConnection>();
  private config: ConnectionsConfig | null = null;
  private defaultName: string = 'default';
  private transactionClients = new AsyncLocalStorage<Map<string, any>>();
  private transactionFrames = new AsyncLocalStorage<Map<string, TransactionFrame>>();
  private sqliteTransactions = new Map<string, Promise<void>>();
  private openingConnections = new Map<string, Promise<ActiveConnection>>();
  private implicitConnection = new AsyncLocalStorage<string>();
  private savepointId = 0;

  /** Scope implicit Schema/QueryBuilder calls without changing the process default. */
  usingConnection<T>(name: string | undefined, callback: () => T): T {
    const resolved = this.resolveConnectionName(name);
    this.getConfig(resolved);
    return this.implicitConnection.run(resolved, callback);
  }

  private resolveConnectionName(name?: string): string {
    return name ?? this.implicitConnection.getStore() ?? this.defaultName;
  }

  /**
   * Initialize the connection manager with configuration
   */
  configure(config: ConnectionsConfig): void {
    const connections: Record<string, DatabaseConfig> = {};
    for (const [name, connection] of Object.entries(config.connections)) {
      connections[name] = {
        ...connection,
        driver: normalizeDatabaseDriver(connection.driver),
      };
    }

    let defaultName = config.default;
    if (!connections[defaultName]) {
      try {
        const normalizedDefault = normalizeDatabaseDriver(config.default);
        if (connections[normalizedDefault]) {
          defaultName = normalizedDefault;
        }
      } catch {
        // The default may be a named connection rather than a driver alias.
      }
    }

    this.config = { ...config, default: defaultName, connections };
    this.defaultName = defaultName;
  }

  /**
   * Get or create a database connection by name
   */
  async connection(name?: string): Promise<DrizzleInstance> {
    const connName = this.resolveConnectionName(name);

    if (this.connections.has(connName)) {
      return this.connections.get(connName)!.drizzle;
    }

    if (!this.config) {
      throw new Error(
        'Database not configured. Call Connection.configure() first, or register DatabaseServiceProvider.'
      );
    }

    const dbConfig = this.config.connections[connName];
    if (!dbConfig) {
      throw new Error(`Database connection "${connName}" is not defined in configuration.`);
    }

    let opening = this.openingConnections.get(connName);
    if (!opening) {
      opening = this.createConnection(dbConfig);
      this.openingConnections.set(connName, opening);
    }
    try {
      const active = await opening;
      this.connections.set(connName, active);
      return active.drizzle;
    } finally {
      if (this.openingConnections.get(connName) === opening) this.openingConnections.delete(connName);
    }
  }

  /**
   * Get the raw client (e.g. better-sqlite3 Database, pg Pool, mysql2 connection)
   */
  async rawClient(name?: string): Promise<any> {
    const connName = this.resolveConnectionName(name);
    const frame = this.transactionFrames.getStore()?.get(connName);
    for (let ancestor = frame; ancestor; ancestor = ancestor.parent) {
      if (!ancestor.active) throw new Error('This transaction has already ended. Await work before returning from its callback.');
    }
    if (frame?.childActive) throw new Error('Await the nested transaction before issuing statements in its parent context.');
    const transactionClient = this.transactionClients.getStore()?.get(connName);
    if (transactionClient) {
      return transactionClient;
    }

    // Ensure connection exists
    await this.connection(connName);
    // SQLite has one synchronous client. Unrelated async executions must not borrow its open transaction.
    if (this.getDriver(connName) === 'sqlite') {
      const pending = this.sqliteTransactions.get(connName);
      if (pending) await pending;
    }
    return this.connections.get(connName)!.rawClient;
  }

  /**
   * Execute raw SQL
   */
  async raw(sql: string, bindings: any[] = [], connectionName?: string): Promise<any> {
    const db = await this.connection(connectionName);
    const config = this.getConfig(connectionName);

    switch (config.driver) {
      case 'sqlite': {
        const client = await this.rawClient(connectionName);
        const safeBindings = normalizeDatabaseBindings(bindings, 'sqlite');
        const execute = async () => {
          const stmt = client.prepare(sql);
          // DDL/mutations use run(); queries use all().
          const trimmed = sql.trimStart().toUpperCase();
          if (trimmed.startsWith('SELECT') || (trimmed.startsWith('PRAGMA') && !trimmed.includes('=')) || trimmed.startsWith('WITH')) {
            return stmt.all(...safeBindings);
          }
          return stmt.run(...safeBindings);
        };
        return this.inTransaction(connectionName) ? execute()
          : this.serializeSQLite(this.resolveConnectionName(connectionName), execute);
      }
      case 'postgres': {
        const client = await this.rawClient(connectionName);
        return client.unsafe(postgresSql(sql, bindings.length), bindings);
      }
      case 'mysql': {
        const client = await this.rawClient(connectionName);
        const [rows] = await client.execute(sql, normalizeDatabaseBindings(bindings, 'mysql'));
        return rows;
      }
      default:
        throw new Error(`Unsupported driver: ${config.driver}`);
    }
  }

  /**
   * Get the driver type for a connection
   */
  getDriver(name?: string): DatabaseDriver {
    return normalizeDatabaseDriver(this.getConfig(name).driver);
  }

  /**
   * Get connection config
   */
  getConfig(name?: string): DatabaseConfig {
    const connName = this.resolveConnectionName(name);
    if (!this.config) {
      throw new Error('Database not configured.');
    }
    const cfg = this.config.connections[connName];
    if (!cfg) {
      throw new Error(`Database connection "${connName}" is not defined.`);
    }
    return cfg;
  }

  /**
   * Close all connections
   */
  async disconnect(name?: string): Promise<void> {
    if (name) {
      const conn = this.connections.get(name);
      if (conn) {
        await this.closeConnection(conn);
        this.connections.delete(name);
      }
    } else {
      for (const [key, conn] of this.connections) {
        await this.closeConnection(conn);
      }
      this.connections.clear();
    }
  }

  /**
   * Check if a connection is active
   */
  isConnected(name?: string): boolean {
    return this.connections.has(this.resolveConnectionName(name));
  }

  /**
   * Run a callback inside a database transaction.
   * Automatically commits on success, rolls back on error.
   */
  async transaction<T>(callback: () => Promise<T>, connectionName?: string): Promise<T> {
    const connName = this.resolveConnectionName(connectionName);
    const driver = this.getDriver(connName);
    const parent = this.transactionFrames.getStore()?.get(connName);
    if (parent && !parent.active) throw new Error('This transaction has already ended.');
    if (parent?.childActive) throw new Error('Concurrent nested transactions are not supported. Await each nested transaction.');
    const client = parent ? this.transactionClients.getStore()!.get(connName) : await this.rawClient(connName);
    const frame: TransactionFrame = { active: true, parent, afterCommit: [] };
    if (parent) parent.childActive = true;
    const run = (transactionClient: any) => {
      const clients = new Map(this.transactionClients.getStore() ?? []);
      const frames = new Map(this.transactionFrames.getStore() ?? []);
      clients.set(connName, transactionClient);
      frames.set(connName, frame);
      return this.transactionClients.run(clients, () => this.transactionFrames.run(frames, callback));
    };
    let result: T;
    try {
      if (parent) {
        if (driver === 'postgres') result = await client.savepoint(run);
        else {
          const name = `svelar_${++this.savepointId}`;
          const sql = async (statement: string) => {
            if (driver === 'sqlite') client.exec(statement);
            else await client.query(statement);
          };
          await sql(`SAVEPOINT ${name}`);
          try { result = await run(client); await sql(`RELEASE SAVEPOINT ${name}`); }
          catch (error) { await sql(`ROLLBACK TO SAVEPOINT ${name}`); await sql(`RELEASE SAVEPOINT ${name}`); throw error; }
        }
      } else if (driver === 'postgres') result = await client.begin(run);
      else if (driver === 'mysql') {
        const connection = await client.getConnection();
        try {
          await connection.beginTransaction();
          try { result = await run(connection); await connection.commit(); }
          catch (error) { await connection.rollback(); throw error; }
        } finally { connection.release(); }
      } else {
        result = await this.serializeSQLite(connName, async () => {
          client.exec('BEGIN');
          try { const value = await run(client); client.exec('COMMIT'); return value; }
          catch (error) { client.exec('ROLLBACK'); throw error; }
        });
      }
    } finally { frame.active = false; if (parent) parent.childActive = false; }
    if (parent) parent.afterCommit.push(...frame.afterCommit);
    else {
      const errors: unknown[] = [];
      for (const hook of frame.afterCommit) { try { await hook(); } catch (error) { errors.push(error); } }
      if (errors.length) throw new AfterCommitError(errors);
    }
    return result;
  }

  inTransaction(connectionName?: string): boolean {
    return this.transactionFrames.getStore()?.get(this.resolveConnectionName(connectionName))?.active === true;
  }

  /** Register on the current transaction; rolled-back savepoints discard their callbacks. */
  async afterCommit(callback: () => void | Promise<void>, connectionName?: string): Promise<void> {
    const context = ApplicationContext.snapshot();
    const hook = async () => { await ApplicationContext.run(context, callback); };
    const frame = this.transactionFrames.getStore()?.get(this.resolveConnectionName(connectionName));
    if (frame) {
      if (!frame.active) throw new Error('This transaction has already ended.');
      frame.afterCommit.push(hook);
    } else await hook();
  }

  private async serializeSQLite<T>(name: string, callback: () => Promise<T>): Promise<T> {
    const previous = this.sqliteTransactions.get(name) ?? Promise.resolve();
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const tail = previous.then(() => held);
    this.sqliteTransactions.set(name, tail);
    await previous;
    try { return await callback(); }
    finally { release(); if (this.sqliteTransactions.get(name) === tail) this.sqliteTransactions.delete(name); }
  }

  /** @internal Isolate recoverable PostgreSQL statements within an existing transaction. */
  async withSavepointIfNeeded<T>(callback: () => Promise<T>, connectionName?: string): Promise<T> {
    const connName = this.resolveConnectionName(connectionName);
    if (this.getDriver(connName) !== 'postgres') return callback();

    const current = this.transactionClients.getStore();
    const transactionClient = current?.get(connName);
    if (!transactionClient) return callback();

    return this.transaction(callback, connName);
  }

  // ── Private ──────────────────────────────────────────────

  private async createConnection(config: DatabaseConfig): Promise<ActiveConnection> {
    switch (config.driver) {
      case 'sqlite':
        return this.createSQLiteConnection(config);
      case 'postgres':
        return this.createPostgresConnection(config);
      case 'mysql':
        return this.createMySQLConnection(config);
      default:
        throw new Error(`Unsupported database driver: ${config.driver}`);
    }
  }

  private async createSQLiteConnection(config: DatabaseConfig): Promise<ActiveConnection> {
    const filename = config.filename ?? config.database ?? ':memory:';

    // Try better-sqlite3 first, fall back to Node.js built-in sqlite
    try {
      const Database = (await import('better-sqlite3')).default;
      const { drizzle } = await import('drizzle-orm/better-sqlite3');

      const sqlite = new Database(filename);

      // Enable WAL mode for better performance
      sqlite.pragma('journal_mode = WAL');
      sqlite.pragma('foreign_keys = ON');

      const db = drizzle(sqlite);
      return { drizzle: db, config, rawClient: sqlite };
    } catch (betterSqliteErr) {
      // Fall back to Node.js built-in sqlite (v22+)
      // Use Function constructor to create a truly opaque dynamic import
      // that bundlers (tsup/esbuild) cannot statically analyze
      let DatabaseSync: any;
      try {
        const dynamicImport = new Function('mod', 'return import(mod)');
        const sqliteMod = await dynamicImport('node:sqlite');
        DatabaseSync = sqliteMod.DatabaseSync;
      } catch {
        // Neither better-sqlite3 nor node:sqlite available
        throw new Error(
          'No SQLite driver available. Install better-sqlite3 (npm install better-sqlite3) ' +
          'or use Node.js v22+ which includes built-in SQLite support. ' +
          `Original error: ${betterSqliteErr instanceof Error ? betterSqliteErr.message : String(betterSqliteErr)}`
        );
      }

      const nativeDb = new DatabaseSync(filename);

      // Enable WAL and foreign keys
      nativeDb.exec('PRAGMA journal_mode = WAL');
      nativeDb.exec('PRAGMA foreign_keys = ON');

      // Create a wrapper that mimics better-sqlite3 API for raw() usage
      const wrapper = {
        prepare(sql: string) {
          const stmt = nativeDb.prepare(sql);
          return {
            all(...params: any[]) { return stmt.all(...params); },
            run(...params: any[]) { return stmt.run(...params); },
            get(...params: any[]) { return stmt.get(...params); },
          };
        },
        exec(sql: string) { nativeDb.exec(sql); },
        pragma(pragma: string) {
          return nativeDb.prepare(`PRAGMA ${pragma}`).all();
        },
        close() { nativeDb.close(); },
      };

      // For Drizzle: try to create a drizzle instance with the wrapper
      let db: any;
      try {
        const { drizzle } = await import('drizzle-orm/better-sqlite3');
        db = drizzle(wrapper as any);
      } catch {
        // If Drizzle adapter fails, use wrapper directly for raw queries
        db = wrapper;
      }

      return { drizzle: db, config, rawClient: wrapper };
    }
  }

  private async createPostgresConnection(config: DatabaseConfig): Promise<ActiveConnection> {
    const postgres = (await import('postgres')).default;
    const { drizzle } = await import('drizzle-orm/postgres-js');

    const connectionString =
      config.url ??
      `postgres://${config.user}:${config.password}@${config.host ?? 'localhost'}:${config.port ?? 5432}/${config.database}`;

    const client = postgres(connectionString, {
      prepare: config.prepare ?? true,
    });
    const db = drizzle(client);

    return { drizzle: db, config, rawClient: client };
  }

  private async createMySQLConnection(config: DatabaseConfig): Promise<ActiveConnection> {
    const mysql = await import('mysql2/promise');
    const { drizzle } = await import('drizzle-orm/mysql2');

    const pool = mysql.createPool({
      host: config.host ?? 'localhost',
      port: config.port ?? 3306,
      database: config.database,
      user: config.user,
      password: config.password,
      uri: config.url,
    });

    const db = drizzle(pool);

    return { drizzle: db, config, rawClient: pool };
  }

  private async closeConnection(conn: ActiveConnection): Promise<void> {
    try {
      switch (conn.config.driver) {
        case 'sqlite':
          conn.rawClient.close();
          break;
        case 'postgres':
          await conn.rawClient.end();
          break;
        case 'mysql':
          await conn.rawClient.end();
          break;
      }
    } catch {
      // Silently ignore close errors
    }
  }
}

/**
 * Global connection manager singleton.
 */
import { singleton } from '../support/singleton.js';

export const Connection = singleton('svelar.connection', () => new ConnectionManager());
