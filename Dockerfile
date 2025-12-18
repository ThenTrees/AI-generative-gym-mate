# ======================
# 1️⃣ BUILD STAGE
# ======================
FROM node:20-alpine AS builder

WORKDIR /app

# Copy dependency files
COPY package.json package-lock.json ./

# Install dependencies (exact versions)
RUN npm ci

# Copy source code
COPY . .

# Build TypeScript → dist/
RUN npm run build


# ======================
# 2️⃣ RUNTIME STAGE
# ======================
FROM node:20-alpine AS runner

WORKDIR /app

# Set production env
ENV NODE_ENV=production

# Copy only what is needed to run
COPY --from=builder /app/package.json ./
COPY --from=builder /app/package-lock.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/certs ./certs

# Expose service port (đổi nếu app bạn khác)
EXPOSE 3000

# Start app
CMD ["node", "dist/index.js"]
