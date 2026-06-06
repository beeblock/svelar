# Docker Compose Deep Dive

Comprehensive guide to Docker Compose for multi-container applications.

## Table of Contents

- [Compose File Structure](#compose-file-structure)
- [Service Configuration](#service-configuration)
- [Networking](#networking)
- [Volumes](#volumes)
- [Environment Variables](#environment-variables)
- [Development vs Production](#development-vs-production)
- [Profiles](#profiles)
- [Dependencies](#dependencies)
- [Advanced Patterns](#advanced-patterns)

## Compose File Structure

### Basic Structure

```yaml
# docker-compose.yml
version: '3.8'  # Optional in recent versions

services:
  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=development

  database:
    image: postgres:16-alpine
    environment:
      - POSTGRES_DB=myapp
      - POSTGRES_PASSWORD_FILE=/run/secrets/db_password
    volumes:
      - postgres_data:/var/lib/postgresql/data
    secrets:
      - db_password

volumes:
  postgres_data:

secrets:
  db_password:
    file: ./secrets/db_password.txt

networks:
  default:
    name: myapp_network
```

### Service Definition

```yaml
services:
  app:
    # Image or build
    image: myapp:latest
    # Or build from source
    build:
      context: .
      dockerfile: Dockerfile
      target: production
      args:
        - NODE_ENV=production
      cache_from:
        - myapp:latest

    # Container name
    container_name: myapp_container

    # Restart policy
    restart: unless-stopped

    # Resource limits
    deploy:
      resources:
        limits:
          cpus: '0.5'
          memory: 512M
        reservations:
          cpus: '0.25'
          memory: 256M

    # Ports
    ports:
      - "3000:3000"  # host:container
      - "127.0.0.1:3001:3001"  # bind to specific IP

    # Expose (without publishing to host)
    expose:
      - "3000"

    # Environment
    environment:
      NODE_ENV: production
      DATABASE_URL: postgres://postgres:password@database:5432/myapp

    # Environment file
    env_file:
      - .env
      - .env.production

    # Volumes
    volumes:
      - ./src:/app/src:ro  # read-only
      - app_data:/app/data
      - type: tmpfs
        target: /tmp

    # Networks
    networks:
      - frontend
      - backend

    # Dependencies
    depends_on:
      database:
        condition: service_healthy

    # Health check
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 3s
      retries: 3
      start_period: 40s

    # Command override
    command: npm start

    # Entrypoint override
    entrypoint: /app/entrypoint.sh

    # User
    user: "1001:1001"

    # Working directory
    working_dir: /app

    # Labels
    labels:
      com.example.description: "My application"
      com.example.version: "1.0.0"

    # Logging
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"

    # Security options
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
    cap_add:
      - NET_BIND_SERVICE

    # Read-only root filesystem
    read_only: true
    tmpfs:
      - /tmp
      - /var/run
```

## Service Configuration

### Multi-Stage Build

```yaml
services:
  app:
    build:
      context: .
      dockerfile: Dockerfile
      target: production
      args:
        NODE_ENV: production
        BUILD_DATE: ${BUILD_DATE:-unknown}
        VERSION: ${VERSION:-latest}
      labels:
        com.example.version: ${VERSION:-latest}
      cache_from:
        - myapp:latest
        - myapp:cache
      shm_size: '2gb'
```

### Health Checks

```yaml
services:
  database:
    image: postgres:16-alpine
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 10s

  redis:
    image: redis:7-alpine
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 3s
      retries: 3

  app:
    image: myapp:latest
    depends_on:
      database:
        condition: service_healthy
      redis:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 3s
      retries: 3
      start_period: 40s
```

### Resource Limits

```yaml
services:
  app:
    image: myapp:latest
    deploy:
      resources:
        limits:
          cpus: '1'
          memory: 1G
          pids: 100
        reservations:
          cpus: '0.5'
          memory: 512M
      restart_policy:
        condition: on-failure
        delay: 5s
        max_attempts: 3
        window: 120s

  # Alternative syntax for Docker Compose (not Swarm)
  database:
    image: postgres:16-alpine
    mem_limit: 1g
    mem_reservation: 512m
    cpus: 0.5
    pids_limit: 100
```

## Networking

### Multiple Networks

```yaml
networks:
  frontend:
    driver: bridge
  backend:
    driver: bridge
    internal: true  # Not accessible from outside

services:
  nginx:
    image: nginx:alpine
    networks:
      - frontend
    ports:
      - "80:80"

  app:
    image: myapp:latest
    networks:
      - frontend
      - backend

  database:
    image: postgres:16-alpine
    networks:
      - backend  # Only accessible from app
```

### Custom Network Configuration

```yaml
networks:
  mynetwork:
    driver: bridge
    driver_opts:
      com.docker.network.bridge.name: br-myapp
    ipam:
      driver: default
      config:
        - subnet: 172.28.0.0/16
          gateway: 172.28.0.1

services:
  app:
    image: myapp:latest
    networks:
      mynetwork:
        ipv4_address: 172.28.0.10
```

### Network Aliases

```yaml
services:
  app:
    image: myapp:latest
    networks:
      backend:
        aliases:
          - api
          - api.internal
          - app.backend

  database:
    image: postgres:16-alpine
    networks:
      backend:
        aliases:
          - postgres
          - db
```

### External Networks

```yaml
networks:
  shared_network:
    external: true
    name: my_existing_network

services:
  app:
    image: myapp:latest
    networks:
      - shared_network
```

## Volumes

### Named Volumes

```yaml
volumes:
  postgres_data:
    driver: local
  redis_data:
    driver: local
  uploads:
    driver: local
    driver_opts:
      type: none
      o: bind
      device: /mnt/uploads

services:
  database:
    image: postgres:16-alpine
    volumes:
      - postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    volumes:
      - redis_data:/data

  app:
    image: myapp:latest
    volumes:
      - uploads:/app/uploads
```

### Bind Mounts

```yaml
services:
  app:
    image: myapp:latest
    volumes:
      # Bind mount (development)
      - ./src:/app/src:ro  # read-only
      - ./config:/app/config

      # Named volume (data)
      - app_data:/app/data

      # tmpfs (temporary)
      - type: tmpfs
        target: /tmp
        tmpfs:
          size: 100000000  # 100MB
```

### Volume Configuration

```yaml
volumes:
  postgres_data:
    driver: local
    driver_opts:
      type: nfs
      o: addr=10.0.0.1,rw
      device: ":/path/to/dir"

  backup:
    driver: local
    driver_opts:
      type: none
      o: bind
      device: /mnt/backup
```

### External Volumes

```yaml
volumes:
  shared_data:
    external: true
    name: my_existing_volume

services:
  app:
    image: myapp:latest
    volumes:
      - shared_data:/app/data
```

## Environment Variables

### .env File

```bash
# .env
COMPOSE_PROJECT_NAME=myapp
NODE_ENV=development
DATABASE_URL=postgres://postgres:password@database:5432/myapp
REDIS_URL=redis://redis:6379
VERSION=1.0.0
```

### Environment Variable Precedence

```yaml
# 1. Compose file environment section (highest priority)
services:
  app:
    environment:
      - NODE_ENV=production

# 2. Shell environment variables
# $ export NODE_ENV=staging

# 3. env_file
services:
  app:
    env_file:
      - .env
      - .env.local  # Override .env

# 4. Dockerfile ENV (lowest priority)
```

### Variable Substitution

```yaml
services:
  app:
    image: myapp:${VERSION:-latest}
    environment:
      - DATABASE_URL=${DATABASE_URL}
      - API_KEY=${API_KEY:?API_KEY not set}  # Required
      - PORT=${PORT:-3000}  # Default value
    ports:
      - "${PORT:-3000}:3000"
```

### Secrets

```yaml
secrets:
  db_password:
    file: ./secrets/db_password.txt
  api_key:
    external: true  # Already created in Docker

services:
  app:
    image: myapp:latest
    secrets:
      - db_password
      - api_key
    environment:
      - DB_PASSWORD_FILE=/run/secrets/db_password
      - API_KEY_FILE=/run/secrets/api_key
```

## Development vs Production

### Base Configuration

```yaml
# docker-compose.yml (base)
services:
  app:
    build:
      context: .
      dockerfile: Dockerfile
      target: ${BUILD_TARGET:-development}
    environment:
      - NODE_ENV=${NODE_ENV:-development}
    volumes:
      - ./src:/app/src
    networks:
      - app_network

  database:
    image: postgres:16-alpine
    environment:
      - POSTGRES_DB=myapp
      - POSTGRES_PASSWORD=password
    networks:
      - app_network

networks:
  app_network:
```

### Development Overrides

```yaml
# docker-compose.override.yml (automatically loaded)
services:
  app:
    build:
      target: development
    ports:
      - "3000:3000"
      - "9229:9229"  # Debug port
    environment:
      - NODE_ENV=development
      - DEBUG=*
    volumes:
      - ./src:/app/src  # Hot reload
      - /app/node_modules  # Prevent overwriting
    command: npm run dev

  database:
    ports:
      - "5432:5432"  # Expose for local tools
    volumes:
      - ./postgres_data:/var/lib/postgresql/data
```

### Production Configuration

```yaml
# docker-compose.prod.yml
services:
  app:
    build:
      target: production
      cache_from:
        - myapp:latest
    restart: unless-stopped
    environment:
      - NODE_ENV=production
    volumes: []  # No source mounting
    deploy:
      replicas: 3
      resources:
        limits:
          cpus: '1'
          memory: 1G
        reservations:
          cpus: '0.5'
          memory: 512M

  database:
    restart: unless-stopped
    volumes:
      - postgres_data:/var/lib/postgresql/data
    deploy:
      resources:
        limits:
          cpus: '1'
          memory: 2G

volumes:
  postgres_data:
    driver: local
```

### Usage

```bash
# Development (uses docker-compose.yml + docker-compose.override.yml)
docker-compose up

# Production
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d

# Staging
docker-compose -f docker-compose.yml -f docker-compose.staging.yml up -d
```

## Profiles

### Profile Configuration

```yaml
services:
  app:
    image: myapp:latest
    # Always runs

  database:
    image: postgres:16-alpine
    # Always runs

  redis:
    image: redis:7-alpine
    profiles: ["cache"]
    # Only with --profile cache

  worker:
    image: myapp:latest
    command: npm run worker
    profiles: ["worker"]
    # Only with --profile worker

  test:
    image: myapp:latest
    command: npm test
    profiles: ["test"]
    # Only with --profile test

  monitoring:
    image: prom/prometheus
    profiles: ["monitoring", "debug"]
    # With --profile monitoring OR --profile debug
```

### Usage

```bash
# Default (app + database)
docker-compose up

# With cache
docker-compose --profile cache up

# With worker
docker-compose --profile worker up

# Multiple profiles
docker-compose --profile cache --profile worker up

# All services
docker-compose --profile cache --profile worker --profile monitoring up
```

## Dependencies

### depends_on with Conditions

```yaml
services:
  database:
    image: postgres:16-alpine
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 5

  migrations:
    image: myapp:latest
    command: npm run migrate
    depends_on:
      database:
        condition: service_healthy

  app:
    image: myapp:latest
    depends_on:
      database:
        condition: service_healthy
      redis:
        condition: service_healthy
      migrations:
        condition: service_completed_successfully
```

### Startup Order

```yaml
services:
  # 1. Infrastructure
  database:
    image: postgres:16-alpine
    healthcheck:
      test: ["CMD-SHELL", "pg_isready"]
      interval: 5s

  redis:
    image: redis:7-alpine
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s

  # 2. Migrations
  migrations:
    image: myapp:latest
    command: npm run migrate
    depends_on:
      database:
        condition: service_healthy
    restart: on-failure

  # 3. Application
  app:
    image: myapp:latest
    depends_on:
      database:
        condition: service_healthy
      redis:
        condition: service_healthy
      migrations:
        condition: service_completed_successfully

  # 4. Workers
  worker:
    image: myapp:latest
    command: npm run worker
    depends_on:
      app:
        condition: service_healthy
```

## Advanced Patterns

### Full Stack Application

```yaml
version: '3.8'

services:
  # Reverse Proxy
  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
      - ./nginx/ssl:/etc/nginx/ssl:ro
    networks:
      - frontend
    depends_on:
      - app

  # Application
  app:
    build:
      context: .
      dockerfile: Dockerfile
      target: production
    restart: unless-stopped
    environment:
      - NODE_ENV=production
      - DATABASE_URL=postgres://postgres:${DB_PASSWORD}@database:5432/myapp
      - REDIS_URL=redis://redis:6379
    networks:
      - frontend
      - backend
    depends_on:
      database:
        condition: service_healthy
      redis:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 3s
      retries: 3
    deploy:
      replicas: 3
      resources:
        limits:
          cpus: '1'
          memory: 1G

  # Background Workers
  worker:
    build:
      context: .
      dockerfile: Dockerfile
      target: production
    command: npm run worker
    restart: unless-stopped
    environment:
      - NODE_ENV=production
      - DATABASE_URL=postgres://postgres:${DB_PASSWORD}@database:5432/myapp
      - REDIS_URL=redis://redis:6379
    networks:
      - backend
    depends_on:
      database:
        condition: service_healthy
      redis:
        condition: service_healthy
    deploy:
      replicas: 2
      resources:
        limits:
          cpus: '0.5'
          memory: 512M

  # Database
  database:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      - POSTGRES_DB=myapp
      - POSTGRES_PASSWORD=${DB_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./postgres/init.sql:/docker-entrypoint-initdb.d/init.sql:ro
    networks:
      - backend
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 10s
      timeout: 5s
      retries: 5
    deploy:
      resources:
        limits:
          cpus: '1'
          memory: 2G

  # Cache
  redis:
    image: redis:7-alpine
    restart: unless-stopped
    command: redis-server --appendonly yes --requirepass ${REDIS_PASSWORD}
    volumes:
      - redis_data:/data
    networks:
      - backend
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 3s
      retries: 3

networks:
  frontend:
    driver: bridge
  backend:
    driver: bridge
    internal: true

volumes:
  postgres_data:
  redis_data:
```

### Microservices Architecture

```yaml
version: '3.8'

services:
  # API Gateway
  gateway:
    build: ./gateway
    ports:
      - "80:80"
    networks:
      - frontend
    depends_on:
      - auth-service
      - user-service
      - order-service

  # Authentication Service
  auth-service:
    build: ./services/auth
    networks:
      - frontend
      - auth-backend
    depends_on:
      auth-db:
        condition: service_healthy

  auth-db:
    image: postgres:16-alpine
    environment:
      - POSTGRES_DB=auth
    volumes:
      - auth_data:/var/lib/postgresql/data
    networks:
      - auth-backend
    healthcheck:
      test: ["CMD-SHELL", "pg_isready"]
      interval: 10s

  # User Service
  user-service:
    build: ./services/user
    networks:
      - frontend
      - user-backend
    depends_on:
      user-db:
        condition: service_healthy

  user-db:
    image: postgres:16-alpine
    environment:
      - POSTGRES_DB=users
    volumes:
      - user_data:/var/lib/postgresql/data
    networks:
      - user-backend
    healthcheck:
      test: ["CMD-SHELL", "pg_isready"]
      interval: 10s

  # Order Service
  order-service:
    build: ./services/order
    networks:
      - frontend
      - order-backend
      - message-queue
    depends_on:
      order-db:
        condition: service_healthy
      rabbitmq:
        condition: service_healthy

  order-db:
    image: postgres:16-alpine
    environment:
      - POSTGRES_DB=orders
    volumes:
      - order_data:/var/lib/postgresql/data
    networks:
      - order-backend
    healthcheck:
      test: ["CMD-SHELL", "pg_isready"]
      interval: 10s

  # Message Queue
  rabbitmq:
    image: rabbitmq:3-management-alpine
    networks:
      - message-queue
    healthcheck:
      test: ["CMD", "rabbitmq-diagnostics", "ping"]
      interval: 10s

networks:
  frontend:
  auth-backend:
    internal: true
  user-backend:
    internal: true
  order-backend:
    internal: true
  message-queue:
    internal: true

volumes:
  auth_data:
  user_data:
  order_data:
```

## Best Practices

1. **Use version control for compose files**
2. **Use .env files for configuration**
3. **Implement health checks for all services**
4. **Use networks to isolate services**
5. **Use named volumes for persistent data**
6. **Set resource limits**
7. **Use multi-stage builds**
8. **Implement proper logging**
9. **Use secrets for sensitive data**
10. **Test with production-like configuration**

## Common Commands

```bash
# Start services
docker-compose up -d

# View logs
docker-compose logs -f
docker-compose logs -f app

# Stop services
docker-compose stop

# Remove containers
docker-compose down

# Remove containers and volumes
docker-compose down -v

# Build images
docker-compose build
docker-compose build --no-cache

# Pull images
docker-compose pull

# Scale services
docker-compose up -d --scale app=3

# Execute command
docker-compose exec app sh
docker-compose exec database psql -U postgres

# View running services
docker-compose ps

# Validate compose file
docker-compose config
```
