/**
 * make:config — Generate a new configuration file
 */

import { Command } from '../Command.js';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export class MakeConfigCommand extends Command {
  name = 'make:config';
  description = 'Create a new config file';
  arguments = ['name'];
  flags = [];

  private templates: Record<string, string> = {
    app: `import { env } from 'svelar/config';

export default {
  name: env('APP_NAME', 'Svelar'),
  env: env('APP_ENV', 'development'),
  debug: env<boolean>('APP_DEBUG', false),
  url: env('APP_URL', 'http://localhost:5173'),
  key: env('APP_KEY', ''),
  timezone: 'UTC',
  locale: 'en',
};
`,
    database: `import { env } from 'svelar/config';

export default {
  default: env('DB_DRIVER', 'sqlite'),

  connections: {
    sqlite: {
      driver: 'sqlite' as const,
      filename: env('DB_PATH', 'database.db'),
    },

    postgres: {
      driver: 'postgresql' as const,
      host: env('DB_HOST', 'localhost'),
      port: env<number>('DB_PORT', 5432),
      database: env('DB_NAME', 'svelar'),
      user: env('DB_USER', 'postgres'),
      password: env('DB_PASSWORD', ''),
    },

    mysql: {
      driver: 'mysql2' as const,
      host: env('DB_HOST', 'localhost'),
      port: env<number>('DB_PORT', 3306),
      database: env('DB_NAME', 'svelar'),
      user: env('DB_USER', 'root'),
      password: env('DB_PASSWORD', ''),
    },
  },

  migrations: {
    table: 'migrations',
    path: 'src/lib/database/migrations',
  },
};
`,
    auth: `import { env } from 'svelar/config';

export default {
  guard: env('AUTH_GUARD', 'session'),

  session: {
    lifetime: 60 * 60 * 24,  // 24 hours
    cookie: 'svelar_session',
  },

  jwt: {
    secret: env('JWT_SECRET', ''),
    ttl: 60 * 60,            // 1 hour
    refreshTtl: 60 * 60 * 24 * 7,  // 7 days
  },

  passwords: {
    expire: 60,  // Reset token expires in 60 minutes
  },
};
`,
    mail: `import { env } from 'svelar/config';

export default {
  driver: env('MAIL_DRIVER', 'log'),

  from: {
    address: env('MAIL_FROM', 'hello@example.com'),
    name: env('MAIL_FROM_NAME', 'Svelar'),
  },

  smtp: {
    host: env('MAIL_HOST', 'localhost'),
    port: env<number>('MAIL_PORT', 587),
    user: env('MAIL_USER', ''),
    password: env('MAIL_PASSWORD', ''),
    secure: env<boolean>('MAIL_SECURE', false),
  },
};
`,
    cache: `import { env } from 'svelar/config';

export default {
  default: env('CACHE_DRIVER', 'memory'),

  stores: {
    memory: {
      driver: 'memory' as const,
    },

    database: {
      driver: 'database' as const,
      table: 'cache',
      ttl: 60 * 60,  // 1 hour default
    },
  },

  prefix: 'svelar_cache_',
};
`,
    queue: `import { env } from 'svelar/config';

export default {
  default: env('QUEUE_DRIVER', 'sync'),

  connections: {
    sync: {
      driver: 'sync' as const,
    },

    memory: {
      driver: 'memory' as const,
    },

    database: {
      driver: 'database' as const,
      table: 'svelar_jobs',
    },

    redis: {
      driver: 'redis' as const,
      host: env('REDIS_HOST', 'localhost'),
      port: env<number>('REDIS_PORT', 6379),
      password: env('REDIS_PASSWORD', ''),
      db: env<number>('REDIS_DB', 0),
      prefix: 'svelar',
      defaultJobOptions: {
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    },
  },
};
`,
    storage: `import { env } from 'svelar/config';

export default {
  default: env('STORAGE_DISK', 'local'),

  disks: {
    local: {
      driver: 'local' as const,
      root: 'storage',
    },

    public: {
      driver: 'local' as const,
      root: 'storage/public',
      urlPrefix: '/storage',
    },

    s3: {
      driver: 's3' as const,
      bucket: env('S3_BUCKET', 'svelar'),
      region: env('S3_REGION', 'us-east-1'),
      endpoint: env('S3_ENDPOINT', 'http://localhost:9000'),
      accessKeyId: env('S3_ACCESS_KEY', 'svelar'),
      secretAccessKey: env('S3_SECRET_KEY', 'svelarsecret'),
      forcePathStyle: true, // Required for RustFS/MinIO
    },
  },
};
`,
    broadcasting: `import { env } from 'svelar/config';

export default {
  default: env('BROADCAST_DRIVER', 'pusher'),

  drivers: {
    pusher: {
      driver: 'pusher' as const,
      key: env('PUSHER_KEY', 'svelar-key'),
      secret: env('PUSHER_SECRET', 'svelar-secret'),
      appId: env('PUSHER_APP_ID', 'svelar-app'),
      cluster: env('PUSHER_CLUSTER', 'mt1'),
      // Soketi (included in docker-compose by default):
      host: env('PUSHER_HOST', 'localhost'),
      port: env<number>('PUSHER_PORT', 6001),
      useTLS: env<boolean>('PUSHER_TLS', false),
    },

    sse: {
      driver: 'sse' as const,
    },

    log: {
      driver: 'log' as const,
    },
  },
};
`,
    logging: `import { env } from 'svelar/config';

export default {
  default: env('LOG_CHANNEL', 'console'),

  channels: {
    console: {
      driver: 'console' as const,
      level: env('LOG_LEVEL', 'info'),
    },

    file: {
      driver: 'file' as const,
      path: 'storage/logs/svelar.log',
      level: 'debug',
    },
  },
};
`,
  };

  async handle(args: string[]): Promise<void> {
    const name = args[0];
    if (!name) {
      this.error('Please provide a config file name. Example: npx svelar make:config database');
      this.newLine();
      this.info('Available presets: app, database, auth, mail, cache, queue, storage, broadcasting, logging');
      return;
    }

    const configDir = join(process.cwd(), 'config');
    mkdirSync(configDir, { recursive: true });

    const fileName = name.toLowerCase().replace(/\s+/g, '-');
    const filePath = join(configDir, `${fileName}.ts`);

    if (existsSync(filePath)) {
      this.warn(`Config file config/${fileName}.ts already exists.`);
      return;
    }

    // Use a preset template if available, otherwise generate a blank one
    const content = this.templates[fileName] ?? this.blankTemplate(fileName);

    writeFileSync(filePath, content);
    this.success(`Config created: config/${fileName}.ts`);
    this.newLine();
    this.info('Access it with:');
    this.log(`  config.get('${fileName}.key')`);
  }

  private blankTemplate(name: string): string {
    return `import { env } from 'svelar/config';

export default {
  // Add your ${name} configuration here
  // Use env() to read from environment variables:
  //   env('MY_VAR', 'default')
  //   env<number>('MY_PORT', 3000)
  //   env<boolean>('MY_FLAG', false)
};
`;
  }
}
