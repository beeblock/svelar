# syntax=docker/dockerfile:1

# Multi-stage Dockerfile for Node.js application
# Optimized for production with security best practices

# ============================================
# Stage 1: Base - Common dependencies
# ============================================
FROM node:20-alpine AS base

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 -G nodejs

# Set working directory
WORKDIR /app

# ============================================
# Stage 2: Dependencies - Install all deps
# ============================================
FROM base AS dependencies

# Copy package files
COPY package.json package-lock.json ./

# Install all dependencies (dev + prod)
RUN npm ci

# ============================================
# Stage 3: Build - Compile application
# ============================================
FROM dependencies AS builder

# Copy source code
COPY --chown=nodejs:nodejs . .

# Build application
RUN npm run build

# Prune dev dependencies
RUN npm prune --production

# ============================================
# Stage 4: Production - Minimal runtime image
# ============================================
FROM base AS production

# Set environment
ENV NODE_ENV=production

# Copy only production dependencies
COPY --from=builder --chown=nodejs:nodejs /app/node_modules ./node_modules

# Copy built application
COPY --from=builder --chown=nodejs:nodejs /app/dist ./dist

# Copy package.json for metadata
COPY --from=builder --chown=nodejs:nodejs /app/package.json ./

# Switch to non-root user
USER nodejs

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Start application
CMD ["node", "dist/index.js"]

# ============================================
# Stage 5: Development - For local development
# ============================================
FROM dependencies AS development

# Install development tools
RUN apk add --no-cache git curl

# Copy source code
COPY --chown=nodejs:nodejs . .

# Switch to non-root user
USER nodejs

# Expose port and debug port
EXPOSE 3000 9229

# Start with hot reload and debugging
CMD ["npm", "run", "dev"]
