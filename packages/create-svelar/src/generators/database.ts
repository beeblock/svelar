/**
 * Database configuration generators
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseDriver, ProjectOptions } from './types.js';

export function generateEnvFile(database: DatabaseDriver): string {
  const lines = [
    `# Svelar Environment Configuration`,
    ``,
    `APP_NAME=svelar`,
    `APP_ENV=development`,
    `APP_KEY=`,
    ``,
    `DB_CONNECTION=${database}`,
  ];

  if (database === 'sqlite') {
    lines.push(`DB_PATH=database.db`);
  } else {
    lines.push(`DB_HOST=localhost`);
    lines.push(`DB_PORT=${database === 'postgres' ? '5432' : '3306'}`);
    lines.push(`DB_NAME=svelar`);
    lines.push(`DB_USER=${database === 'postgres' ? 'postgres' : 'root'}`);
    lines.push(`DB_PASSWORD=`);
  }

  return lines.join('\n') + '\n';
}

export function generateDatabaseConnectionConfig(database: DatabaseDriver): string {
  switch (database) {
    case 'sqlite':
      return `{
      driver: 'sqlite' as const,
      filename: env('DB_PATH', 'database.db'),
    }`;
    case 'postgres':
      return `{
      driver: 'postgres' as const,
      host: env('DB_HOST', 'localhost'),
      port: env<number>('DB_PORT', 5432),
      database: env('DB_NAME', 'svelar'),
      user: env('DB_USER', 'postgres'),
      password: env('DB_PASSWORD', ''),
    }`;
    case 'mysql':
      return `{
      driver: 'mysql' as const,
      host: env('DB_HOST', 'localhost'),
      port: env<number>('DB_PORT', 3306),
      database: env('DB_NAME', 'svelar'),
      user: env('DB_USER', 'root'),
      password: env('DB_PASSWORD', ''),
    }`;
    default:
      return '{}';
  }
}

export function generateAppBootstrap(options: ProjectOptions): string {
  return `import { Application } from 'svelar/container';
import { ConnectionManager } from 'svelar/database';
import { env } from 'svelar/config';
import type { DatabaseConfig } from 'svelar/database';

/**
 * Svelar Application Bootstrap
 */
const app = new Application();

// Configure database
ConnectionManager.configure({
  default: '${options.database}',
  connections: {
    ${options.database}: ${generateDatabaseConnectionConfig(options.database)},
  },
});

export default app;
`;
}

export function generateDatabaseConfig(options: ProjectOptions): string {
  return `import { env } from 'svelar/config';

const database = {
  default: env('DB_CONNECTION', '${options.database}'),
  connections: {
    sqlite: {
      driver: 'sqlite' as const,
      filename: env('DB_PATH', 'database.db'),
    },
    postgres: {
      driver: 'postgres' as const,
      host: env('DB_HOST', 'localhost'),
      port: Number(env('DB_PORT', '5432')),
      database: env('DB_NAME', '${options.projectName}'),
      user: env('DB_USER', 'postgres'),
      password: env('DB_PASSWORD', ''),
    },
    mysql: {
      driver: 'mysql' as const,
      host: env('DB_HOST', 'localhost'),
      port: Number(env('DB_PORT', '3306')),
      database: env('DB_NAME', '${options.projectName}'),
      user: env('DB_USER', 'root'),
      password: env('DB_PASSWORD', ''),
    },
  },
};

export default database;
`;
}

export function generateHooksServer(options: ProjectOptions): string {
  return `import { createSvelarHooks } from 'svelar/hooks';
import app from './app.js';

export const handle = createSvelarHooks({
  app,
  middleware: [
    // Add your global middleware here
  ],
  onError: (error, event) => {
    console.error('[Svelar Error]', error);
  },
});
`;
}

export function getDatabaseDependency(database: DatabaseDriver): Record<string, string> {
  switch (database) {
    case 'sqlite': return { 'better-sqlite3': '^11.0.0' };
    case 'postgres': return { postgres: '^3.4.0' };
    case 'mysql': return { mysql2: '^3.11.0' };
    default: return {};
  }
}
