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

# Copy source code
COPY src ./src

# ✨ CRITICAL: Add cache buster to force fresh code copy
RUN echo "Cache bust: ${CACHE_BUST}" > /tmp/cache-bust.txt

# Build TypeScript to JavaScript
RUN npm run build

# Remove dev dependencies after build
RUN npm prune --production

# Production stage
FROM base AS production

# Accept build arguments
ARG NODE_ENV=production
ARG PORT=4002
ARG LOG_LEVEL=info
ARG RATE_LIMIT_WINDOW_MS=900000
ARG RATE_LIMIT_MAX_REQUESTS=100
ARG CORS_ORIGIN
ARG MONGODB_URI
ARG FIREBASE_PROJECT_ID
ARG FIREBASE_PRIVATE_KEY_ID
ARG FIREBASE_PRIVATE_KEY
ARG FIREBASE_CLIENT_EMAIL
ARG FIREBASE_CLIENT_ID
ARG FIREBASE_AUTH_URI
ARG FIREBASE_TOKEN_URI
ARG FIREBASE_AUTH_PROVIDER_X509_CERT_URL
ARG FIREBASE_CLIENT_X509_CERT_URL
ARG SERVICE_AUTH_TOKEN
ARG USER_SERVICE_URL
ARG MESSAGING_SERVICE_URL
ARG PAYMENT_SERVICE_URL

# Set environment variables from build arguments
ENV NODE_ENV=${NODE_ENV}
ENV PORT=${PORT}
ENV LOG_LEVEL=${LOG_LEVEL}
ENV RATE_LIMIT_WINDOW_MS=${RATE_LIMIT_WINDOW_MS}
ENV RATE_LIMIT_MAX_REQUESTS=${RATE_LIMIT_MAX_REQUESTS}
ENV CORS_ORIGIN=${CORS_ORIGIN}
ENV MONGODB_URI=${MONGODB_URI}
ENV FIREBASE_PROJECT_ID=${FIREBASE_PROJECT_ID}
ENV FIREBASE_PRIVATE_KEY_ID=${FIREBASE_PRIVATE_KEY_ID}
ENV FIREBASE_PRIVATE_KEY=${FIREBASE_PRIVATE_KEY}
ENV FIREBASE_CLIENT_EMAIL=${FIREBASE_CLIENT_EMAIL}
ENV FIREBASE_CLIENT_ID=${FIREBASE_CLIENT_ID}
ENV FIREBASE_AUTH_URI=${FIREBASE_AUTH_URI}
ENV FIREBASE_TOKEN_URI=${FIREBASE_TOKEN_URI}
ENV FIREBASE_AUTH_PROVIDER_X509_CERT_URL=${FIREBASE_AUTH_PROVIDER_X509_CERT_URL}
ENV FIREBASE_CLIENT_X509_CERT_URL=${FIREBASE_CLIENT_X509_CERT_URL}
ENV SERVICE_AUTH_TOKEN=${SERVICE_AUTH_TOKEN}
ENV USER_SERVICE_URL=${USER_SERVICE_URL}
ENV MESSAGING_SERVICE_URL=${MESSAGING_SERVICE_URL}
ENV PAYMENT_SERVICE_URL=${PAYMENT_SERVICE_URL}

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
