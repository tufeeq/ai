# Mail Hub — mailer (password reset + transactional email).
FROM node:22-alpine

ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/data \
    NODE_NO_WARNINGS=1

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY server.mjs ./
COPY src ./src
COPY public ./public

# State (SQLite database, generated admin.key) lives in /data, owned by the unprivileged user.
RUN mkdir -p /data && chown -R node:node /data && chmod 700 /data
VOLUME ["/data"]
USER node
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 8080) + '/health', { signal: AbortSignal.timeout(4000) }).then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]

CMD ["node", "server.mjs"]
