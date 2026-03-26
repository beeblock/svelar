/**
 * Type declarations for optional peer dependencies.
 * These modules are dynamically imported and only required when their features are used.
 */

declare module 'better-sqlite3' {
  interface Database {
    pragma(source: string): any;
    exec(sql: string): void;
    prepare(sql: string): Statement;
    close(): void;
  }
  interface Statement {
    run(...params: any[]): RunResult;
    get(...params: any[]): any;
    all(...params: any[]): any[];
  }
  interface RunResult {
    changes: number;
    lastInsertRowid: number | bigint;
  }
  interface DatabaseConstructor {
    new (filename: string, options?: any): Database;
    (filename: string, options?: any): Database;
  }
  const BetterSqlite3: DatabaseConstructor;
  export default BetterSqlite3;
  export = BetterSqlite3;
}

declare module 'postgres' {
  function postgres(connectionString?: string, options?: any): postgres.Sql;
  namespace postgres {
    interface Sql {
      (strings: TemplateStringsArray, ...values: any[]): Promise<any[]>;
      unsafe(query: string, params?: any[]): Promise<any[]>;
      end(): Promise<void>;
    }
  }
  export = postgres;
}

declare module 'mysql2/promise' {
  interface Connection {
    execute(sql: string, params?: any[]): Promise<[any[], any]>;
    end(): Promise<void>;
  }
  interface Pool extends Connection {
    getConnection(): Promise<Connection>;
  }
  export function createPool(config: any): Pool;
}

declare module 'bcrypt' {
  export function hash(data: string, saltOrRounds: string | number): Promise<string>;
  export function compare(data: string, encrypted: string): Promise<boolean>;
  export function genSalt(rounds?: number): Promise<string>;
}

declare module 'argon2' {
  export function hash(password: string, options?: any): Promise<string>;
  export function verify(hash: string, password: string): Promise<boolean>;
  export function needsRehash(hash: string, options?: any): boolean;
}

declare module 'nodemailer' {
  interface Transporter {
    sendMail(options: any): Promise<any>;
  }
  export function createTransport(options: any): Transporter;
}
