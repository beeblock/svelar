# GitHub Actions Deep Dive

Comprehensive guide to GitHub Actions workflows, patterns, and best practices.

## Table of Contents

- [Workflow Syntax](#workflow-syntax)
- [Reusable Workflows](#reusable-workflows)
- [Matrix Strategies](#matrix-strategies)
- [Caching Strategies](#caching-strategies)
- [Secrets Management](#secrets-management)
- [OIDC Authentication](#oidc-authentication)
- [Deployment Environments](#deployment-environments)
- [Performance Optimization](#performance-optimization)

## Workflow Syntax

### Basic Structure

```yaml
name: CI Pipeline

on:
  push:
    branches: [main, develop]
    paths:
      - 'src/**'
      - 'package.json'
      - '.github/workflows/**'
  pull_request:
    branches: [main]
  schedule:
    - cron: '0 2 * * *'  # Daily at 2 AM UTC
  workflow_dispatch:
    inputs:
      environment:
        description: 'Environment to deploy'
        required: true
        type: choice
        options:
          - staging
          - production

# Prevent concurrent runs
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: ${{ github.event_name == 'pull_request' }}

env:
  NODE_VERSION: '20'
  REGISTRY: ghcr.io

jobs:
  # Job definitions...
```

### Job Dependencies

```yaml
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: Build application
        run: npm run build

  test:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - name: Run tests
        run: npm test

  deploy:
    needs: [build, test]  # Wait for both
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - name: Deploy to production
        run: ./scripts/deploy.sh
```

## Reusable Workflows

### Creating a Reusable Workflow

```yaml
# .github/workflows/reusable-docker-build.yml
name: Reusable Docker Build

on:
  workflow_call:
    inputs:
      image-name:
        required: true
        type: string
      dockerfile:
        required: false
        type: string
        default: 'Dockerfile'
      build-args:
        required: false
        type: string
        default: ''
    outputs:
      image-tag:
        description: "The image tag that was built"
        value: ${{ jobs.build.outputs.image-tag }}
    secrets:
      registry-username:
        required: true
      registry-password:
        required: true

jobs:
  build:
    runs-on: ubuntu-latest
    outputs:
      image-tag: ${{ steps.meta.outputs.tags }}
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Login to Registry
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ secrets.registry-username }}
          password: ${{ secrets.registry-password }}

      - name: Docker meta
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: ghcr.io/${{ inputs.image-name }}
          tags: |
            type=ref,event=branch
            type=ref,event=pr
            type=semver,pattern={{version}}
            type=semver,pattern={{major}}.{{minor}}
            type=sha,prefix={{branch}}-

      - name: Build and push
        uses: docker/build-push-action@v5
        with:
          context: .
          file: ${{ inputs.dockerfile }}
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          build-args: ${{ inputs.build-args }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

### Using a Reusable Workflow

```yaml
# .github/workflows/build-app.yml
name: Build Application

on:
  push:
    branches: [main]

jobs:
  build-backend:
    uses: ./.github/workflows/reusable-docker-build.yml
    with:
      image-name: myorg/backend
      dockerfile: docker/Dockerfile.backend
      build-args: |
        NODE_ENV=production
        API_VERSION=v1
    secrets:
      registry-username: ${{ github.actor }}
      registry-password: ${{ secrets.GITHUB_TOKEN }}

  build-frontend:
    uses: ./.github/workflows/reusable-docker-build.yml
    with:
      image-name: myorg/frontend
      dockerfile: docker/Dockerfile.frontend
    secrets:
      registry-username: ${{ github.actor }}
      registry-password: ${{ secrets.GITHUB_TOKEN }}

  deploy:
    needs: [build-backend, build-frontend]
    runs-on: ubuntu-latest
    steps:
      - name: Deploy with new images
        run: echo "Deploying..."
```

## Matrix Strategies

### Multi-Version Testing

```yaml
jobs:
  test:
    runs-on: ${{ matrix.os }}
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, windows-latest, macos-latest]
        node-version: [18, 20, 22]
        include:
          # Add specific combinations
          - os: ubuntu-latest
            node-version: 20
            run-integration: true
        exclude:
          # Exclude specific combinations
          - os: macos-latest
            node-version: 18

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup Node.js ${{ matrix.node-version }}
        uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node-version }}
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Run tests
        run: npm test

      - name: Run integration tests
        if: matrix.run-integration
        run: npm run test:integration
```

### Multi-Platform Docker Builds

```yaml
jobs:
  build:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        platform:
          - linux/amd64
          - linux/arm64
          - linux/arm/v7

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Set up QEMU
        uses: docker/setup-qemu-action@v3

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Build for ${{ matrix.platform }}
        uses: docker/build-push-action@v5
        with:
          context: .
          platforms: ${{ matrix.platform }}
          push: false
          tags: myapp:${{ github.sha }}-${{ matrix.platform }}
          cache-from: type=gha,scope=${{ matrix.platform }}
          cache-to: type=gha,mode=max,scope=${{ matrix.platform }}
```

## Caching Strategies

### NPM/Yarn Cache

```yaml
- name: Setup Node.js
  uses: actions/setup-node@v4
  with:
    node-version: '20'
    cache: 'npm'  # or 'yarn' or 'pnpm'

# Or manual caching for more control
- name: Cache dependencies
  uses: actions/cache@v4
  with:
    path: |
      ~/.npm
      node_modules
    key: ${{ runner.os }}-node-${{ hashFiles('**/package-lock.json') }}
    restore-keys: |
      ${{ runner.os }}-node-
```

### Docker Layer Caching

```yaml
- name: Build and push
  uses: docker/build-push-action@v5
  with:
    context: .
    push: true
    tags: myapp:latest
    # GitHub Actions cache (recommended)
    cache-from: type=gha
    cache-to: type=gha,mode=max
    # Or registry cache
    # cache-from: type=registry,ref=myapp:buildcache
    # cache-to: type=registry,ref=myapp:buildcache,mode=max
```

### Composer (PHP) Cache

```yaml
- name: Get Composer cache directory
  id: composer-cache
  run: echo "dir=$(composer config cache-files-dir)" >> $GITHUB_OUTPUT

- name: Cache Composer dependencies
  uses: actions/cache@v4
  with:
    path: ${{ steps.composer-cache.outputs.dir }}
    key: ${{ runner.os }}-composer-${{ hashFiles('**/composer.lock') }}
    restore-keys: |
      ${{ runner.os }}-composer-
```

### Build Artifacts Cache

```yaml
- name: Cache build output
  uses: actions/cache@v4
  with:
    path: |
      dist
      .next/cache
      .nuxt
    key: ${{ runner.os }}-build-${{ hashFiles('src/**') }}
    restore-keys: |
      ${{ runner.os }}-build-
```

## Secrets Management

### GitHub Secrets

```yaml
# Access repository secrets
- name: Deploy to server
  env:
    SSH_PRIVATE_KEY: ${{ secrets.SSH_PRIVATE_KEY }}
    DB_PASSWORD: ${{ secrets.DB_PASSWORD }}
  run: |
    echo "$SSH_PRIVATE_KEY" > key.pem
    chmod 600 key.pem
    ssh -i key.pem user@server "docker-compose up -d"

# Access organization secrets
- name: Use org secret
  env:
    ORG_API_KEY: ${{ secrets.ORG_API_KEY }}
  run: ./deploy.sh
```

### Environment Secrets

```yaml
jobs:
  deploy-staging:
    runs-on: ubuntu-latest
    environment: staging
    steps:
      - name: Deploy
        env:
          API_URL: ${{ vars.API_URL }}  # Environment variable
          API_KEY: ${{ secrets.API_KEY }}  # Environment secret
        run: ./deploy.sh

  deploy-production:
    runs-on: ubuntu-latest
    environment: production  # Requires approval
    steps:
      - name: Deploy
        env:
          API_URL: ${{ vars.API_URL }}
          API_KEY: ${{ secrets.API_KEY }}
        run: ./deploy.sh
```

### Secret Masking

```yaml
- name: Add mask for dynamic secret
  run: |
    SECRET=$(generate-secret.sh)
    echo "::add-mask::$SECRET"
    echo "SECRET=$SECRET" >> $GITHUB_ENV

- name: Use masked secret
  run: |
    echo "Using secret: $SECRET"  # Will be masked in logs
```

## OIDC Authentication

### AWS OIDC

```yaml
jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      id-token: write
      contents: read

    steps:
      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::123456789012:role/GitHubActionsRole
          aws-region: us-east-1

      - name: Deploy to AWS
        run: |
          aws ecr get-login-password | docker login --username AWS --password-stdin 123456789012.dkr.ecr.us-east-1.amazonaws.com
          docker push myapp:latest
```

### Azure OIDC

```yaml
jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      id-token: write
      contents: read

    steps:
      - name: Azure Login
        uses: azure/login@v1
        with:
          client-id: ${{ secrets.AZURE_CLIENT_ID }}
          tenant-id: ${{ secrets.AZURE_TENANT_ID }}
          subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID }}

      - name: Deploy to Azure
        run: az webapp deploy
```

### Google Cloud OIDC

```yaml
jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      id-token: write
      contents: read

    steps:
      - name: Authenticate to Google Cloud
        uses: google-github-actions/auth@v2
        with:
          workload_identity_provider: 'projects/123456789/locations/global/workloadIdentityPools/github/providers/github-provider'
          service_account: 'github-actions@project.iam.gserviceaccount.com'

      - name: Deploy to GCP
        run: gcloud run deploy myapp --image gcr.io/project/myapp:latest
```

## Deployment Environments

### Environment Protection Rules

```yaml
jobs:
  deploy-staging:
    runs-on: ubuntu-latest
    environment:
      name: staging
      url: https://staging.example.com
    steps:
      - name: Deploy to staging
        run: ./deploy.sh staging

  deploy-production:
    needs: deploy-staging
    runs-on: ubuntu-latest
    environment:
      name: production
      url: https://example.com
    steps:
      - name: Deploy to production
        run: ./deploy.sh production
```

Configure protection rules in GitHub:
- Required reviewers
- Wait timer (e.g., 5 minutes)
- Deployment branches (only main/release branches)

### Dynamic Environments

```yaml
jobs:
  deploy-preview:
    runs-on: ubuntu-latest
    if: github.event_name == 'pull_request'
    environment:
      name: preview-pr-${{ github.event.pull_request.number }}
      url: https://pr-${{ github.event.pull_request.number }}.example.com
    steps:
      - name: Deploy preview
        run: ./deploy-preview.sh ${{ github.event.pull_request.number }}
```

## Performance Optimization

### Parallel Jobs

```yaml
jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - run: npm run lint

  unit-test:
    runs-on: ubuntu-latest
    steps:
      - run: npm run test:unit

  integration-test:
    runs-on: ubuntu-latest
    steps:
      - run: npm run test:integration

  # These run in parallel, then deploy waits for all
  deploy:
    needs: [lint, unit-test, integration-test]
    runs-on: ubuntu-latest
    steps:
      - run: ./deploy.sh
```

### Conditional Steps

```yaml
- name: Build application
  run: npm run build

- name: Run expensive tests
  if: github.event_name == 'push' && github.ref == 'refs/heads/main'
  run: npm run test:e2e

- name: Deploy
  if: success() && github.ref == 'refs/heads/main'
  run: ./deploy.sh

- name: Notify on failure
  if: failure()
  run: ./notify-slack.sh "Build failed"
```

### Dependency Graph Optimization

```yaml
jobs:
  # Stage 1: Fast checks (run in parallel)
  lint:
    runs-on: ubuntu-latest
    steps:
      - run: npm run lint

  type-check:
    runs-on: ubuntu-latest
    steps:
      - run: npm run type-check

  # Stage 2: Unit tests (after fast checks)
  unit-test:
    needs: [lint, type-check]
    runs-on: ubuntu-latest
    steps:
      - run: npm run test:unit

  # Stage 3: Build (after unit tests pass)
  build:
    needs: unit-test
    runs-on: ubuntu-latest
    steps:
      - run: npm run build

  # Stage 4: Integration tests (after build)
  integration-test:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - run: npm run test:integration

  # Stage 5: Deploy (after everything passes)
  deploy:
    needs: [build, integration-test]
    runs-on: ubuntu-latest
    steps:
      - run: ./deploy.sh
```

## Advanced Patterns

### Monorepo Path Filtering

```yaml
on:
  push:
    paths:
      - 'apps/backend/**'
      - 'packages/shared/**'

jobs:
  build-backend:
    runs-on: ubuntu-latest
    steps:
      - name: Check changed files
        id: changes
        uses: dorny/paths-filter@v3
        with:
          filters: |
            backend:
              - 'apps/backend/**'
            shared:
              - 'packages/shared/**'

      - name: Build backend
        if: steps.changes.outputs.backend == 'true' || steps.changes.outputs.shared == 'true'
        run: npm run build:backend
```

### Artifact Sharing

```yaml
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: Build application
        run: npm run build

      - name: Upload build artifacts
        uses: actions/upload-artifact@v4
        with:
          name: build-output
          path: dist/
          retention-days: 7

  test:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - name: Download build artifacts
        uses: actions/download-artifact@v4
        with:
          name: build-output
          path: dist/

      - name: Test built application
        run: npm run test:built

  deploy:
    needs: [build, test]
    runs-on: ubuntu-latest
    steps:
      - name: Download build artifacts
        uses: actions/download-artifact@v4
        with:
          name: build-output
          path: dist/

      - name: Deploy
        run: ./deploy.sh dist/
```

### Composite Actions

```yaml
# .github/actions/setup-project/action.yml
name: 'Setup Project'
description: 'Setup Node.js and install dependencies'
inputs:
  node-version:
    description: 'Node.js version'
    required: false
    default: '20'
runs:
  using: 'composite'
  steps:
    - name: Setup Node.js
      uses: actions/setup-node@v4
      with:
        node-version: ${{ inputs.node-version }}
        cache: 'npm'

    - name: Install dependencies
      shell: bash
      run: npm ci

    - name: Verify installation
      shell: bash
      run: npm list --depth=0

# Usage in workflow
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: ./.github/actions/setup-project
        with:
          node-version: '20'
      - run: npm run build
```

## Debugging Workflows

### Enable Debug Logging

Set repository secrets:
- `ACTIONS_RUNNER_DEBUG`: `true`
- `ACTIONS_STEP_DEBUG`: `true`

### Debug Steps

```yaml
- name: Debug information
  run: |
    echo "Event name: ${{ github.event_name }}"
    echo "Ref: ${{ github.ref }}"
    echo "SHA: ${{ github.sha }}"
    echo "Actor: ${{ github.actor }}"
    echo "Runner OS: ${{ runner.os }}"
    env | sort

- name: Dump GitHub context
  env:
    GITHUB_CONTEXT: ${{ toJSON(github) }}
  run: echo "$GITHUB_CONTEXT"

- name: Dump job context
  env:
    JOB_CONTEXT: ${{ toJSON(job) }}
  run: echo "$JOB_CONTEXT"
```

### SSH Debug Session

```yaml
- name: Setup tmate session
  if: failure()
  uses: mxschmitt/action-tmate@v3
  timeout-minutes: 30
```

## Security Best Practices

1. **Pin action versions** to commit SHAs, not tags
2. **Use OIDC** instead of long-lived credentials
3. **Limit permissions** with `permissions:` key
4. **Never log secrets** - they're automatically masked, but be careful
5. **Use environment secrets** for sensitive deployments
6. **Audit third-party actions** before using them
7. **Enable branch protection** rules
8. **Require status checks** before merging
9. **Use CodeQL** for security scanning
10. **Rotate secrets** regularly

```yaml
# Minimal permissions example
permissions:
  contents: read
  pull-requests: write

jobs:
  build:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    steps:
      - uses: actions/checkout@692973e3d937129bcbf40652eb9f2f61becf3332 # v4.1.7
```
