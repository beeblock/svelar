# Docker Swarm Deep Dive

Comprehensive guide to Docker Swarm orchestration for production deployments.

## Table of Contents

- [Swarm Initialization](#swarm-initialization)
- [Stack Files](#stack-files)
- [Service Configuration](#service-configuration)
- [Rolling Updates](#rolling-updates)
- [Secrets and Configs](#secrets-and-configs)
- [Placement Constraints](#placement-constraints)
- [High Availability](#high-availability)
- [Monitoring](#monitoring)

## Swarm Initialization

### Initialize Swarm

```bash
# Initialize swarm on manager node
docker swarm init --advertise-addr <MANAGER-IP>

# Get join token for workers
docker swarm join-token worker

# Get join token for managers
docker swarm join-token manager

# Join as worker
docker swarm join --token <WORKER-TOKEN> <MANAGER-IP>:2377

# Join as manager
docker swarm join --token <MANAGER-TOKEN> <MANAGER-IP>:2377
```

### Swarm Management

```bash
# List nodes
docker node ls

# Inspect node
docker node inspect <NODE-ID>

# Update node availability
docker node update --availability drain <NODE-ID>
docker node update --availability active <NODE-ID>
docker node update --availability pause <NODE-ID>

# Add label to node
docker node update --label-add type=frontend <NODE-ID>
docker node update --label-add environment=production <NODE-ID>

# Remove node
docker node rm <NODE-ID>

# Promote worker to manager
docker node promote <NODE-ID>

# Demote manager to worker
docker node demote <NODE-ID>
```

## Stack Files

### Basic Stack File

```yaml
# docker-stack.yml
version: '3.8'

services:
  app:
    image: myapp:${VERSION}
    ports:
      - "80:3000"
    networks:
      - app_network
    deploy:
      replicas: 3
      update_config:
        parallelism: 1
        delay: 10s
        failure_action: rollback
      restart_policy:
        condition: any
        delay: 5s
        max_attempts: 3
      placement:
        constraints:
          - node.role == worker

networks:
  app_network:
    driver: overlay
```

### Deploy Stack

```bash
# Deploy stack
docker stack deploy -c docker-stack.yml myapp

# List stacks
docker stack ls

# List services in stack
docker stack services myapp

# List tasks in stack
docker stack ps myapp

# Remove stack
docker stack rm myapp
```

## Service Configuration

### Complete Service Definition

```yaml
services:
  app:
    image: myapp:${VERSION:-latest}

    # Deployment configuration
    deploy:
      # Number of replicas
      replicas: 3

      # Update strategy
      update_config:
        parallelism: 1        # Update 1 container at a time
        delay: 10s           # Wait between updates
        failure_action: rollback
        monitor: 60s         # Monitor for 60s before continuing
        max_failure_ratio: 0.3
        order: start-first   # Start new before stopping old (zero downtime)

      # Rollback configuration
      rollback_config:
        parallelism: 1
        delay: 5s
        failure_action: pause
        monitor: 30s
        max_failure_ratio: 0.3
        order: stop-first

      # Restart policy
      restart_policy:
        condition: any       # on-failure, any, none
        delay: 5s
        max_attempts: 3
        window: 120s

      # Resource limits
      resources:
        limits:
          cpus: '0.5'
          memory: 512M
        reservations:
          cpus: '0.25'
          memory: 256M

      # Placement
      placement:
        constraints:
          - node.role == worker
          - node.labels.environment == production
          - node.labels.type == frontend
        preferences:
          - spread: node.labels.datacenter

      # Labels
      labels:
        com.example.version: "1.0.0"
        com.example.environment: "production"

    # Port mapping (published mode)
    ports:
      - target: 3000
        published: 80
        protocol: tcp
        mode: ingress  # or host

    # Networks
    networks:
      - frontend
      - backend

    # Environment variables
    environment:
      - NODE_ENV=production
      - DATABASE_URL=postgres://db:5432/myapp

    # Secrets
    secrets:
      - source: db_password
        target: /run/secrets/db_password
        uid: '1001'
        gid: '1001'
        mode: 0400

    # Configs
    configs:
      - source: app_config
        target: /app/config.yml
        uid: '1001'
        gid: '1001'
        mode: 0440

    # Volumes
    volumes:
      - app_data:/app/data
      - type: tmpfs
        target: /tmp

    # Health check
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 3s
      retries: 3
      start_period: 40s

    # Logging
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
```

### Global Mode

```yaml
services:
  # One replica per node
  monitoring:
    image: prom/node-exporter
    deploy:
      mode: global
      placement:
        constraints:
          - node.role == worker
    volumes:
      - /proc:/host/proc:ro
      - /sys:/host/sys:ro
      - /:/rootfs:ro
    command:
      - '--path.procfs=/host/proc'
      - '--path.sysfs=/host/sys'
      - '--collector.filesystem.mount-points-exclude=^/(sys|proc|dev|host|etc)($$|/)'
```

## Rolling Updates

### Zero-Downtime Updates

```yaml
services:
  app:
    image: myapp:${VERSION}
    deploy:
      replicas: 5
      update_config:
        parallelism: 2      # Update 2 at a time
        delay: 10s          # Wait 10s between batches
        failure_action: rollback
        monitor: 60s        # Monitor for issues
        max_failure_ratio: 0.2
        order: start-first  # Start new before stopping old
      rollback_config:
        parallelism: 1
        delay: 5s
        failure_action: pause
        monitor: 30s
        order: stop-first
```

### Update Service

```bash
# Update service image
docker service update --image myapp:v2.0.0 myapp_app

# Update with environment variable
docker service update --env-add NEW_VAR=value myapp_app

# Update replica count
docker service scale myapp_app=5

# Update resource limits
docker service update \
  --limit-cpu 0.5 \
  --limit-memory 512M \
  myapp_app

# Force update (restart all containers)
docker service update --force myapp_app

# Rollback to previous version
docker service rollback myapp_app
```

### Monitor Update Progress

```bash
# Watch service
watch docker service ps myapp_app

# View logs
docker service logs -f myapp_app

# Inspect service
docker service inspect myapp_app

# View service status
docker service ls
```

## Secrets and Configs

### Secrets Management

```bash
# Create secret from file
docker secret create db_password ./db_password.txt

# Create secret from stdin
echo "my-secret-password" | docker secret create db_password -

# List secrets
docker secret ls

# Inspect secret
docker secret inspect db_password

# Remove secret
docker secret rm db_password
```

### Using Secrets in Stack

```yaml
services:
  app:
    image: myapp:latest
    secrets:
      - db_password
      - api_key
    environment:
      - DB_PASSWORD_FILE=/run/secrets/db_password
      - API_KEY_FILE=/run/secrets/api_key

secrets:
  db_password:
    external: true  # Already created
  api_key:
    file: ./api_key.txt  # Create from file
```

### Configs Management

```bash
# Create config from file
docker config create nginx_config ./nginx.conf

# Create config from stdin
cat nginx.conf | docker config create nginx_config -

# List configs
docker config ls

# Inspect config
docker config inspect nginx_config

# Remove config
docker config rm nginx_config
```

### Using Configs in Stack

```yaml
services:
  nginx:
    image: nginx:alpine
    configs:
      - source: nginx_config
        target: /etc/nginx/nginx.conf
      - source: nginx_ssl
        target: /etc/nginx/ssl/cert.pem

configs:
  nginx_config:
    external: true
  nginx_ssl:
    file: ./ssl/cert.pem
```

### Rotating Secrets

```yaml
# Version 1
services:
  app:
    image: myapp:latest
    secrets:
      - source: db_password
        target: db_password

secrets:
  db_password:
    external: true

# Update to version 2
secrets:
  db_password:
    name: db_password_v2
    external: true
```

```bash
# Create new secret
echo "new-password" | docker secret create db_password_v2 -

# Update stack (rolling update with new secret)
docker stack deploy -c docker-stack.yml myapp

# Remove old secret after deployment
docker secret rm db_password
```

## Placement Constraints

### Node Constraints

```yaml
services:
  # Frontend servers on specific nodes
  frontend:
    image: myapp-frontend:latest
    deploy:
      replicas: 3
      placement:
        constraints:
          - node.role == worker
          - node.labels.type == frontend
          - node.labels.environment == production

  # Backend on high-memory nodes
  backend:
    image: myapp-backend:latest
    deploy:
      replicas: 2
      placement:
        constraints:
          - node.role == worker
          - node.labels.type == backend
          - node.labels.memory == high

  # Database on specific nodes
  database:
    image: postgres:16-alpine
    deploy:
      replicas: 1
      placement:
        constraints:
          - node.role == worker
          - node.labels.type == database
          - node.hostname == db-server-1
```

### Placement Preferences

```yaml
services:
  app:
    image: myapp:latest
    deploy:
      replicas: 6
      placement:
        # Spread across datacenters
        preferences:
          - spread: node.labels.datacenter
        # And constrain to workers
        constraints:
          - node.role == worker
```

### Setting Node Labels

```bash
# Add labels to nodes
docker node update --label-add type=frontend node1
docker node update --label-add type=backend node2
docker node update --label-add type=database node3
docker node update --label-add environment=production node1
docker node update --label-add datacenter=us-east-1 node1
docker node update --label-add memory=high node2

# Remove label
docker node update --label-rm type node1

# View node labels
docker node inspect node1 --format '{{ .Spec.Labels }}'
```

## High Availability

### Multi-Manager Setup

```bash
# Initialize first manager
docker swarm init --advertise-addr manager1-ip

# Add more managers (recommended 3 or 5 for HA)
# On manager2
docker swarm join --token <MANAGER-TOKEN> manager1-ip:2377

# On manager3
docker swarm join --token <MANAGER-TOKEN> manager1-ip:2377
```

### HA Stack Configuration

```yaml
version: '3.8'

services:
  # Application with multiple replicas
  app:
    image: myapp:latest
    deploy:
      replicas: 5
      placement:
        constraints:
          - node.role == worker
        preferences:
          - spread: node.labels.datacenter
      update_config:
        parallelism: 1
        delay: 10s
        failure_action: rollback
        order: start-first
    networks:
      - app_network
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 10s
      timeout: 3s
      retries: 3

  # Load balancer
  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    deploy:
      replicas: 2
      placement:
        constraints:
          - node.labels.type == frontend
    configs:
      - source: nginx_config
        target: /etc/nginx/nginx.conf
    networks:
      - app_network

  # Database with leader election
  database:
    image: postgres:16-alpine
    deploy:
      replicas: 1
      placement:
        constraints:
          - node.labels.type == database
      restart_policy:
        condition: any
        delay: 5s
    volumes:
      - database_data:/var/lib/postgresql/data
    networks:
      - app_network

networks:
  app_network:
    driver: overlay
    attachable: true

volumes:
  database_data:
    driver: local

configs:
  nginx_config:
    external: true
```

## Monitoring

### Service Monitoring

```bash
# List all services
docker service ls

# Detailed service info
docker service ps myapp_app

# View service logs
docker service logs -f myapp_app

# View last 100 lines
docker service logs --tail 100 myapp_app

# Follow logs from specific replica
docker service logs -f myapp_app --raw

# Inspect service
docker service inspect myapp_app

# View service events
docker service inspect myapp_app --format '{{json .UpdateStatus}}'
```

### Stack Monitoring

```bash
# List stacks
docker stack ls

# List services in stack
docker stack services myapp

# List tasks in stack
docker stack ps myapp

# Filter failed tasks
docker stack ps --filter "desired-state=running" myapp
docker stack ps --filter "desired-state=shutdown" myapp
```

### Node Monitoring

```bash
# List nodes
docker node ls

# Inspect node
docker node inspect node1

# View node resource usage
docker node inspect node1 --format '{{json .Description.Resources}}'

# List tasks on node
docker node ps node1

# View node availability
docker node ls --filter "role=worker"
```

## Production Stack Example

### Complete Production Stack

```yaml
version: '3.8'

services:
  # Nginx Load Balancer
  nginx:
    image: nginx:alpine
    ports:
      - target: 80
        published: 80
        mode: ingress
      - target: 443
        published: 443
        mode: ingress
    configs:
      - source: nginx_config_v1
        target: /etc/nginx/nginx.conf
      - source: nginx_ssl_cert_v1
        target: /etc/nginx/ssl/cert.pem
      - source: nginx_ssl_key_v1
        target: /etc/nginx/ssl/key.pem
    networks:
      - frontend
    deploy:
      replicas: 2
      placement:
        constraints:
          - node.role == worker
          - node.labels.type == frontend
      update_config:
        parallelism: 1
        delay: 10s
        order: start-first
      resources:
        limits:
          cpus: '0.5'
          memory: 256M

  # Application
  app:
    image: myapp:${VERSION}
    networks:
      - frontend
      - backend
    secrets:
      - db_password
      - redis_password
    configs:
      - source: app_config_v1
        target: /app/config.yml
    environment:
      - NODE_ENV=production
      - DATABASE_URL=postgres://postgres@database:5432/myapp
      - REDIS_URL=redis://redis:6379
    deploy:
      replicas: 5
      placement:
        constraints:
          - node.role == worker
          - node.labels.type == backend
        preferences:
          - spread: node.labels.datacenter
      update_config:
        parallelism: 2
        delay: 10s
        failure_action: rollback
        monitor: 60s
        max_failure_ratio: 0.2
        order: start-first
      rollback_config:
        parallelism: 1
        delay: 5s
      restart_policy:
        condition: any
        delay: 5s
        max_attempts: 3
      resources:
        limits:
          cpus: '1'
          memory: 1G
        reservations:
          cpus: '0.5'
          memory: 512M
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 3s
      retries: 3
      start_period: 40s

  # Background Worker
  worker:
    image: myapp:${VERSION}
    command: npm run worker
    networks:
      - backend
    secrets:
      - db_password
      - redis_password
    environment:
      - NODE_ENV=production
      - DATABASE_URL=postgres://postgres@database:5432/myapp
      - REDIS_URL=redis://redis:6379
    deploy:
      replicas: 3
      placement:
        constraints:
          - node.role == worker
          - node.labels.type == backend
      restart_policy:
        condition: any
        delay: 5s
      resources:
        limits:
          cpus: '0.5'
          memory: 512M

  # PostgreSQL Database
  database:
    image: postgres:16-alpine
    networks:
      - backend
    secrets:
      - db_password
    environment:
      - POSTGRES_PASSWORD_FILE=/run/secrets/db_password
      - POSTGRES_DB=myapp
    volumes:
      - database_data:/var/lib/postgresql/data
    deploy:
      replicas: 1
      placement:
        constraints:
          - node.role == worker
          - node.labels.type == database
          - node.hostname == db-server-1
      restart_policy:
        condition: any
        delay: 5s
      resources:
        limits:
          cpus: '2'
          memory: 4G
        reservations:
          cpus: '1'
          memory: 2G
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 10s
      timeout: 5s
      retries: 5

  # Redis Cache
  redis:
    image: redis:7-alpine
    command: redis-server --requirepass-file /run/secrets/redis_password --appendonly yes
    networks:
      - backend
    secrets:
      - redis_password
    volumes:
      - redis_data:/data
    deploy:
      replicas: 1
      placement:
        constraints:
          - node.role == worker
          - node.labels.type == cache
      restart_policy:
        condition: any
      resources:
        limits:
          cpus: '1'
          memory: 2G
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 3s
      retries: 3

  # Monitoring - Prometheus
  prometheus:
    image: prom/prometheus:latest
    command:
      - '--config.file=/etc/prometheus/prometheus.yml'
      - '--storage.tsdb.path=/prometheus'
    configs:
      - source: prometheus_config_v1
        target: /etc/prometheus/prometheus.yml
    volumes:
      - prometheus_data:/prometheus
    networks:
      - monitoring
    deploy:
      replicas: 1
      placement:
        constraints:
          - node.role == manager
      resources:
        limits:
          cpus: '1'
          memory: 2G

  # Monitoring - Grafana
  grafana:
    image: grafana/grafana:latest
    ports:
      - "3000:3000"
    environment:
      - GF_SECURITY_ADMIN_PASSWORD__FILE=/run/secrets/grafana_password
    secrets:
      - grafana_password
    volumes:
      - grafana_data:/var/lib/grafana
    networks:
      - monitoring
    deploy:
      replicas: 1
      placement:
        constraints:
          - node.role == manager

networks:
  frontend:
    driver: overlay
  backend:
    driver: overlay
    internal: true
  monitoring:
    driver: overlay

volumes:
  database_data:
    driver: local
  redis_data:
    driver: local
  prometheus_data:
    driver: local
  grafana_data:
    driver: local

secrets:
  db_password:
    external: true
  redis_password:
    external: true
  grafana_password:
    external: true

configs:
  nginx_config_v1:
    external: true
  nginx_ssl_cert_v1:
    external: true
  nginx_ssl_key_v1:
    external: true
  app_config_v1:
    external: true
  prometheus_config_v1:
    external: true
```

### Deployment Script

```bash
#!/bin/bash
set -e

VERSION=${1:-latest}
STACK_NAME=myapp

echo "Deploying ${STACK_NAME} version ${VERSION}..."

# Deploy stack
docker stack deploy \
  -c docker-stack.yml \
  --with-registry-auth \
  ${STACK_NAME}

echo "Waiting for services to converge..."
sleep 10

# Monitor deployment
docker stack services ${STACK_NAME}

echo "Deployment complete!"
echo "Monitor with: docker service logs -f ${STACK_NAME}_app"
```

## Best Practices

1. **Use overlay networks** for service communication
2. **Implement health checks** on all services
3. **Set resource limits** to prevent resource starvation
4. **Use secrets** for sensitive data
5. **Use configs** for configuration files
6. **Spread replicas** across nodes with placement preferences
7. **Use rolling updates** with start-first order for zero downtime
8. **Monitor services** continuously
9. **Plan for rollback** with rollback configurations
10. **Label nodes** for better placement control
11. **Use external volumes** for persistent data
12. **Test updates** in staging before production
13. **Keep odd number** of managers (3 or 5) for quorum
14. **Backup secrets** and configs
15. **Document** deployment procedures
