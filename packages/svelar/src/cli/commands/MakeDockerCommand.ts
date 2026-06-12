/**
 * make:docker — Generate Docker deployment files
 *
 * Creates Dockerfile (multi-stage), docker-compose.yml, dev/prod overrides,
 * .dockerignore, local runtime scripts, and health endpoint.
 */

import { Command } from '../Command.js';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DeployTemplates } from './DeployTemplates.js';

export class MakeDockerCommand extends Command {
  name = 'make:docker';
  description = 'Scaffold Docker deployment files (Dockerfile, docker-compose, worker/scheduler, health endpoint)';
  arguments = [];
  flags = [
    { name: 'db', alias: 'd', description: 'Database driver: postgres, mysql, sqlite (default: postgres)', type: 'string' as const },
    { name: 'image', alias: 'i', description: 'Docker image name (default: package.json name)', type: 'string' as const },
    { name: 'registry', description: 'Docker registry prefix (default: Docker Hub)', type: 'string' as const },
    { name: 'port', description: 'Production port (default: 3000)', type: 'string' as const },
    { name: 'dev-port', description: 'Development port (default: 5173)', type: 'string' as const },
    { name: 'soketi', alias: 's', description: 'Include Soketi WebSocket server (default: true; use --no-soketi to disable)', type: 'boolean' as const },
    { name: 'redis', alias: 'r', description: 'Include Redis service (default: true; use --no-redis to disable)', type: 'boolean' as const },
    { name: 'gotenberg', alias: 'g', description: 'Include Gotenberg PDF service (default: true; use --no-gotenberg to disable)', type: 'boolean' as const },
    { name: 'rustfs', description: 'Include RustFS S3-compatible object storage (default: true; use --no-rustfs to disable)', type: 'boolean' as const },
    { name: 'meilisearch', alias: 'm', description: 'Include Meilisearch full-text search engine (default: true; use --no-meilisearch to disable)', type: 'boolean' as const },
    { name: 'force', alias: 'f', description: 'Overwrite existing files', type: 'boolean' as const },
  ];

  async handle(args: string[], flags: Record<string, any>): Promise<void> {
    const cwd = process.cwd();
    const db = (flags.db as string) ?? 'postgres';
    const includeSoketi = flags.soketi ?? true;
    const includeRedis = flags.redis ?? true;
    const includeGotenberg = flags.gotenberg ?? true;
    const includeRustFS = flags.rustfs ?? true;
    const includeMeilisearch = flags.meilisearch ?? true;
    const force = flags.force ?? false;

    const appName = this.resolveAppName(cwd);
    const image = (flags.image as string) ?? appName;
    const registry = flags.registry as string | undefined;
    const fullImage = registry ? `${registry}/${image}` : image;

    const validDbs = ['postgres', 'mysql', 'sqlite'];
    if (!validDbs.includes(db)) {
      this.error(`Unknown database driver: ${db}. Use one of: ${validDbs.join(', ')}`);
      return;
    }

    mkdirSync(join(cwd, '.svelar-local'), { recursive: true });
    mkdirSync(join(cwd, 'scripts'), { recursive: true });

    // Ensure health endpoint directory exists
    const healthDir = join(cwd, 'src', 'routes', 'api', 'health');
    mkdirSync(healthDir, { recursive: true });

    // Ensure docker config directories exist for non-sqlite DBs
    if (db === 'postgres') {
      mkdirSync(join(cwd, 'docker', 'postgres'), { recursive: true });
      mkdirSync(join(cwd, 'docker', 'pgbouncer'), { recursive: true });
    } else if (db === 'mysql') {
      mkdirSync(join(cwd, 'docker', 'mysql'), { recursive: true });
    }

    const files: Array<{ path: string; content: string; label: string }> = [
      {
        path: join(cwd, 'Dockerfile'),
        content: DeployTemplates.dockerfile(),
        label: 'Dockerfile',
      },
      {
        path: join(cwd, 'docker-compose.yml'),
        content: this.composeTemplate(db, includeSoketi, includeRedis, includeGotenberg, includeRustFS, includeMeilisearch),
        label: 'docker-compose.yml',
      },
      {
        path: join(cwd, 'docker-compose.dev.yml'),
        content: this.composeDevOverrideTemplate(db, includeRedis, includeGotenberg, includeRustFS),
        label: 'docker-compose.dev.yml',
      },
      {
        path: join(cwd, 'docker-compose.prod.yml'),
        content: DeployTemplates.composeProdOverride(fullImage),
        label: 'docker-compose.prod.yml',
      },
      {
        path: join(cwd, '.dockerignore'),
        content: this.dockerignoreTemplate(),
        label: '.dockerignore',
      },
      {
        path: join(cwd, '.svelar-local', '.gitkeep'),
        content: '',
        label: '.svelar-local/.gitkeep',
      },
      {
        path: join(cwd, 'scripts', 'svelar-dev-runtime.mjs'),
        content: this.devRuntimeScriptTemplate(),
        label: 'scripts/svelar-dev-runtime.mjs',
      },
      {
        path: join(healthDir, '+server.ts'),
        content: DeployTemplates.healthEndpoint(),
        label: 'src/routes/api/health/+server.ts',
      },
    ];

    // Add database init config
    if (db === 'postgres') {
      files.push({
        path: join(cwd, 'docker', 'postgres', 'postgresql.conf'),
        content: DeployTemplates.postgresConf(),
        label: 'docker/postgres/postgresql.conf',
      });
      files.push({
        path: join(cwd, 'docker', 'postgres', 'init.sql'),
        content: DeployTemplates.postgresInit(),
        label: 'docker/postgres/init.sql',
      });
      files.push({
        path: join(cwd, 'docker', 'pgbouncer', 'pgbouncer.ini'),
        content: DeployTemplates.pgbouncerIni(),
        label: 'docker/pgbouncer/pgbouncer.ini',
      });
    } else if (db === 'mysql') {
      files.push({
        path: join(cwd, 'docker', 'mysql', 'init.sql'),
        content: DeployTemplates.mysqlInit(),
        label: 'docker/mysql/init.sql',
      });
    }

    let created = 0;
    let skipped = 0;

    for (const file of files) {
      if (existsSync(file.path) && !force) {
        this.warn(`${file.label} already exists (use --force to overwrite)`);
        skipped++;
        continue;
      }
      writeFileSync(file.path, file.content);
      this.success(`Created ${file.label}`);
      created++;
    }


    this.newLine();
    if (created > 0) {
      this.info(`${created} file(s) created${skipped > 0 ? `, ${skipped} skipped` : ''}`);
    } else {
      this.info('No files created (all exist already)');
    }

    this.newLine();
    this.info('Quick start:');
    this.log('  # Development (with hot-reload)');
    this.log('  npx svelar dev:up');
    this.newLine();
    this.log('  # Production (local build)');
    this.log('  docker compose up -d --build');
    this.newLine();
    this.log('  # Run migrations inside the container');
    this.log('  docker compose exec app npx svelar migrate');
    this.newLine();
    this.log('  # View logs');
    this.log('  npx svelar dev:logs');
    this.newLine();
    this.log('  # Stop services');
    this.log('  npx svelar dev:down');
    this.newLine();
    this.info('Make sure to update .env with production values before deploying.');
  }

  // ── Helpers ──────────────────────────────────────────────

  private resolveAppName(cwd: string): string {
    try {
      const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf-8'));
      if (pkg.name && typeof pkg.name === 'string') {
        // Strip scope (e.g. @org/name → name)
        return pkg.name.replace(/^@[^/]+\//, '');
      }
    } catch {
      // No package.json or invalid
    }
    return 'svelar-app';
  }

  // ── Templates ──────────────────────────────────────────────

  private composeTemplate(db: string, soketi: boolean, redis: boolean, gotenberg: boolean, rustfs: boolean = true, meilisearch: boolean = true): string {
    const lines: string[] = [];

    lines.push('# ── Svelar Docker Compose ─────────────────────────────────');
    lines.push('# Generated by: npx svelar make:docker');
    lines.push('#');
    lines.push('# Usage:');
    lines.push('#   docker compose up -d --build     # Start all services');
    lines.push('#   docker compose exec app npx svelar migrate   # Run migrations');
    lines.push('#   docker compose logs -f app       # View app logs');
    lines.push('#   docker compose down              # Stop all services');
    lines.push('');
    lines.push('services:');

    // ── App service ──
    lines.push('  app:');
    lines.push('    build:');
    lines.push('      context: .');
    lines.push('      target: production');
    lines.push('    restart: unless-stopped');
    lines.push('    ports:');
    lines.push('      - "${APP_PORT:-3000}:3000"');
    lines.push('    env_file: .env');
    lines.push('    environment:');
    lines.push('      - NODE_ENV=production');
    lines.push('      - ORIGIN=${APP_URL:-http://localhost:3000}');
    lines.push('      - INTERNAL_APP_URL=http://app:3000');

    if (db === 'postgres') {
      lines.push('      - DB_HOST=pgbouncer');
      lines.push('      - DB_PORT=6432');
    } else if (db === 'mysql') {
      lines.push('      - DB_HOST=mysql');
      lines.push('      - DB_PORT=3306');
    }

    if (redis) {
      lines.push('      - REDIS_HOST=redis');
      lines.push('      - REDIS_PORT=6379');
      lines.push('      - REDIS_PASSWORD=${REDIS_PASSWORD:-svelarsecret}');
      lines.push('      - QUEUE_DRIVER=redis');
    }

    if (soketi) {
      lines.push('      - PUSHER_HOST=soketi');
      lines.push('      - PUSHER_PORT=6001');
    }

    if (gotenberg) {
      lines.push('      - GOTENBERG_URL=http://gotenberg:3000');
    }

    if (rustfs) {
      lines.push('      - S3_ENDPOINT=http://rustfs:9000');
      lines.push('      - S3_ACCESS_KEY=${RUSTFS_ACCESS_KEY:-svelar}');
      lines.push('      - S3_SECRET_KEY=${RUSTFS_SECRET_KEY:-svelarsecret}');
      lines.push('      - S3_BUCKET=${S3_BUCKET:-svelar}');
      lines.push('      - S3_REGION=us-east-1');
      lines.push('      - STORAGE_DISK=s3');
    }

    if (meilisearch) {
      lines.push('      - MEILISEARCH_HOST=http://meilisearch:7700');
      lines.push('      - MEILISEARCH_KEY=${MEILI_MASTER_KEY:-svelar-meili-master-key}');
    }

    // depends_on with health checks
    const deps: string[] = [];
    if (db === 'postgres') deps.push('pgbouncer');
    if (db === 'mysql') deps.push('mysql');
    if (redis) deps.push('redis');
    if (soketi) deps.push('soketi');
    if (gotenberg) deps.push('gotenberg');
    if (rustfs) deps.push('rustfs');
    if (meilisearch) deps.push('meilisearch');

    if (deps.length > 0) {
      lines.push('    depends_on:');
      for (const dep of deps) {
        lines.push(`      ${dep}:`);
        lines.push('        condition: service_healthy');
      }
    }

    lines.push('    volumes:');
    lines.push('      - app_storage:/app/storage');
    lines.push('    healthcheck:');
    lines.push('      test: ["CMD", "wget", "-qO-", "http://127.0.0.1:3000/api/health"]');
    lines.push('      interval: 30s');
    lines.push('      timeout: 5s');
    lines.push('      start_period: 15s');
    lines.push('      retries: 3');
    lines.push('    deploy:');
    lines.push('      resources:');
    lines.push('        limits:');
    lines.push('          memory: ${APP_MEMORY_LIMIT:-1G}');
    lines.push('          pids: 200');
    lines.push('    logging:');
    lines.push('      driver: json-file');
    lines.push('      options:');
    lines.push('        max-size: "10m"');
    lines.push('        max-file: "3"');

    this.appendRuntimeService(lines, {
      name: 'worker',
      command: '["npx", "svelar", "queue:work", "--max-time=3600", "--queue=default"]',
      memoryLimit: '${WORKER_MEMORY_LIMIT:-512M}',
      db,
      redis,
      soketi,
      gotenberg,
      rustfs,
      meilisearch,
      deps,
    });

    this.appendRuntimeService(lines, {
      name: 'scheduler',
      command: '["npx", "svelar", "schedule:run"]',
      memoryLimit: '${SCHEDULER_MEMORY_LIMIT:-256M}',
      db,
      redis,
      soketi,
      gotenberg,
      rustfs,
      meilisearch,
      deps,
    });

    // ── PostgreSQL ──
    if (db === 'postgres') {
      lines.push('');
      lines.push('  postgres:');
      lines.push('    image: postgres:17-alpine');
      lines.push('    restart: unless-stopped');
      lines.push('    # No ports exposed — only reachable via PgBouncer on the Docker network');
      lines.push('    command: postgres -c config_file=/etc/postgresql/postgresql.conf');
      lines.push('    environment:');
      lines.push('      POSTGRES_DB: ${DB_NAME:-svelar}');
      lines.push('      POSTGRES_USER: ${DB_USER:-svelar}');
      lines.push('      POSTGRES_PASSWORD: ${DB_PASSWORD:-secret}');
      lines.push('    volumes:');
      lines.push('      - pgdata:/var/lib/postgresql/data');
      lines.push('      - ./docker/postgres/postgresql.conf:/etc/postgresql/postgresql.conf:ro');
      lines.push('      - ./docker/postgres/init.sql:/docker-entrypoint-initdb.d/init.sql:ro');
      lines.push('    healthcheck:');
      lines.push('      test: ["CMD-SHELL", "pg_isready -U ${DB_USER:-svelar} -d ${DB_NAME:-svelar}"]');
      lines.push('      interval: 30s');
      lines.push('      timeout: 10s');
      lines.push('      retries: 5');
      lines.push('    deploy:');
      lines.push('      resources:');
      lines.push('        limits:');
      lines.push('          memory: ${POSTGRES_MEMORY_LIMIT:-1G}');
      lines.push('    logging:');
      lines.push('      driver: json-file');
      lines.push('      options:');
      lines.push('        max-size: "10m"');
      lines.push('        max-file: "3"');

      // ── PgBouncer (connection pooler) ──
      lines.push('');
      lines.push('  pgbouncer:');
      lines.push('    image: edoburu/pgbouncer:v1.25.1-p0');
      lines.push('    restart: unless-stopped');
      lines.push('    # No ports exposed — only reachable by app via Docker network');
      lines.push('    # Expose 6432 to host only for direct debugging (uncomment below)');
      lines.push('    # ports:');
      lines.push('    #   - "6432:6432"');
      lines.push('    environment:');
      lines.push('      DATABASE_URL: postgres://${DB_USER:-svelar}:${DB_PASSWORD:-secret}@postgres:5432/${DB_NAME:-svelar}');
      lines.push('      AUTH_TYPE: scram-sha-256');
      lines.push('    volumes:');
      lines.push('      - ./docker/pgbouncer/pgbouncer.ini:/etc/pgbouncer/pgbouncer.ini:ro');
      lines.push('    depends_on:');
      lines.push('      postgres:');
      lines.push('        condition: service_healthy');
      lines.push('    healthcheck:');
      lines.push('      test: ["CMD-SHELL", "PGPASSWORD=${DB_PASSWORD:-secret} pg_isready -h 127.0.0.1 -p 6432 -U ${DB_USER:-svelar} -d ${DB_NAME:-svelar}"]');
      lines.push('      interval: 10s');
      lines.push('      timeout: 5s');
      lines.push('      retries: 5');
      lines.push('    deploy:');
      lines.push('      resources:');
      lines.push('        limits:');
      lines.push('          memory: 128M');
      lines.push('    logging:');
      lines.push('      driver: json-file');
      lines.push('      options:');
      lines.push('        max-size: "5m"');
      lines.push('        max-file: "3"');
    }

    // ── MySQL ──
    if (db === 'mysql') {
      lines.push('');
      lines.push('  mysql:');
      lines.push('    image: mysql:8.0');
      lines.push('    restart: unless-stopped');
      lines.push('    # No ports exposed — only reachable by app via Docker network');
      lines.push('    environment:');
      lines.push('      MYSQL_DATABASE: ${DB_NAME:-svelar}');
      lines.push('      MYSQL_USER: ${DB_USER:-svelar}');
      lines.push('      MYSQL_PASSWORD: ${DB_PASSWORD:-secret}');
      lines.push('      MYSQL_ROOT_PASSWORD: ${DB_ROOT_PASSWORD:-rootsecret}');
      lines.push('    volumes:');
      lines.push('      - mysqldata:/var/lib/mysql');
      lines.push('      - ./docker/mysql/init.sql:/docker-entrypoint-initdb.d/init.sql:ro');
      lines.push('    healthcheck:');
      lines.push('      test: ["CMD", "mysqladmin", "ping", "-h", "localhost"]');
      lines.push('      interval: 10s');
      lines.push('      timeout: 5s');
      lines.push('      retries: 5');
      lines.push('    deploy:');
      lines.push('      resources:');
      lines.push('        limits:');
      lines.push('          memory: ${MYSQL_MEMORY_LIMIT:-1G}');
      lines.push('    logging:');
      lines.push('      driver: json-file');
      lines.push('      options:');
      lines.push('        max-size: "10m"');
      lines.push('        max-file: "3"');
    }

    // ── Redis ──
    if (redis) {
      lines.push('');
      lines.push('  redis:');
      lines.push('    image: redis:7-alpine');
      lines.push('    restart: unless-stopped');
      lines.push('    # No ports exposed — only reachable by app via Docker network');
      lines.push('    command: redis-server --requirepass ${REDIS_PASSWORD:-svelarsecret} --save "" --appendonly no --stop-writes-on-bgsave-error no');
      lines.push('    volumes:');
      lines.push('      - redisdata:/data');
      lines.push('    healthcheck:');
      lines.push('      test: ["CMD", "redis-cli", "-a", "${REDIS_PASSWORD:-svelarsecret}", "ping"]');
      lines.push('      interval: 10s');
      lines.push('      timeout: 5s');
      lines.push('      retries: 5');
      lines.push('    deploy:');
      lines.push('      resources:');
      lines.push('        limits:');
      lines.push('          memory: ${REDIS_MEMORY_LIMIT:-256M}');
      lines.push('    logging:');
      lines.push('      driver: json-file');
      lines.push('      options:');
      lines.push('        max-size: "5m"');
      lines.push('        max-file: "3"');
    }

    // ── Soketi ──
    if (soketi) {
      lines.push('');
      lines.push('  soketi:');
      lines.push('    image: quay.io/soketi/soketi:1.6-16-debian');
      lines.push('    restart: unless-stopped');
      lines.push('    ports:');
      lines.push('      - "${SOKETI_PORT:-5334}:6001"');
      lines.push('    environment:');
      lines.push('      SOKETI_DEBUG: "${SOKETI_DEBUG:-0}"');
      lines.push('      SOKETI_DEFAULT_APP_ID: ${PUSHER_APP_ID}');
      lines.push('      SOKETI_DEFAULT_APP_KEY: ${PUSHER_KEY}');
      lines.push('      SOKETI_DEFAULT_APP_SECRET: ${PUSHER_SECRET}');
      lines.push('      SOKETI_DEFAULT_APP_MAX_CONNS: "${SOKETI_MAX_CONNS:-1000}"');
      lines.push('      SOKETI_DEFAULT_APP_ENABLE_CLIENT_MESSAGES: "true"');
      lines.push('      SOKETI_DEFAULT_APP_MAX_BACKEND_EVENTS_PER_SEC: "-1"');
      lines.push('    healthcheck:');
      lines.push(`      test: ["CMD-SHELL", "node -e \\"require('http').get('http://127.0.0.1:6001', r => process.exit(r.statusCode < 500 ? 0 : 1)).on('error', () => process.exit(1))\\""]`);
      lines.push('      interval: 10s');
      lines.push('      timeout: 5s');
      lines.push('      retries: 3');
      lines.push('    deploy:');
      lines.push('      resources:');
      lines.push('        limits:');
      lines.push('          memory: 256M');
      lines.push('    logging:');
      lines.push('      driver: json-file');
      lines.push('      options:');
      lines.push('        max-size: "5m"');
      lines.push('        max-file: "3"');
    }

    // ── Gotenberg ──
    if (gotenberg) {
      lines.push('');
      lines.push('  gotenberg:');
      lines.push('    image: gotenberg/gotenberg:8');
      lines.push('    restart: unless-stopped');
      lines.push('    # No ports exposed — only reachable by app via Docker network');
      lines.push('    environment:');
      lines.push('      CHROMIUM_DISABLE_JAVASCRIPT: "false"');
      lines.push('      CHROMIUM_ALLOW_LIST: "file:///tmp/.*"');
      lines.push('      API_TIMEOUT: "${GOTENBERG_TIMEOUT:-60s}"');
      lines.push('      LOG_LEVEL: "${GOTENBERG_LOG_LEVEL:-info}"');
      lines.push('    healthcheck:');
      lines.push('      test: ["CMD", "curl", "-f", "http://127.0.0.1:3000/health"]');
      lines.push('      interval: 10s');
      lines.push('      timeout: 5s');
      lines.push('      retries: 5');
      lines.push('    deploy:');
      lines.push('      resources:');
      lines.push('        limits:');
      lines.push('          memory: 512M');
      lines.push('    logging:');
      lines.push('      driver: json-file');
      lines.push('      options:');
      lines.push('        max-size: "5m"');
      lines.push('        max-file: "3"');
    }

    // ── RustFS (S3-compatible object storage) ──
    if (rustfs) {
      lines.push('');
      lines.push('  rustfs:');
      lines.push('    image: rustfs/rustfs:latest');
      lines.push('    restart: unless-stopped');
      lines.push('    ports:');
      lines.push('      - "${RUSTFS_CONSOLE_PORT:-9001}:9001"   # Admin console (protect with firewall)');
      lines.push('    environment:');
      lines.push('      RUSTFS_ACCESS_KEY: ${RUSTFS_ACCESS_KEY:-svelar}');
      lines.push('      RUSTFS_SECRET_KEY: ${RUSTFS_SECRET_KEY:-svelarsecret}');
      lines.push('      RUSTFS_CONSOLE_ENABLE: "true"');
      lines.push('      RUSTFS_ADDRESS: ":9000"');
      lines.push('    command: /data');
      lines.push('    volumes:');
      lines.push('      - rustfs_data:/data');
      lines.push('    healthcheck:');
      lines.push('      test: ["CMD-SHELL", "curl -s -o /dev/null http://localhost:9000/"]');
      lines.push('      interval: 10s');
      lines.push('      timeout: 5s');
      lines.push('      retries: 5');
      lines.push('    deploy:');
      lines.push('      resources:');
      lines.push('        limits:');
      lines.push('          memory: 512M');
      lines.push('    logging:');
      lines.push('      driver: json-file');
      lines.push('      options:');
      lines.push('        max-size: "5m"');
      lines.push('        max-file: "3"');
    }

    // ── Meilisearch ──
    if (meilisearch) {
      lines.push('');
      lines.push('  meilisearch:');
      lines.push('    image: getmeili/meilisearch:v1.13');
      lines.push('    restart: unless-stopped');
      lines.push('    ports:');
      lines.push('      - "${MEILI_PORT:-5333}:7700"');
      lines.push('    environment:');
      lines.push('      MEILI_MASTER_KEY: ${MEILI_MASTER_KEY:-svelar-meili-master-key}');
      lines.push('      MEILI_ENV: production');
      lines.push('      MEILI_DB_PATH: /meili_data');
      lines.push('      MEILI_NO_ANALYTICS: "true"');
      lines.push('    volumes:');
      lines.push('      - meili_data:/meili_data');
      lines.push('    healthcheck:');
      lines.push('      test: ["CMD", "wget", "--no-verbose", "--spider", "http://127.0.0.1:7700/health"]');
      lines.push('      interval: 10s');
      lines.push('      timeout: 5s');
      lines.push('      retries: 5');
      lines.push('    deploy:');
      lines.push('      resources:');
      lines.push('        limits:');
      lines.push('          memory: 512M');
      lines.push('    logging:');
      lines.push('      driver: json-file');
      lines.push('      options:');
      lines.push('        max-size: "5m"');
      lines.push('        max-file: "3"');
    }

    // ── Volumes ──
    lines.push('');
    lines.push('volumes:');
    lines.push('  app_storage:');
    if (db === 'postgres') lines.push('  pgdata:');
    if (db === 'mysql') lines.push('  mysqldata:');
    if (redis) lines.push('  redisdata:');
    if (rustfs) lines.push('  rustfs_data:');
    if (meilisearch) lines.push('  meili_data:');

    lines.push('');
    return lines.join('\n');
  }

  private appendRuntimeService(lines: string[], options: {
    name: string;
    command: string;
    memoryLimit: string;
    db: string;
    redis: boolean;
    soketi: boolean;
    gotenberg: boolean;
    rustfs: boolean;
    meilisearch: boolean;
    deps: string[];
  }): void {
    lines.push('');
    lines.push(`  ${options.name}:`);
    lines.push('    build:');
    lines.push('      context: .');
    lines.push('      target: production');
    lines.push('    restart: unless-stopped');
    lines.push(`    command: ${options.command}`);
    lines.push('    env_file: .env');
    lines.push('    environment:');
    lines.push('      - NODE_ENV=production');
    lines.push('      - ORIGIN=${APP_URL:-http://localhost:3000}');
    lines.push('      - INTERNAL_APP_URL=http://app:3000');

    if (options.db === 'postgres') {
      lines.push('      - DB_HOST=pgbouncer');
      lines.push('      - DB_PORT=6432');
    } else if (options.db === 'mysql') {
      lines.push('      - DB_HOST=mysql');
      lines.push('      - DB_PORT=3306');
    }

    if (options.redis) {
      lines.push('      - REDIS_HOST=redis');
      lines.push('      - REDIS_PORT=6379');
      lines.push('      - REDIS_PASSWORD=${REDIS_PASSWORD:-svelarsecret}');
      lines.push('      - QUEUE_DRIVER=redis');
    }

    if (options.soketi) {
      lines.push('      - PUSHER_HOST=soketi');
      lines.push('      - PUSHER_PORT=6001');
    }

    if (options.gotenberg) {
      lines.push('      - GOTENBERG_URL=http://gotenberg:3000');
    }

    if (options.rustfs) {
      lines.push('      - S3_ENDPOINT=http://rustfs:9000');
      lines.push('      - S3_ACCESS_KEY=${RUSTFS_ACCESS_KEY:-svelar}');
      lines.push('      - S3_SECRET_KEY=${RUSTFS_SECRET_KEY:-svelarsecret}');
      lines.push('      - S3_BUCKET=${S3_BUCKET:-svelar}');
      lines.push('      - S3_REGION=us-east-1');
      lines.push('      - STORAGE_DISK=s3');
    }

    if (options.meilisearch) {
      lines.push('      - MEILISEARCH_HOST=http://meilisearch:7700');
      lines.push('      - MEILISEARCH_KEY=${MEILI_MASTER_KEY:-svelar-meili-master-key}');
    }

    lines.push('    depends_on:');
    lines.push('      app:');
    lines.push('        condition: service_healthy');
    for (const dep of options.deps) {
      lines.push(`      ${dep}:`);
      lines.push('        condition: service_healthy');
    }
    lines.push('    volumes:');
    lines.push('      - app_storage:/app/storage');
    lines.push('    healthcheck:');
    lines.push('      disable: true');
    lines.push('    deploy:');
    lines.push('      resources:');
    lines.push('        limits:');
    lines.push(`          memory: ${options.memoryLimit}`);
    lines.push('          pids: 200');
    lines.push('    logging:');
    lines.push('      driver: json-file');
    lines.push('      options:');
    lines.push('        max-size: "10m"');
    lines.push('        max-file: "3"');
  }

  private composeDevOverrideTemplate(db: string, redis: boolean, gotenberg: boolean, rustfs: boolean): string {
    const lines: string[] = [
      '# ── Svelar Docker Compose — Development Override ─────────',
      '# Usage: docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build',
      '# Generated by: npx svelar make:docker',
      '',
      'services:',
      '  app:',
      '    build:',
      '      context: .',
      '      target: development',
      '    ports:',
      '      - "${DEV_PORT:-5173}:5173"',
      '    volumes:',
      '      - .:/app',
      '      - /app/node_modules',
      '    environment:',
      '      - NODE_ENV=development',
    ];

    if (db === 'postgres') {
      lines.push('');
      lines.push('  pgbouncer:');
      lines.push('    ports:');
      lines.push('      - "${PGBOUNCER_HOST_PORT:-56432}:6432"');
    } else if (db === 'mysql') {
      lines.push('');
      lines.push('  mysql:');
      lines.push('    ports:');
      lines.push('      - "${MYSQL_HOST_PORT:-53306}:3306"');
    }

    if (redis) {
      lines.push('');
      lines.push('  redis:');
      lines.push('    ports:');
      lines.push('      - "${REDIS_HOST_PORT:-56379}:6379"');
    }

    if (gotenberg) {
      lines.push('');
      lines.push('  gotenberg:');
      lines.push('    ports:');
      lines.push('      - "${GOTENBERG_HOST_PORT:-53000}:3000"');
    }

    if (rustfs) {
      lines.push('');
      lines.push('  rustfs:');
      lines.push('    ports:');
      lines.push('      - "${RUSTFS_API_PORT:-5335}:9000"');
    }

    lines.push('');
    return lines.join('\n');
  }

  private devRuntimeScriptTemplate(): string {
    return `import { existsSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';

function loadEnvFile(path) {
  if (!existsSync(path)) return {};

  const env = {};
  for (const rawLine of readFileSync(path, 'utf8').split(/\\r?\\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const index = line.indexOf('=');
    if (index === -1) continue;

    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    env[key] = value;
  }

  return env;
}

const fileEnv = {
  ...loadEnvFile('.env'),
  ...loadEnvFile('.env.local'),
};

const pgBouncerPort = process.env.PGBOUNCER_HOST_PORT ?? fileEnv.PGBOUNCER_HOST_PORT ?? '56432';
const mysqlPort = process.env.MYSQL_HOST_PORT ?? fileEnv.MYSQL_HOST_PORT ?? '53306';
const redisPort = process.env.REDIS_HOST_PORT ?? fileEnv.REDIS_HOST_PORT ?? '56379';
const gotenbergPort = process.env.GOTENBERG_HOST_PORT ?? fileEnv.GOTENBERG_HOST_PORT ?? '53000';
const rustfsApiPort = process.env.RUSTFS_API_PORT ?? fileEnv.RUSTFS_API_PORT ?? '5335';
const meiliPort = process.env.MEILI_PORT ?? fileEnv.MEILI_PORT ?? '5333';
const soketiPort = process.env.SOKETI_PORT ?? fileEnv.SOKETI_PORT ?? '5334';
const dbDriver = process.env.DB_DRIVER ?? fileEnv.DB_DRIVER ?? 'postgres';

const env = {
  ...fileEnv,
  ...process.env,
  NODE_ENV: 'development',
  APP_URL: process.env.APP_URL ?? fileEnv.APP_URL ?? 'http://127.0.0.1:5173',
  DB_DRIVER: dbDriver,
  DB_HOST: process.env.DB_HOST ?? '127.0.0.1',
  DB_PORT: process.env.DB_PORT ?? (dbDriver === 'mysql' ? mysqlPort : pgBouncerPort),
  DB_PREPARE: process.env.DB_PREPARE ?? 'false',
  REDIS_HOST: process.env.REDIS_HOST ?? '127.0.0.1',
  REDIS_PORT: process.env.REDIS_PORT ?? redisPort,
  CACHE_DRIVER: process.env.CACHE_DRIVER ?? 'redis',
  QUEUE_DRIVER: process.env.QUEUE_DRIVER ?? 'redis',
  RATE_LIMIT_STORE: process.env.RATE_LIMIT_STORE ?? 'cache',
  RATE_LIMIT_CACHE_STORE: process.env.RATE_LIMIT_CACHE_STORE ?? 'redis',
  PUSHER_HOST: process.env.PUSHER_HOST ?? '127.0.0.1',
  PUSHER_PORT: process.env.PUSHER_PORT ?? soketiPort,
  PUSHER_CLIENT_HOST: process.env.PUSHER_CLIENT_HOST ?? 'localhost',
  PUSHER_CLIENT_PORT: process.env.PUSHER_CLIENT_PORT ?? soketiPort,
  MEILISEARCH_HOST: process.env.MEILISEARCH_HOST ?? \`http://127.0.0.1:\${meiliPort}\`,
  GOTENBERG_URL: process.env.GOTENBERG_URL ?? \`http://127.0.0.1:\${gotenbergPort}\`,
  S3_ENDPOINT: process.env.S3_ENDPOINT ?? \`http://127.0.0.1:\${rustfsApiPort}\`,
};

const child = spawn('npx', ['svelar', ...process.argv.slice(2)], {
  env,
  stdio: 'inherit',
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 0);
});
`;
  }

  private dockerignoreTemplate(): string {
    return `# Dependencies
node_modules

# Build output (rebuilt in Docker)
build
.svelte-kit

# Environment files (mount or use env_file in compose)
.env
.env.local
.env.*.local

# Git
.git
.gitignore

# IDE
.vscode
.idea
*.swp
*.swo

# OS
.DS_Store
Thumbs.db

# Docker (prevent recursive context)
Dockerfile
docker-compose*.yml
.dockerignore

# Database files (use volume mounts)
*.db
*.sqlite
*.sqlite3

# Logs
storage/logs/*
*.log

# Test & Coverage
coverage
.nyc_output
__tests__
*.test.ts
*.spec.ts
`;
  }

}
