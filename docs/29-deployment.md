# Deployment

Svelar provides a complete Docker-based deployment pipeline. A single `npx svelar make:deploy` scaffolds everything: multi-stage Dockerfile, docker-compose with dev/prod overrides, GitHub Actions CI/CD, DigitalOcean droplet setup, health endpoint, PM2 config, and `.dockerignore`.

CLI wrapper commands (`dev:up`, `prod:deploy`, etc.) let you manage containers without memorizing long compose flags.

---

## Table of Contents

- [Quick Start](#quick-start)
- [Scaffold Commands](#scaffold-commands)
- [Runtime Commands](#runtime-commands)
- [Generated Files](#generated-files)
- [Architecture: Dev vs Prod](#architecture-dev-vs-prod)
- [Dockerfile](#dockerfile)
- [Docker Compose Files](#docker-compose-files)
- [Health Endpoint](#health-endpoint)
- [GitHub Actions CI/CD](#github-actions-cicd)
- [Infrastructure Setup](#infrastructure-setup)
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
- [Troubleshooting](#troubleshooting)

---

## Quick Start

```bash
# 1. Scaffold all deployment files
npx svelar make:deploy

# 2. Start development (hot-reload + all services)
npx svelar dev:up

# 3. Run migrations
docker compose -f docker-compose.yml -f docker-compose.dev.yml exec app npx svelar migrate

# 4. View logs
npx svelar dev:logs

# 5. Stop everything
npx svelar dev:down
```

Your app is now running at `http://localhost:5173` with hot-reload, backed by PostgreSQL, Redis, Soketi, Gotenberg, and RustFS.

For production:

```bash
# Build and start production containers locally
npx svelar prod:up

# Or deploy latest image from registry
npx svelar prod:deploy
```

---

## Scaffold Commands

| Command | What it generates |
|---------|-------------------|
| `npx svelar make:deploy` | Runs all three commands below |
| `npx svelar make:docker` | `Dockerfile`, `docker-compose.yml`, `docker-compose.dev.yml`, `docker-compose.prod.yml`, `.dockerignore`, `ecosystem.config.cjs`, `src/routes/api/health/+server.ts`, `docker/postgres/postgresql.conf`, `docker/postgres/init.sql`, `docker/pgbouncer/pgbouncer.ini` (PostgreSQL only) |
| `npx svelar make:ci` | `.github/workflows/deploy.yml` |
| `npx svelar make:infra` | `infra/setup-droplet.sh`, `infra/droplet.env.example` |

### Flags

```bash
# Database driver (default: postgres)
npx svelar make:docker --db=postgres
npx svelar make:docker --db=mysql
npx svelar make:docker --db=sqlite

# Docker image name (default: package.json name)
npx svelar make:docker --image=myapp

# Exclude optional services
npx svelar make:docker --no-redis       # No Redis (uses in-memory queue)
npx svelar make:docker --no-soketi       # No WebSocket server
npx svelar make:docker --no-gotenberg    # No PDF service
npx svelar make:docker --no-rustfs       # No S3 storage

# Minimal setup (just app + database)
npx svelar make:docker --no-redis --no-soketi --no-gotenberg --no-rustfs

# Overwrite existing files
npx svelar make:deploy --force
```

---

## Runtime Commands

All commands are docker compose wrappers. They automatically use the correct compose override file (dev or prod) so you don't need to type `-f docker-compose.yml -f docker-compose.dev.yml` every time.

### Development (`dev:*`)

Uses `docker-compose.yml` + `docker-compose.dev.yml`. Builds the `development` Dockerfile target with source bind-mount and hot-reload on port 5173.

| Command | What it runs |
|---------|-------------|
| `npx svelar dev:up` | `docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build` |
| `npx svelar dev:down` | `docker compose -f docker-compose.yml -f docker-compose.dev.yml down` |
| `npx svelar dev:logs` | `docker compose -f docker-compose.yml -f docker-compose.dev.yml logs -f` |
| `npx svelar dev:restart` | `dev:down` then `dev:up` |

### Production (`prod:*`)

Uses `docker-compose.yml` + `docker-compose.prod.yml`. Pulls a pre-built image from your registry instead of building locally.

| Command | What it runs |
|---------|-------------|
| `npx svelar prod:up` | `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d` |
| `npx svelar prod:down` | `docker compose -f docker-compose.yml -f docker-compose.prod.yml down` |
| `npx svelar prod:logs` | `docker compose -f docker-compose.yml -f docker-compose.prod.yml logs -f` |
| `npx svelar prod:restart` | `prod:down` then `prod:up` |
| `npx svelar prod:deploy` | `pull` then `up -d` (pull latest image and restart) |

### Targeting a specific service

All runtime commands accept `--service <name>`:

```bash
npx svelar dev:logs --service=postgres
npx svelar prod:restart --service=app
npx svelar dev:up --service=redis
```

---

## Generated Files

### File Overview

```
your-project/
├── Dockerfile                          # Multi-stage (base, deps, builder, production, development)
├── docker-compose.yml                  # Base compose — all services (app, postgres, pgbouncer, redis, etc.)
├── docker-compose.dev.yml              # Dev override — builds development target, bind-mounts source
├── docker-compose.prod.yml             # Prod override — uses pre-built image from registry
├── .dockerignore                       # Excludes node_modules, .env, build artifacts
├── ecosystem.config.cjs                # PM2 config (web, worker, scheduler)
├── src/routes/api/health/+server.ts    # Health endpoint
├── docker/                             # Database & pooler config (PostgreSQL only)
│   ├── postgres/
│   │   ├── postgresql.conf             # Production-tuned PostgreSQL config
│   │   └── init.sql                    # Extensions (uuid-ossp, pgcrypto, citext, pg_trgm, etc.)
│   └── pgbouncer/
│       └── pgbouncer.ini               # Connection pooler config (transaction mode, pool sizes)
├── .github/workflows/deploy.yml        # GitHub Actions CI/CD
└── infra/
    ├── setup-droplet.sh                # Droplet provisioning script
    └── droplet.env.example             # Infrastructure config template
```

---

## Architecture: Dev vs Prod

Svelar uses **docker compose override files** to keep one `docker-compose.yml` (shared services) with environment-specific overrides.

### How it works

```
docker-compose.yml           Base config — app + infrastructure (postgres, pgbouncer, redis, etc.)
  + docker-compose.dev.yml   Dev override — builds FROM Dockerfile target=development
  + docker-compose.prod.yml  Prod override — pulls pre-built image from registry

Request flow:  App (PM2 cluster) → PgBouncer (:6432) → PostgreSQL (:5432)
```

PostgreSQL, PgBouncer, Redis, and all other services are defined in the base `docker-compose.yml` — they run identically in both dev and prod. Only the `app` service changes between overrides.

**Development** (`dev:up`):
- Builds the `development` stage of the Dockerfile
- Bind-mounts your source code into the container (`.:/app`)
- Runs `npm run dev -- --host 0.0.0.0` with hot-reload
- Exposes port **5173** (Vite dev server)
- `node_modules` is an anonymous volume (not bind-mounted, so container uses its own)

**Production** (`prod:up`):
- Uses a **pre-built image** from Docker Hub / your registry
- Runs `node build/index.js` via dumb-init as a non-root user
- Exposes port **3000**
- PM2 manages web, worker, and scheduler processes
- Health check on `/api/health`

### Development without Docker (hybrid approach)

If you prefer running SvelteKit natively for hot-reload speed but want Docker for infrastructure:

```bash
# Start only infrastructure services
npx svelar dev:up --service=postgres
npx svelar dev:up --service=redis

# Run your app natively
npm run dev
```

Your `.env` should point to the Docker services on `localhost`:

```bash
DB_HOST=localhost
DB_PORT=5432
REDIS_HOST=localhost
REDIS_PORT=6379
```

---

## Dockerfile

The generated Dockerfile has **5 stages**: `base`, `deps`, `builder`, `production`, and `development`.

```dockerfile
# ── Base ──────────────────────────────────────────────────
FROM node:20-alpine AS base
RUN apk add --no-cache dumb-init
RUN addgroup -g 1001 sveltekit && adduser -u 1001 -G sveltekit -s /bin/sh -D sveltekit

# ── Dependencies (production only) ───────────────────────
FROM base AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

# ── Builder (full install + build) ───────────────────────
FROM base AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# ── Production ───────────────────────────────────────────
FROM base AS production
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/build ./build
COPY --from=builder /app/package.json ./
COPY --from=builder /app/ecosystem.config.cjs ./
RUN mkdir -p storage/logs storage/public && chown -R sveltekit:sveltekit /app
USER sveltekit
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/health || exit 1
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "build/index.js"]

# ── Development (hot-reload) ─────────────────────────────
FROM base AS development
WORKDIR /app
ENV NODE_ENV=development
COPY package*.json ./
RUN npm ci
COPY . .
EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
```

**Key design decisions:**

| Feature | Why |
|---------|-----|
| **dumb-init** | Proper PID 1 signal handling — Node.js doesn't handle SIGTERM/SIGINT correctly as PID 1 |
| **Non-root user** (`sveltekit:1001`) | Security — container never runs as root |
| **Separate deps stage** | `npm ci --omit=dev` creates a lean `node_modules` without devDependencies |
| **Multi-stage** | Final production image is ~150MB instead of ~800MB |
| **Layer caching** | `package*.json` is copied first so `npm ci` is cached unless dependencies change |
| **Node adapter output** | The scaffold uses `@sveltejs/adapter-node`, so production runs the explicit Node server from `build/index.js` |
| **Migrations at runtime** | Run `npx svelar migrate` inside the container after deploy; the CLI boots `src/app.ts` before falling back to config |
| **Health check** | Docker monitors `/api/health` every 30s. Failed containers are restarted automatically |
| **Development target** | `docker compose.dev.yml` builds this stage for hot-reload in Docker |

---

## Docker Compose Files

### `docker-compose.yml` (base)

The base compose file defines all services — app, database, Redis, Soketi, Gotenberg, RustFS. It uses `build: .` for the app service (builds the production Dockerfile target by default).

The dev and prod override files **replace** the app service's build/image configuration.

### `docker-compose.dev.yml`

```yaml
services:
  app:
    build:
      context: .
      target: development          # Uses the 'development' Dockerfile stage
    ports:
      - "${DEV_PORT:-5173}:5173"   # Vite dev server port
    volumes:
      - .:/app                     # Bind-mount source for hot-reload
      - /app/node_modules          # Anonymous volume — container keeps its own node_modules
    environment:
      - NODE_ENV=development
```

This overrides the `app` service from the base compose file:
- **Builds the `development` target** instead of `production`
- **Bind-mounts your source code** so file changes trigger hot-reload
- **Maps port 5173** (Vite dev server) instead of 3000
- All infrastructure services (postgres, redis, etc.) come from the base compose file unchanged

### `docker-compose.prod.yml`

```yaml
services:
  app:
    image: ${DOCKER_IMAGE:-myapp}:latest
    # No build — uses pre-built image from registry
```

This overrides the `app` service to:
- **Pull a pre-built image** from Docker Hub (or your registry) instead of building locally
- Set `DOCKER_IMAGE` in your `.env` to your Docker Hub username/image name
- The image was built and pushed by GitHub Actions (or `docker build -t myapp . && docker push myapp`)

---

## Health Endpoint

`make:docker` generates `src/routes/api/health/+server.ts`:

```typescript
import { json } from '@sveltejs/kit';

export const GET = () => json({
  status: 'ok',
  timestamp: new Date().toISOString(),
  uptime: process.uptime(),
});
```

Used by:
- **Dockerfile HEALTHCHECK** — Docker restarts the container if this endpoint fails
- **Traefik load balancer** — routes traffic only to healthy containers
- **GitHub Actions deploy** — can verify deployment success
- **Monitoring** — external uptime checks

---

## GitHub Actions CI/CD

`npx svelar make:ci` generates `.github/workflows/deploy.yml` — a complete build, push, and SSH deploy pipeline.

### What it does

1. **Triggers** on push to `main` (also builds on PRs, but only deploys on push)
2. **Builds** the Docker image (production target)
3. **Pushes** to Docker Hub with `:latest` and `:timestamp` tags
4. **SSHs** into your droplet, writes `ENV_PROD` secret to `.env`, pulls the image, and starts containers

### Required GitHub Secrets

| Secret | Description |
|--------|-------------|
| `DOCKER_USERNAME` | Docker Hub username |
| `DOCKER_TOKEN` | Docker Hub access token |
| `DOCKER_IMAGE_NAME` | Docker image name (e.g. `myapp`) |
| `DROPLET_HOST` | Droplet IP address or hostname |
| `DROPLET_USER` | SSH user on the droplet (e.g. `deploy`) |
| `DROPLET_SSH_KEY` | Private SSH key for the deploy user |
| `DROPLET_PROJECT` | Project directory name on the droplet (e.g. `myapp`) |
| `ENV_PROD` | **Complete production `.env` file contents** |

### How `.env` works

The production `.env` is **never manually managed on the server**. Instead:

1. Store your entire production `.env` contents as the `ENV_PROD` GitHub Secret
2. On every deploy, the workflow writes it to `.env` on the server: `echo "${{ secrets.ENV_PROD }}" > .env`
3. Docker Compose reads it via `env_file: .env`

This means updating environment variables is as simple as updating the `ENV_PROD` secret and pushing to main.

### Generated workflow

```yaml
name: Deploy

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

env:
  DOCKER_IMAGE: ${{ secrets.DOCKER_USERNAME }}/${{ secrets.DOCKER_IMAGE_NAME }}

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3

      - name: Log in to Docker Hub
        if: github.event_name == 'push'
        run: echo "${{ secrets.DOCKER_TOKEN }}" | docker login -u "${{ secrets.DOCKER_USERNAME }}" --password-stdin

      - name: Build Docker image
        run: |
          docker build . --file Dockerfile \
            --target production \
            --tag $DOCKER_IMAGE:$(date +%s) \
            --tag $DOCKER_IMAGE:latest

      - name: Push to Docker Hub
        if: github.event_name == 'push'
        run: docker push $DOCKER_IMAGE --all-tags

      - name: Deploy to droplet
        if: github.event_name == 'push'
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.DROPLET_HOST }}
          username: ${{ secrets.DROPLET_USER }}
          key: ${{ secrets.DROPLET_SSH_KEY }}
          script: |
            echo "${{ secrets.DOCKER_TOKEN }}" | docker login -u "${{ secrets.DOCKER_USERNAME }}" --password-stdin
            cd ${{ secrets.DROPLET_PROJECT }}/
            echo "${{ secrets.ENV_PROD }}" > .env
            docker compose -f docker-compose.yml -f docker-compose.prod.yml pull
            docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
            docker image prune -f
```

---

## Infrastructure Setup

### How it works

`npx svelar make:infra` generates a setup script and config template. `npx svelar infra:setup` runs the script — it reads config from `infra/droplet.env`, SSHs into the droplet, and sets everything up automatically.

The `.env` file is **not** copied to the server during setup. It's managed by CI/CD — the `ENV_PROD` GitHub Secret is written to `.env` on every deploy.

### Setup Flow

```bash
# 1. Scaffold everything
npx svelar make:deploy

# 2. Fill in your droplet config
cp infra/droplet.env.example infra/droplet.env
# Edit: DROPLET_IP, DEPLOY_USER, PROJECT_NAME, SSH_KEY_PATH

# 3. Provision the droplet (interactive — asks for confirmation)
npx svelar infra:setup

# 4. Add GitHub Secrets:
#    DOCKER_USERNAME, DOCKER_TOKEN, DOCKER_IMAGE_NAME,
#    DROPLET_HOST, DROPLET_USER, DROPLET_SSH_KEY, DROPLET_PROJECT,
#    ENV_PROD

# 5. Push to main — GitHub Actions handles the rest
git push origin main
```

### Generated Files

`npx svelar make:infra` generates two files:

#### `infra/droplet.env.example`

Configuration for the setup script (NOT the app `.env`). Copy to `infra/droplet.env` and fill in:

```bash
# Required
DROPLET_IP=           # Your server's public IP
DEPLOY_USER=deploy    # Non-root user to create
PROJECT_NAME=myapp    # Directory name on server: ~/PROJECT_NAME
SSH_KEY_PATH=~/.ssh/id_ed25519  # Private key (public key = path + .pub)

# Optional
COMPOSE_FILE=docker-compose.prod.yml
DEPLOY_USER_PASSWORD=  # For emergency console access
```

#### `infra/setup-droplet.sh`

Runs locally, SSHs into the droplet to:
1. Create a `deploy` user with passwordless sudo
2. Copy your SSH public key to the deploy user
3. Add deploy user to the `docker` group
4. Create the project directory (`~/PROJECT_NAME`)
5. Copy `docker-compose.yml` and `docker-compose.prod.yml` to the server

The script assumes Docker is pre-installed on the droplet (DigitalOcean Docker droplets). For bare Ubuntu, Docker installation can be added.

#### Using `infra:setup` with flags (no config file needed)

```bash
npx svelar infra:setup --ip=123.45.67.89 --key=~/.ssh/id_ed25519
npx svelar infra:setup --ip=123.45.67.89 --key=~/.ssh/id_ed25519 --deploy-user=deploy --project=myapp
```

| Flag | Default | Description |
|------|---------|-------------|
| `--ip` | (required) | Droplet IP or hostname |
| `--key`, `-k` | (required) | Path to SSH private key |
| `--deploy-user` | `deploy` | Non-root user to create |
| `--project`, `-p` | package.json name | Remote directory name |
| `--config`, `-c` | `infra/droplet.env` | Path to config file (alternative to flags) |

You can also run the script directly: `bash infra/setup-droplet.sh`

#### Security

`make:infra` automatically adds `infra/droplet.env` to `.gitignore` so server IPs and SSH key paths are never committed. The `infra/droplet.env.example` template (with empty values) is safe to commit.

---

## Docker Compose Services

The base `docker-compose.yml` includes up to 7 services depending on your flags:

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
  image: postgres:17-alpine
  restart: unless-stopped
  # No ports exposed — only reachable via PgBouncer on the Docker network
  command: postgres -c config_file=/etc/postgresql/postgresql.conf
  environment:
    POSTGRES_DB: ${DB_NAME:-svelar}
    POSTGRES_USER: ${DB_USER:-svelar}
    POSTGRES_PASSWORD: ${DB_PASSWORD:-secret}
  volumes:
    - pgdata:/var/lib/postgresql/data
    - ./docker/postgres/postgresql.conf:/etc/postgresql/postgresql.conf:ro
    - ./docker/postgres/init.sql:/docker-entrypoint-initdb.d/init.sql:ro
  healthcheck:
    test: ["CMD-SHELL", "pg_isready -U ${DB_USER:-svelar} -d ${DB_NAME:-svelar}"]
    interval: 30s
    timeout: 10s
    retries: 5
```

The app never connects directly to PostgreSQL — it goes through PgBouncer (see below).

**Generated config files:**

| File | Purpose |
|------|---------|
| `docker/postgres/postgresql.conf` | Production-tuned settings (memory, WAL, logging, autovacuum, pg_stat_statements) |
| `docker/postgres/init.sql` | Extensions: uuid-ossp, pgcrypto, citext, unaccent, pg_trgm, pg_stat_statements |

Extensions and postgresql.conf are loaded automatically on both dev and prod — they come from the base `docker-compose.yml` which is shared by both overrides.

### PgBouncer (connection pooling)

PgBouncer is included automatically when using PostgreSQL. It sits between the app and the database, pooling connections to prevent exhaustion under load (PM2 cluster mode with multiple workers).

Credentials are read from the `DATABASE_URL` environment variable in `docker-compose.yml` — the PgBouncer image auto-generates its auth file at startup. No static password files are committed to git.

```yaml
pgbouncer:
  image: edoburu/pgbouncer:v1.25.1-p0
  restart: unless-stopped
  environment:
    DATABASE_URL: postgres://${DB_USER:-svelar}:${DB_PASSWORD:-secret}@postgres:5432/${DB_NAME:-svelar}
  volumes:
    - ./docker/pgbouncer/pgbouncer.ini:/etc/pgbouncer/pgbouncer.ini:ro
  depends_on:
    postgres:
      condition: service_healthy
  healthcheck:
    test: ["CMD", "pg_isready", "-h", "localhost", "-p", "6432"]
    interval: 10s
    timeout: 5s
    retries: 5
```

The app connects to `pgbouncer:6432` (not `postgres:5432`). This is set automatically in `docker-compose.yml` via `DB_HOST=pgbouncer` and `DB_PORT=6432`.

**Generated config files:**

| File | Purpose |
|------|---------|
| `docker/pgbouncer/pgbouncer.ini` | Pool mode (transaction), pool sizes, timeouts, keepalive, scram-sha-256 auth |

**Default pool settings:**

| Setting | Value | Description |
|---------|-------|-------------|
| `pool_mode` | transaction | Release connection after each transaction |
| `max_client_conn` | 500 | Max connections from app |
| `max_db_connections` | 80 | Max connections to PostgreSQL |
| `default_pool_size` | 25 | Connections per user/database pair |

To tune these values, edit `docker/pgbouncer/pgbouncer.ini` directly. Changes are picked up on next deploy (the `docker/` directory is synced automatically by CI/CD).

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
    interval: 10s
    timeout: 5s
    retries: 5
```

### Soketi (WebSockets)

```yaml
soketi:
  image: quay.io/soketi/soketi:1.6-16-debian
  restart: unless-stopped
  # No ports exposed — only reachable by app via Docker network
  environment:
    SOKETI_DEFAULT_APP_ID: ${PUSHER_APP_ID}
    SOKETI_DEFAULT_APP_KEY: ${PUSHER_KEY}
    SOKETI_DEFAULT_APP_SECRET: ${PUSHER_SECRET}
    SOKETI_DEFAULT_APP_MAX_CONNS: "${SOKETI_MAX_CONNS:-1000}"
    SOKETI_DEFAULT_APP_ENABLE_CLIENT_MESSAGES: "true"
```

### Gotenberg (PDF Generation)

```yaml
gotenberg:
  image: gotenberg/gotenberg:8
  restart: unless-stopped
  environment:
    CHROMIUM_DISABLE_JAVASCRIPT: "false"
    API_TIMEOUT: "${GOTENBERG_TIMEOUT:-60s}"
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

RustFS web console is available at `http://localhost:9001`.

### Meilisearch (Full-Text Search)

Opt-in with `npx svelar make:docker --meilisearch`:

```yaml
meilisearch:
  image: getmeili/meilisearch:v1.13
  restart: unless-stopped
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

---

## PM2 Process Management

The `ecosystem.config.cjs` runs three processes inside the production container:

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
    },
    {
      name: 'worker',
      script: 'node_modules/.bin/svelar',
      args: 'queue:work --max-time=3600',
      instances: 2,
      exec_mode: 'fork',
      autorestart: true,
    },
    {
      name: 'scheduler',
      script: 'node_modules/.bin/svelar',
      args: 'schedule:run',
      instances: 1,     // Only ONE scheduler instance
      exec_mode: 'fork',
      autorestart: true,
      cron_restart: '0 */6 * * *',  // Restart every 6h
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
| `APP_PORT` | `3000` | Host port mapping (production) |
| `DEV_PORT` | `5173` | Host port mapping (development) |
| `APP_URL` | — | Public URL (for email links, OAuth callbacks) |
| `APP_KEY` | — | Secret key for session encryption |
| `INTERNAL_SECRET` | — | Secret for internal API bridge (scheduler broadcasts) |
| `DOCKER_IMAGE` | package.json name | Docker image for `docker-compose.prod.yml` |

### Database

| Variable | Default | Description |
|----------|---------|-------------|
| `DB_HOST` | `pgbouncer` | PgBouncer hostname (auto-set in Docker for PostgreSQL) |
| `DB_PORT` | `6432` | PgBouncer port (app connects here, not directly to postgres) |
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
| `QUEUE_DRIVER` | `redis` | Queue driver (`redis`, `database`, `memory`, `sync`) |

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

Create a `docker-compose.traefik.yml` alongside your generated compose files:

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
      # Redirect HTTP -> HTTPS
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
docker compose -f docker-compose.yml -f docker-compose.traefik.yml up -d
```

Your app is now available at `https://myapp.example.com` with auto-renewing Let's Encrypt certificates. WebSocket connections go through `wss://ws.myapp.example.com`.

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
command:
  - "--providers.file.filename=/etc/traefik/dynamic.yml"
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

If your app uses server-side sessions, enable sticky sessions:

```yaml
labels:
  - "traefik.http.services.app.loadbalancer.sticky.cookie=true"
  - "traefik.http.services.app.loadbalancer.sticky.cookie.name=svelar_affinity"
  - "traefik.http.services.app.loadbalancer.sticky.cookie.httpOnly=true"
  - "traefik.http.services.app.loadbalancer.sticky.cookie.secure=true"
```

> **Note:** If you use `DatabaseSessionStore` (the default), sticky sessions are not strictly required since all instances read from the same database.

### Scheduler with Multiple Instances

When scaling to multiple containers, **only one scheduler should run tasks at a time**. Svelar's `SchedulerLock` handles this automatically with database-backed distributed locking.

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
├── .env
└── deploy.sh
```

### Deployment Script

```bash
#!/usr/bin/env bash
# deploy.sh — Blue-green deployment for Svelar
set -euo pipefail

APP_DOMAIN="${APP_DOMAIN:?Set APP_DOMAIN}"
CURRENT_FILE=".current-deployment"

if [ -f "$CURRENT_FILE" ] && [ "$(cat $CURRENT_FILE)" = "blue" ]; then
  CURRENT="blue"; NEXT="green"
else
  CURRENT="green"; NEXT="blue"
fi

echo "==> Current: $CURRENT | Deploying: $NEXT"

# 1. Build the new environment
docker compose -f docker-compose.yml -f docker-compose.${NEXT}.yml build

# 2. Start (Traefik won't route until healthy)
docker compose -f docker-compose.yml -f docker-compose.${NEXT}.yml up -d

# 3. Wait for health check
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

# 4. Run migrations
docker compose -f docker-compose.yml -f docker-compose.${NEXT}.yml \
  exec app-${NEXT} npx svelar migrate

# 5. Switch traffic
docker compose -f docker-compose.yml -f docker-compose.${NEXT}.yml up -d

# 6. Stop the old environment
docker compose -f docker-compose.yml -f docker-compose.${CURRENT}.yml down

echo "$NEXT" > "$CURRENT_FILE"
echo "==> Deployment complete. Active: $NEXT"
```

---

## Docker Swarm

Docker Swarm provides native container orchestration with rolling updates and multi-node clustering.

### Initialize Swarm

```bash
# On the manager node
docker swarm init --advertise-addr <MANAGER_IP>

# On worker nodes
docker swarm join --token <TOKEN> <MANAGER_IP>:2377
```

### Deploy the Stack

```bash
# Build and push image to registry
docker build -t ${REGISTRY}/svelar-app:v1.0.0 .
docker push ${REGISTRY}/svelar-app:v1.0.0

# Deploy
TAG=v1.0.0 docker stack deploy -c docker-stack.yml svelar

# Run migrations
docker exec $(docker ps -q -f name=svelar_app | head -1) npx svelar migrate

# Check status
docker stack services svelar
docker service logs svelar_app -f
```

### Rolling Updates

```bash
# Update the image (Swarm handles the rest)
docker service update \
  --image ${REGISTRY}/svelar-app:v2.0.0 \
  --update-parallelism 1 \
  --update-delay 30s \
  --update-order start-first \
  --update-failure-action rollback \
  svelar_app

# Manual rollback if needed
docker service rollback svelar_app
```

### Scaling

```bash
docker service scale svelar_app=5
docker service scale svelar_worker=4
```

---

## Blue-Green Deployments with Docker Swarm

Swarm's built-in rolling updates already provide zero-downtime deployments. For full blue-green isolation, deploy the new version as a separate service, test it, then switch Traefik labels.

---

## Database Management

### Migrations in Docker

```bash
# Development
docker compose -f docker-compose.yml -f docker-compose.dev.yml exec app npx svelar migrate

# Production
docker compose -f docker-compose.yml -f docker-compose.prod.yml exec app npx svelar migrate

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
```

---

## Monitoring and Logging

### Application Logs

```bash
# Using Svelar CLI
npx svelar dev:logs                    # All dev services
npx svelar dev:logs --service=app      # Just the app
npx svelar prod:logs                   # All prod services

# PM2 logs inside the container
docker compose exec app pm2 logs web
docker compose exec app pm2 logs worker
docker compose exec app pm2 logs scheduler
```

### Container Health

```bash
# Check all container health
docker compose ps

# Inspect health check details
docker inspect --format='{{json .State.Health}}' <container_id> | jq
```

### PM2 Monitoring

```bash
docker compose exec app pm2 monit      # Real-time metrics
docker compose exec app pm2 list       # Process list with CPU/memory
docker compose exec app pm2 jlist      # JSON metrics for external monitoring
```

---

## Security Best Practices

### Secrets Management

Never commit secrets to your repository:

```bash
# Docker Compose — use .env file (not committed to git)
echo ".env" >> .gitignore

# Docker Swarm — use Docker secrets
echo "my-secret-key" | docker secret create app_key -
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
MAIL_DRIVER=postmark
```

### Network Isolation

Only expose what's needed:

```yaml
services:
  traefik:
    ports:
      - "80:80"
      - "443:443"
  app:
    expose:
      - "3000"     # No published ports — only through Traefik
  postgres:
    # No ports section — internal only
  redis:
    # No ports section — internal only
```

---

## Multiple Projects on One Droplet

You can deploy multiple Svelar apps to the same droplet. Each project runs in its own directory with isolated Docker networks, containers, and volumes — no conflicts by default.

The only thing you need to manage is **host port mapping** so projects don't fight over the same port.

### Port configuration (APP_PORT)

Each project needs a unique APP_PORT in its ENV_PROD GitHub Secret to avoid port conflicts:

```bash
# Project A — ENV_PROD secret
APP_PORT=3000
DB_NAME=project_a
DB_PASSWORD=supersecret
# ...

# Project B — ENV_PROD secret
APP_PORT=3001
DB_NAME=project_b
DB_PASSWORD=supersecret
# ...
```

The compose file maps `${APP_PORT:-3000}:3000` — the host port comes from `.env`, the container always listens on `3000` internally.

### Why there are no service name conflicts

Docker Compose namespaces everything by project directory. If project A lives in `/home/deploy/my-app` and project B in `/home/deploy/my-api`, their containers and volumes are prefixed differently:

```
my-app-app-1        my-api-app-1
my-app-postgres-1   my-api-postgres-1
my-app_pgdata       my-api_pgdata
```

Each project gets its own isolated Docker network — services communicate internally without host ports.

### Services that expose host ports

| Service | Port | Env variable | Notes |
|---------|------|-------------|-------|
| `app` | 3000 | `APP_PORT` | **Must be unique per project** |
| `rustfs` | 9001 | `RUSTFS_CONSOLE_PORT` | Admin console — unique per project if both use RustFS |

All other services (postgres, redis, soketi, gotenberg, meilisearch) are internal-only — no host port, no conflicts.

### Using a reverse proxy

For production with multiple projects, put a reverse proxy (Nginx, Caddy, or Traefik) in front to route domains to the correct `APP_PORT`:

```
blog.example.com   → localhost:3000 (project A)
api.example.com    → localhost:3001 (project B)
admin.example.com  → localhost:3002 (project C)
```

---

## Troubleshooting

### Container Won't Start

```bash
npx svelar dev:logs --service=app

# Common issues:
# 1. Database not ready — ensure depends_on + healthcheck
# 2. Missing APP_KEY — generate with: openssl rand -hex 32
# 3. Port conflict — change APP_PORT/DEV_PORT in .env
# 4. Build failure — verify adapter-node is installed and native hashing packages are externalized in vite.config.ts
```

### Health Check Failing

```bash
# Test health endpoint manually
docker compose exec app wget -qO- http://localhost:3000/api/health

# Check if the build exists (production)
docker compose exec app ls -la build/

# Check PM2 processes (production)
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

# Check queue stats
docker compose exec app pm2 logs worker
```

### Out of Disk Space

```bash
docker system prune -a --volumes
docker system df -v
docker image prune -a
```

### Scheduler Running Duplicate Tasks

```bash
# Verify only ONE scheduler per container
docker compose exec app pm2 list | grep scheduler

# Check scheduler_locks table
docker compose exec postgres psql -U svelar -c "SELECT * FROM scheduler_locks;"

# Clear stale locks
docker compose exec postgres psql -U svelar -c "DELETE FROM scheduler_locks WHERE expires_at < NOW();"
```
