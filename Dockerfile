# Imagem única para a VPS (fase 3): Next.js + worker (Node, ffmpeg, Python/OpenCV, Chromium do Remotion).
FROM node:22-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg python3 python3-pip python3-numpy ca-certificates \
      libnss3 libdbus-1-3 libatk1.0-0 libgbm1 libasound2 libxrandr2 libxkbcommon0 libxfixes3 libxcomposite1 libxdamage1 libatk-bridge2.0-0 libcups2 libpango-1.0-0 libcairo2 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY worker/requirements.txt worker/requirements.txt
RUN pip3 install --break-system-packages --no-cache-dir -r worker/requirements.txt
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npx remotion browser ensure && npm run build
ENV NODE_ENV=production PORT=3000 DATA_DIR=/data
VOLUME /data
EXPOSE 3000
CMD ["npm", "start"]
