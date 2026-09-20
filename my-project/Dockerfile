FROM node:20-slim

# Python va supervisor vositalarini o'rnatamiz
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    supervisor \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Node.js loyihasi bog'liqliklarini o'rnatish
COPY package*.json ./
RUN npm install

# Python loyihasi bog'liqliklarini o'rnatish
COPY my-project/comment_bot/requirements.txt ./my-project/comment_bot/
RUN pip3 install -r ./my-project/comment_bot/requirements.txt --break-system-packages

# Barcha fayllarni konteynerga nusxalash
COPY . .

# Supervisor konfiguratsiyasini ko'chirish
COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf

CMD ["/usr/bin/supervisord"]
