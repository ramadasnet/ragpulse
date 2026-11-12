# RAGPulse

Self-hosted, single-tenant AI support chat for your projects. Index your docs (FAQ, git repositories, web pages), embed a fast
chat on your sites, escalate what the AI can't answer to your support email — and plug your own bots and agents in via **MCP**
so they can act on unanswered questions.

- **Stack:** TypeScript · Nuxt 4 · Bun · MongoDB (documents + vectors) · OpenRouter (chat + embeddings)
- **Admin:** Google / Microsoft social login, Admin and Assistant roles with per-project permissions
- **Chat:** JS embed (floating launcher) or iframe, light/dark themes with 3 custom colours, domain allowlist
- **MCP:** Streamable HTTP endpoint at `/mcp`, authenticated with personal API tokens

## Architecture

RAGPulse runs as two independent servers sharing the same MongoDB, built from this codebase:

| App     | Image                               | Serves                                                                         |
| ------- | ----------------------------------- | ------------------------------------------------------------------------------ |
| Admin   | `ghcr.io/ramadasnet/ragpulse-admin` | Dashboard (`/admin`), login, admin API, MCP (`/mcp`), source sync scheduler    |
| Chat    | `ghcr.io/ramadasnet/ragpulse-chat`  | Visitor chat page (`/chat/:projectId`), chat API (`/api/chat/**`), `/embed.js` |
| Landing | static files                        | Landing page at `/`, no server, for Cloudflare Pages/Workers                    |

The build target is selected with `RAGPULSE_APP=admin|chat|landing` (`bun run build:admin` / `bun run build:chat` /
`bun run build:landing`, or `docker build --target admin|chat`). Without it (e.g. `bun run dev`) all apps are served
by one server (the landing page is then at `/landing`). Project changes reach the chat instance within 30 seconds
(public project cache TTL).

## Why MongoDB?

MongoDB stores both the application data and the embeddings, and queries them with native `$vectorSearch`
(Atlas Vector Search). It runs on:

| Deployment                                                                 | Vector search                                                                |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| MongoDB Atlas (any tier, incl. free)                                       | Native `$vectorSearch`                                                       |
| `mongodb/mongodb-atlas-local` Docker image (included `docker-compose.yml`) | Native `$vectorSearch`                                                       |
| MongoDB Community 8.2+ with `mongot`                                       | Native `$vectorSearch`                                                       |
| Plain `mongod`                                                             | Automatic in-app cosine similarity fallback (fine for small knowledge bases) |

RAGPulse creates the vector index automatically on startup and tells you the active mode on **System**.
(Postgres + pgvector would be an equally valid choice; MongoDB was chosen for the flexible document model and preference.)

## Quick start

```bash
cp .env.example .env        # fill in OpenRouter key, OAuth credentials, admin emails, SMTP
docker compose up -d        # MongoDB (atlas-local), admin on http://localhost:3000, chat on http://localhost:3001
```

The bundled MongoDB port is exposed only on localhost; the application containers connect to it over Docker's private network.

### Local development

```bash
bun install                       # or: make install
docker compose up -d mongodb      # or: make db, or point NUXT_MONGODB_URI to Atlas
bun run dev                       # or: make dev, all apps on one origin at http://localhost:3000
bun run dev:admin                 # or: make dev-admin, admin instance on http://localhost:3030
bun run dev:chat                  # or: make dev-chat, chat instance on http://localhost:3031
bun run dev:landing               # or: make dev-landing, landing page on http://localhost:3032
make check                        # typecheck and tests
```

`bun run dev` serves everything from one server (the landing page at `/landing`). The `dev:admin` / `dev:chat` / `dev:landing`
scripts mirror the production split as separate instances that can run at the same time (each with its own `.nuxt` build
directory); they point the public admin and chat URLs at `http://localhost:3030` / `:3031` automatically, so embed snippets,
the appearance preview and origin checks work across them.

Set `NUXT_DEV_LOGIN=true` to use `/auth/dev?email=you@example.com` in development without OAuth — `http://localhost:3000/auth/dev?...`
for `bun run dev`, `http://localhost:3030/auth/dev?...` for `bun run dev:admin` (the email must be listed in
`NUXT_ADMIN_EMAILS` or already invited). This shortcut does not exist in production builds.

### Production build

```bash
bun run build:admin && bun run start   # admin (or: make build-admin start)
bun run build:chat && bun run start    # chat (or: make build-chat start)
bun run build:landing                  # landing: static HTML + assets in .output/public
```

The landing page is a fully static site: deploy `.output/public` to Cloudflare Pages or Workers static assets,
no server needed (Pages: build command `bun run build:landing`, output directory `.output/public`). Set
`NUXT_PUBLIC_CHAT_URL` at build time to fill in the host of the embed snippet shown on the page.

`make docker-build` builds both Docker images, `make up` / `make down` start and stop the Docker Compose stack.

`git` must be installed on the admin server to index git repositories (the admin Docker image includes it).

## Configuration

All settings are environment variables, see [`.env.example`](.env.example). Both apps take the same configuration. The important ones:

| Variable                                             | Description                                                                                                                     |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `NUXT_PUBLIC_ADMIN_URL`                              | Public URL of the admin app (OAuth redirects, MCP endpoint, links in support emails)                                            |
| `NUXT_PUBLIC_CHAT_URL`                               | Public URL of the chat app (embed snippets, chat links, appearance preview)                                                     |
| `NUXT_APP_SECRET`                                    | 32+ chars secret for the admin session cookie and visitor IP hashing                                                            |
| `NUXT_ADMIN_EMAILS`                                  | Emails auto-provisioned as admins on first login. Everyone else must be invited from **Users**                                  |
| `NUXT_MONGODB_URI`                                   | MongoDB connection string                                                                                                       |
| `NUXT_OPENROUTER_API_KEY`                            | OpenRouter key, used for chat and embeddings                                                                                    |
| `NUXT_EMBEDDING_MODEL` / `NUXT_EMBEDDING_DIMENSIONS` | Default embedding model (default `openai/text-embedding-3-small`, 1536). Change it on **Settings** instead (see below)          |
| `NUXT_VISION_MODEL` / `NUXT_VISION_MAX_PER_SYNC`     | Vision model for images and scanned PDFs (default `openrouter/free`, empty disables), max new files per sync (100) |
| `NUXT_CODE_SUMMARY_MODEL` / `NUXT_CODE_SUMMARY_MAX_PER_SYNC` | Default model for source code summaries (`openrouter/free`, empty disables), max new files per sync (500) |
| `NUXT_CRAWLER_USER_AGENT` / `NUXT_CRAWLER_REQUEST_INTERVAL_MS` | Default website crawler User-Agent (empty = `RAGPulseBot/1.0 (+chat URL)`) and delay between requests to one site (500) |
| `NUXT_OAUTH_GOOGLE_*`, `NUXT_OAUTH_MICROSOFT_*`      | Social login. Redirect URIs: `/auth/google`, `/auth/microsoft`                                                                  |
| `NUXT_GOOGLE_SERVICE_ACCOUNT_KEY`                    | Service account JSON key (single-line or base64) for Google Drive sources; folders are shared with its client_email             |
| `NUXT_SMTP_PASS` / `NUXT_SMTP_FROM`                  | Outgoing email for escalations, replies and invites: Cloudflare API token and sender address (see below)                       |
| `NUXT_CHAT_SESSION_RETENTION_DAYS`                   | Days without activity after which chat sessions, their messages and questions are deleted (default 180, `0` keeps them forever) |
| `NUXT_SYNC_HISTORY_DAYS`                             | Days sync runs are kept in each source's history (default 30, max 365). Change it on **Settings** instead (see below)          |

### Settings page

Admins can change these workspace-wide settings on **Settings**; saved values override the environment defaults above:

- **Embedding model** and optional **dimensions** (any OpenRouter embedding model). The model is tested before it is applied.
  Vectors of different models can't be compared, so changing it re-indexes the knowledge of **all projects**: the scheduler
  re-embeds the stored chunks in the background (no re-fetching), the vector index is updated automatically, and progress is
  shown on **Settings** and **System**. Until it finishes, answers only use the knowledge that has already been re-indexed.
- **Source code summaries**: the model that summarizes git repository code (or off).
- **Website crawler**: the User-Agent and the minimum delay between two requests to the same site.
- **Sync history**: how many days each source's sync runs (files, total size and duration per run) are kept; older runs are deleted automatically.

### Email

Outgoing email uses [Cloudflare Email Service](https://developers.cloudflare.com/email-service/api/send-emails/smtp/) by default
(`smtp.mx.cloudflare.net`, port 465 with implicit TLS, user `api_token`). Set `NUXT_SMTP_PASS` to a Cloudflare API token with the
**Email Sending: Edit** permission and `NUXT_SMTP_FROM` to a sender on a domain onboarded for Email Sending, e.g.
`RAGPulse <support@example.com>`. To use another server, override `NUXT_SMTP_HOST`, `NUXT_SMTP_PORT` and `NUXT_SMTP_USER`
(port 465 uses implicit TLS, other ports STARTTLS; `NUXT_SMTP_SECURE=true|false` overrides it). Empty values use the defaults.
Without a sender, or without a password on Cloudflare, email is disabled and **System** shows a warning.

### Secrets from Infisical

Instead of putting every secret in `.env`, both apps can load them from Infisical when they start. Create a machine identity
with Universal Auth and read access to the project environment, then set only `RAGPULSE_INFISICAL_CLIENT_ID`,
`RAGPULSE_INFISICAL_CLIENT_SECRET` and `RAGPULSE_INFISICAL_PROJECT_ID` (plus `RAGPULSE_INFISICAL_ENVIRONMENT` if it is not
`prod`) in the environment. Store the other variables in Infisical with the same names (`NUXT_APP_SECRET`, `NUXT_MONGODB_URI`, ...).

| Variable                           | Description                                                                                     | Default when unset                                  |
| ---------------------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `RAGPULSE_INFISICAL_CLIENT_ID`     | Infisical Universal Auth client ID; when set, startup loads the other variables from Infisical. | Unset; Infisical is not used                        |
| `RAGPULSE_INFISICAL_CLIENT_SECRET` | Infisical Universal Auth client secret.                                                         | Unset; required with `RAGPULSE_INFISICAL_CLIENT_ID` |
| `RAGPULSE_INFISICAL_PROJECT_ID`    | Infisical project ID.                                                                           | Unset; required with `RAGPULSE_INFISICAL_CLIENT_ID` |
| `RAGPULSE_INFISICAL_ENVIRONMENT`   | Infisical environment slug.                                                                     | `prod`                                              |
| `RAGPULSE_INFISICAL_SECRET_PATH`   | Infisical folder path that holds the secrets.                                                   | `/`                                                 |
| `RAGPULSE_INFISICAL_SITE_URL`      | Infisical instance URL, for the EU cloud or a self-hosted instance.                             | `https://app.infisical.com`                         |

`bun run dev`, `bun run start` and the Docker images preload `server/preload.ts` before the runtime
config is read. Builds, typechecks and tests do not contact Infisical. Variables that already have a non-empty value in the
environment (`.env`, `docker-compose.yml`) are kept, so they win over Infisical; remove placeholders such as the example
`NUXT_APP_SECRET` from `.env`. If Infisical cannot be reached, the process exits on startup (and the container restart policy
tries again). Secrets are never written to disk or baked into the images; rotate a secret in Infisical and restart to apply it.

## Concepts

### Projects

Each project is a website/app/service with its own title, website, system instructions, OpenRouter model, chat theme,
knowledge, rate limit (max visitor messages per session before redirecting to support), support email and allowed domains.

When a project is created, its website's home page and stylesheets are analyzed in the background (theme-color, brand
custom properties, buttons, links, page background) and the chat theme preset with the closest colours is selected,
in light or dark mode like the website. It can be changed any time under **Appearance**. The website's favicon becomes
the project icon, falling back to a two-letter mark when none is found; it can be changed under **Settings**.

### Knowledge

- **FAQ** — question/answer pairs, indexed instantly.
- **Website** — a new project adds its website as a crawled URL source (up to 25 pages) automatically, unless unchecked.
- **Git repositories** — shallow-cloned; documentation files (`*.md`, `*.mdx`, `*.txt`, `*.rst`, `*.adoc`, `README*`, `*.pdf`, `docs/**`)
  and source code (common programming languages plus manifests such as `package.json`, `Dockerfile`, compose files; tests and
  generated files are skipped) by default, customizable include/exclude globs, optional access token for private repos.
  Each code file is summarized by `NUXT_CODE_SUMMARY_MODEL` with the repository (README, file tree) as context, and an
  **"How the application works"** document is written from all summaries, so the assistant can answer technical questions.
  Summaries are cached; at most `NUXT_CODE_SUMMARY_MAX_PER_SYNC` new files are summarized per sync and the rest follow within an hour.
  The overview is written again only when at least 10% of its inputs (file summaries, README) changed since it was written.
  Before cloning, the branch's latest commit is checked with `git ls-remote`: when neither the commit nor the source settings
  (index detail, include/exclude patterns, models) changed since the last complete sync, the repository isn't cloned at all.
  Turn **Index source code** off on a source to index documentation only.
- **URLs** — fetched, main content extracted (Readability) and converted to Markdown; optional crawling of linked pages under
  the same path. Requests to a site are spaced (500 ms by default, or the robots.txt `Crawl-delay` if longer); `429 Too Many
  Requests` responses slow the site down and are retried after `Retry-After`. A crawl that stays rate limited stops early and
  keeps the previously indexed pages until the next attempt (within an hour).
- **Google Drive folders** — indexed recursively (subfolders and shared drives): Google Docs, Slides and Sheets are exported
  and converted to Markdown, Office files, PDFs, images and text/markdown/csv files are indexed as well. Shortcuts to files
  are followed, shortcuts to folders are skipped. Files are compared by Drive version and only re-downloaded when they changed.
  Setup: create a service account in Google Cloud, enable the Google Drive API, share each folder with its `client_email` as
  **Viewer**, and set `NUXT_GOOGLE_SERVICE_ACCOUNT_KEY` to the JSON key (a different key can be pasted per source).
- **PDFs, images and Office files** (PNG, JPEG, WebP, GIF, Word, PowerPoint, Excel, up to 20 MB) from repositories, URLs and
  Drive — the text of PDFs is extracted locally and Word/PowerPoint/Excel files are converted to Markdown locally.
  Images and scanned PDFs are transcribed by the OpenRouter vision model (`NUXT_VISION_MODEL`); tiny images such as icons are
  skipped and results are cached, so unchanged files are never sent twice.

Everything is converted to Markdown, split into heading-aware chunks, embedded through OpenRouter and stored in MongoDB.
Unchanged documents and chunks are never re-embedded. Sources refresh automatically: every 2 days by default, configurable per
project and per source (1 hour to 7 days). Each source keeps a history of its sync runs (files, total size and duration per run,
for `NUXT_SYNC_HISTORY_DAYS` days), opened from the history button in the source list.

#### Index detail

Each project picks how much of its sources is indexed (**Settings → Knowledge → Index detail**). Every chunk stores an
embedding (~20 KB in MongoDB at 1536 dimensions, far more than its text), so the presets mostly differ in how many chunks
they produce. Changing the preset re-indexes all sources of the project.

| Preset | What is indexed | Chunks |
| --- | --- | --- |
| **Compact** | Headings and lists only: emphasis, links, images, quotes and HTML are removed, tables become lists, code blocks are cut after 100 lines. Repeated blocks are removed within a document and across the documents of a source (site footers, PDF letterheads). Code files keep only a short summary (no source code), trivial files are skipped. Vision transcribes only key text and skips more small images. | ~2400 chars, no overlap |
| **Balanced** (default) | Clean Markdown, code summaries followed by the source code. Only exact repeats are removed, always keeping one copy: repeated paragraphs within a document, identical blocks of 200+ characters across the documents of a source, and identical long lines on nearly every page of a PDF (letterheads, footers). | ~1800 chars, 200 overlap |
| **Detailed** | All Markdown styles (images with alt text, strikethrough, keys, task and definition lists, captions, embedded videos as links). In-depth code summaries with references, intricacies and source comments, richer application overview and vision transcriptions. | ~1400 chars, 300 overlap |

Projects without a preset use **Balanced**. Code summaries and vision results are cached per preset.

### Conversations & escalation

Visitors tell the chat how they want to be called, then ask away. Answers are generated from the retrieved knowledge only. When the
model can't answer confidently, or a visitor hits the rate limit, the question becomes an **unanswered question**: it's emailed to
the project's support email and shows up in the admin inbox and over MCP. Replies (from the admin UI or an agent via MCP) are posted
into the visitor's chat and emailed to them if they left an address, and can be added to the FAQ in one click.
Conversations without activity for 180 days (`NUXT_CHAT_SESSION_RETENTION_DAYS`) are deleted automatically by the scheduler.

### Roles

- **Admin** — full access, manages projects, users and system.
- **Assistant** — access to assigned projects only, with per-project permissions: analytics, conversations, unanswered questions,
  knowledge, settings.

## Embedding the chat

From **Project → Install**:

```html
<!-- Floating launcher -->
<script src="https://chat.ragpulse.example.com/embed.js" data-project="PROJECT_ID" async></script>

<!-- Inline iframe -->
<iframe src="https://chat.ragpulse.example.com/chat/PROJECT_ID" style="width:100%;height:600px;border:0"></iframe>
```

The chat can only be framed by the project's website domain and the domains in its allowlist (`Content-Security-Policy:
frame-ancestors`, plus the admin app for the appearance preview), public endpoints validate origins, and visitors are rate limited per IP.

## MCP

Create a token in **MCP & API**, then point any MCP client at `https://admin.ragpulse.example.com/mcp`:

```json
{
  "mcpServers": {
    "ragpulse": {
      "type": "http",
      "url": "https://admin.ragpulse.example.com/mcp",
      "headers": {"Authorization": "Bearer rp_..."}
    }
  }
}
```

Tools include `list_projects`, `list_sessions`, `get_session`, `list_unanswered_questions`, `reply_to_question`,
`dismiss_question`, `send_session_message`, `trigger_sync`, `list_sources`, `search_knowledge`, `add_faq`, `list_faqs` and
`get_project_stats`. Tokens act with the permissions of the user who created them.
