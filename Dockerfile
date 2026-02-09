# Use Node.js 18 LTS Alpine image for smaller size
FROM node:18-alpine AS base

# Install security updates and necessary packages
RUN apk update && apk upgrade && \
    apk add --no-cache dumb-init curl && \
    rm -rf /var/cache/apk/*

# Create app directory with proper permissions
WORKDIR /app

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodeuser -u 1001

# Dependencies stage
FROM base AS dependencies

# Copy package files
COPY package.json package-lock.json* ./

# Install production dependencies only
RUN if [ -f package-lock.json ]; then \
      npm ci --omit=dev && npm cache clean --force; \
    else \
      npm install --omit=dev && npm cache clean --force; \
    fi

# Build stage
FROM base AS build

# Accept build cache buster argument
ARG CACHE_BUST=1

# Copy package files
COPY package.json package-lock.json* ./

# Install all dependencies (including dev dependencies for TypeScript)
RUN if [ -f package-lock.json ]; then \
      npm ci; \
    else \
      npm install; \
    fi

# Copy TypeScript configuration
COPY tsconfig.json ./

# ✨ CRITICAL: Use cache buster to invalidate cache for source copy
# This ARG must be passed at build time with a new value to bust cache
ARG CACHE_BUST
RUN echo "Build cache bust: ${CACHE_BUST:-$(date +%s)}" && \
    echo "${CACHE_BUST:-$(date +%s)}" > /tmp/build-id.txt

# Copy source code
COPY src ./src

# Build TypeScript to JavaScript
RUN npm run build

# Remove dev dependencies after build
RUN npm prune --production

# Production stage
FROM base AS production

# Set default environment variables (can be overridden at runtime)
# Sensitive variables should be provided via CapRover envVars, not build args
ENV NODE_ENV=production
ENV PORT=4002
ENV LOG_LEVEL=info
ENV RATE_LIMIT_WINDOW_MS=900000
ENV RATE_LIMIT_MAX_REQUESTS=100

# Note: The following environment variables should be set at runtime via CapRover:
# - CORS_ORIGIN
# - MONGODB_URI
# - FIREBASE_PROJECT_ID
# - FIREBASE_PRIVATE_KEY_ID
# - FIREBASE_PRIVATE_KEY
# - FIREBASE_CLIENT_EMAIL
# - FIREBASE_CLIENT_ID
# - FIREBASE_AUTH_URI
# - FIREBASE_TOKEN_URI
# - FIREBASE_AUTH_PROVIDER_X509_CERT_URL
# - FIREBASE_CLIENT_X509_CERT_URL
# - SERVICE_AUTH_TOKEN
# - USER_SERVICE_URL
# - MESSAGING_SERVICE_URL
# - PAYMENT_SERVICE_URL

# Copy production dependencies from dependencies stage
COPY --from=dependencies --chown=nodeuser:nodejs /app/node_modules ./node_modules

# Copy compiled JavaScript from build stage
COPY --from=build --chown=nodeuser:nodejs /app/dist ./dist
COPY --from=build --chown=nodeuser:nodejs /app/package.json ./

# Create logs directory with proper permissions
RUN mkdir -p logs && chown -R nodeuser:nodejs logs

# Remove unnecessary files for production
RUN rm -rf \
    .git \
    .gitignore \
    .env.example \
    *.md \
    .dockerignore \
    Dockerfile \
    tsconfig.json \
    src \
    node_modules/typescript \
    node_modules/@types

# Switch to non-root user
USER nodeuser

# Expose port
EXPOSE 4002

# ✅ HEALTH CHECK - Check localhost inside container
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD curl -f http://localhost:4002/api/v1/health || exit 1

# Use dumb-init for proper signal handling
ENTRYPOINT ["dumb-init", "--"]

# Start the application (run compiled JavaScript)
CMD ["node", "dist/server.js"]
