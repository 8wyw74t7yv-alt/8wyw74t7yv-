FROM node:18-slim

# FFmpeg vositasini o'rnatamiz (Voice tag va audio tayyorlash uchun)
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY . .

# Voice tag uchun bo'sh audio papkasini yaratamiz
RUN mkdir -p assets temp

CMD ["npm", "start"]
