# ---------------------------------------------------
# 1. TEPASI: Node.js Telegram bot uchun muhit
# ---------------------------------------------------
FROM node:18-slim

# FFmpeg, Python3 va Supervisor o'rnatamiz
RUN apt-get update && apt-get install -y \
    ffmpeg \
    python3 \
    python3-pip \
    supervisor \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Node.js fayllari va paketlarini o'rnatish
COPY package*.json ./
RUN npm install --production

# ---------------------------------------------------
# 2. PASTKI QISMI: Python paketlarini o'rnatish
# ---------------------------------------------------

# Root'dagi va YouTube bot'dagi har ikkala requirements faylini o'rnatamiz
COPY requirements.txt ./
COPY my-project/comment_bot/requirements.txt ./comment_bot/

RUN pip3 install --no-cache-dir -r requirements.txt && \
    pip3 install --no-cache-dir -r comment_bot/requirements.txt

# Barcha loyiha fayllarini nusxalash
COPY . .

# Kerakli papkalarni yaratish
RUN mkdir -p assets temp comment_bot

# Supervisor konfiguratsiyasini nusxalash
COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf

# ---------------------------------------------------
# 3. IKKALA BOTNI BIR VAQTDA ISHGA TUSHIRISH
# ---------------------------------------------------
CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf"]
