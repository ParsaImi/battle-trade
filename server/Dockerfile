# Battle Trade game server — Node + Express + ws.
FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

# Dependencies first: a source-only change reuses this layer.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src

# Player saves live on a mounted volume, never in an image layer.
# Creating it here (owned by `node`) means a fresh named volume inherits
# that ownership the first time Docker populates it.
ENV DATA_DIR=/app/data
RUN mkdir -p /app/data && chown -R node:node /app/data

USER node
EXPOSE 8787

# The server already serves /health with uptime + connection count.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8787/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

# Exec form so node is the direct child of the init and actually receives
# SIGTERM — that is what triggers the synchronous save flush on shutdown.
CMD ["node", "src/index.js"]
