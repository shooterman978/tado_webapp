# syntax=docker/dockerfile:1
# MVP scaffold: run TypeScript via tsx. Bundle/harden in a later pass.
FROM node:22-bookworm-slim
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/
COPY packages/bridge/package.json packages/bridge/
COPY apps/api/package.json apps/api/

# hap-controller pulls optional BLE native deps (noble); we only use IP/HTTP.
RUN pnpm install --filter @heizplan/api... --frozen-lockfile --ignore-scripts

COPY packages/shared packages/shared
COPY packages/bridge packages/bridge
COPY apps/api apps/api

ENV NODE_ENV=production
ENV API_HOST=0.0.0.0
ENV API_PORT=3080
# Corepack needs a writable home when running as non-root (`pnpm exec` → EACCES otherwise).
ENV HOME=/home/heizplan
ENV COREPACK_HOME=/home/heizplan/.cache/node/corepack

RUN useradd --system --create-home --uid 10001 --home-dir /home/heizplan heizplan \
 && mkdir -p /data/bridge "$COREPACK_HOME" \
 && chown -R heizplan:heizplan /data /app /home/heizplan

USER heizplan
EXPOSE 3080
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3080/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

WORKDIR /app/apps/api
CMD ["pnpm", "exec", "tsx", "src/index.ts"]
