# ---------- Builder ----------
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package.json only
COPY package.json ./

# Install all dependencies
RUN npm install

# Copy source code
COPY . .

# Build app (nếu có step build)
# Nếu app bạn không có build step thì có thể xoá dòng này
RUN npm run build


# ---------- Production ----------
FROM node:20-alpine AS production

WORKDIR /app

# Copy package.json only
COPY package.json ./

# Install production dependencies only
RUN npm install --omit=dev && npm cache clean --force

# Copy built app from builder
COPY --from=builder /app/dist ./dist
# Nếu app bạn không có dist, đổi thành:
# COPY --from=builder /app ./

EXPOSE 3000

CMD ["node", "dist/index.js"]
# hoặc
# CMD ["npm", "start"]
