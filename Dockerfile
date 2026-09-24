# 1. Base Image: Node.js 18-alpine (Slim'dan ham kichikroq va tezroq)
FROM node:18-alpine

WORKDIR /app

# 2. Node.js paketlarini o'rnatish
COPY package*.json ./
RUN npm install --production

# 3. Barcha loyiha fayllarini ko'chirish
COPY . .

# 4. Kerakli papkalarni yaratish
RUN mkdir -p assets temp

# 5. Server/Bot portini ochish (Fly.io uchun)
EXPOSE 3000

# 6. Ishga tushirish
CMD ["node", "src/index.js"]
