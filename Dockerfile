# 1. Base Image: Node.js 18-slim
FROM node:18-slim

# 2. System paketlari (faqat FFmpeg)
RUN apt-get update && apt-get install -y \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 3. Node.js paketlarini o'rnatish
COPY package*.json ./
RUN npm install --production

# 4. Barcha loyiha fayllarini ko'chirish
COPY . .

# 5. Kerakli papkalarni yaratish
RUN mkdir -p assets temp

# 6. Botni to'g'ridan-to'g'ri Node orqali ishga tushirish
CMD ["node", "src/index.js"]
