# Container Security Deep Dive

Comprehensive guide to container security, vulnerability scanning, secrets management, and security best practices.

## Table of Contents

- [Security Principles](#security-principles)
- [Image Security](#image-security)
- [Runtime Security](#runtime-security)
- [Secrets Management](#secrets-management)
- [Network Security](#network-security)
- [Vulnerability Scanning](#vulnerability-scanning)
- [Compliance and Auditing](#compliance-and-auditing)
- [Security Checklist](#security-checklist)

## Security Principles

### Defense in Depth

Layer multiple security controls:

1. **Build Time Security**
   - Secure base images
   - Dependency scanning
   - SAST (Static Application Security Testing)
   - Dockerfile linting

2. **Registry Security**
   - Image signing
   - Vulnerability scanning
   - Access control
   - Audit logging

3. **Runtime Security**
   - Least privilege
   - Resource limits
   - Network policies
   - Runtime protection

4. **Infrastructure Security**
   - Host hardening
   - Kernel security modules (AppArmor, SELinux)
   - Regular updates
   - Monitoring and logging

### Zero Trust Model

```yaml
# Assume breach, verify everything
services:
  app:
    image: myapp:latest
    # Don't trust the image
    security_opt:
      - no-new-privileges:true
    # Don't trust the network
    networks:
      - isolated_network
    # Don't trust the filesystem
    read_only: true
    tmpfs:
      - /tmp
    # Don't trust processes
    cap_drop:
      - ALL
    cap_add:
      - NET_BIND_SERVICE  # Only what's needed
    # Don't run as root
    user: "1001:1001"
```

## Image Security

### Secure Base Images

```dockerfile
# ❌ BAD - Large attack surface, outdated packages
FROM ubuntu:latest

# ⚠️ ACCEPTABLE - Smaller, but still has package manager
FROM node:20-alpine

# ✅ GOOD - Minimal, no package manager, no shell
FROM gcr.io/distroless/nodejs20-debian12

# ✅ EXCELLENT - Absolutely minimal
FROM scratch
COPY --from=builder /app/binary /binary
ENTRYPOINT ["/binary"]
```

### Multi-Stage Build Security

```dockerfile
# syntax=docker/dockerfile:1

# Build stage - Can use full image with build tools
FROM node:20 AS builder

WORKDIR /build

# Install dependencies
COPY package*.json ./
RUN npm ci

# Build application
COPY . .
RUN npm run build && \
    npm prune --production

# Security scan stage
FROM aquasec/trivy:latest AS scanner
COPY --from=builder /build /scan
RUN trivy fs --exit-code 1 --severity HIGH,CRITICAL --no-progress /scan

# Production stage - Minimal image
FROM gcr.io/distroless/nodejs20-debian12

# Copy only what's needed
COPY --from=builder --chown=nonroot:nonroot /build/dist /app/dist
COPY --from=builder --chown=nonroot:nonroot /build/node_modules /app/node_modules

WORKDIR /app

# Run as non-root
USER nonroot

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD ["/nodejs/bin/node", "-e", "require('http').get('http://localhost:3000/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"]

CMD ["dist/index.js"]
```

### Image Signing and Verification

```bash
# Enable Docker Content Trust
export DOCKER_CONTENT_TRUST=1

# Sign image
docker trust sign myregistry.com/myapp:v1.0.0

# Verify signature before pulling
docker pull myregistry.com/myapp:v1.0.0

# Using cosign (recommended for supply chain security)
# Sign image
cosign sign --key cosign.key myregistry.com/myapp:v1.0.0

# Verify signature
cosign verify --key cosign.pub myregistry.com/myapp:v1.0.0

# Generate SBOM (Software Bill of Materials)
syft myregistry.com/myapp:v1.0.0 -o spdx-json > sbom.json

# Attach SBOM to image
cosign attach sbom --sbom sbom.json myregistry.com/myapp:v1.0.0
```

### .dockerignore for Security

```dockerignore
# .dockerignore - Prevent sensitive files from being copied

# Secrets and credentials
.env
.env.*
*.key
*.pem
*.p12
*.pfx
credentials.json
secrets/
**/*password*
**/*secret*
**/*token*

# Git and version control
.git
.gitignore
.github

# CI/CD
.gitlab-ci.yml
.travis.yml
Jenkinsfile

# Development
node_modules
.vscode
.idea
*.swp
.DS_Store

# Documentation (may contain sensitive info)
docs/internal/
runbooks/

# Build artifacts
dist
build
*.log

# Testing
coverage
.nyc_output
test/
**/*.test.js
**/*.spec.js
```

## Runtime Security

### Security Options

```yaml
services:
  app:
    image: myapp:latest

    # Prevent privilege escalation
    security_opt:
      - no-new-privileges:true

    # Drop all capabilities
    cap_drop:
      - ALL

    # Add only required capabilities
    cap_add:
      - NET_BIND_SERVICE  # Bind to ports < 1024
      - CHOWN            # Change file ownership (if needed)
      # Never add: CAP_SYS_ADMIN, CAP_NET_ADMIN, CAP_SYS_MODULE

    # Run as non-root user
    user: "1001:1001"

    # Read-only root filesystem
    read_only: true

    # Temporary filesystem for writes
    tmpfs:
      - /tmp
      - /var/run
      - /var/cache

    # Resource limits (prevent DoS)
    deploy:
      resources:
        limits:
          cpus: '1'
          memory: 1G
          pids: 100  # Limit number of processes
        reservations:
          cpus: '0.5'
          memory: 512M

    # AppArmor profile
    security_opt:
      - apparmor=docker-default

    # SELinux labels
    security_opt:
      - label:type:container_runtime_t
```

### Seccomp Profile

```json
{
  "defaultAction": "SCMP_ACT_ERRNO",
  "architectures": [
    "SCMP_ARCH_X86_64",
    "SCMP_ARCH_X86",
    "SCMP_ARCH_X32"
  ],
  "syscalls": [
    {
      "names": [
        "accept",
        "accept4",
        "access",
        "arch_prctl",
        "bind",
        "brk",
        "clone",
        "close",
        "connect",
        "dup",
        "dup2",
        "epoll_create",
        "epoll_ctl",
        "epoll_wait",
        "execve",
        "exit",
        "exit_group",
        "fcntl",
        "fstat",
        "futex",
        "getcwd",
        "getdents",
        "getpeername",
        "getpid",
        "getsockname",
        "getsockopt",
        "listen",
        "mmap",
        "open",
        "poll",
        "read",
        "recvfrom",
        "recvmsg",
        "rt_sigaction",
        "rt_sigprocmask",
        "rt_sigreturn",
        "sendmsg",
        "sendto",
        "setsockopt",
        "shutdown",
        "socket",
        "stat",
        "uname",
        "write"
      ],
      "action": "SCMP_ACT_ALLOW"
    }
  ]
}
```

```yaml
# Use custom seccomp profile
services:
  app:
    image: myapp:latest
    security_opt:
      - seccomp=./seccomp-profile.json
```

### AppArmor Profile

```apparmor
# /etc/apparmor.d/docker-myapp
#include <tunables/global>

profile docker-myapp flags=(attach_disconnected,mediate_deleted) {
  #include <abstractions/base>

  # Network
  network inet tcp,
  network inet udp,

  # File access
  /app/** r,
  /app/dist/** r,
  /tmp/** rw,
  /var/run/** rw,

  # Deny dangerous operations
  deny /proc/sys/kernel/** w,
  deny /sys/** w,
  deny /dev/** w,
  deny mount,
  deny pivot_root,

  # Allow execution of Node.js
  /usr/local/bin/node ix,
  /nodejs/bin/node ix,
}
```

```yaml
services:
  app:
    image: myapp:latest
    security_opt:
      - apparmor=docker-myapp
```

## Secrets Management

### Docker Secrets (Swarm)

```bash
# Create secret from file
docker secret create db_password ./db_password.txt

# Create secret from stdin
echo "my-secret-password" | docker secret create db_password -

# Create secret with labels
docker secret create --label environment=production db_password ./db_password.txt

# List secrets
docker secret ls

# Inspect secret (doesn't show value)
docker secret inspect db_password

# Remove secret
docker secret rm db_password
```

```yaml
# Use in stack file
services:
  app:
    image: myapp:latest
    secrets:
      - source: db_password
        target: /run/secrets/db_password
        uid: '1001'
        gid: '1001'
        mode: 0400

secrets:
  db_password:
    external: true  # Already created
  api_key:
    file: ./api_key.txt  # Create from file
```

### Environment Variables (Compose)

```bash
# .env file (NEVER commit to git)
DB_PASSWORD=secret123
API_KEY=key456
```

```yaml
# docker-compose.yml
services:
  app:
    image: myapp:latest
    environment:
      - NODE_ENV=production
      # Don't set secrets directly
      - DB_PASSWORD=${DB_PASSWORD}  # From .env file
      - API_KEY=${API_KEY}

# Or use env_file
services:
  app:
    image: myapp:latest
    env_file:
      - .env
      - .env.local
```

### External Secrets Management

```yaml
# Using HashiCorp Vault
services:
  app:
    image: myapp:latest
    environment:
      - VAULT_ADDR=https://vault.example.com
      - VAULT_TOKEN=${VAULT_TOKEN}
    command: >
      sh -c "
        export DB_PASSWORD=$(vault kv get -field=password secret/db)
        && export API_KEY=$(vault kv get -field=key secret/api)
        && node dist/index.js
      "

# Using AWS Secrets Manager
services:
  app:
    image: myapp:latest
    environment:
      - AWS_REGION=us-east-1
    command: >
      sh -c "
        export DB_PASSWORD=$(aws secretsmanager get-secret-value --secret-id db-password --query SecretString --output text)
        && node dist/index.js
      "
```

### GitHub Actions Secrets

```yaml
name: Deploy

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest

    steps:
      - name: Deploy to production
        env:
          # Access repository secrets
          SSH_KEY: ${{ secrets.SSH_KEY }}
          DB_PASSWORD: ${{ secrets.DB_PASSWORD }}

          # Access organization secrets
          API_KEY: ${{ secrets.ORG_API_KEY }}

          # Access environment secrets
          DEPLOY_TOKEN: ${{ secrets.DEPLOY_TOKEN }}
        run: |
          echo "$SSH_KEY" > key.pem
          chmod 600 key.pem
          # Use secrets securely
          ./deploy.sh
```

## Network Security

### Network Isolation

```yaml
networks:
  # Public-facing network
  frontend:
    driver: overlay
    driver_opts:
      encrypted: "true"  # Encrypt overlay network

  # Internal network (not accessible externally)
  backend:
    driver: overlay
    internal: true  # No external access
    driver_opts:
      encrypted: "true"

  # Database network (most restricted)
  database:
    driver: overlay
    internal: true
    driver_opts:
      encrypted: "true"

services:
  # Public-facing service
  nginx:
    image: nginx:alpine
    networks:
      - frontend
    ports:
      - "80:80"
      - "443:443"

  # Application service
  app:
    image: myapp:latest
    networks:
      - frontend  # Receive requests from nginx
      - backend   # Access backend services

  # Backend service
  api:
    image: api:latest
    networks:
      - backend   # Internal only
      - database  # Access database

  # Database
  database:
    image: postgres:16-alpine
    networks:
      - database  # Most restricted, internal only
```

### Firewall Rules

```bash
# Allow only specific ports
iptables -A DOCKER-USER -p tcp --dport 80 -j ACCEPT
iptables -A DOCKER-USER -p tcp --dport 443 -j ACCEPT
iptables -A DOCKER-USER -j DROP

# Rate limiting
iptables -A DOCKER-USER -p tcp --dport 80 -m limit --limit 100/min -j ACCEPT
iptables -A DOCKER-USER -p tcp --dport 80 -j DROP

# Block specific IPs
iptables -A DOCKER-USER -s 192.168.1.100 -j DROP
```

### TLS/SSL Configuration

```yaml
services:
  nginx:
    image: nginx:alpine
    ports:
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
      - ./ssl/cert.pem:/etc/nginx/ssl/cert.pem:ro
      - ./ssl/key.pem:/etc/nginx/ssl/key.pem:ro
    secrets:
      - ssl_cert
      - ssl_key

secrets:
  ssl_cert:
    file: ./ssl/cert.pem
  ssl_key:
    file: ./ssl/key.pem
```

```nginx
# nginx.conf - Strong SSL configuration
server {
    listen 443 ssl http2;
    server_name example.com;

    # SSL certificates
    ssl_certificate /run/secrets/ssl_cert;
    ssl_certificate_key /run/secrets/ssl_key;

    # Strong SSL configuration
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers 'ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384';
    ssl_prefer_server_ciphers on;

    # HSTS
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    # Other security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "no-referrer-when-downgrade" always;
}
```

## Vulnerability Scanning

### Trivy (Recommended)

```bash
# Scan image
trivy image myapp:latest

# Scan with severity filter
trivy image --severity HIGH,CRITICAL myapp:latest

# Fail on vulnerabilities
trivy image --exit-code 1 --severity CRITICAL myapp:latest

# Scan filesystem
trivy fs /path/to/project

# Scan running container
trivy image $(docker ps -q --filter ancestor=myapp:latest)

# Generate report
trivy image --format json --output report.json myapp:latest

# Scan with inline ignore
trivy image --ignorefile .trivyignore myapp:latest
```

```yaml
# .trivyignore
CVE-2021-12345  # False positive, see JIRA-123
CVE-2021-67890  # Will fix in next sprint
```

### Integrate in CI/CD

```yaml
# GitHub Actions
name: Security Scan

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  scan:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Build image
        run: docker build -t myapp:${{ github.sha }} .

      - name: Run Trivy vulnerability scanner
        uses: aquasecurity/trivy-action@master
        with:
          image-ref: myapp:${{ github.sha }}
          format: 'sarif'
          output: 'trivy-results.sarif'
          severity: 'CRITICAL,HIGH'
          exit-code: '1'

      - name: Upload Trivy results to GitHub Security
        uses: github/codeql-action/upload-sarif@v3
        if: always()
        with:
          sarif_file: 'trivy-results.sarif'

      - name: Run Snyk to check for vulnerabilities
        uses: snyk/actions/docker@master
        env:
          SNYK_TOKEN: ${{ secrets.SNYK_TOKEN }}
        with:
          image: myapp:${{ github.sha }}
          args: --severity-threshold=high
```

### Continuous Scanning

```yaml
# Schedule daily scans
name: Daily Security Scan

on:
  schedule:
    - cron: '0 2 * * *'  # Daily at 2 AM

jobs:
  scan:
    runs-on: ubuntu-latest

    steps:
      - name: Pull production image
        run: docker pull myregistry.com/myapp:latest

      - name: Scan for vulnerabilities
        run: |
          trivy image --severity CRITICAL,HIGH myregistry.com/myapp:latest

      - name: Notify on failure
        if: failure()
        run: |
          # Send alert to Slack, email, etc.
          ./scripts/alert.sh "Security vulnerabilities found in production image"
```

## Compliance and Auditing

### CIS Docker Benchmark

```bash
# Run Docker Bench Security
docker run --rm --net host --pid host --userns host --cap-add audit_control \
    -v /etc:/etc:ro \
    -v /usr/bin/containerd:/usr/bin/containerd:ro \
    -v /usr/bin/runc:/usr/bin/runc:ro \
    -v /usr/lib/systemd:/usr/lib/systemd:ro \
    -v /var/lib:/var/lib:ro \
    -v /var/run/docker.sock:/var/run/docker.sock:ro \
    docker/docker-bench-security
```

### Audit Logging

```yaml
# Docker daemon configuration (/etc/docker/daemon.json)
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3",
    "labels": "production",
    "env": "os,customer"
  },
  "audit": {
    "enabled": true,
    "log-level": "info"
  }
}
```

```yaml
# Service logging
services:
  app:
    image: myapp:latest
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
        labels: "service,environment"
        env: "NODE_ENV"

    labels:
      service: "myapp"
      environment: "production"
      version: "1.0.0"
```

### Policy Enforcement (OPA)

```yaml
# conftest policy (policy.rego)
package main

deny[msg] {
    input.services[_].image
    not startswith(input.services[_].image, "myregistry.com/")
    msg = "Images must come from myregistry.com"
}

deny[msg] {
    input.services[service].security_opt
    not input.services[service].security_opt[_] == "no-new-privileges:true"
    msg = sprintf("Service %s must set no-new-privileges", [service])
}

deny[msg] {
    input.services[service].user
    input.services[service].user == "root"
    msg = sprintf("Service %s cannot run as root", [service])
}
```

```bash
# Test compose file against policy
conftest test docker-compose.yml

# In CI/CD
- name: Validate security policies
  run: |
    conftest test docker-compose.yml --policy ./policies
```

## Security Checklist

### Build Time

- [ ] Use minimal base images (Alpine, distroless)
- [ ] Multi-stage builds to reduce attack surface
- [ ] Scan dependencies for vulnerabilities
- [ ] No secrets in Dockerfile or layers
- [ ] Use specific version tags, not :latest
- [ ] Run as non-root user
- [ ] Implement health checks
- [ ] Use .dockerignore
- [ ] Sign images
- [ ] Generate and attach SBOM

### Runtime

- [ ] Run containers as non-root
- [ ] Read-only root filesystem
- [ ] Drop all capabilities, add only required
- [ ] Set no-new-privileges
- [ ] Apply resource limits (CPU, memory, PIDs)
- [ ] Use seccomp/AppArmor/SELinux
- [ ] Network isolation with internal networks
- [ ] Encrypt overlay networks
- [ ] Use secrets management
- [ ] Enable audit logging

### Infrastructure

- [ ] Keep Docker daemon updated
- [ ] Secure Docker socket (TLS)
- [ ] Enable Docker Content Trust
- [ ] Run CIS Docker Benchmark
- [ ] Implement network policies
- [ ] Use private registry
- [ ] Enable vulnerability scanning
- [ ] Monitor and alert on security events
- [ ] Regular security audits
- [ ] Incident response plan

### CI/CD

- [ ] Scan images in pipeline
- [ ] Block deployment on critical vulnerabilities
- [ ] Use OIDC instead of long-lived credentials
- [ ] Minimal permissions for CI/CD
- [ ] Sign commits and images
- [ ] Policy enforcement (OPA)
- [ ] Dependency pinning
- [ ] SAST/DAST integration
- [ ] Secret scanning in repos
- [ ] Audit CI/CD changes

## Common Vulnerabilities and Mitigations

### 1. Running as Root

```dockerfile
# ❌ VULNERABLE
FROM node:20-alpine
COPY . /app
CMD ["node", "index.js"]

# ✅ SECURE
FROM node:20-alpine
RUN addgroup -g 1001 nodejs && adduser -S nodejs -u 1001
COPY --chown=nodejs:nodejs . /app
USER nodejs
CMD ["node", "index.js"]
```

### 2. Secrets in Images

```dockerfile
# ❌ VULNERABLE
ENV API_KEY=secret123
RUN echo "API_KEY=secret123" > .env

# ✅ SECURE
# Use BuildKit secrets
RUN --mount=type=secret,id=api_key \
    API_KEY=$(cat /run/secrets/api_key) ./configure.sh

# Or runtime secrets (Docker Swarm)
# Pass via environment at runtime
```

### 3. Unrestricted Network Access

```yaml
# ❌ VULNERABLE
services:
  database:
    image: postgres:16-alpine
    ports:
      - "5432:5432"  # Exposed to internet

# ✅ SECURE
services:
  database:
    image: postgres:16-alpine
    networks:
      - backend  # Internal network only
    # No published ports
```

### 4. Missing Resource Limits

```yaml
# ❌ VULNERABLE
services:
  app:
    image: myapp:latest
    # No limits - can consume all resources

# ✅ SECURE
services:
  app:
    image: myapp:latest
    deploy:
      resources:
        limits:
          cpus: '1'
          memory: 1G
          pids: 100
```

### 5. Vulnerable Dependencies

```dockerfile
# ❌ VULNERABLE
FROM node:20-alpine
COPY package.json .
RUN npm install  # May install vulnerable versions

# ✅ SECURE
FROM node:20-alpine
COPY package*.json .
RUN npm ci  # Install exact versions from lock file
# AND scan with Trivy/Snyk in CI
```

## Incident Response

### Security Incident Checklist

1. **Detect** - Monitor logs, alerts, anomalies
2. **Contain** - Isolate affected containers
3. **Investigate** - Analyze logs, images, networks
4. **Remediate** - Patch vulnerabilities, rebuild images
5. **Recover** - Deploy secure versions
6. **Review** - Post-mortem, improve processes

### Emergency Response

```bash
#!/bin/bash
# emergency-response.sh - Isolate compromised container

CONTAINER_ID=$1

echo "SECURITY INCIDENT: Isolating container $CONTAINER_ID"

# Stop container
docker stop $CONTAINER_ID

# Capture logs
docker logs $CONTAINER_ID > incident-logs-$CONTAINER_ID.txt

# Export container filesystem for analysis
docker export $CONTAINER_ID > incident-fs-$CONTAINER_ID.tar

# Remove from network
docker network disconnect bridge $CONTAINER_ID

# Tag image for investigation
docker commit $CONTAINER_ID compromised-image:incident-$(date +%Y%m%d-%H%M%S)

echo "Container isolated. Logs and filesystem exported for analysis."
```

Remember: **Security is not a one-time task, it's a continuous process.**
