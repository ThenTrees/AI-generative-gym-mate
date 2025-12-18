# ======================
# Stage 1: Build
# ======================
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
COPY app.ts ./

# Build TypeScript (src -> dist)
RUN npm run build

# Compile app.ts separately (in case it's not included in src)
RUN npx tsc app.ts \
  --outDir ./dist \
  --module commonjs \
  --target ES2020 \
  --esModuleInterop \
  --skipLibCheck \
  --resolveJsonModule \
  --rootDir . \
  --baseUrl .

# ======================
# Stage 2: Production
# ======================
FROM node:20-alpine AS production

WORKDIR /app

# Install production dependencies only
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# Copy built output
COPY --from=builder /app/dist ./dist

# Copy source & config (optional but safe)
COPY --from=builder /app/app.ts ./
COPY --from=builder /app/tsconfig.json ./
COPY --from=builder /app/src ./src

# Copy SSL certs (MUST exist in repo)
COPY certs ./certs

# Security: run as non-root
RUN addgroup -S nodejs && adduser -S nodejs -G nodejs
USER nodejs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', r => process.exit(r.statusCode === 200 ? 0 : 1))"

# Run compiled JS
CMD ["node", "dist/app.js"]
