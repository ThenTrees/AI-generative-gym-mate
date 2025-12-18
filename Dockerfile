# ======================
# Stage 1: Builder
# ======================
FROM node:20-alpine AS builder

WORKDIR /app

# Copy lock files first (cache-friendly)
COPY package.json package-lock.json ./
RUN npm ci

# Copy source
COPY tsconfig.json ./
COPY src ./src
COPY app.ts ./

# Build TypeScript -> dist
RUN npm run build


# ======================
# Stage 2: Production
# ======================
FROM node:20-alpine AS production

WORKDIR /app

ENV NODE_ENV=production

# Install prod dependencies only
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy compiled output only
COPY --from=builder /app/dist ./dist

# Create non-root user
RUN addgroup -S nodejs && adduser -S nodejs -G nodejs
USER nodejs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', r => process.exit(r.statusCode === 200 ? 0 : 1))"

CMD ["node", "dist/app.js"]
