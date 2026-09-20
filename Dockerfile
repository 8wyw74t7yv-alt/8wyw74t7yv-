# ---------------------------------------------------
# 1. TEPASI: Node.js Telegram bot uchun muhit
# ---------------------------------------------------
FROM node:18-slim

# FFmpeg (Telegram bot uchun) va Python3 + Supervisor (YouTube bot uchun) o'rnatamiz
RUN apt-get update && apt-get install -y \
    ffmpeg \
    python3 \
    python3-pip \
    supervisor \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Node.js loyiha fayllari va kutubxonalarini o'rnatish
COPY package*.json ./
RUN npm install --production

# ---------------------------------------------------
# 2. PASTKI QISMI: Python YouTube Comment Bot uchun muhit
# ---------------------------------------------------

# Python paketlarini (google-api-python-client, google-genai va h.k.) o'rnatish
COPY comment_bot/requirements.txt ./comment_bot/
RUN pip3 install --no-cache-dir -r comment_bot/requirements.txt

# Barcha kod va aktivlarni nusxalash
COPY . .

# Kerakli papkalarni yaratish
RUN mkdir -p assets temp comment_bot

# Supervisor konfiguratsiyasini mos joyga nusxalash
COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf

# ---------------------------------------------------
# 3. IKKALA BOTNI BIR VAQTDA ISHGA TUSHIRISH
# ---------------------------------------------------
CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf"]
