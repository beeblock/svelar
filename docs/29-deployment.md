# Deployment

Svelar scaffolds Docker, separate app/worker/scheduler services, GitHub Actions and host provisioning with `npx svelar make:deploy`. Production `prod:deploy` uses an explicit release image, a stable blue/green gateway, readiness checks, bounded drain and retained rollback. Infrastructure bootstrap, migration compatibility and application-specific readiness still require operator review.

CLI wrapper commands (`dev:up`, `prod:deploy`, etc.) let you manage containers without memorizing long compose flags.

The core and generated app toolchain baseline is TypeScript 6.0.3, not an unconstrained `typescript@latest`. Root/core manifests and new apps use `^6.0.3`; generated apps keep `@types/node` on the 22.x line. This compiler change does not raise the runtime contract to Node 25 or migrate plugin manifests.

TypeScript 6 no longer includes every visible `@types` package automatically. Core compiler configurations explicitly include `types: ['node']`; app templates include `types: ['node', 'vite/client']` and retain the SvelteKit-generated configuration. Existing apps should update their compiler dependency, rerun `svelte-kit sync`, and verify their required ambient types rather than setting `types: ['*']`. Core retains its existing explicit `rootDir`, ES2022 target, and module-resolution settings.

Verify the migration with strict declaration emission, source tests, and app `svelte-check`/build for both Zod and Valibot projects. Passing runtime tests alone does not prove that form/DTO types or compiler-API consumers work. No blanket `ignoreDeprecations` setting is used to suppress migration errors. See [TypeScript 6 release notes](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-6-0.html); [TypeScript 7 guidance](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/) explains why embedded Svelte tooling still needs the 6.x API.

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
- [Worker and Scheduler Containers](#worker-and-scheduler-containers)
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
# After infrastructure, core migration 000049 and bootstrap/readiness are installed:
npx svelar prod:deploy --image=registry.example.com/myapp:release-123 --compatible-migrations

# Promote the previous retained runtime; database migrations are not undone
npx svelar prod:deploy --rollback
```

These commands are not a first-adoption shortcut. Read [Blue-Green Deployments with Docker Compose](#blue-green-deployments-with-docker-compose) before exposing a production service. `prod:up` is the legacy direct-Compose path, not start-first deployment; an existing legacy app requires a planned gateway cutover.

---

## Scaffold Commands

| Command | What it generates |
|---------|-------------------|
| `npx svelar make:deploy` | Runs all three commands below |
| `npx svelar make:docker` | `Dockerfile`, base/dev/prod Compose, `svelar.deploy.json`, `.dockerignore`, `.svelar-local/.gitkeep`, dev/deploy runtime scripts, `/api/health`, `/api/ready`, `/api/traffic` routes, PostgreSQL/PgBouncer config when selected |
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
npx svelar make:docker --no-meilisearch  # No full-text search

# Minimal setup (just app + database)
npx svelar make:docker --no-redis --no-soketi --no-gotenberg --no-rustfs --no-meilisearch

# The same Docker options work with the all-in-one deploy scaffold
npx svelar make:deploy --db=mysql --no-redis --no-soketi

# Overwrite existing files
npx svelar make:deploy --force
```

---

## Runtime Commands

Development and maintenance commands select the corresponding Compose override. `prod:deploy` is a release orchestrator, not a plain `compose up` wrapper.

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
| `npx svelar prod:restart` | `up -d --force-recreate --remove-orphans --wait app worker scheduler` |
| `npx svelar prod:deploy --image=<release> --compatible-migrations` | Inspect/pull immutable image, preflight locked forward migrations, start candidate, verify readiness/smoke, promote gateway eligibility, drain old slot |
| `npx svelar prod:deploy --rollback` | Start/promote retained previous slot, verify it and drain current slot; no database rollback |

`prod:restart` does not run `down` by default because that tears down every dependency and causes avoidable downtime. It recreates the runtime containers (`app`, `worker`, and `scheduler`) and waits for health checks. Use `--service=app` to target one container, and `--no-wait` only when your Docker Compose version does not support health waiting.

`prod:deploy` runs locked forward migrations by default and requires `--compatible-migrations` acknowledgement of expand/contract compatibility. `--no-migrate` is an explicit separately-managed exception, not a way to make incompatible schemas safe. `--no-pull` supports locally built, explicit release images. Untagged images and `:latest` are rejected; the inspected local SHA256 image ID is used for the runtime.

`prod:up/down/restart/logs` target the original base Compose project. They do not target generated blue/green slot projects. Use the private slot Compose files for maintenance/logs after adoption; never run base `prod:up` alongside the gateway on the same port.

### Targeting a specific service

Compose maintenance commands accept `--service <name>`; `prod:deploy` deliberately rejects partial-service or no-readiness deployment:

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
├── Dockerfile                          # base, builder, deps, production, deployer, development
├── docker-compose.yml                  # Base compose — all services (app, postgres, pgbouncer, redis, etc.)
├── docker-compose.dev.yml              # Dev override — builds development target, bind-mounts source
├── docker-compose.prod.yml             # Prod override — uses pre-built image from registry
├── .dockerignore                       # Excludes node_modules, .env, build artifacts
├── .svelar-local/.gitkeep              # Keeps optional local package archive directory available to Docker
├── scripts/svelar-dev-runtime.mjs      # Local worker/scheduler runtime with Docker service host ports
├── scripts/svelar-deploy.sh            # One-shot administrative image; host Docker only
├── svelar.deploy.json                  # Reviewed blue/green manifest
├── src/routes/api/health/+server.ts    # Health endpoint
├── src/routes/api/ready/+server.ts     # Boot/dependency readiness, no-store
├── src/routes/api/traffic/+server.ts   # Read-only slot traffic eligibility, no-store
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

Request flow:  app container → PgBouncer (:6432) → PostgreSQL (:5432)
```

Infrastructure is defined in the base Compose file. Dev/prod overrides select runtime behavior; start-first deployment derives isolated runtime slot projects and shares already-existing infrastructure/network/named storage volumes without recreating them.

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
- Includes `src/`, `svelar.database.json`, `tsconfig.json` and `.svelte-kit` so CLI/Jiti commands and background daemons can bootstrap the app
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

The generated Dockerfile has six targets: `base`, `builder`, `deps`, `production`, `deployer`, and `development`.

`builder` copies app source before `npm ci`, allowing the generated `prepare: svelte-kit sync` script to find the Svelte/Vite configuration. Native dependency install scripts run normally. `deps` derives from that build and prunes development dependencies with `--ignore-scripts`; it does not rerun SvelteKit prepare after removing its tooling.

```dockerfile
FROM base AS builder
WORKDIR /app
COPY .svelar-local ./.svelar-local
COPY . .
RUN npm ci
RUN npm run build

FROM builder AS deps
RUN npm prune --omit=dev --ignore-scripts
```

The production target runs adapter-node through dumb-init as user 1001. It includes the built server, production dependencies, source bootstrap, database configuration, `tsconfig.json` and `.svelte-kit` for CLI/Jiti execution. Do not assume a built HTTP server alone can bootstrap migrations or workers.

The administrative `deployer` target derives from production, runs as root and installs Docker CLI/Compose. Only its one-shot deployment command mounts the host Docker socket. Docker/socket access is host-administrative authority, not a sandbox; never mount it in app, worker or scheduler containers.

```bash
docker build --target production -t "$DEPLOY_IMAGE" .
docker build --target deployer -t "$DEPLOYER_IMAGE" .
```

Keep lockfiles and local package archives available to the build. The scaffold excludes `.env*`, `.svelar-env` and private deployment state from its Docker context. Do not bake credentials into image layers. Image size depends on application/native dependencies; no fixed size or automatic restart-on-unhealthy guarantee is made.

---

## Docker Compose Files

### `docker-compose.yml` (base)

The base compose file defines all services — app, database, Redis, Soketi, Gotenberg, RustFS. It builds the `production` Dockerfile target for the app service.

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

This legacy override selects `:latest` for direct `prod:up`. It is not the release selector for `prod:deploy`, which requires `--image` and pins the inspected immutable ID. For direct maintenance, review and replace mutable tags deliberately.

This overrides the `app` service to:
- **Pull a pre-built image** from Docker Hub (or your registry) instead of building locally
- Set `DOCKER_IMAGE` in your `.env` to your Docker Hub username/image name
- The image was built and pushed by GitHub Actions (or `docker build -t myapp . && docker push myapp`)

---

## Health Endpoint

The generated routes have distinct meanings:

| Route | Meaning |
|-------|---------|
| `GET /api/health` | Process liveness/uptime, not dependency or worker readiness |
| `GET /api/ready` | Bootstrap completed, not draining, and every configured readiness check returned `true` |
| `GET /api/traffic` | Readiness plus this slot's current operator-controlled gateway eligibility |

Ready and traffic responses are safe, no-store envelopes with HTTP 200/503:

```json
{"data":{"ready":true},"meta":{}}
```

Traffic adds `slot: "blue" | "green" | null`. The routes bind the public controller, without persistence or runtime DDL:

```typescript
// src/routes/api/ready/+server.ts
import { DeploymentController } from '@beeblock/svelar/deployment';

const controller = new DeploymentController();
export const GET = () => controller.ready();
```

The traffic route calls `controller.traffic()`. Neither route permits changing slot eligibility over HTTP. The orchestrator supplies `SVELAR_DEPLOY_SLOT` and the absolute `SVELAR_DEPLOY_TRAFFIC_FILE` path; the app reads a small, read-only shared file containing slot names, not secrets. A missing/malformed file or unknown eligibility fails closed.

### Bootstrap and Drain

Configure readiness in the common server bootstrap after configuring dependencies, and mark ready only after providers initialize. Generated apps already wire these lifecycle calls; review existing/customized apps rather than adding duplicate handlers.

```typescript
import { Connection } from '@beeblock/svelar/database';
import { DeploymentRuntime } from '@beeblock/svelar/deployment';

DeploymentRuntime.configure({
  timeoutMs: 2000,
  cacheMs: 250,
  checks: {
    database: async signal => {
      await Connection.raw('SELECT 1'); // Infrastructure probe, not application CRUD
      return !signal.aborted;
    },
  },
});
// Only after the application's provider/bootstrap work has completed:
DeploymentRuntime.ready();
```

Checks receive an `AbortSignal`. Timeout returns not-ready and aborts the signal; it cannot force-cancel a database/SDK operation that ignores it. The runtime retains one tracked probe flight until settlement, shares concurrent requests and briefly caches results, so repeated polling cannot create unbounded copies of a hung check. Configure driver deadlines as well. Reconfiguration and drain invalidate late success.

Choose required probes deliberately. A DB read/cache operation/Redis count proves only that operation's reachability. Queue counts do not prove a live worker, sufficient intake capacity or successful domain work. Memory/sync adapters do not support shared queue monitoring; use `adapter.capabilities.shared` to decide whether that configured role has a shared-backend probe. Broadcast readiness does not prove visible cross-browser delivery. No checks means bootstrap/drain state only, not universal infrastructure health.

On SIGTERM/SIGINT call `DeploymentRuntime.beginDrain()` immediately so readiness/traffic eligibility fail and Svelar hooks reject new work. Let adapter-node drain active HTTP requests before disconnecting their database. Generated cleanup is attached to `sveltekit:shutdown`, after HTTP drain, and then stops background resources. Do not close the DB at the initial signal while a response still needs it. Independently supervise CLI worker/scheduler shutdown and configure their deadlines.

`SHUTDOWN_TIMEOUT` is finite; streams, WebSockets or long jobs exceeding it can be interrupted. Configure client reconnect/idempotency and test the application's own long-running requests. A Docker healthcheck marks a container unhealthy; Docker's restart policy does not by itself restart a still-running unhealthy process.

---

## GitHub Actions CI/CD

`npx svelar make:ci` generates `.github/workflows/deploy.yml` — a complete build, push, and SSH deploy pipeline.

### What it does

1. Builds production and administrative deployer targets on push/PR, using local SHA tags so fork PR builds do not need registry secrets.
2. Pushes only Git SHA release/deployer tags on push; no `latest` or automatic old-image pruning.
3. Serializes deployment workflows with `cancel-in-progress: false`.
4. Copies reviewed Compose/config/manifest/script files and a private environment transfer file to the host.
5. Requires `DEPLOY_COMPATIBLE_MIGRATIONS=true`, then invokes the administrative deployment script through Docker.

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

The generated workflow supplies `.env` through the `ENV_PROD` secret:

1. Store your entire production `.env` contents as the `ENV_PROD` GitHub Secret
2. It passes the secret through an environment variable, writes `.svelar-env` using `umask 077` and `printf`, then copies it over SSH.
3. Docker Compose reads it via `env_file: .env`

The remote step copies the transfer file to `.env` and removes the transfer file. Do not interpolate multiline secrets directly into shell source. Review secret rotation and compatibility for both retained releases. The workflow does not provision dependencies or bootstrap the deployment lock table; finish first adoption separately. `DEPLOY_COMPATIBLE_MIGRATIONS` is an approval variable, not automated schema compatibility analysis.

### Generated workflow

The authoritative workflow is emitted by `npx svelar make:ci`. Review the generated file rather than copying an older `compose up` pipeline. Its deployment operation is:

```bash
# These come from reviewed CI environment/secrets, not interpolated shell source:
test "$COMPATIBLE_MIGRATIONS" = true
printf '%s' "$DOCKER_TOKEN" | docker login -u "$DOCKER_USERNAME" --password-stdin
cd "$DEPLOY_PROJECT"
umask 077
cp .svelar-env .env
rm .svelar-env
docker pull "$DEPLOYER_IMAGE"
sh scripts/svelar-deploy.sh --compatible-migrations
```

Release/deployer images use Git SHA tags. The script runs the framework CLI from the administrative image, preserving the host project path for Docker bind mounts; host Node/npm is not required. Keep the previous release image and slot files for rollback. Do not cancel a running deploy or prune its retained resources blindly.

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

# 5. Provision infra, bootstrap migration 000049 and review readiness/cutover
# 6. Set DEPLOY_COMPATIBLE_MIGRATIONS=true only after compatibility review
# 7. Push to main to deploy the reviewed release
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
  build:
    context: .
    target: production
  restart: unless-stopped
  ports:
    - "${APP_PORT:-3000}:3000"
  env_file: .env
  environment:
    - NODE_ENV=production
    - ORIGIN=${APP_URL:-http://localhost:3000}
    - INTERNAL_APP_URL=http://app:3000
    - DB_HOST=pgbouncer
    - DB_PORT=6432
  volumes:
    - app_storage:/app/storage
  depends_on:
    pgbouncer:
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

PgBouncer is included automatically when using PostgreSQL. It sits between the app and the database, pooling connections to prevent exhaustion under load across web, worker, and scheduler containers.

Credentials are read from the `DATABASE_URL` environment variable in `docker-compose.yml` — the PgBouncer image auto-generates its auth file at startup. No static password files are committed to git.

```yaml
pgbouncer:
  image: edoburu/pgbouncer:v1.25.1-p0
  restart: unless-stopped
  environment:
    DATABASE_URL: postgres://${DB_USER:-svelar}:${DB_PASSWORD:-secret}@postgres:5432/${DB_NAME:-svelar}
    AUTH_TYPE: scram-sha-256
  volumes:
    - ./docker/pgbouncer/pgbouncer.ini:/etc/pgbouncer/pgbouncer.ini:ro
  depends_on:
    postgres:
      condition: service_healthy
  healthcheck:
    test: ["CMD-SHELL", "PGPASSWORD=${DB_PASSWORD:-secret} pg_isready -h 127.0.0.1 -p 6432 -U ${DB_USER:-svelar} -d ${DB_NAME:-svelar}"]
    interval: 10s
    timeout: 5s
    retries: 5
```

The app connects to `pgbouncer:6432` (not `postgres:5432`). This is set automatically in `docker-compose.yml` via `DB_HOST=pgbouncer` and `DB_PORT=6432`. Generated database config disables PostgreSQL prepared statements automatically when `DB_HOST=pgbouncer`; set `DB_PREPARE=false` explicitly when connecting to PgBouncer through a different hostname.

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
  command: redis-server --requirepass ${REDIS_PASSWORD:-svelarsecret} --save "" --appendonly yes --appendfsync everysec
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
  ports:
    - "${SOKETI_PORT:-5334}:6001"
  environment:
    SOKETI_DEFAULT_APP_ID: ${PUSHER_APP_ID}
    SOKETI_DEFAULT_APP_KEY: ${PUSHER_KEY}
    SOKETI_DEFAULT_APP_SECRET: ${PUSHER_SECRET}
    SOKETI_DEFAULT_APP_MAX_CONNS: "${SOKETI_MAX_CONNS:-1000}"
    SOKETI_DEFAULT_APP_ENABLE_CLIENT_MESSAGES: "true"
  healthcheck:
    test: ["CMD-SHELL", "node -e \"require('http').get('http://127.0.0.1:6001', r => process.exit(r.statusCode < 500 ? 0 : 1)).on('error', () => process.exit(1))\""]
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
    RUSTFS_ACCESS_KEY: ${RUSTFS_ACCESS_KEY:-svelar}
    RUSTFS_SECRET_KEY: ${RUSTFS_SECRET_KEY:-svelarsecret}
    RUSTFS_CONSOLE_ENABLE: "true"
    RUSTFS_ADDRESS: ":9000"
  command: /data
  volumes:
    - rustfs_data:/data
```

RustFS web console is available at `http://localhost:9001`.

### Meilisearch (Full-Text Search)

Meilisearch is included in the default `docker-compose.yml` generated by `make:docker`. Disable it with `npx svelar make:docker --no-meilisearch`:

```yaml
meilisearch:
  image: getmeili/meilisearch:v1.13
  restart: unless-stopped
  ports:
    - "${MEILI_PORT:-5333}:7700"
  environment:
    MEILI_MASTER_KEY: ${MEILI_MASTER_KEY:-svelar-meili-master-key}
    MEILI_ENV: production
    MEILI_DB_PATH: /meili_data
    MEILI_NO_ANALYTICS: "true"
  volumes:
    - meili_data:/meili_data
  healthcheck:
    test: ["CMD", "wget", "--no-verbose", "--spider", "http://127.0.0.1:7700/health"]
    interval: 10s
    timeout: 5s
    retries: 5
```

---

## Worker and Scheduler Containers

Generated Docker apps run long-lived daemons as separate Compose services:

| Service | Command | Purpose |
|---------|---------|---------|
| `app` | `node build/index.js` | SvelteKit production server |
| `worker` | `npx svelar queue:work --queue=default --concurrency=${QUEUE_WORKER_CONCURRENCY:-1} --grace-period=${QUEUE_WORKER_GRACE_PERIOD:-30}` | Long-lived queue job processor |
| `scheduler` | `npx svelar schedule:work` | Long-lived cron/runtime-request processor |

During start-first deployment, old and candidate background daemons briefly overlap. Register the same jobs/tasks and use durable task locks/domain idempotency. A running container alone is not proof that a worker registered or a schedule can execute. Runtime services without custom healthchecks have running-only startup coverage and produce a warning; supply a real application-specific healthcheck when role readiness is required.

For custom queues, add one worker service per queue:

```yaml
worker-emails:
  build:
    context: .
    target: production
  command: ["npx", "svelar", "queue:work", "--queue=emails", "--concurrency=${QUEUE_WORKER_CONCURRENCY:-1}"]
  env_file: .env
  depends_on:
    app:
      condition: service_healthy
```

For local development, run infrastructure in Docker and run daemons directly from source:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d redis pgbouncer
npm run dev:worker
npm run dev:scheduler
```

`scripts/svelar-dev-runtime.mjs` maps Docker service names to localhost and uses non-default host ports such as `PGBOUNCER_HOST_PORT=56432` and `REDIS_HOST_PORT=56379`, which avoids conflicts when several projects are running locally.

---

## Environment Variables Reference

### Application

| Variable | Default | Description |
|----------|---------|-------------|
| `NODE_ENV` | `production` | Node environment |
| `APP_PORT` | `3000` | Host port mapping (production) |
| `DEV_PORT` | `5173` | Host port mapping (development) |
| `APP_URL` | `http://localhost:3000` | Public URL used by Compose to set `ORIGIN` |
| `ORIGIN` | `${APP_URL}` | SvelteKit adapter-node origin for CSRF-safe production requests |
| `INTERNAL_APP_URL` | `http://app:3000` | Internal Docker URL for server-side callbacks, scheduler broadcasts, and service-to-app requests |
| `APP_KEY` | — | Secret key for session encryption |
| `INTERNAL_SECRET` | — | Secret for internal API bridge (scheduler broadcasts) |
| `DOCKER_IMAGE` | package.json name | Legacy direct Compose image prefix; not `prod:deploy --image` |
| `DEPLOY_IMAGE` | none | Explicit production release tag/digest for the administrative script |
| `DEPLOYER_IMAGE` | none | Matching administrative release image; has Docker CLI/Compose |
| `SHUTDOWN_TIMEOUT` | slot drain timeout minus one | adapter-node HTTP drain seconds; cleanup after HTTP drain |
| `SVELAR_DEPLOY_SLOT` / `SVELAR_DEPLOY_TRAFFIC_FILE` | set by orchestrator | Slot identity and read-only eligibility file; do not accept browser overrides |

### Database

| Variable | Default | Description |
|----------|---------|-------------|
| `DB_HOST` | `pgbouncer` | PgBouncer hostname (auto-set in Docker for PostgreSQL) |
| `DB_PORT` | `6432` | PgBouncer port (app connects here, not directly to postgres) |
| `DB_NAME` | `svelar` | Database name |
| `DB_USER` | `svelar` | Database user |
| `DB_PASSWORD` | `secret` | Database password |
| `DB_PREPARE` | `false` behind PgBouncer | Set to `false` for PgBouncer transaction pooling |
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
| `SOKETI_PORT` | `5334` | Host port mapping for browser WebSocket clients |
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
| `RUSTFS_ACCESS_KEY` | `svelar` | RustFS access key |
| `RUSTFS_SECRET_KEY` | `svelarsecret` | RustFS secret key |

### Search (Meilisearch)

| Variable | Default | Description |
|----------|---------|-------------|
| `MEILISEARCH_HOST` | `http://meilisearch:7700` | Meilisearch host URL (auto-set in Docker) |
| `MEILISEARCH_KEY` | `svelar-meili-master-key` | Meilisearch API key (must match `MEILI_MASTER_KEY`) |
| `MEILI_MASTER_KEY` | `svelar-meili-master-key` | Meilisearch master key (container config) |
| `MEILI_PORT` | `5333` | Host port mapping for local dashboard/API access |

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

Traefik automatically detects new app containers and distributes traffic across them.

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

Multiple schedulers require configured persistent runtime/locks and task concurrency policy; do not infer no-overlap from process count. Tasks without an applicable distributed policy can still overlap. The generated single-host blue/green plan temporarily overlaps old/new schedulers and does not implement an arbitrary horizontally scaled topology.

---

## Blue-Green Deployments with Docker Compose

`prod:deploy` implements a bounded **single Docker-host** start-first plan. A stable Caddy gateway keeps the public port while separate blue/green runtime projects share existing infrastructure. It is not multi-host orchestration, an autoscaler or a guarantee of uninterrupted arbitrary streams.

### First Adoption and Migration Foundation

Before deployment:

1. Review generated Docker/config files; generators preserve existing files unless explicitly forced.
2. Provision the required base network, infrastructure services and named storage volumes. Do not start legacy app/worker/scheduler services on the gateway port.
3. Under an explicit exclusive maintenance/bootstrap procedure, run core migrations including `000049_create_deployment_locks_table` against the intended database. A reviewed ordinary `npx svelar migrate` bootstrap can do this; `deploy:migrate` cannot create its own missing foundation.
4. Wire ready/traffic routes and bootstrap/drain lifecycle in the actual release. For historical apps, review `update --dry-run` and lifecycle changes before deployment.
5. Review forward migrations against both old and candidate images using expand/contract changes, and test rollback against the evolved schema.

A release one-shot runs `deploy:migrate --check` before candidate startup, then locked forward `deploy:migrate`. Missing migration 49 fails before changing the active service. No runtime/web helper creates tables. The lock is keyed by database connection and name, with committed exact ownership; migration DDL is not placed inside that ownership transaction. `--connection=<name>` is available for an explicitly configured named database.

An already-running legacy base app is rejected without stopping/rebinding it. Its **first gateway adoption requires a planned cutover**; the command does not claim zero-downtime migration of an arbitrary legacy topology.

### Configuration and Commands

`make:docker` emits `svelar.deploy.json`:

```json
{
  "version": 1,
  "strategy": "blue-green",
  "gatewayImage": "caddy:2.11.7-alpine",
  "readinessPath": "/api/ready",
  "trafficPath": "/api/traffic",
  "smokePath": "/api/health",
  "readinessTimeout": 60,
  "drainTimeout": 45,
  "network": "default",
  "runtimeServices": ["app", "worker", "scheduler"]
}
```

Timeouts use seconds: readiness `1..600`, drain `2..600`. Probe paths must be local absolute paths without query/fragment/redirects. Readiness must return `data.ready === true`; smoke must return 200. Choose a meaningful app-owned smoke route when process liveness is insufficient.

The bounded plan requires one existing resolved network, existing named volumes, no fixed runtime `container_name`, no extra runtime networks or published background ports, and exactly one app HTTP port targeting container 3000. Unsupported topology is rejected, not silently dropped. Include every intended worker service in `runtimeServices` and give roles a real healthcheck if running-only startup coverage is insufficient.

```bash
# Installed CLI on an administrative host:
npx svelar prod:deploy --image=registry.example.com/myapp:release-123 --compatible-migrations

# Docker-only host, using matching reviewed release targets:
export DEPLOY_IMAGE=registry.example.com/myapp:release-123
export DEPLOYER_IMAGE=registry.example.com/myapp:release-123-deployer
sh scripts/svelar-deploy.sh --compatible-migrations

# Prior retained runtime only; does not roll back schema:
npx svelar prod:deploy --rollback
# Docker-only equivalent with the administrative image environment still set:
sh scripts/svelar-deploy.sh --rollback
```

`--no-pull` permits an already-local explicit release image. `--no-migrate` requires a separately reviewed migration process. `--service` and `--no-wait` cannot bypass release/readiness boundaries. The administrative script needs Docker socket privileges; never expose it as a web endpoint.

### Promotion, Failure and Recovery

The candidate uses the inspected immutable image ID, the original environment/commands and external storage/network, without sharing the legacy `app` DNS alias. It starts before old runtime shutdown, passes local readiness/smoke and proves its slot identity. The fixed gateway has both slot upstreams and checks `/api/traffic`; promotion changes the read-only eligibility file, **not gateway config reload**. The orchestrator witnesses the candidate through the public gateway, makes it sole eligible, and waits for the active-health settling window before stopping the old slot.

Once gateway smoke succeeds, release state is committed and the old slot receives bounded SIGTERM drain. Its image/container/config remain retained for rollback. Candidate readiness failure leaves the current route unchanged; a precommit post-switch smoke failure attempts restoration of the old eligibility. If restoration fails, both runtimes and journal are retained for operator reconciliation. If drain fails after state commit, the CLI reports that the new release **is already active**; do not treat that as permission to repeat an unknown deployment.

State and Compose files live in `.svelar/deployment/` (private directory 0700, files 0600) and can contain app environment values. The tiny traffic subdirectory/file is readable by the nonroot app through a readonly bind mount and contains only slot names. Keep deployment state and environment transfer files out of Git/images.

Deployment mutexes/journals and database migration ownership **do not automatically expire**. A killed process can leave an orphan. Inspect the saved active slot, containers, gateway eligibility and database lock, independently verify the old process is dead, and reconcile deliberately; never use a guessed age to steal a DDL lock. Public server-safe recovery APIs are:

```typescript
import { MigrationLock } from '@beeblock/svelar/deployment';

const options = { connectionName: 'primary', name: 'migrations' };
const lock = await MigrationLock.inspect(options);
// Only after independently proving the prior owner has stopped:
if (lock?.owner) await MigrationLock.release(lock.owner, options);
```

`MigrationLock.check(options)` verifies the installed foundation/unowned lock. `MigrationLock.run(callback, options)` acquires committed ownership and releases the exact token, preserving operation errors; it rejects execution inside an existing DB transaction. Busy/missing foundation use `MigrationLockBusyError` / `MigrationLockFoundationError`. This barrel exports runtime/controller/lock/types, not CLI commands.

Database rollback is deliberately absent. Old and new app/worker/scheduler versions can overlap, so schema, serialized job classes and task policies must remain compatible. Rollback cannot undo external side effects. Retain compatible images and backups; define operator cleanup/retention separately.

### Traffic Proof and Limits

The deployment slice passed **36 focused unit/CLI tests** plus **4 native Docker/Caddy cases**, with strict declaration emission. Native proofs used different immutable Node images containing the actual `DeploymentRuntime`, an isolated random host port, Caddy 2.11.7, continuous HTTP requests and a request held on the old backend until its real SIGTERM showed one in-flight request. That request completed, the old process exited zero, promotion/explicit rollback kept the same public port, and the request loop recorded zero dropped/non-200 ordinary requests.

Other cases proved never-ready candidate protection, automatic route restoration after a real gateway smoke failure, and refusal to touch a running legacy container. Run the isolated native suite with:

```bash
# From packages/svelar; requires Docker, Node/Caddy base images and esbuild:
SVELAR_TEST_DEPLOY_DOCKER=1 ../../node_modules/.bin/vitest run tests/deployment-traffic.test.ts
```

This is a real HTTP/runtime/gateway proof, **not** certification of a generated SvelteKit app, worker domain readiness, TLS, multi-host failover, SSE/WebSocket continuity or an arbitrary production workload. Validate the packed/generated app, dependency probes, background healthchecks, active traffic and long-request/stream behavior before claiming readiness or availability. Application certification is separate from this focused source gate.

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

Swarm has its own start-first/rollback primitives. The examples above are operator-managed alternatives, not generated `prod:deploy` support or proof of zero downtime. Verify readiness, schema compatibility, traffic switching, long-lived streams and drain in that environment before making an availability claim.

---

## Database Management

### Migrations in Docker

```bash
# Development
docker compose -f docker-compose.yml -f docker-compose.dev.yml exec app npx svelar migrate

# Adopted blue/green production (run through the reviewed active slot, example blue)
docker compose -f .svelar/deployment/blue.compose.json run --rm --no-deps app_blue npx svelar deploy:migrate --check
docker compose -f .svelar/deployment/blue.compose.json run --rm --no-deps app_blue npx svelar deploy:migrate

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

# Adopted deployment: inspect state.json first, then target that slot (example blue)
docker compose -f .svelar/deployment/blue.compose.json logs -f app_blue worker_blue scheduler_blue
docker compose -f .svelar/deployment/gateway.compose.json logs -f gateway
```

### Container Health

```bash
# Check all container health
docker compose ps

# Inspect health check details
docker inspect --format='{{json .State.Health}}' <container_id> | jq
```

### Runtime Monitoring

```bash
docker compose ps                      # Container status and health
docker compose stats                   # CPU and memory
npx svelar dev:logs --service=worker   # Worker logs in development
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
RUSTFS_SECRET_KEY=<strong-password>
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

# Check runtime services (production)
docker compose ps app worker scheduler
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
docker compose ps worker

# Check queue stats
docker compose logs -f worker
```

### Out of Disk Space

```bash
docker system df -v
```

Do not run blanket `--volumes` or old-image pruning on a deployment host. Named volumes contain authoritative data and retained release images support rollback. Inspect ownership, backups, active state and the retained previous release before removing specific unused resources.

### Scheduler Running Duplicate Tasks

```bash
# Verify only ONE scheduler service is running
docker compose ps scheduler

# Check scheduler_locks table
docker compose exec postgres psql -U svelar -c "SELECT * FROM scheduler_locks;"

```

Use the scheduler's public runtime/lock contracts and current timestamp units when diagnosing overlap. Never delete a lock merely because a process looks quiet; verify ownership and that the task has stopped. See [Scheduler](./10-scheduler.md).
