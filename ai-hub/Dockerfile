# AI Hub — runtime image.
# Build context is the ai-hub folder. The app has zero npm dependencies,
# so there is no install step: copy the sources and run them with Node 22.
FROM node:22-alpine

ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/data

WORKDIR /app

# Sources stay owned by root and read-only for the runtime user.
# .dockerignore keeps tests, docs, local data and secrets out of the image.
COPY . .

# Writable state (API key hashes, usage log, admin.key) lives in /data.
# The directory is created and owned by the unprivileged "node" user (uid 1000)
# before VOLUME, so a fresh named volume inherits that ownership.
RUN mkdir -p /data && chown -R node:node /data && chmod 700 /data
VOLUME ["/data"]

USER node

EXPOSE 8080

# No curl/wget needed: Node's built-in fetch checks the public /health route.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 8080) + '/health', { signal: AbortSignal.timeout(4000) }).then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]

CMD ["node", "server.mjs"]
