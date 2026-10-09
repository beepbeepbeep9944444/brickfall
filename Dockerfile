FROM node:22-alpine

ENV NODE_ENV=production \
    PORT=8123 \
    DATA_DIR=/data \
    TRUST_PROXY=1

WORKDIR /app
COPY package.json ./
COPY server ./server
COPY public ./public

RUN mkdir -p /data && chown -R node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8123

HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8123/healthz || exit 1
CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.js"]
