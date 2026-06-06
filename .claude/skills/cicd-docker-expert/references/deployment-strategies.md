# Deployment Strategies Deep Dive

Comprehensive guide to deployment strategies including blue-green, canary, rolling updates, and rollback procedures.

## Table of Contents

- [Blue-Green Deployment](#blue-green-deployment)
- [Canary Deployment](#canary-deployment)
- [Rolling Updates](#rolling-updates)
- [Rollback Procedures](#rollback-procedures)
- [Database Migrations](#database-migrations)
- [Traffic Management](#traffic-management)
- [Testing Strategies](#testing-strategies)

## Blue-Green Deployment

### Concept

Blue-green deployment runs two identical production environments: "blue" (current) and "green" (new). Traffic switches from blue to green after the new version is verified.

**Benefits:**
- Zero downtime
- Instant rollback
- Full testing before switch
- Easy to understand

**Drawbacks:**
- Requires double resources
- Database migrations can be complex
- All-or-nothing switch

### Docker Compose Implementation

```yaml
# docker-compose.blue-green.yml
version: '3.8'

services:
  # Blue environment (current production)
  app-blue:
    image: myapp:${BLUE_VERSION}
    container_name: app-blue
    networks:
      - app-network
    environment:
      - NODE_ENV=production
      - COLOR=blue
    labels:
      - "environment=blue"
      - "version=${BLUE_VERSION}"
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 10s
      timeout: 3s
      retries: 3

  # Green environment (new version)
  app-green:
    image: myapp:${GREEN_VERSION}
    container_name: app-green
    networks:
      - app-network
    environment:
      - NODE_ENV=production
      - COLOR=green
    labels:
      - "environment=green"
      - "version=${GREEN_VERSION}"
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 10s
      timeout: 3s
      retries: 3

  # Nginx load balancer
  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
    volumes:
      - ./nginx-${ACTIVE_ENV:-blue}.conf:/etc/nginx/nginx.conf:ro
    networks:
      - app-network
    depends_on:
      - app-blue
      - app-green

  # Shared database
  database:
    image: postgres:16-alpine
    networks:
      - app-network
    volumes:
      - database_data:/var/lib/postgresql/data
    environment:
      - POSTGRES_DB=myapp
      - POSTGRES_PASSWORD=${DB_PASSWORD}

networks:
  app-network:
    driver: bridge

volumes:
  database_data:
```

### Nginx Configuration

```nginx
# nginx-blue.conf (route to blue)
upstream backend {
    server app-blue:3000;
}

server {
    listen 80;

    location / {
        proxy_pass http://backend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location /health {
        proxy_pass http://backend/health;
    }
}
```

```nginx
# nginx-green.conf (route to green)
upstream backend {
    server app-green:3000;
}

server {
    listen 80;

    location / {
        proxy_pass http://backend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location /health {
        proxy_pass http://backend/health;
    }
}
```

### Deployment Script

```bash
#!/bin/bash
set -e

CURRENT_ENV=${1:-blue}
NEW_VERSION=${2:-latest}

# Determine target environment
if [ "$CURRENT_ENV" = "blue" ]; then
    TARGET_ENV="green"
    CURRENT_VERSION=$BLUE_VERSION
else
    TARGET_ENV="blue"
    CURRENT_VERSION=$GREEN_VERSION
fi

echo "Current environment: $CURRENT_ENV (version: $CURRENT_VERSION)"
echo "Target environment: $TARGET_ENV (version: $NEW_VERSION)"

# Export versions
export BLUE_VERSION=${BLUE_VERSION:-latest}
export GREEN_VERSION=${GREEN_VERSION:-latest}
export ACTIVE_ENV=$CURRENT_ENV

if [ "$TARGET_ENV" = "green" ]; then
    export GREEN_VERSION=$NEW_VERSION
else
    export BLUE_VERSION=$NEW_VERSION
fi

# Pull new image
echo "Pulling new image..."
docker pull myapp:$NEW_VERSION

# Start target environment
echo "Starting $TARGET_ENV environment..."
docker-compose -f docker-compose.blue-green.yml up -d app-$TARGET_ENV

# Wait for health checks
echo "Waiting for $TARGET_ENV to be healthy..."
timeout 60 bash -c "
    until docker inspect --format='{{.State.Health.Status}}' app-$TARGET_ENV | grep -q healthy; do
        echo 'Waiting for health check...'
        sleep 2
    done
"

# Run smoke tests
echo "Running smoke tests..."
./scripts/smoke-test.sh "http://localhost:3000"

# Switch traffic
echo "Switching traffic to $TARGET_ENV..."
export ACTIVE_ENV=$TARGET_ENV
docker-compose -f docker-compose.blue-green.yml up -d nginx

# Wait for verification
echo "Verifying deployment..."
sleep 30

# Monitor for errors
echo "Monitoring for errors (60 seconds)..."
if ./scripts/monitor.sh 60; then
    echo "Deployment successful!"

    # Stop old environment
    echo "Stopping $CURRENT_ENV environment..."
    docker-compose -f docker-compose.blue-green.yml stop app-$CURRENT_ENV

    echo "Deployment complete!"
    echo "Active environment: $TARGET_ENV"
else
    echo "Errors detected! Rolling back..."
    export ACTIVE_ENV=$CURRENT_ENV
    docker-compose -f docker-compose.blue-green.yml up -d nginx
    echo "Rollback complete. Active environment: $CURRENT_ENV"
    exit 1
fi
```

### Docker Swarm Blue-Green

```yaml
# docker-stack.blue-green.yml
version: '3.8'

services:
  app-blue:
    image: myapp:${BLUE_VERSION}
    networks:
      - app-network
    deploy:
      replicas: ${BLUE_REPLICAS:-0}
      labels:
        - "environment=blue"
      placement:
        constraints:
          - node.role == worker

  app-green:
    image: myapp:${GREEN_VERSION}
    networks:
      - app-network
    deploy:
      replicas: ${GREEN_REPLICAS:-0}
      labels:
        - "environment=green"
      placement:
        constraints:
          - node.role == worker

  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
    configs:
      - source: nginx_config
        target: /etc/nginx/nginx.conf
    networks:
      - app-network
    deploy:
      replicas: 2
      placement:
        constraints:
          - node.labels.type == frontend

networks:
  app-network:
    driver: overlay

configs:
  nginx_config:
    external: true
```

```bash
#!/bin/bash
# Swarm blue-green deployment

CURRENT_ENV=${1:-blue}
NEW_VERSION=${2:-latest}

if [ "$CURRENT_ENV" = "blue" ]; then
    TARGET_ENV="green"
else
    TARGET_ENV="blue"
fi

# Deploy new version to target environment
export ${TARGET_ENV^^}_VERSION=$NEW_VERSION
export ${TARGET_ENV^^}_REPLICAS=5
export ${CURRENT_ENV^^}_REPLICAS=5

docker stack deploy -c docker-stack.blue-green.yml myapp

# Wait and verify
sleep 60

# Switch traffic by updating nginx config
docker config create nginx_config_new ./nginx-$TARGET_ENV.conf
docker service update --config-rm nginx_config --config-add source=nginx_config_new,target=/etc/nginx/nginx.conf myapp_nginx

# Stop old environment
export ${CURRENT_ENV^^}_REPLICAS=0
docker stack deploy -c docker-stack.blue-green.yml myapp
```

## Canary Deployment

### Concept

Canary deployment gradually rolls out changes to a small subset of users before rolling out to the entire infrastructure.

**Benefits:**
- Gradual rollout
- Early detection of issues
- Limited blast radius
- Can measure impact

**Drawbacks:**
- More complex setup
- Requires traffic routing
- Longer deployment time

### Docker Swarm Canary

```yaml
# docker-stack.canary.yml
version: '3.8'

services:
  # Stable version
  app-stable:
    image: myapp:${STABLE_VERSION}
    networks:
      - app-network
    deploy:
      replicas: ${STABLE_REPLICAS:-9}
      labels:
        - "version=stable"
        - "canary=false"
      update_config:
        parallelism: 1
        delay: 10s
      placement:
        constraints:
          - node.role == worker
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 3s
      retries: 3

  # Canary version
  app-canary:
    image: myapp:${CANARY_VERSION}
    networks:
      - app-network
    deploy:
      replicas: ${CANARY_REPLICAS:-1}
      labels:
        - "version=canary"
        - "canary=true"
      update_config:
        parallelism: 1
        delay: 10s
      placement:
        constraints:
          - node.role == worker
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 3s
      retries: 3

  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
    configs:
      - source: nginx_canary_config
        target: /etc/nginx/nginx.conf
    networks:
      - app-network
    deploy:
      replicas: 2

networks:
  app-network:
    driver: overlay

configs:
  nginx_canary_config:
    external: true
```

### Nginx Canary Configuration

```nginx
# nginx-canary.conf
upstream stable {
    server app-stable:3000;
}

upstream canary {
    server app-canary:3000;
}

# Split module for weighted distribution
split_clients $request_id $backend {
    10% canary;    # 10% to canary
    *   stable;    # 90% to stable
}

server {
    listen 80;

    location / {
        proxy_pass http://$backend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Canary $backend;
    }
}
```

### Canary Deployment Script

```bash
#!/bin/bash
set -e

CANARY_VERSION=${1:-latest}
STABLE_VERSION=${2:-$(cat current-version.txt)}

echo "Deploying canary: $CANARY_VERSION"
echo "Stable version: $STABLE_VERSION"

# Stage 1: 10% canary
echo "Stage 1: Deploying to 10% of traffic..."
export STABLE_VERSION=$STABLE_VERSION
export CANARY_VERSION=$CANARY_VERSION
export STABLE_REPLICAS=9
export CANARY_REPLICAS=1

docker stack deploy -c docker-stack.canary.yml myapp
sleep 60

# Monitor canary
if ! ./scripts/monitor-canary.sh 300; then
    echo "Canary failed! Rolling back..."
    export CANARY_REPLICAS=0
    docker stack deploy -c docker-stack.canary.yml myapp
    exit 1
fi

# Stage 2: 50% canary
echo "Stage 2: Increasing to 50% of traffic..."
export STABLE_REPLICAS=5
export CANARY_REPLICAS=5

docker stack deploy -c docker-stack.canary.yml myapp
sleep 60

if ! ./scripts/monitor-canary.sh 300; then
    echo "Canary failed! Rolling back..."
    export STABLE_REPLICAS=10
    export CANARY_REPLICAS=0
    docker stack deploy -c docker-stack.canary.yml myapp
    exit 1
fi

# Stage 3: 100% canary (promote)
echo "Stage 3: Promoting canary to stable..."
export STABLE_VERSION=$CANARY_VERSION
export STABLE_REPLICAS=10
export CANARY_REPLICAS=0

docker stack deploy -c docker-stack.canary.yml myapp

echo "Canary deployment successful!"
echo $CANARY_VERSION > current-version.txt
```

## Rolling Updates

### Docker Compose Rolling Update

```yaml
services:
  app:
    image: myapp:${VERSION}
    deploy:
      replicas: 5
      update_config:
        parallelism: 1      # Update 1 at a time
        delay: 10s          # Wait 10s between updates
        failure_action: rollback
        monitor: 60s
        max_failure_ratio: 0.2
        order: start-first  # Zero downtime
      rollback_config:
        parallelism: 1
        delay: 5s
        failure_action: pause
```

### Progressive Rolling Update

```bash
#!/bin/bash
set -e

NEW_VERSION=${1:-latest}
TOTAL_REPLICAS=10

echo "Rolling update to version: $NEW_VERSION"

# Update in stages
STAGES=(2 5 10)  # Update 2, then 5, then all 10

for stage in "${STAGES[@]}"; do
    echo "Updating $stage/$TOTAL_REPLICAS replicas..."

    # Calculate old and new replica counts
    NEW_REPLICAS=$stage
    OLD_REPLICAS=$((TOTAL_REPLICAS - NEW_REPLICAS))

    # Deploy new version
    export NEW_VERSION=$NEW_VERSION
    export OLD_VERSION=$(cat current-version.txt)
    export NEW_REPLICAS=$NEW_REPLICAS
    export OLD_REPLICAS=$OLD_REPLICAS

    docker stack deploy -c docker-stack.rolling.yml myapp

    # Monitor
    echo "Monitoring stage $stage..."
    sleep 60

    if ! ./scripts/monitor.sh 120; then
        echo "Stage $stage failed! Rolling back..."
        export NEW_REPLICAS=0
        export OLD_REPLICAS=$TOTAL_REPLICAS
        docker stack deploy -c docker-stack.rolling.yml myapp
        exit 1
    fi

    echo "Stage $stage successful!"
done

echo "Rolling update complete!"
echo $NEW_VERSION > current-version.txt
```

## Rollback Procedures

### Immediate Rollback

```bash
#!/bin/bash
# Immediate rollback to previous version

PREVIOUS_VERSION=$(cat previous-version.txt)

echo "Rolling back to version: $PREVIOUS_VERSION"

# Docker Swarm
docker service update --image myapp:$PREVIOUS_VERSION myapp_app

# Or use rollback command
docker service rollback myapp_app

# Docker Compose
export VERSION=$PREVIOUS_VERSION
docker-compose up -d app

echo "Rollback complete!"
```

### Automated Rollback on Failure

```yaml
services:
  app:
    image: myapp:${VERSION}
    deploy:
      replicas: 5
      update_config:
        parallelism: 1
        delay: 10s
        failure_action: rollback  # Auto rollback on failure
        monitor: 60s
        max_failure_ratio: 0.2
      rollback_config:
        parallelism: 2
        delay: 5s
        failure_action: pause
        monitor: 30s
```

### Health Check Based Rollback

```bash
#!/bin/bash
# Monitor health and rollback if needed

SERVICE_NAME=$1
THRESHOLD=0.8  # 80% healthy required

while true; do
    # Get service status
    DESIRED=$(docker service inspect --format '{{.Spec.Mode.Replicated.Replicas}}' $SERVICE_NAME)
    RUNNING=$(docker service ps $SERVICE_NAME --filter "desired-state=running" -q | wc -l)
    HEALTHY_RATIO=$(echo "scale=2; $RUNNING / $DESIRED" | bc)

    if (( $(echo "$HEALTHY_RATIO < $THRESHOLD" | bc -l) )); then
        echo "Health check failed! Only $RUNNING/$DESIRED replicas running"
        echo "Rolling back..."
        docker service rollback $SERVICE_NAME
        exit 1
    fi

    echo "Health check passed: $RUNNING/$DESIRED replicas running"
    sleep 30
done
```

## Database Migrations

### Compatible Migrations

```bash
#!/bin/bash
# Database migration strategy for zero-downtime deployments

set -e

VERSION=$1

echo "Running database migrations for version: $VERSION"

# 1. Run forward-compatible migrations
docker run --rm \
    --network app_network \
    -e DATABASE_URL=$DATABASE_URL \
    myapp:$VERSION \
    npm run migrate:forward-compatible

echo "Forward-compatible migrations complete"

# 2. Deploy new application version
./deploy.sh $VERSION

# 3. Run cleanup migrations (after deployment)
sleep 60  # Wait for deployment to stabilize

docker run --rm \
    --network app_network \
    -e DATABASE_URL=$DATABASE_URL \
    myapp:$VERSION \
    npm run migrate:cleanup

echo "Migration complete!"
```

### Migration Checklist

1. **Make changes backwards compatible**
   - Add columns as nullable
   - Don't remove columns immediately
   - Use views for schema changes

2. **Three-phase migration**
   - Phase 1: Add new schema (both work)
   - Phase 2: Deploy application
   - Phase 3: Remove old schema

3. **Example: Renaming a column**

```sql
-- Phase 1: Add new column
ALTER TABLE users ADD COLUMN email_address VARCHAR(255);
UPDATE users SET email_address = email;
CREATE INDEX idx_users_email_address ON users(email_address);

-- Deploy application (reads from both columns, writes to both)

-- Phase 2 (after deployment): Remove old column
ALTER TABLE users DROP COLUMN email;
```

## Traffic Management

### Gradual Traffic Shift

```nginx
# nginx-gradual.conf
upstream backend_old {
    server app-old:3000;
}

upstream backend_new {
    server app-new:3000;
}

split_clients $request_id $backend {
    ${TRAFFIC_PERCENTAGE} backend_new;
    *                      backend_old;
}

server {
    listen 80;

    location / {
        proxy_pass http://$backend;
        proxy_set_header Host $host;
        proxy_set_header X-Backend $backend;
    }
}
```

```bash
#!/bin/bash
# Gradually shift traffic

PERCENTAGES=(10 25 50 75 100)

for pct in "${PERCENTAGES[@]}"; do
    echo "Shifting ${pct}% traffic to new version..."

    # Update nginx config
    export TRAFFIC_PERCENTAGE="${pct}%"
    envsubst < nginx-gradual.conf.template > nginx-gradual.conf

    # Reload nginx
    docker exec nginx nginx -s reload

    # Monitor
    echo "Monitoring at ${pct}%..."
    sleep 300  # 5 minutes

    if ! ./scripts/monitor.sh 60; then
        echo "Issues detected at ${pct}%! Rolling back..."
        export TRAFFIC_PERCENTAGE="0%"
        envsubst < nginx-gradual.conf.template > nginx-gradual.conf
        docker exec nginx nginx -s reload
        exit 1
    fi
done

echo "Traffic shift complete!"
```

## Testing Strategies

### Smoke Tests

```bash
#!/bin/bash
# smoke-test.sh

BASE_URL=$1

echo "Running smoke tests against $BASE_URL"

# Health check
if ! curl -f $BASE_URL/health; then
    echo "Health check failed"
    exit 1
fi

# API test
if ! curl -f $BASE_URL/api/status; then
    echo "API status check failed"
    exit 1
fi

# Authentication test
if ! curl -f -X POST $BASE_URL/api/auth/login \
    -H "Content-Type: application/json" \
    -d '{"username":"test","password":"test"}'; then
    echo "Auth test failed"
    exit 1
fi

echo "Smoke tests passed!"
```

### Load Testing

```bash
#!/bin/bash
# load-test.sh

TARGET_URL=$1
DURATION=300  # 5 minutes

echo "Running load test for ${DURATION}s..."

# Using Apache Bench
ab -n 100000 -c 100 -t $DURATION $TARGET_URL/

# Or using wrk
wrk -t12 -c400 -d${DURATION}s $TARGET_URL/

# Check error rate
ERROR_RATE=$(docker service logs myapp_app 2>&1 | grep -c "ERROR")

if [ $ERROR_RATE -gt 100 ]; then
    echo "High error rate detected: $ERROR_RATE errors"
    exit 1
fi

echo "Load test passed!"
```

### Integration Tests

```bash
#!/bin/bash
# integration-test.sh

docker run --rm \
    --network app_network \
    -e API_URL=http://app:3000 \
    myapp:$VERSION \
    npm run test:integration

if [ $? -ne 0 ]; then
    echo "Integration tests failed"
    exit 1
fi

echo "Integration tests passed!"
```

## Monitoring During Deployment

### Deployment Monitor Script

```bash
#!/bin/bash
# monitor.sh - Monitor metrics during deployment

DURATION=${1:-60}
START_TIME=$(date +%s)

echo "Monitoring for ${DURATION} seconds..."

while [ $(($(date +%s) - START_TIME)) -lt $DURATION ]; do
    # Error rate
    ERROR_COUNT=$(docker service logs myapp_app --since 1m 2>&1 | grep -c "ERROR")

    # Response time (from logs)
    AVG_RESPONSE_TIME=$(docker service logs myapp_app --since 1m 2>&1 | \
        grep "response_time" | \
        awk '{sum+=$5; count++} END {print sum/count}')

    # Health check
    HEALTHY_REPLICAS=$(docker service ps myapp_app --filter "desired-state=running" -q | wc -l)
    DESIRED_REPLICAS=$(docker service inspect --format '{{.Spec.Mode.Replicated.Replicas}}' myapp_app)

    echo "[$(date)] Errors: $ERROR_COUNT, Avg Response: ${AVG_RESPONSE_TIME}ms, Healthy: $HEALTHY_REPLICAS/$DESIRED_REPLICAS"

    # Thresholds
    if [ $ERROR_COUNT -gt 50 ]; then
        echo "ERROR: High error rate detected"
        exit 1
    fi

    if [ $HEALTHY_REPLICAS -lt $((DESIRED_REPLICAS * 80 / 100)) ]; then
        echo "ERROR: Too many unhealthy replicas"
        exit 1
    fi

    sleep 10
done

echo "Monitoring complete - No issues detected"
```

## Best Practices

1. **Always have a rollback plan** - Test rollback procedures regularly
2. **Automate health checks** - Don't rely on manual verification
3. **Monitor metrics** - Error rates, response times, resource usage
4. **Use canary deployments** for high-risk changes
5. **Test database migrations** thoroughly before production
6. **Keep old version running** until new version is verified
7. **Gradual rollout** - Start with small percentage of traffic
8. **Document procedures** - Clear runbooks for deployment and rollback
9. **Alert on failures** - Automated alerts for deployment issues
10. **Practice** - Run deployment drills regularly
