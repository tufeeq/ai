FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY quote-service ./quote-service
COPY research ./research
RUN mkdir -p /var/lib/tagit && chown -R node:node /app /var/lib/tagit
USER node
ENV HOST=0.0.0.0 PORT=10000 TAGIT_PAPER_PYTHON=/usr/bin/python3
WORKDIR /app/quote-service
EXPOSE 10000
CMD ["node", "server.mjs"]
