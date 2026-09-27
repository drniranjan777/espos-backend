# ---- Dependencies (production only) ----
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# ---- Runtime ----
FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json knexfile.js docker-entrypoint.sh ./
COPY src ./src

RUN mkdir -p uploads && chown -R node:node /app && chmod +x docker-entrypoint.sh
USER node

EXPOSE 5000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:5000/api/v1/health || exit 1

ENTRYPOINT ["./docker-entrypoint.sh"]
