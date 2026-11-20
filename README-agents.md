# RAGPulse — agent briefing

Self-hosted, single-tenant AI support chat: indexes docs (FAQ, git repos, web pages), embeds a visitor chat widget, escalates unanswered questions to email. External bots/agents integrate over MCP at `/mcp` (personal API tokens).

## Stack

- TypeScript, Nuxt 4 (Nitro `bun` preset), Vue 3, zod — Bun, `bun.lock`
- MongoDB for documents + vectors: native `$vectorSearch` on Atlas / `mongodb-atlas-local` / `mongod`+mongot; automatic in-app cosine fallback on plain mongod
- OpenRouter or any OpenAI-compatible API for chat + embeddings (+ optional vision/code-summary models)
- `@modelcontextprotocol/sdk`, `nuxt-auth-utils` (Google/Microsoft), nodemailer, Readability/turndown/unpdf for ingestion
- Tests `bun test` (`tests/`); typecheck = `vue-tsc` on `.nuxt/tsconfig.{server,app}.json`; Prettier via `format`/`format:check`

## One codebase, three apps

- `RAGPULSE_APP=admin|chat|landing` selects the build; unset (`bun run dev`) = all-in-one on :3000 with landing at `/landing`
- Production split: **admin** (dashboard, admin API, `/mcp`, sync scheduler) and **chat** (visitor chat, `/api/chat/**`, `/embed.js`) — separate Docker images (`docker build --target admin|chat`), compose maps them to :3000/:3001
- **landing** is a static site (`bun run build:landing` → `.output/public`) deployed to Cloudflare via `wrangler.jsonc`
- `app.vue` vs `app.public.vue`: public builds (chat/landing) swap in the stripped public root component

## Commands

- dev: `make dev` (:3000) · `make dev-admin` (:3030) · `make dev-chat` (:3031) · `make dev-landing` (:3032)
- verify: `bun run check` (= `make check`) — what the `check` job in `docker.yml` runs
- DB only: `make db` — `docker compose up -d mongodb`
- containers: `make docker-build` / `make up` / `make down`
- prod build locally: `bun run build:admin|build:chat|build:landing`, `bun run start`
- deps+version: `make update` — `bun update` + date-version `YY.WWD.1HHMM`

## Conventions

- App config envs are `NUXT_*` (nuxt-auth-utils style); infra envs are `RAGPULSE_*` (`RAGPULSE_APP`, `RAGPULSE_BUILD_DIR`, `RAGPULSE_INFISICAL_*`)
- `server/preload.ts` runs via `bun --preload` in every dev/start/Docker command and loads Infisical secrets before Nuxt reads config — always run through the package.json scripts, never bare `nuxt`
- `landing/` contains only `public/` assets; the landing pages live in the main `app/` tree

## Corner cases

- The compose `mongodb` uses `mongodb/mongodb-atlas-local:8` (replica set + vector search). After the container is recreated, "not primary"/"not a member" errors mean the replica set lost itself — remove the `mongo-data` and `mongo-config` volumes and restart
- `NUXT_DEV_LOGIN` enables a passwordless dev sign-in
- Compose requires `NUXT_MONGODB_URI=…?directConnection=true` against the atlas-local container
- Two GH workflows: `docker.yml` (check + build/push admin+chat images to ghcr, Dokploy hook) and `landing.yml` (check + build + `wrangler deploy`)
- The Dokploy redeploy step in `docker.yml` runs only when the `DOKPLOY_URL` and `DOKPLOY_API_KEY` Actions secrets are set, and then also needs the `DOKPLOY_ADMIN_APP_ID` and `DOKPLOY_CHAT_APP_ID` Actions secrets (all four are secrets, not variables)

## Pointers

- `README.md` — architecture table, vector-search modes, full env reference · `REVIEW.md` — PR review-bot instructions
