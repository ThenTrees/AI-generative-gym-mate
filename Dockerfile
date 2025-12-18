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

# Build TypeScript (compiles src/ to dist/)
RUN npm run build

# Compile app.ts separately (since it's not in src/)
# Use same tsconfig but compile app.ts to dist/
RUN npx tsc app.ts --outDir ./dist --module commonjs --target ES2020 \
    --esModuleInterop --skipLibCheck --resolveJsonModule \
    --rootDir . --baseUrl . || \
    (echo "Warning: app.ts compilation failed, will use ts-node fallback")

# ======================
# Stage 2: Production
# ======================
FROM node:20-alpine AS production

WORKDIR /app

# Only install production deps
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# Copy built output only
COPY --from=builder /app/dist ./dist

# Copy app.ts and tsconfig for fallback (if compilation failed)
COPY --from=builder /app/app.ts ./
COPY --from=builder /app/tsconfig.json ./
COPY --from=builder /app/src ./src

# Install ts-node as fallback (in case app.ts compilation failed)
RUN npm install --save-dev ts-node typescript && npm cache clean --force

# Copy certs (for RDS SSL) - optional
COPY certs ./certs 2>/dev/null || true

# Security: non-root user
RUN addgroup -S nodejs && adduser -S nodejs -G nodejs
USER nodejs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', r => process.exit(r.statusCode === 200 ? 0 : 1))"

# 🚀 Run compiled JS if exists, otherwise use ts-node
CMD ["sh", "-c", "if [ -f dist/app.js ]; then node dist/app.js; else npx ts-node app.ts; fi"]
