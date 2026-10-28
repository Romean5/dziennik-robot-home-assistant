FROM node:22-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends nginx openssl && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build
ENV NODE_ENV=production
ENV DZIENNIK_DATA_DIR=/data/native
ENV WRANGLER_WRITE_LOGS=false
ENV WRANGLER_LOG_PATH=/tmp/wrangler-logs
ENV MINIFLARE_REGISTRY_PATH=/tmp/wrangler-registry
EXPOSE 8099
CMD ["sh", "/app/run-gateway.sh"]
