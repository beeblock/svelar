/**
 * make:docker — Generate Docker deployment files
 *
 * Creates Dockerfile, docker-compose.yml, .dockerignore, and PM2 ecosystem config.
 */

import { Command } from '../Command.js';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export class MakeDockerCommand extends Command {
  name = 'make:docker';
  description = 'Scaffold Docker deployment files (Dockerfile, docker-compose.yml, PM2 config)';
  arguments = [];
  flags = [
    { name: 'db', alias: 'd', description: 'Database driver: postgres, mysql, sqlite (default: postgres)', type: 'string' as const },
    { name: 'soketi', alias: 's', description: 'Include Soketi WebSocket server', type: 'boolean' as const },
    { name: 'redis', alias: 'r', description: 'Include Redis service', type: 'boolean' as const },
    { name: 'gotenberg', alias: 'g', description: 'Include Gotenberg PDF service (default: true)', type: 'boolean' as const },
    { name: 'rustfs', description: 'Include RustFS S3-compatible object storage (default: true)', type: 'boolean' as const },
    { name: 'meilisearch', alias: 'm', description: 'Include Meilisearch full-text search engine', type: 'boolean' as const },
    { name: 'force', alias: 'f', description: 'Overwrite existing files', type: 'boolean' as const },
  ];

  async handle(args: string[], flags: Record<string, any>): Promise<void> {
    const cwd = process.cwd();
    const db = (flags.db as string) ?? 'postgres';
    const includeSoketi = flags.soketi ?? true; // default: include Soketi
    const includeRedis = flags.redis ?? true; // default: include Redis (BullMQ queues)
    const includeGotenberg = flags.gotenberg ?? true; // default: include Gotenberg
    const includeRustFS = flags.rustfs ?? true; // default: include RustFS object storage
    const includeMeilisearch = flags.meilisearch ?? false; // default: not included (opt-in)
    const force = flags.force ?? false;

    const validDbs = ['postgres', 'mysql', 'sqlite'];
    if (!validDbs.includes(db)) {
      this.error(`Unknown database driver: ${db}. Use one of: ${validDbs.join(', ')}`);
      return;
    }

    const files: Array<{ path: string; content: string; label: string }> = [
      {
        path: join(cwd, 'Dockerfile'),
        content: this.dockerfileTemplate(),
        label: 'Dockerfile',
      },
      {
        path: join(cwd, 'docker-compose.yml'),
        content: this.composeTemplate(db, includeSoketi, includeRedis, includeGotenberg, includeRustFS, includeMeilisearch),
        label: 'docker-compose.yml',
      },
      {
        path: join(cwd, '.dockerignore'),
        content: this.dockerignoreTemplate(),
        label: '.dockerignore',
      },
      {
        path: join(cwd, 'ecosystem.config.cjs'),
        content: this.pm2Template(),
        label: 'ecosystem.config.cjs',
      },
    ];

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

    // Also create a docker/ directory with an nginx config if not sqlite
    if (db !== 'sqlite') {
      const dockerDir = join(cwd, 'docker');
      mkdirSync(dockerDir, { recursive: true });
    }

    this.newLine();
    if (created > 0) {
      this.info(`${created} file(s) created${skipped > 0 ? `, ${skipped} skipped` : ''}`);
    } else {
      this.info('No files created (all exist already)');
    }

    this.newLine();
    this.info('Quick start:');
    this.log('  # Build and start all services');
    this.log('  docker compose up -d --build');
    this.newLine();
    this.log('  # Run migrations inside the container');
    this.log('  docker compose exec app npx svelar migrate');
    this.newLine();
    this.log('  # View logs');
    this.log('  docker compose logs -f app');
    this.newLine();
    this.log('  # Stop services');
    this.log('  docker compose down');
    this.newLine();
    this.info('Make sure to update .env with production values before deploying.');
  }

  // ── Templates ──────────────────────────────────────────────

  private dockerfileTemplate(): string {
    return `# ── Svelar Production Dockerfile ──────────────────────────
# Multi-stage build for a lean production image.

# Stage 1: Install dependencies & build
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files first for better layer caching
COPY package*.json ./
RUN npm ci

# Copy source and build
COPY . .
RUN npm run build

# Prune dev dependencies
RUN npm prune --production

# ──────────────────────────────────────────────────────────
# Stage 2: Production image
FROM node:20-alpine AS production

WORKDIR /app

# Install PM2 globally for process management
RUN npm install -g pm2

# Copy built app and production deps from builder
COPY --from=builder /app/build ./build
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/ecosystem.config.cjs ./

# Copy Svelar CLI + migrations/seeders (needed at runtime)
COPY --from=builder /app/src/lib/database ./src/lib/database

# Create storage directories
RUN mkdir -p storage/logs storage/public

# Environment
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \\
  CMD wget -qO- http://localhost:3000/api/health || exit 1

# Start with PM2
CMD ["pm2-runtime", "ecosystem.config.cjs"]
`;
  }

  private composeTemplate(db: string, soketi: boolean, redis: boolean, gotenberg: boolean, rustfs: boolean = true, meilisearch: boolean = false): string {
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
    lines.push('    build: .');
    lines.push('    restart: unless-stopped');
    lines.push('    ports:');
    lines.push('      - "${APP_PORT:-3000}:3000"');
    lines.push('    env_file: .env');
    lines.push('    environment:');
    lines.push('      - NODE_ENV=production');

    if (db === 'postgres') {
      lines.push('      - DB_HOST=postgres');
      lines.push('      - DB_PORT=5432');
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
      lines.push('      - S3_ACCESS_KEY=${RUSTFS_ROOT_USER:-svelar}');
      lines.push('      - S3_SECRET_KEY=${RUSTFS_ROOT_PASSWORD:-svelarsecret}');
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
    if (db === 'postgres') deps.push('postgres');
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

    // ── PostgreSQL ──
    if (db === 'postgres') {
      lines.push('');
      lines.push('  postgres:');
      lines.push('    image: postgres:16-alpine');
      lines.push('    restart: unless-stopped');
      lines.push('    # No ports exposed — only reachable by app via Docker network');
      lines.push('    environment:');
      lines.push('      POSTGRES_DB: ${DB_NAME:-svelar}');
      lines.push('      POSTGRES_USER: ${DB_USER:-svelar}');
      lines.push('      POSTGRES_PASSWORD: ${DB_PASSWORD:-secret}');
      lines.push('    volumes:');
      lines.push('      - pgdata:/var/lib/postgresql/data');
      lines.push('    healthcheck:');
      lines.push('      test: ["CMD-SHELL", "pg_isready -U ${DB_USER:-svelar}"]');
      lines.push('      interval: 10s');
      lines.push('      timeout: 5s');
      lines.push('      retries: 5');
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
      lines.push('    healthcheck:');
      lines.push('      test: ["CMD", "mysqladmin", "ping", "-h", "localhost"]');
      lines.push('      interval: 10s');
      lines.push('      timeout: 5s');
      lines.push('      retries: 5');
    }

    // ── Redis ──
    if (redis) {
      lines.push('');
      lines.push('  redis:');
      lines.push('    image: redis:7-alpine');
      lines.push('    restart: unless-stopped');
      lines.push('    # No ports exposed — only reachable by app via Docker network');
      lines.push('    command: redis-server --requirepass ${REDIS_PASSWORD:-svelarsecret}');
      lines.push('    volumes:');
      lines.push('      - redisdata:/data');
      lines.push('    healthcheck:');
      lines.push('      test: ["CMD", "redis-cli", "-a", "${REDIS_PASSWORD:-svelarsecret}", "ping"]');
      lines.push('      interval: 10s');
      lines.push('      timeout: 5s');
      lines.push('      retries: 5');
    }

    // ── Soketi ──
    if (soketi) {
      lines.push('');
      lines.push('  soketi:');
      lines.push('    image: quay.io/soketi/soketi:1.6-16-debian');
      lines.push('    restart: unless-stopped');
      lines.push('    # No ports exposed — only reachable by app via Docker network');
      lines.push('    # Expose 6001 to host only if clients connect directly (uncomment below)');
      lines.push('    # ports:');
      lines.push('    #   - "${SOKETI_PORT:-6001}:6001"');
      lines.push('    environment:');
      lines.push('      SOKETI_DEBUG: "${SOKETI_DEBUG:-0}"');
      lines.push('      SOKETI_DEFAULT_APP_ID: ${PUSHER_APP_ID}');
      lines.push('      SOKETI_DEFAULT_APP_KEY: ${PUSHER_KEY}');
      lines.push('      SOKETI_DEFAULT_APP_SECRET: ${PUSHER_SECRET}');
      lines.push('      SOKETI_DEFAULT_APP_MAX_CONNS: "${SOKETI_MAX_CONNS:-1000}"');
      lines.push('      SOKETI_DEFAULT_APP_ENABLE_CLIENT_MESSAGES: "true"');
      lines.push('      SOKETI_DEFAULT_APP_MAX_BACKEND_EVENTS_PER_SEC: "-1"');
      lines.push('    healthcheck:');
      lines.push('      test: ["CMD", "wget", "-qO-", "http://localhost:6001"]');
      lines.push('      interval: 10s');
      lines.push('      timeout: 5s');
      lines.push('      retries: 3');
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
      lines.push('      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]');
      lines.push('      interval: 10s');
      lines.push('      timeout: 5s');
      lines.push('      retries: 5');
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
      lines.push('      RUSTFS_ROOT_USER: ${RUSTFS_ROOT_USER:-svelar}');
      lines.push('      RUSTFS_ROOT_PASSWORD: ${RUSTFS_ROOT_PASSWORD:-svelarsecret}');
      lines.push('    command: server /data --console-address ":9001"');
      lines.push('    volumes:');
      lines.push('      - rustfs_data:/data');
      lines.push('    healthcheck:');
      lines.push('      test: ["CMD", "curl", "-f", "http://localhost:9000/minio/health/live"]');
      lines.push('      interval: 10s');
      lines.push('      timeout: 5s');
      lines.push('      retries: 5');
    }

    // ── Meilisearch ──
    if (meilisearch) {
      lines.push('');
      lines.push('  meilisearch:');
      lines.push('    image: getmeili/meilisearch:v1.13');
      lines.push('    restart: unless-stopped');
      lines.push('    # No ports exposed — only reachable by app via Docker network');
      lines.push('    # Uncomment below to access the dashboard from the host');
      lines.push('    # ports:');
      lines.push('    #   - "${MEILI_PORT:-7700}:7700"');
      lines.push('    environment:');
      lines.push('      MEILI_MASTER_KEY: ${MEILI_MASTER_KEY:-svelar-meili-master-key}');
      lines.push('      MEILI_ENV: production');
      lines.push('      MEILI_DB_PATH: /meili_data');
      lines.push('      MEILI_NO_ANALYTICS: "true"');
      lines.push('    volumes:');
      lines.push('      - meili_data:/meili_data');
      lines.push('    healthcheck:');
      lines.push('      test: ["CMD", "wget", "--no-verbose", "--spider", "http://localhost:7700/health"]');
      lines.push('      interval: 10s');
      lines.push('      timeout: 5s');
      lines.push('      retries: 5');
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

  private pm2Template(): string {
    return `// ── PM2 Ecosystem Config ──────────────────────────────────
// Manages multiple Svelar processes in production.
//
// Processes:
//   1. web     — SvelteKit production server (port 3000)
//   2. worker  — Queue job processor
//   3. scheduler — Scheduled task runner
//
// Usage:
//   pm2 start ecosystem.config.cjs
//   pm2 logs
//   pm2 monit

module.exports = {
  apps: [
    {
      name: 'web',
      script: 'build/index.js',
      instances: 'max',          // Use all available CPU cores
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },

      // Graceful restart
      kill_timeout: 5000,
      listen_timeout: 10000,
      wait_ready: true,

      // Auto-restart on memory threshold
      max_memory_restart: '512M',

      // Logging
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: 'storage/logs/web-error.log',
      out_file: 'storage/logs/web-out.log',
      merge_logs: true,
    },
    {
      name: 'worker',
      script: 'node_modules/.bin/svelar',
      args: 'queue:work --max-time=3600',
      instances: 2,              // Parallel workers
      exec_mode: 'fork',
      autorestart: true,         // Restart when max-time reached
      env: {
        NODE_ENV: 'production',
      },

      // Logging
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: 'storage/logs/worker-error.log',
      out_file: 'storage/logs/worker-out.log',
      merge_logs: true,
    },
    {
      name: 'scheduler',
      script: 'node_modules/.bin/svelar',
      args: 'schedule:run',
      instances: 1,              // Only ONE scheduler instance!
      exec_mode: 'fork',
      autorestart: true,
      cron_restart: '0 */6 * * *',  // Restart every 6h for safety
      env: {
        NODE_ENV: 'production',
      },

      // Logging
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: 'storage/logs/scheduler-error.log',
      out_file: 'storage/logs/scheduler-out.log',
      merge_logs: true,
    },
  ],
};
`;
  }
}
