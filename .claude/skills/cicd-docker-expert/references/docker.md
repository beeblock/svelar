# Docker Deep Dive

Advanced Docker patterns, optimization techniques, and security best practices.

## Table of Contents

- [Multi-Stage Builds](#multi-stage-builds)
- [Layer Optimization](#layer-optimization)
- [Security Hardening](#security-hardening)
- [Health Checks](#health-checks)
- [Image Scanning](#image-scanning)
- [BuildKit Features](#buildkit-features)
- [Debugging Containers](#debugging-containers)
- [Performance Tuning](#performance-tuning)

## Multi-Stage Builds

### Node.js Application

```dockerfile
# syntax=docker/dockerfile:1

# Stage 1: Dependencies
FROM node:20-alpine AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --only=production && \
    npm cache clean --force

# Stage 2: Build
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && \
    npm prune --production

# Stage 3: Production
FROM node:20-alpine AS production
ENV NODE_ENV=production

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

WORKDIR /app

# Copy only what's needed
COPY --from=builder --chown=nodejs:nodejs /app/dist ./dist
COPY --from=builder --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nodejs:nodejs /app/package.json ./

USER nodejs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node healthcheck.js

CMD ["node", "dist/index.js"]
```

### Go Application

```dockerfile
# syntax=docker/dockerfile:1

# Stage 1: Build
FROM golang:1.22-alpine AS builder

# Install build dependencies
RUN apk add --no-cache git ca-certificates tzdata

WORKDIR /build

# Cache dependencies
COPY go.mod go.sum ./
RUN go mod download && go mod verify

# Build application
COPY . .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build \
    -ldflags='-w -s -extldflags "-static"' \
    -a -installsuffix cgo \
    -o /app/server \
    ./cmd/server

# Stage 2: Production
FROM scratch

# Copy SSL certs and timezone data from builder
COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
COPY --from=builder /usr/share/zoneinfo /usr/share/zoneinfo

# Copy binary
COPY --from=builder /app/server /server

# Non-root user (scratch doesn't have adduser)
USER 65534:65534

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD ["/server", "healthcheck"]

ENTRYPOINT ["/server"]
```

### Python Application

```dockerfile
# syntax=docker/dockerfile:1

# Stage 1: Build
FROM python:3.12-slim AS builder

WORKDIR /app

# Install build dependencies
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    gcc \
    python3-dev && \
    rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt .
RUN pip wheel --no-cache-dir --no-deps --wheel-dir /app/wheels -r requirements.txt

# Stage 2: Production
FROM python:3.12-slim AS production

# Create non-root user
RUN groupadd -g 1001 appgroup && \
    useradd -r -u 1001 -g appgroup appuser

WORKDIR /app

# Install runtime dependencies
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    curl && \
    rm -rf /var/lib/apt/lists/*

# Copy and install wheels
COPY --from=builder /app/wheels /wheels
COPY --from=builder /app/requirements.txt .
RUN pip install --no-cache /wheels/*

# Copy application
COPY --chown=appuser:appgroup . .

USER appuser

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:8000/health || exit 1

CMD ["gunicorn", "--bind", "0.0.0.0:8000", "--workers", "4", "app:app"]
```

### PHP Application (Laravel)

```dockerfile
# syntax=docker/dockerfile:1

# Stage 1: Composer dependencies
FROM composer:2 AS composer

WORKDIR /app

COPY composer.json composer.lock ./
RUN composer install \
    --no-dev \
    --no-scripts \
    --no-autoloader \
    --prefer-dist

COPY . .
RUN composer dump-autoload --optimize --classmap-authoritative

# Stage 2: Frontend build
FROM node:20-alpine AS frontend

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# Stage 3: Production
FROM php:8.3-fpm-alpine AS production

# Install PHP extensions
RUN apk add --no-cache \
    nginx \
    supervisor \
    && docker-php-ext-install \
    pdo_mysql \
    opcache \
    pcntl

# Create non-root user
RUN addgroup -g 1001 -S laravel && \
    adduser -S laravel -u 1001 -G laravel

# Configure PHP-FPM
COPY docker/php/php.ini /usr/local/etc/php/conf.d/custom.ini
COPY docker/php/www.conf /usr/local/etc/php-fpm.d/www.conf

# Configure Nginx
COPY docker/nginx/nginx.conf /etc/nginx/nginx.conf
COPY docker/nginx/default.conf /etc/nginx/http.d/default.conf

# Configure Supervisor
COPY docker/supervisor/supervisord.conf /etc/supervisord.conf

WORKDIR /var/www/html

# Copy application
COPY --from=composer --chown=laravel:laravel /app ./
COPY --from=frontend --chown=laravel:laravel /app/public/build ./public/build

# Set permissions
RUN chown -R laravel:laravel \
    /var/www/html/storage \
    /var/www/html/bootstrap/cache

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost/health || exit 1

CMD ["/usr/bin/supervisord", "-c", "/etc/supervisord.conf"]
```

## Layer Optimization

### Order Matters

```dockerfile
# ❌ BAD - Changes to code invalidate dependency cache
FROM node:20-alpine
WORKDIR /app
COPY . .
RUN npm install
RUN npm run build

# ✅ GOOD - Dependencies cached separately
FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build
```

### Combine RUN Commands

```dockerfile
# ❌ BAD - Creates multiple layers
FROM ubuntu:22.04
RUN apt-get update
RUN apt-get install -y curl
RUN apt-get install -y git
RUN apt-get clean
RUN rm -rf /var/lib/apt/lists/*

# ✅ GOOD - Single layer, cleaned up
FROM ubuntu:22.04
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        curl \
        git && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*
```

### Use .dockerignore

```dockerignore
# .dockerignore
# Version control
.git
.gitignore
.gitattributes

# Dependencies
node_modules
vendor
bower_components

# Build artifacts
dist
build
*.log
npm-debug.log*

# Testing
coverage
.nyc_output
*.test.js

# IDE
.vscode
.idea
*.swp
*.swo

# OS
.DS_Store
Thumbs.db

# Docker
Dockerfile
docker-compose.yml
.dockerignore

# CI/CD
.github
.gitlab-ci.yml
.travis.yml

# Documentation
*.md
docs

# Environment
.env
.env.local
.env.*.local
```

### Leverage Build Cache

```dockerfile
# Use BuildKit cache mounts for package managers
FROM node:20-alpine

WORKDIR /app

# Cache npm packages
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci

# Cache build output
COPY . .
RUN --mount=type=cache,target=/app/.next/cache \
    npm run build
```

## Security Hardening

### Non-Root User

```dockerfile
# Alpine
RUN addgroup -g 1001 -S appgroup && \
    adduser -S appuser -u 1001 -G appgroup

# Debian/Ubuntu
RUN groupadd -g 1001 appgroup && \
    useradd -r -u 1001 -g appgroup appuser

# Use the user
USER appuser

# If you need to run as root temporarily
USER root
RUN chown -R appuser:appgroup /app
USER appuser
```

### Read-Only Root Filesystem

```dockerfile
# In Dockerfile - prepare for read-only
FROM nginx:alpine
COPY nginx.conf /etc/nginx/nginx.conf
COPY public/ /usr/share/nginx/html/

# Runtime (docker-compose.yml or docker run)
services:
  web:
    image: myapp:latest
    read_only: true
    tmpfs:
      - /tmp
      - /var/run
      - /var/cache/nginx
```

### Drop Capabilities

```yaml
# docker-compose.yml
services:
  app:
    image: myapp:latest
    cap_drop:
      - ALL
    cap_add:
      - NET_BIND_SERVICE  # Only if needed for ports < 1024
    security_opt:
      - no-new-privileges:true
```

### Minimal Base Images

```dockerfile
# ✅ EXCELLENT - Distroless (2-20 MB)
FROM gcr.io/distroless/nodejs20-debian12
COPY --from=builder /app /app
WORKDIR /app
CMD ["index.js"]

# ✅ GOOD - Alpine (5-15 MB base)
FROM node:20-alpine
# ...

# ⚠️ ACCEPTABLE - Slim (50-100 MB base)
FROM node:20-slim
# ...

# ❌ AVOID - Full (200+ MB base)
FROM node:20
# ...
```

### Secret Management

```dockerfile
# ❌ NEVER DO THIS
ENV API_KEY=secret123
RUN echo "API_KEY=secret123" > .env

# ✅ Use BuildKit secrets
RUN --mount=type=secret,id=api_key \
    API_KEY=$(cat /run/secrets/api_key) \
    ./configure.sh

# Build with:
# docker build --secret id=api_key,src=./api_key.txt .

# ✅ Runtime secrets (Docker Compose)
services:
  app:
    image: myapp:latest
    secrets:
      - api_key

secrets:
  api_key:
    file: ./api_key.txt
```

## Health Checks

### HTTP Health Check

```dockerfile
# Using curl
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

# Using wget
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1
```

### Custom Health Check Script

```dockerfile
# healthcheck.js
const http = require('http');

const options = {
  host: 'localhost',
  port: 3000,
  path: '/health',
  timeout: 2000
};

const request = http.request(options, (res) => {
  console.log(`Health check status: ${res.statusCode}`);
  process.exit(res.statusCode === 200 ? 0 : 1);
});

request.on('error', (err) => {
  console.error('Health check failed:', err);
  process.exit(1);
});

request.end();

# Dockerfile
COPY healthcheck.js /app/
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node /app/healthcheck.js
```

### Health Check Endpoint

```javascript
// Express.js example
app.get('/health', async (req, res) => {
  const health = {
    uptime: process.uptime(),
    timestamp: Date.now(),
    status: 'healthy',
    checks: {
      database: await checkDatabase(),
      redis: await checkRedis(),
      s3: await checkS3(),
    }
  };

  // Check if any dependency is unhealthy
  const isUnhealthy = Object.values(health.checks).some(
    check => !check.healthy
  );

  const statusCode = isUnhealthy ? 503 : 200;
  res.status(statusCode).json(health);
});

async function checkDatabase() {
  try {
    await db.query('SELECT 1');
    return { healthy: true, latency: 10 };
  } catch (error) {
    return { healthy: false, error: error.message };
  }
}
```

## Image Scanning

### Trivy (Recommended)

```dockerfile
# Scan during build
FROM aquasec/trivy:latest AS scanner
COPY --from=builder /app /scan
RUN trivy fs --exit-code 1 --severity CRITICAL,HIGH --no-progress /scan

# Or scan in CI
- name: Run Trivy vulnerability scanner
  uses: aquasecurity/trivy-action@master
  with:
    image-ref: myapp:${{ github.sha }}
    format: 'sarif'
    output: 'trivy-results.sarif'
    severity: 'CRITICAL,HIGH'
    exit-code: '1'
```

### Snyk

```yaml
# GitHub Actions
- name: Run Snyk to check for vulnerabilities
  uses: snyk/actions/docker@master
  env:
    SNYK_TOKEN: ${{ secrets.SNYK_TOKEN }}
  with:
    image: myapp:latest
    args: --severity-threshold=high
```

### Docker Scout

```bash
# Enable Docker Scout
docker scout cves myapp:latest

# Compare to production
docker scout compare --to myapp:production myapp:latest

# Only show critical vulnerabilities
docker scout cves --only-severity critical,high myapp:latest
```

## BuildKit Features

### Enable BuildKit

```bash
# Environment variable
export DOCKER_BUILDKIT=1
docker build .

# Or in docker-compose.yml
export COMPOSE_DOCKER_CLI_BUILD=1
export DOCKER_BUILDKIT=1

# Or globally in /etc/docker/daemon.json
{
  "features": {
    "buildkit": true
  }
}
```

### Cache Mounts

```dockerfile
# NPM cache
RUN --mount=type=cache,target=/root/.npm \
    npm ci

# Go build cache
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    go build -o /app/server

# Apt cache
RUN --mount=type=cache,target=/var/cache/apt \
    --mount=type=cache,target=/var/lib/apt \
    apt-get update && \
    apt-get install -y package
```

### Bind Mounts

```dockerfile
# Mount source code without copying
RUN --mount=type=bind,source=.,target=/src \
    cd /src && go build -o /app/server
```

### SSH Mounts

```dockerfile
# Clone private repository
RUN --mount=type=ssh \
    git clone git@github.com:myorg/private-repo.git

# Build with:
# docker build --ssh default .
```

### Multi-Platform Builds

```dockerfile
# Use platform-specific base images
FROM --platform=$BUILDPLATFORM golang:1.22-alpine AS builder
ARG TARGETPLATFORM
ARG TARGETOS
ARG TARGETARCH

RUN GOOS=$TARGETOS GOARCH=$TARGETARCH go build -o /app/server

FROM --platform=$TARGETPLATFORM alpine:latest
COPY --from=builder /app/server /server
```

```bash
# Build for multiple platforms
docker buildx build \
  --platform linux/amd64,linux/arm64,linux/arm/v7 \
  -t myapp:latest \
  --push \
  .
```

## Debugging Containers

### Interactive Shell

```bash
# Run container with shell
docker run -it --rm myapp:latest /bin/sh

# Exec into running container
docker exec -it container-name /bin/sh

# For distroless images (no shell)
docker run -it --rm --entrypoint /bin/sh myapp:latest

# Debug distroless with separate debug image
FROM gcr.io/distroless/nodejs20-debian12:debug
```

### Inspect Container

```bash
# View logs
docker logs -f container-name

# View last 100 lines
docker logs --tail 100 container-name

# View logs with timestamps
docker logs -t container-name

# Inspect container details
docker inspect container-name

# View container processes
docker top container-name

# View resource usage
docker stats container-name

# View file changes
docker diff container-name
```

### Debug Tools

```dockerfile
# Add debug tools in development stage
FROM node:20-alpine AS development
RUN apk add --no-cache \
    curl \
    netcat-openbsd \
    tcpdump \
    strace \
    bind-tools

# Production stage without debug tools
FROM node:20-alpine AS production
# ... minimal image
```

## Performance Tuning

### Optimize Image Size

```dockerfile
# Before optimization (500 MB)
FROM node:20
WORKDIR /app
COPY . .
RUN npm install
CMD ["node", "index.js"]

# After optimization (50 MB)
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .

FROM node:20-alpine
RUN addgroup -g 1001 nodejs && adduser -S nodejs -u 1001
WORKDIR /app
COPY --from=builder --chown=nodejs:nodejs /app .
USER nodejs
CMD ["node", "index.js"]
```

### Parallel Builds

```dockerfile
# Use parallel make
RUN make -j$(nproc)

# Parallel npm install
RUN npm ci --prefer-offline --no-audit
```

### Layer Caching Strategy

```dockerfile
# 1. Base image (rarely changes)
FROM node:20-alpine AS base
RUN apk add --no-cache dumb-init

# 2. Dependencies (changes occasionally)
FROM base AS dependencies
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

# 3. Build (changes with code)
FROM base AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# 4. Production (final stage)
FROM base AS production
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
CMD ["dumb-init", "node", "dist/index.js"]
```

### Reduce Build Time

```dockerfile
# Use .dockerignore aggressively
# Pin base image versions
# Use BuildKit cache mounts
# Parallelize independent stages
# Use smaller base images

# Example: Parallel stage builds
FROM node:20-alpine AS frontend
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM node:20-alpine AS backend
WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm ci
COPY backend/ ./
RUN npm run build

FROM node:20-alpine AS production
COPY --from=frontend /app/frontend/dist /app/public
COPY --from=backend /app/backend/dist /app/dist
```

## Best Practices Checklist

- [ ] Use multi-stage builds
- [ ] Start with minimal base images (Alpine, distroless)
- [ ] Run as non-root user
- [ ] Implement health checks
- [ ] Use .dockerignore
- [ ] Pin all versions (base images, dependencies)
- [ ] Scan for vulnerabilities
- [ ] Optimize layer caching
- [ ] Set resource limits
- [ ] Use BuildKit features
- [ ] Add metadata labels
- [ ] Document the Dockerfile
- [ ] Test in production-like environment
- [ ] Monitor image size
- [ ] Implement proper logging
- [ ] Handle signals gracefully (SIGTERM)
- [ ] Use secrets management
- [ ] Version your images properly
- [ ] Keep images up to date
- [ ] Use immutable tags for production

## Common Pitfalls to Avoid

1. **Using :latest in production** - Always use specific versions
2. **Running as root** - Create and use non-root user
3. **Storing secrets in layers** - Use secrets management
4. **Large image sizes** - Use multi-stage builds and minimal base images
5. **No health checks** - Always implement health checks
6. **Ignoring security scanning** - Scan all images for vulnerabilities
7. **Not using .dockerignore** - Exclude unnecessary files
8. **Installing unnecessary packages** - Only install what's needed
9. **Not cleaning up in same layer** - Clean caches in the same RUN command
10. **Copying entire context** - Copy only what's needed
