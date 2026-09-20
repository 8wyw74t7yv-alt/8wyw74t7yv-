# 1. Base Image: Node.js 18-slim
FROM node:18-slim

# 2. System paketlari (FFmpeg va Python)
RUN apt-get update && apt-get install -y \
    ffmpeg \
    python3 \
    python3-pip \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 3. Node.js paketlarini o'rnatish
COPY package*.json ./
RUN npm install --production

# 4. Python paketlarini o'rnatish (Gemini uchun)
RUN pip3 install --no-cache-dir --break-system-packages \
    google-genai \
    google-generativeai

# 5. Barcha loyiha fayllarini ko'chirish
COPY . .

# 6. Kerakli papkalarni yaratish
RUN mkdir -p assets temp

# 7. Botni to'g'ridan-to'g'ri Node orqali ishga tushirish
CMD ["node", "src/index.js"]
