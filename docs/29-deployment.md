# Deployment

Svelar ships with a production-grade Docker deployment pipeline out of the box. One command generates everything you need — Dockerfile, docker-compose.yml, PM2 process manager config, and a tuned `.dockerignore`.

This guide covers the full journey from development to multi-instance production deployments with zero-downtime updates.

---

## Table of Contents

- [When Do You Need Docker?](#when-do-you-need-docker)
- [Development with Docker Services](#development-with-docker-services)
- [Quick Start](#quick-start)
- [Generated Files](#generated-files)
- [Dockerfile](#dockerfile)
- [Docker Compose Services](#docker-compose-services)
- [PM2 Process Management](#pm2-process-management)
- [Environment Variables Reference](#environment-variables-reference)
- [Reverse Proxy with Traefik](#reverse-proxy-with-traefik)
- [SSL/TLS with Traefik](#ssltls-with-traefik)
- [Scaling Horizontally](#scaling-horizontally)
- [Blue-Green Deployments with Docker Compose](#blue-green-deployments-with-docker-compose)
- [Docker Swarm](#docker-swarm)
- [Blue-Green Deployments with Docker Swarm](#blue-green-deployments-with-docker-swarm)
- [Database Management](#database-management)
- [Monitoring & Logging](#monitoring-and-logging)
- [Security Best Practices](#security-best-practices)
- [CI/CD Pipeline](#cicd-pipeline)
- [Troubleshooting](#troubleshooting)

---

## When Do You Need Docker?

| Scenario | Recommendation |
|----------|---------------|
| Local development (SQLite only) | **Optional** — `npm run dev` works without Docker if you only need SQLite |
| Local development (full stack) | **Yes** — PostgreSQL, MySQL, Redis, Soketi, Gotenberg, RustFS all run as containers |
| Staging/preview environments | **Yes** — mirrors production exactly |
| Single-server production | **Yes** — PM2 manages all processes |
| Multi-server / load-balanced | **Yes** — Swarm or Compose with Traefik |
| CI/CD testing | **Yes** — integration tests against real services |

If your production stack uses PostgreSQL, Redis, Soketi, Gotenberg, or RustFS, you should use Docker from day one so your development environment matches production. Running `npm run dev` against containerized services gives you hot-reload speed with production-grade infrastructure.

### Development with Docker Services

Generate the Docker files, then run only the **infrastructure services** while keeping your SvelteKit dev server running natively for hot reload:

```bash
# Generate Docker files
npx svelar make:docker

# Start only infrastructure (not the app container)
docker compose up -d postgres redis soketi gotenberg rustfs

# Run your app with hot reload, connecting to Docker services
npm run dev
```

Your `.env` should point to the Docker services:

```bash
# Database (PostgreSQL running in Docker)
DB_DRIVER=postgres
DB_HOST=localhost
DB_PORT=5432
DB_NAME=svelar
DB_USER=svelar
DB_PASSWORD=secret

# Redis (for queue + cache)
REDIS_HOST=localhost
REDIS_PORT=6379
QUEUE_DRIVER=redis

# Soketi (WebSockets)
PUSHER_HOST=localhost
PUSHER_PORT=6001
PUSHER_KEY=svelar-key
PUSHER_SECRET=svelar-secret
PUSHER_APP_ID=svelar-app

# Gotenberg (PDF)
GOTENBERG_URL=http://localhost:3001

# RustFS (S3 storage)
S3_ENDPOINT=http://localhost:9000
S3_ACCESS_KEY=svelar
S3_SECRET_KEY=svelarsecret
S3_BUCKET=svelar
STORAGE_DISK=s3
```

This gives you the best of both worlds: instant hot reload from SvelteKit's dev server and real production services running locally. When you're ready to deploy, the same `docker compose up` starts everything including the app container.

You can also deploy without Docker (bare Node.js + PM2 + systemd), but Docker gives you reproducible builds, isolated services, and one-command deployments.

---

## Quick Start

```bash
# Generate Docker deployment files
npx svelar make:docker

# Build and start all services
docker compose up -d --build

# Run migrations
docker compose exec app npx svelar migrate

# Seed the database
docker compose exec app npx svelar seed:run

# View logs
docker compose logs -f app

# Stop everything
docker compose down
```

Your app is now running at `http://localhost:3000` with PostgreSQL, Redis, queue workers, scheduler, WebSockets (Soketi), PDF generation (Gotenberg), and S3-compatible storage (RustFS).

---

## Generated Files

Running `npx svelar make:docker` generates four files:

| File | Purpose |
|------|---------|
| `Dockerfile` | Multi-stage Node 20 Alpine build with PM2 |
| `docker-compose.yml` | Full stack with all services |
| `ecosystem.config.cjs` | PM2 config for web, worker, scheduler processes |
| `.dockerignore` | Excludes node_modules, .env, build artifacts, db files |

### Customization Flags

```bash
# Database driver (default: postgres)
npx svelar make:docker --db=postgres
npx svelar make:docker --db=mysql
npx svelar make:docker --db=sqlite

# Exclude optional services
npx svelar make:docker --no-redis       # No Redis (uses in-memory queue)
npx svelar make:docker --no-soketi       # No WebSocket server
npx svelar make:docker --no-gotenberg    # No PDF service
npx svelar make:docker --no-rustfs       # No S3 storage

# Minimal setup (just app + database)
npx svelar make:docker --no-redis --no-soketi --no-gotenberg --no-rustfs

# Overwrite existing files
npx svelar make:docker --force
```

---

## Dockerfile

The generated Dockerfile uses a multi-stage build for lean production images:

```dockerfile
# Stage 1: Build
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
RUN npm prune --production

# Stage 2: Production
FROM node:20-alpine AS production
WORKDIR /app
RUN npm install -g pm2
COPY --from=builder /app/build ./build
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/ecosystem.config.cjs ./
COPY --from=builder /app/src/lib/database ./src/lib/database

RUN mkdir -p storage/logs storage/public

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/health || exit 1

CMD ["pm2-runtime", "ecosystem.config.cjs"]
```

**Key design decisions:**

- **Multi-stage** — builder stage installs all deps and compiles; production stage copies only what's needed. Final image is ~150MB instead of ~800MB.
- **Layer caching** — `package*.json` is copied first so `npm ci` is cached unless dependencies change.
- **Migrations at runtime** — `src/lib/database` is copied so you can run `npx svelar migrate` inside the container.
- **Health check** — Docker monitors `/api/health` every 30s. Failed containers are restarted automatically.
- **PM2** — manages web server, queue workers, and scheduler as child processes within a single container.

---

## Docker Compose Services

The default `docker-compose.yml` includes up to 7 services:

### App

```yaml
app:
  build: .
  restart: unless-stopped
  ports:
    - "${APP_PORT:-3000}:3000"
  env_file: .env
  volumes:
    - app_storage:/app/storage
  depends_on:
    postgres:
      condition: service_healthy
    redis:
      condition: service_healthy
```

### PostgreSQL

```yaml
postgres:
  image: postgres:16-alpine
  restart: unless-stopped
  # No ports exposed — only reachable by app via Docker network
  environment:
    POSTGRES_DB: ${DB_NAME:-svelar}
    POSTGRES_USER: ${DB_USER:-svelar}
    POSTGRES_PASSWORD: ${DB_PASSWORD:-secret}
  volumes:
    - pgdata:/var/lib/postgresql/data
  healthcheck:
    test: ["CMD-SHELL", "pg_isready -U ${DB_USER:-svelar}"]
    interval: 5s
    timeout: 3s
    retries: 5
```

### Redis

```yaml
redis:
  image: redis:7-alpine
  restart: unless-stopped
  # No ports exposed — only reachable by app via Docker network
  command: redis-server --requirepass ${REDIS_PASSWORD:-svelarsecret}
  volumes:
    - redisdata:/data
  healthcheck:
    test: ["CMD", "redis-cli", "-a", "${REDIS_PASSWORD:-svelarsecret}", "ping"]
    interval: 5s
    timeout: 3s
    retries: 5
```

### Soketi (WebSockets)

```yaml
soketi:
  image: quay.io/soketi/soketi:1.6-16-debian
  restart: unless-stopped
  # No ports exposed — only reachable by app via Docker network
  # Uncomment below if browser clients connect directly to Soketi
  # ports:
  #   - "${SOKETI_PORT:-6001}:6001"
  environment:
    SOKETI_DEFAULT_APP_ID: ${PUSHER_APP_ID:-svelar-app}
    SOKETI_DEFAULT_APP_KEY: ${PUSHER_KEY:-svelar-key}
    SOKETI_DEFAULT_APP_SECRET: ${PUSHER_SECRET:-svelar-secret}
    SOKETI_DEFAULT_APP_MAX_CONNS: ${SOKETI_MAX_CONNS:-1000}
    SOKETI_DEFAULT_APP_ENABLE_CLIENT_MESSAGES: "true"
```

### Gotenberg (PDF Generation)

```yaml
gotenberg:
  image: gotenberg/gotenberg:8
  restart: unless-stopped
  # No ports exposed — only reachable by app via Docker network
  environment:
    CHROMIUM_DISABLE_JAVASCRIPT: "false"
    API_TIMEOUT: ${GOTENBERG_TIMEOUT:-60s}
```

### RustFS (S3-Compatible Storage)

```yaml
rustfs:
  image: rustfs/rustfs:latest
  restart: unless-stopped
  ports:
    - "${RUSTFS_CONSOLE_PORT:-9001}:9001"   # Admin console (protect with firewall)
  environment:
    RUSTFS_ROOT_USER: ${RUSTFS_ROOT_USER:-svelar}
    RUSTFS_ROOT_PASSWORD: ${RUSTFS_ROOT_PASSWORD:-svelarsecret}
  command: server /data --console-address ":9001"
  volumes:
    - rustfs_data:/data
```

RustFS web console is available at `http://localhost:9001` for browsing buckets and managing files.

### Meilisearch (Full-Text Search)

Opt-in with `npx svelar make:docker --meilisearch`:

```yaml
meilisearch:
  image: getmeili/meilisearch:v1.13
  restart: unless-stopped
  # No ports exposed — only reachable by app via Docker network
  # Uncomment below to access the dashboard from the host
  # ports:
  #   - "${MEILI_PORT:-7700}:7700"
  environment:
    MEILI_MASTER_KEY: ${MEILI_MASTER_KEY:-svelar-meili-master-key}
    MEILI_ENV: production
    MEILI_DB_PATH: /meili_data
    MEILI_NO_ANALYTICS: "true"
  volumes:
    - meili_data:/meili_data
  healthcheck:
    test: ["CMD", "wget", "--no-verbose", "--spider", "http://localhost:7700/health"]
    interval: 10s
    timeout: 5s
    retries: 5
```

The app connects via the Docker network using `MEILISEARCH_HOST=http://meilisearch:7700`. Install the JS SDK in your project:

```bash
npm install meilisearch
```

Basic usage:

```typescript
import { MeiliSearch } from 'meilisearch';

const client = new MeiliSearch({
  host: process.env.MEILISEARCH_HOST ?? 'http://localhost:7700',
  apiKey: process.env.MEILISEARCH_KEY,
});

// Index documents
const index = client.index('posts');
await index.addDocuments(posts);

// Search
const results = await index.search('query');
```

---

## PM2 Process Management

The `ecosystem.config.cjs` runs three processes inside the app container:

| Process | Mode | Instances | Purpose |
|---------|------|-----------|---------|
| **web** | cluster | `max` (all CPUs) | SvelteKit production server |
| **worker** | fork | 2 | Queue job processor |
| **scheduler** | fork | 1 | Cron task runner |

```javascript
module.exports = {
  apps: [
    {
      name: 'web',
      script: 'build/index.js',
      instances: 'max',
      exec_mode: 'cluster',
      max_memory_restart: '512M',
      kill_timeout: 5000,
      listen_timeout: 10000,
      wait_ready: true,
      error_file: 'storage/logs/web-error.log',
      out_file: 'storage/logs/web-out.log',
    },
    {
      name: 'worker',
      script: 'node_modules/.bin/svelar',
      args: 'queue:work --max-time=3600',
      instances: 2,
      exec_mode: 'fork',
      autorestart: true,
      error_file: 'storage/logs/worker-error.log',
      out_file: 'storage/logs/worker-out.log',
    },
    {
      name: 'scheduler',
      script: 'node_modules/.bin/svelar',
      args: 'schedule:run',
      instances: 1,     // Only ONE scheduler instance
      exec_mode: 'fork',
      autorestart: true,
      cron_restart: '0 */6 * * *',  // Restart every 6h
      error_file: 'storage/logs/scheduler-error.log',
      out_file: 'storage/logs/scheduler-out.log',
    },
  ],
};
```

**Important:** The scheduler must run as exactly **1 instance**. Svelar includes distributed locking (`SchedulerLock`) to prevent duplicate execution across multiple containers, but each container should still run only one scheduler process.

### PM2 Commands Inside the Container

```bash
# View process status
docker compose exec app pm2 list

# View real-time logs
docker compose exec app pm2 logs

# Monitor CPU/memory
docker compose exec app pm2 monit

# Restart web processes (zero-downtime reload)
docker compose exec app pm2 reload web

# Scale workers
docker compose exec app pm2 scale worker 4
```

---

## Environment Variables Reference

### Application

| Variable | Default | Description |
|----------|---------|-------------|
| `NODE_ENV` | `production` | Node environment |
| `APP_PORT` | `3000` | Host port mapping |
| `APP_URL` | — | Public URL (for email links, OAuth callbacks) |
| `APP_KEY` | — | Secret key for session encryption |
| `INTERNAL_SECRET` | — | Secret for internal API bridge (scheduler broadcasts) |

### Database

| Variable | Default | Description |
|----------|---------|-------------|
| `DB_HOST` | `postgres` | Database hostname (auto-set in Docker) |
| `DB_PORT` | `5432` | Database port |
| `DB_NAME` | `svelar` | Database name |
| `DB_USER` | `svelar` | Database user |
| `DB_PASSWORD` | `secret` | Database password |
| `DB_ROOT_PASSWORD` | `rootsecret` | MySQL root password (MySQL only) |

### Redis & Queue

| Variable | Default | Description |
|----------|---------|-------------|
| `REDIS_HOST` | `redis` | Redis hostname (auto-set in Docker) |
| `REDIS_PORT` | `6379` | Redis port |
| `REDIS_PASSWORD` | `svelarsecret` | Redis authentication password |
| `QUEUE_DRIVER` | `redis` | Queue driver (`redis`, `memory`, `sync`) |

### WebSockets (Soketi)

| Variable | Default | Description |
|----------|---------|-------------|
| `PUSHER_HOST` | `soketi` | Soketi hostname (auto-set in Docker) |
| `PUSHER_PORT` | `6001` | Soketi port |
| `PUSHER_APP_ID` | `svelar-app` | Soketi app ID |
| `PUSHER_KEY` | `svelar-key` | Soketi app key |
| `PUSHER_SECRET` | `svelar-secret` | Soketi app secret |
| `VITE_PUSHER_KEY` | — | Client-side Soketi key |
| `VITE_PUSHER_HOST` | — | Client-side Soketi host |
| `VITE_PUSHER_PORT` | — | Client-side Soketi port |

### PDF (Gotenberg)

| Variable | Default | Description |
|----------|---------|-------------|
| `GOTENBERG_URL` | `http://gotenberg:3000` | Gotenberg service URL |
| `GOTENBERG_PORT` | `3001` | Host port mapping |
| `GOTENBERG_TIMEOUT` | `60s` | PDF generation timeout |

### Storage (RustFS / S3)

| Variable | Default | Description |
|----------|---------|-------------|
| `S3_ENDPOINT` | `http://rustfs:9000` | S3-compatible endpoint |
| `S3_ACCESS_KEY` | `svelar` | S3 access key |
| `S3_SECRET_KEY` | `svelarsecret` | S3 secret key |
| `S3_BUCKET` | `svelar` | S3 bucket name |
| `S3_REGION` | `us-east-1` | S3 region |
| `STORAGE_DISK` | `s3` | Default storage disk |
| `RUSTFS_ROOT_USER` | `svelar` | RustFS admin user |
| `RUSTFS_ROOT_PASSWORD` | `svelarsecret` | RustFS admin password |

### Search (Meilisearch)

| Variable | Default | Description |
|----------|---------|-------------|
| `MEILISEARCH_HOST` | `http://meilisearch:7700` | Meilisearch host URL (auto-set in Docker) |
| `MEILISEARCH_KEY` | `svelar-meili-master-key` | Meilisearch API key (must match `MEILI_MASTER_KEY`) |
| `MEILI_MASTER_KEY` | `svelar-meili-master-key` | Meilisearch master key (container config) |

### Auth

| Variable | Default | Description |
|----------|---------|-------------|
| `JWT_SECRET` | — | JWT signing secret |
| `AUTH_OTP_ENABLED` | `true` | Enable OTP login flow |
| `AUTH_EMAIL_VERIFICATION_REQUIRED` | `false` | Require email verification |

### Mail

| Variable | Default | Description |
|----------|---------|-------------|
| `MAIL_DRIVER` | `log` | Mail driver (`smtp`, `postmark`, `resend`, `log`, `null`) |
| `MAIL_FROM` | — | Default sender address |
| `POSTMARK_API_TOKEN` | — | Postmark API token |
| `RESEND_API_KEY` | — | Resend API key |

---

## Reverse Proxy with Traefik

For production deployments, put Traefik in front of your app for SSL termination, load balancing, and automatic certificate management.

### Basic Traefik Setup

Create a `docker-compose.traefik.yml` alongside your generated `docker-compose.yml`:

```yaml
# docker-compose.traefik.yml
services:
  traefik:
    image: traefik:v3
    restart: unless-stopped
    command:
      - "--api.dashboard=true"
      - "--providers.docker=true"
      - "--providers.docker.exposedByDefault=false"
      - "--entrypoints.web.address=:80"
      - "--entrypoints.websecure.address=:443"
      # Redirect HTTP → HTTPS
      - "--entrypoints.web.http.redirections.entrypoint.to=websecure"
      - "--entrypoints.web.http.redirections.entrypoint.scheme=https"
      # Let's Encrypt
      - "--certificatesresolvers.letsencrypt.acme.httpchallenge=true"
      - "--certificatesresolvers.letsencrypt.acme.httpchallenge.entrypoint=web"
      - "--certificatesresolvers.letsencrypt.acme.email=${ACME_EMAIL}"
      - "--certificatesresolvers.letsencrypt.acme.storage=/letsencrypt/acme.json"
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - letsencrypt:/letsencrypt
    networks:
      - web

  app:
    extends:
      file: docker-compose.yml
      service: app
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.app.rule=Host(`${APP_DOMAIN}`)"
      - "traefik.http.routers.app.entrypoints=websecure"
      - "traefik.http.routers.app.tls.certresolver=letsencrypt"
      - "traefik.http.services.app.loadbalancer.server.port=3000"
      - "traefik.http.services.app.loadbalancer.healthcheck.path=/api/health"
      - "traefik.http.services.app.loadbalancer.healthcheck.interval=10s"
    networks:
      - web
      - default

  # Expose Soketi through Traefik (WebSocket support)
  soketi:
    extends:
      file: docker-compose.yml
      service: soketi
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.soketi.rule=Host(`ws.${APP_DOMAIN}`)"
      - "traefik.http.routers.soketi.entrypoints=websecure"
      - "traefik.http.routers.soketi.tls.certresolver=letsencrypt"
      - "traefik.http.services.soketi.loadbalancer.server.port=6001"
    networks:
      - web
      - default

volumes:
  letsencrypt:

networks:
  web:
    external: true
```

### Usage

```bash
# Create the external network (once)
docker network create web

# Set environment variables
export APP_DOMAIN=myapp.example.com
export ACME_EMAIL=admin@example.com

# Start with Traefik
docker compose -f docker-compose.yml -f docker-compose.traefik.yml up -d --build
```

Your app is now available at `https://myapp.example.com` with auto-renewing Let's Encrypt certificates. WebSocket connections go through `wss://ws.myapp.example.com`.

### Traefik Dashboard

To access the Traefik dashboard, add these labels to the traefik service:

```yaml
labels:
  - "traefik.http.routers.dashboard.rule=Host(`traefik.${APP_DOMAIN}`)"
  - "traefik.http.routers.dashboard.service=api@internal"
  - "traefik.http.routers.dashboard.entrypoints=websecure"
  - "traefik.http.routers.dashboard.tls.certresolver=letsencrypt"
  - "traefik.http.routers.dashboard.middlewares=auth"
  - "traefik.http.middlewares.auth.basicauth.users=${TRAEFIK_AUTH}"
```

Generate the auth string: `htpasswd -nb admin your-password`.

### Rate Limiting and Headers

Add middleware for security hardening:

```yaml
labels:
  # Rate limiting
  - "traefik.http.middlewares.ratelimit.ratelimit.average=100"
  - "traefik.http.middlewares.ratelimit.ratelimit.burst=50"
  - "traefik.http.middlewares.ratelimit.ratelimit.period=1m"
  # Security headers
  - "traefik.http.middlewares.headers.headers.stsSeconds=31536000"
  - "traefik.http.middlewares.headers.headers.stsIncludeSubdomains=true"
  - "traefik.http.middlewares.headers.headers.forceSTSHeader=true"
  - "traefik.http.middlewares.headers.headers.contentTypeNosniff=true"
  - "traefik.http.middlewares.headers.headers.browserXssFilter=true"
  - "traefik.http.middlewares.headers.headers.frameDeny=true"
  # Apply middlewares
  - "traefik.http.routers.app.middlewares=ratelimit,headers"
```

---

## SSL/TLS with Traefik

Traefik handles SSL automatically through Let's Encrypt. For custom certificates:

```yaml
# Static configuration
command:
  - "--providers.file.filename=/etc/traefik/dynamic.yml"

# Mount your certificates
volumes:
  - ./certs:/certs:ro
  - ./traefik-dynamic.yml:/etc/traefik/dynamic.yml:ro
```

```yaml
# traefik-dynamic.yml
tls:
  certificates:
    - certFile: /certs/fullchain.pem
      keyFile: /certs/privkey.pem
```

For wildcard certificates with DNS challenge (Cloudflare example):

```yaml
command:
  - "--certificatesresolvers.letsencrypt.acme.dnschallenge=true"
  - "--certificatesresolvers.letsencrypt.acme.dnschallenge.provider=cloudflare"
environment:
  CF_DNS_API_TOKEN: ${CF_DNS_API_TOKEN}
```

---

## Scaling Horizontally

### Multiple App Instances with Docker Compose

```bash
# Scale to 3 app instances (Traefik auto-discovers and load-balances)
docker compose -f docker-compose.yml -f docker-compose.traefik.yml up -d --scale app=3
```

Traefik automatically detects new containers and distributes traffic across them. Each container runs its own PM2 cluster, so 3 containers on a 4-core machine = 12 web processes.

### Sticky Sessions

If your app uses server-side sessions, enable sticky sessions so each user always hits the same container:

```yaml
labels:
  - "traefik.http.services.app.loadbalancer.sticky.cookie=true"
  - "traefik.http.services.app.loadbalancer.sticky.cookie.name=svelar_affinity"
  - "traefik.http.services.app.loadbalancer.sticky.cookie.httpOnly=true"
  - "traefik.http.services.app.loadbalancer.sticky.cookie.secure=true"
```

> **Note:** If you use `DatabaseSessionStore` (the default), sticky sessions are not strictly required since all instances read from the same database. Sticky sessions are mainly needed with `MemorySessionStore` or file-based sessions.

### Scheduler with Multiple Instances

When scaling to multiple containers, **only one scheduler should run tasks at a time**. Svelar's `SchedulerLock` handles this automatically — it uses database-backed distributed locking to prevent duplicate execution. Every container can run a scheduler process; only one will acquire the lock and execute each task.

---

## Blue-Green Deployments with Docker Compose

Blue-green deployments eliminate downtime by running two identical environments and switching traffic between them.

### Directory Structure

```
production/
├── docker-compose.yml          # Shared services (db, redis, etc.)
├── docker-compose.blue.yml     # Blue environment
├── docker-compose.green.yml    # Green environment
├── docker-compose.traefik.yml  # Traefik load balancer
├── .env                        # Shared environment variables
└── deploy.sh                   # Deployment script
```

### Shared Services

```yaml
# docker-compose.yml
services:
  postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_DB: ${DB_NAME:-svelar}
      POSTGRES_USER: ${DB_USER:-svelar}
      POSTGRES_PASSWORD: ${DB_PASSWORD:-secret}
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${DB_USER:-svelar}"]
      interval: 5s
      timeout: 3s
      retries: 5
    networks:
      - backend

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    volumes:
      - redisdata:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 5
    networks:
      - backend

volumes:
  pgdata:
  redisdata:

networks:
  backend:
  web:
    external: true
```

### Blue Environment

```yaml
# docker-compose.blue.yml
services:
  app-blue:
    build:
      context: .
      dockerfile: Dockerfile
    restart: unless-stopped
    env_file: .env
    environment:
      NODE_ENV: production
      DB_HOST: postgres
      REDIS_HOST: redis
      DEPLOYMENT_COLOR: blue
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    volumes:
      - app_storage:/app/storage
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.app-blue.rule=Host(`${APP_DOMAIN}`)"
      - "traefik.http.routers.app-blue.entrypoints=websecure"
      - "traefik.http.routers.app-blue.tls.certresolver=letsencrypt"
      - "traefik.http.routers.app-blue.priority=10"
      - "traefik.http.services.app-blue.loadbalancer.server.port=3000"
      - "traefik.http.services.app-blue.loadbalancer.healthcheck.path=/api/health"
      - "traefik.http.services.app-blue.loadbalancer.healthcheck.interval=5s"
    networks:
      - backend
      - web

volumes:
  app_storage:
```

### Green Environment

```yaml
# docker-compose.green.yml
services:
  app-green:
    build:
      context: .
      dockerfile: Dockerfile
    restart: unless-stopped
    env_file: .env
    environment:
      NODE_ENV: production
      DB_HOST: postgres
      REDIS_HOST: redis
      DEPLOYMENT_COLOR: green
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    volumes:
      - app_storage:/app/storage
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.app-green.rule=Host(`${APP_DOMAIN}`)"
      - "traefik.http.routers.app-green.entrypoints=websecure"
      - "traefik.http.routers.app-green.tls.certresolver=letsencrypt"
      - "traefik.http.routers.app-green.priority=10"
      - "traefik.http.services.app-green.loadbalancer.server.port=3000"
      - "traefik.http.services.app-green.loadbalancer.healthcheck.path=/api/health"
      - "traefik.http.services.app-green.loadbalancer.healthcheck.interval=5s"
    networks:
      - backend
      - web

volumes:
  app_storage:
```

### Deployment Script

```bash
#!/usr/bin/env bash
# deploy.sh — Blue-green deployment for Svelar
set -euo pipefail

APP_DOMAIN="${APP_DOMAIN:?Set APP_DOMAIN}"
CURRENT_FILE=".current-deployment"

# Determine current and next color
if [ -f "$CURRENT_FILE" ] && [ "$(cat $CURRENT_FILE)" = "blue" ]; then
  CURRENT="blue"
  NEXT="green"
else
  CURRENT="green"
  NEXT="blue"
fi

echo "==> Current: $CURRENT | Deploying: $NEXT"

# 1. Build the new environment
echo "==> Building $NEXT..."
docker compose -f docker-compose.yml -f docker-compose.${NEXT}.yml build

# 2. Start the new environment (Traefik won't route to it until healthy)
echo "==> Starting $NEXT..."
docker compose -f docker-compose.yml -f docker-compose.${NEXT}.yml up -d

# 3. Wait for the new environment to be healthy
echo "==> Waiting for $NEXT to become healthy..."
RETRIES=30
until docker compose -f docker-compose.yml -f docker-compose.${NEXT}.yml \
  exec app-${NEXT} wget -qO- http://localhost:3000/api/health > /dev/null 2>&1; do
  RETRIES=$((RETRIES - 1))
  if [ $RETRIES -le 0 ]; then
    echo "==> ERROR: $NEXT failed health check. Rolling back."
    docker compose -f docker-compose.yml -f docker-compose.${NEXT}.yml down
    exit 1
  fi
  sleep 2
done

# 4. Run migrations on the new environment
echo "==> Running migrations on $NEXT..."
docker compose -f docker-compose.yml -f docker-compose.${NEXT}.yml \
  exec app-${NEXT} npx svelar migrate

# 5. Increase priority so Traefik routes to the new environment
echo "==> Switching traffic to $NEXT..."
docker compose -f docker-compose.yml -f docker-compose.${NEXT}.yml up -d

# 6. Stop the old environment
echo "==> Stopping $CURRENT..."
docker compose -f docker-compose.yml -f docker-compose.${CURRENT}.yml down

# 7. Record current deployment
echo "$NEXT" > "$CURRENT_FILE"

echo "==> Deployment complete. Active: $NEXT"
```

### Usage

```bash
chmod +x deploy.sh

# First deployment (starts blue)
docker compose -f docker-compose.yml up -d                # shared services
docker compose -f docker-compose.traefik.yml up -d        # traefik
./deploy.sh                                               # deploys blue

# Subsequent deployments (alternates blue ↔ green)
git pull
./deploy.sh    # builds green, health checks, migrates, switches, stops blue
./deploy.sh    # builds blue, health checks, migrates, switches, stops green
```

### Rollback

If something goes wrong after switching:

```bash
# Read current color and swap back
CURRENT=$(cat .current-deployment)
if [ "$CURRENT" = "blue" ]; then PREVIOUS="green"; else PREVIOUS="blue"; fi

# Start the previous environment
docker compose -f docker-compose.yml -f docker-compose.${PREVIOUS}.yml up -d

# Stop the broken one
docker compose -f docker-compose.yml -f docker-compose.${CURRENT}.yml down

# Update state
echo "$PREVIOUS" > .current-deployment
```

---

## Docker Swarm

Docker Swarm provides native container orchestration with built-in service discovery, rolling updates, and multi-node clustering. It's simpler than Kubernetes and works well for Svelar deployments.

### Initialize Swarm

```bash
# On the manager node
docker swarm init --advertise-addr <MANAGER_IP>

# On worker nodes (use the token from swarm init output)
docker swarm join --token <TOKEN> <MANAGER_IP>:2377
```

### Swarm Stack File

Create a `docker-stack.yml`:

```yaml
# docker-stack.yml
version: "3.8"

services:
  traefik:
    image: traefik:v3
    command:
      - "--api.dashboard=true"
      - "--providers.docker.swarmMode=true"
      - "--providers.docker.exposedByDefault=false"
      - "--entrypoints.web.address=:80"
      - "--entrypoints.websecure.address=:443"
      - "--entrypoints.web.http.redirections.entrypoint.to=websecure"
      - "--entrypoints.web.http.redirections.entrypoint.scheme=https"
      - "--certificatesresolvers.letsencrypt.acme.httpchallenge=true"
      - "--certificatesresolvers.letsencrypt.acme.httpchallenge.entrypoint=web"
      - "--certificatesresolvers.letsencrypt.acme.email=${ACME_EMAIL}"
      - "--certificatesresolvers.letsencrypt.acme.storage=/letsencrypt/acme.json"
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - letsencrypt:/letsencrypt
    networks:
      - web
    deploy:
      placement:
        constraints:
          - node.role == manager
      restart_policy:
        condition: any

  app:
    image: ${REGISTRY}/svelar-app:${TAG:-latest}
    env_file: .env
    environment:
      NODE_ENV: production
      DB_HOST: postgres
      REDIS_HOST: redis
    volumes:
      - app_storage:/app/storage
    networks:
      - web
      - backend
    deploy:
      replicas: 3
      update_config:
        parallelism: 1
        delay: 30s
        order: start-first
        failure_action: rollback
        monitor: 60s
      rollback_config:
        parallelism: 1
        delay: 10s
      restart_policy:
        condition: any
        delay: 5s
        max_attempts: 3
      labels:
        - "traefik.enable=true"
        - "traefik.http.routers.app.rule=Host(`${APP_DOMAIN}`)"
        - "traefik.http.routers.app.entrypoints=websecure"
        - "traefik.http.routers.app.tls.certresolver=letsencrypt"
        - "traefik.http.services.app.loadbalancer.server.port=3000"
        - "traefik.http.services.app.loadbalancer.healthcheck.path=/api/health"
        - "traefik.http.services.app.loadbalancer.healthcheck.interval=10s"
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:3000/api/health"]
      interval: 30s
      timeout: 5s
      start_period: 10s
      retries: 3

  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: ${DB_NAME:-svelar}
      POSTGRES_USER: ${DB_USER:-svelar}
      POSTGRES_PASSWORD: ${DB_PASSWORD:-secret}
    volumes:
      - pgdata:/var/lib/postgresql/data
    networks:
      - backend
    deploy:
      replicas: 1
      placement:
        constraints:
          - node.role == manager
      restart_policy:
        condition: any
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${DB_USER:-svelar}"]
      interval: 5s
      timeout: 3s
      retries: 5

  redis:
    image: redis:7-alpine
    volumes:
      - redisdata:/data
    networks:
      - backend
    deploy:
      replicas: 1
      restart_policy:
        condition: any
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 5

  soketi:
    image: quay.io/soketi/soketi:1.6-16-debian
    environment:
      SOKETI_DEFAULT_APP_ID: ${PUSHER_APP_ID:-svelar-app}
      SOKETI_DEFAULT_APP_KEY: ${PUSHER_KEY:-svelar-key}
      SOKETI_DEFAULT_APP_SECRET: ${PUSHER_SECRET:-svelar-secret}
      SOKETI_DEFAULT_APP_MAX_CONNS: ${SOKETI_MAX_CONNS:-1000}
      SOKETI_DEFAULT_APP_ENABLE_CLIENT_MESSAGES: "true"
    networks:
      - web
      - backend
    deploy:
      replicas: 1
      labels:
        - "traefik.enable=true"
        - "traefik.http.routers.soketi.rule=Host(`ws.${APP_DOMAIN}`)"
        - "traefik.http.routers.soketi.entrypoints=websecure"
        - "traefik.http.routers.soketi.tls.certresolver=letsencrypt"
        - "traefik.http.services.soketi.loadbalancer.server.port=6001"

volumes:
  letsencrypt:
  pgdata:
  redisdata:
  app_storage:

networks:
  web:
    driver: overlay
  backend:
    driver: overlay
```

### Deploy the Stack

```bash
# Build and push image to registry
docker build -t ${REGISTRY}/svelar-app:v1.0.0 .
docker push ${REGISTRY}/svelar-app:v1.0.0

# Deploy the stack
TAG=v1.0.0 docker stack deploy -c docker-stack.yml svelar

# Run migrations (on any running app container)
docker exec $(docker ps -q -f name=svelar_app | head -1) npx svelar migrate

# Check status
docker stack services svelar
docker service logs svelar_app -f
```

### Key Swarm Configuration

The `update_config` section controls rolling updates:

| Setting | Value | Purpose |
|---------|-------|---------|
| `parallelism: 1` | — | Update one container at a time |
| `delay: 30s` | — | Wait 30s between each container update |
| `order: start-first` | — | Start new container before stopping old one (zero downtime) |
| `failure_action: rollback` | — | Auto-rollback if update fails |
| `monitor: 60s` | — | Watch new container for 60s before proceeding |

### Scaling in Swarm

```bash
# Scale app to 5 replicas
docker service scale svelar_app=5

# Scale workers
docker service scale svelar_worker=4

# Check placement across nodes
docker service ps svelar_app
```

---

## Blue-Green Deployments with Docker Swarm

Swarm's built-in rolling updates already provide zero-downtime deployments. For full blue-green isolation (where you can test the new version before switching traffic), use service labels:

### Strategy

1. Deploy the new version as a separate service (`app-green`)
2. Test it on an internal URL
3. Update Traefik labels to route production traffic to green
4. Remove the old blue service

```bash
#!/usr/bin/env bash
# swarm-blue-green.sh
set -euo pipefail

REGISTRY="${REGISTRY:?Set REGISTRY}"
TAG="${TAG:?Set TAG}"
APP_DOMAIN="${APP_DOMAIN:?Set APP_DOMAIN}"
CURRENT_FILE=".current-deployment"

if [ -f "$CURRENT_FILE" ] && [ "$(cat $CURRENT_FILE)" = "blue" ]; then
  CURRENT="blue"; NEXT="green"
else
  CURRENT="green"; NEXT="blue"
fi

echo "==> Current: $CURRENT | Deploying: $NEXT"

# 1. Build and push
echo "==> Building and pushing image..."
docker build -t ${REGISTRY}/svelar-app:${TAG} .
docker push ${REGISTRY}/svelar-app:${TAG}

# 2. Deploy new version as a staging service (internal only, no Traefik)
echo "==> Deploying $NEXT as staging..."
docker service create \
  --name svelar_app-${NEXT} \
  --replicas 3 \
  --network svelar_web \
  --network svelar_backend \
  --env-file .env \
  --env NODE_ENV=production \
  --env DB_HOST=svelar_postgres \
  --env REDIS_HOST=svelar_redis \
  --env DEPLOYMENT_COLOR=${NEXT} \
  --mount type=volume,source=svelar_app_storage,target=/app/storage \
  --health-cmd "wget -qO- http://localhost:3000/api/health || exit 1" \
  --health-interval 10s \
  --health-retries 3 \
  --health-start-period 15s \
  ${REGISTRY}/svelar-app:${TAG}

# 3. Wait for all replicas to be healthy
echo "==> Waiting for $NEXT to become healthy..."
RETRIES=60
while true; do
  RUNNING=$(docker service ps svelar_app-${NEXT} --filter "desired-state=running" -q | wc -l)
  HEALTHY=$(docker service ps svelar_app-${NEXT} --filter "desired-state=running" --format "{{.CurrentState}}" | grep -c "Running" || true)
  if [ "$HEALTHY" -ge 3 ]; then break; fi
  RETRIES=$((RETRIES - 1))
  if [ $RETRIES -le 0 ]; then
    echo "==> ERROR: $NEXT failed to start. Removing."
    docker service rm svelar_app-${NEXT}
    exit 1
  fi
  sleep 5
done

# 4. Run migrations
echo "==> Running migrations on $NEXT..."
CONTAINER=$(docker ps -q -f name=svelar_app-${NEXT} | head -1)
docker exec "$CONTAINER" npx svelar migrate

# 5. Switch Traefik labels to the new service
echo "==> Switching traffic to $NEXT..."
docker service update \
  --label-add "traefik.enable=true" \
  --label-add "traefik.http.routers.app.rule=Host(\`${APP_DOMAIN}\`)" \
  --label-add "traefik.http.routers.app.entrypoints=websecure" \
  --label-add "traefik.http.routers.app.tls.certresolver=letsencrypt" \
  --label-add "traefik.http.services.app.loadbalancer.server.port=3000" \
  svelar_app-${NEXT}

# 6. Remove old service
echo "==> Removing $CURRENT..."
docker service rm svelar_app-${CURRENT} 2>/dev/null || true

# 7. Record state
echo "$NEXT" > "$CURRENT_FILE"
echo "==> Deployment complete. Active: $NEXT"
```

### Rolling Update Alternative

If full blue-green isolation isn't necessary, Swarm's built-in rolling updates are simpler and equally zero-downtime:

```bash
# Update the image (Swarm handles the rest)
docker service update \
  --image ${REGISTRY}/svelar-app:v2.0.0 \
  --update-parallelism 1 \
  --update-delay 30s \
  --update-order start-first \
  --update-failure-action rollback \
  svelar_app

# Watch the rollout
docker service ps svelar_app

# Manual rollback if needed
docker service rollback svelar_app
```

---

## Database Management

### Migrations in Docker

Always run migrations before starting the new version:

```bash
# Docker Compose
docker compose exec app npx svelar migrate

# Docker Swarm
docker exec $(docker ps -q -f name=svelar_app | head -1) npx svelar migrate
```

### Backups

```bash
# PostgreSQL backup
docker compose exec postgres pg_dump -U svelar svelar > backup_$(date +%Y%m%d_%H%M%S).sql

# PostgreSQL restore
docker compose exec -T postgres psql -U svelar svelar < backup.sql

# MySQL backup
docker compose exec mysql mysqldump -u svelar -psecret svelar > backup.sql

# SQLite backup (copy the file)
docker compose exec app cp database.db /app/storage/backup_$(date +%Y%m%d).db
docker compose cp app:/app/storage/backup_$(date +%Y%m%d).db ./
```

### Automated Backup Schedule

Add a backup service to your compose file:

```yaml
backup:
  image: postgres:16-alpine
  environment:
    PGHOST: postgres
    PGUSER: ${DB_USER:-svelar}
    PGPASSWORD: ${DB_PASSWORD:-secret}
    PGDATABASE: ${DB_NAME:-svelar}
  volumes:
    - ./backups:/backups
  entrypoint: >
    sh -c 'while true; do
      pg_dump > /backups/svelar_$$(date +%Y%m%d_%H%M%S).sql
      find /backups -name "*.sql" -mtime +7 -delete
      sleep 86400
    done'
  depends_on:
    postgres:
      condition: service_healthy
```

---

## Monitoring and Logging

### Application Logs

```bash
# All PM2 process logs
docker compose logs -f app

# Specific process logs
docker compose exec app pm2 logs web
docker compose exec app pm2 logs worker
docker compose exec app pm2 logs scheduler

# Log files on the host (via volume mount)
ls storage/logs/
# web-out.log, web-error.log, worker-out.log, scheduler-out.log
```

### Svelar Log Viewer

Svelar's built-in log viewer is available through the admin dashboard. You can also access logs programmatically:

```typescript
import { LogViewer } from '@beeblock/svelar/logging/LogViewer';

const stats = LogViewer.getStats();
const errors = LogViewer.search({ level: 'error', limit: 50 });
```

### PM2 Monitoring

```bash
# Real-time process metrics
docker compose exec app pm2 monit

# Process list with CPU/memory
docker compose exec app pm2 list

# JSON metrics (for external monitoring)
docker compose exec app pm2 jlist
```

### Container Health

```bash
# Check all container health
docker compose ps

# Inspect health check details
docker inspect --format='{{json .State.Health}}' <container_id> | jq

# Service health in Swarm
docker service ps svelar_app --no-trunc
```

### Soketi Metrics

Soketi exposes Prometheus-compatible metrics on port 9601:

```bash
curl http://localhost:9601/metrics
```

---

## Security Best Practices

### Secrets Management

Never commit secrets to your repository. Use Docker secrets or environment files:

```bash
# Docker Compose — use .env file (not committed to git)
echo ".env" >> .gitignore

# Docker Swarm — use Docker secrets
echo "my-secret-key" | docker secret create app_key -
echo "my-jwt-secret" | docker secret create jwt_secret -
```

In your stack file:

```yaml
services:
  app:
    secrets:
      - app_key
      - jwt_secret
    environment:
      APP_KEY_FILE: /run/secrets/app_key
      JWT_SECRET_FILE: /run/secrets/jwt_secret

secrets:
  app_key:
    external: true
  jwt_secret:
    external: true
```

### Production `.env` Checklist

```bash
# REQUIRED — generate strong random values
APP_KEY=<openssl rand -hex 32>
JWT_SECRET=<openssl rand -hex 32>
INTERNAL_SECRET=<openssl rand -hex 32>

# REQUIRED — change from defaults
DB_PASSWORD=<strong-password>
RUSTFS_ROOT_PASSWORD=<strong-password>
PUSHER_KEY=<random-string>
PUSHER_SECRET=<random-string>

# REQUIRED — set your domain
APP_URL=https://myapp.example.com
APP_DOMAIN=myapp.example.com

# RECOMMENDED
NODE_ENV=production
MAIL_DRIVER=postmark   # or resend, smtp
AUTH_OTP_ENABLED=true
AUTH_EMAIL_VERIFICATION_REQUIRED=true
```

### Network Isolation

Only expose what's needed:

```yaml
services:
  # Only Traefik gets external ports
  traefik:
    ports:
      - "80:80"
      - "443:443"

  # App has NO published ports — only accessible through Traefik
  app:
    expose:
      - "3000"

  # Database, Redis — internal only, no published ports
  postgres:
    # No ports section
  redis:
    # No ports section
```

### Read-Only Filesystem

For maximum security, run containers with a read-only root filesystem:

```yaml
app:
  read_only: true
  tmpfs:
    - /tmp
  volumes:
    - app_storage:/app/storage  # Writable storage only
```

---

## CI/CD Pipeline

### GitHub Actions Example

```yaml
# .github/workflows/deploy.yml
name: Deploy

on:
  push:
    branches: [main]

env:
  REGISTRY: ghcr.io/${{ github.repository }}

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write

    steps:
      - uses: actions/checkout@v4

      - name: Log in to Container Registry
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Build and push Docker image
        uses: docker/build-push-action@v5
        with:
          context: .
          push: true
          tags: |
            ${{ env.REGISTRY }}:${{ github.sha }}
            ${{ env.REGISTRY }}:latest
          cache-from: type=gha
          cache-to: type=gha,mode=max

      - name: Deploy to production
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.DEPLOY_HOST }}
          username: ${{ secrets.DEPLOY_USER }}
          key: ${{ secrets.DEPLOY_KEY }}
          script: |
            cd /opt/svelar
            export TAG=${{ github.sha }}
            export REGISTRY=${{ env.REGISTRY }}
            docker pull ${REGISTRY}:${TAG}
            docker service update --image ${REGISTRY}:${TAG} svelar_app
            docker exec $(docker ps -q -f name=svelar_app | head -1) \
              npx svelar migrate
```

### GitLab CI Example

```yaml
# .gitlab-ci.yml
stages:
  - build
  - deploy

build:
  stage: build
  image: docker:24
  services:
    - docker:24-dind
  script:
    - docker build -t $CI_REGISTRY_IMAGE:$CI_COMMIT_SHA .
    - docker push $CI_REGISTRY_IMAGE:$CI_COMMIT_SHA

deploy:
  stage: deploy
  image: alpine
  only:
    - main
  before_script:
    - apk add --no-cache openssh-client
    - eval $(ssh-agent -s)
    - echo "$SSH_PRIVATE_KEY" | ssh-add -
  script:
    - ssh $DEPLOY_USER@$DEPLOY_HOST "
        cd /opt/svelar &&
        docker pull $CI_REGISTRY_IMAGE:$CI_COMMIT_SHA &&
        docker service update --image $CI_REGISTRY_IMAGE:$CI_COMMIT_SHA svelar_app &&
        docker exec \$(docker ps -q -f name=svelar_app | head -1) npx svelar migrate
      "
```

---

## Troubleshooting

### Container Won't Start

```bash
# Check logs
docker compose logs app

# Common issues:
# 1. Database not ready — ensure depends_on + healthcheck
# 2. Missing APP_KEY — generate with: openssl rand -hex 32
# 3. Port conflict — change APP_PORT in .env
# 4. Build failure — check Dockerfile COPY paths
```

### Health Check Failing

```bash
# Test health endpoint manually
docker compose exec app wget -qO- http://localhost:3000/api/health

# Check if the build exists
docker compose exec app ls -la build/

# Check PM2 processes
docker compose exec app pm2 list
```

### Database Connection Refused

```bash
# Verify database is healthy
docker compose ps postgres
docker compose exec postgres pg_isready -U svelar

# Check network connectivity
docker compose exec app ping postgres

# Verify environment variables
docker compose exec app env | grep DB_
```

### Queue Jobs Not Processing

```bash
# Check worker status
docker compose exec app pm2 list

# Verify Redis connection
docker compose exec app node -e "
  const Redis = require('ioredis');
  const r = new Redis({ host: 'redis' });
  r.ping().then(console.log).catch(console.error);
"

# Check queue stats
docker compose exec app pm2 logs worker
```

### Out of Disk Space

```bash
# Clean up Docker artifacts
docker system prune -a --volumes

# Check volume sizes
docker system df -v

# Remove old images
docker image prune -a
```

### Scheduler Running Duplicate Tasks

This should not happen with Svelar's `SchedulerLock`, but if it does:

```bash
# Verify only ONE scheduler per container
docker compose exec app pm2 list | grep scheduler

# Check scheduler_locks table
docker compose exec postgres psql -U svelar -c "SELECT * FROM scheduler_locks;"

# Clear stale locks
docker compose exec postgres psql -U svelar -c "DELETE FROM scheduler_locks WHERE expires_at < NOW();"
```
