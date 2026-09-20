# 1. Base Image: Node.js 18-slim
FROM node:18-slim

# 2. System paketlari (FFmpeg, Python3, Pip va Supervisor)
RUN apt-get update && apt-get install -y \
    ffmpeg \
    python3 \
    python3-pip \
    supervisor \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 3. Node.js paketlarini o'rnatish
COPY package*.json ./
RUN npm install --production

# 4. Python paketlarini faylsiz, to'g'ridan-to'g'ri o'rnatish (Barcha kerakli kutubxonalar)
RUN pip3 install --no-cache-dir \
    google-api-python-client \
    google-auth-oauthlib \
    google-auth-httplib2 \
    google-genai

# 5. Barcha loyiha fayllarini ko'chirish
COPY . .

# 6. Kerakli papkalarni yaratish
RUN mkdir -p assets temp

# 7. Supervisor sozlamasini o'rnatish
COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf

# 8. Ikkala botni bir vaqtda ishga tushirish
CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf"]
