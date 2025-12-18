FROM node:20-alpine

WORKDIR /app

# Copy package files trước để cache layer
COPY package*.json ./

RUN npm ci

# Copy source
COPY . .

# 🔥 BẮT BUỘC: build TypeScript → dist/
RUN npm run build

# App chạy port 3000
EXPOSE 3000

# 🔥 File này PHẢI tồn tại sau build
CMD ["node", "dist/index.js"]
