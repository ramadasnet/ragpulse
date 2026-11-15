# Two images from one codebase: `docker build --target admin` and `docker build --target chat`.
FROM oven/bun:1 AS source
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile
COPY . .

FROM source AS build-admin
RUN bun run build:admin

FROM source AS build-chat
RUN bun run build:chat

FROM oven/bun:1-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0
EXPOSE 3000
# Loads secrets from Infisical (when RAGPULSE_INFISICAL_CLIENT_ID is set) before the server reads its configuration
COPY --from=source /app/server/preload.ts ./server/preload.ts
COPY --from=source /app/server/utils/infisical.ts ./server/utils/infisical.ts
CMD ["bun", "--preload", "./server/preload.ts", ".output/server/index.mjs"]

FROM runtime AS chat
COPY --from=build-chat /app/.output ./.output
USER bun

FROM runtime AS admin
# git is required to index git repositories
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=build-admin /app/.output ./.output
USER bun
