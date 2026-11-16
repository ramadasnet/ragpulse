# RAGPulse

Self-hosted, single-tenant AI support chat for your projects. Index your docs (FAQ, git repositories, web pages), embed a fast
chat on your sites, escalate what the AI can't answer to your support email — and plug your own bots and agents in via **MCP**
so they can act on escalated questions.

- **Stack:** TypeScript · Nuxt 4 · Bun · MongoDB (documents + vectors) · OpenRouter or any OpenAI-compatible provider (chat + embeddings)
- **Admin:** Google / Microsoft social login, Admin and Assistant roles with per-project permissions
- **Chat:** JS embed (floating launcher) or iframe, light/dark themes with 3 custom colours, domain allowlist
- **MCP:** Streamable HTTP endpoint at `/mcp`, authenticated with personal API tokens

## Architecture

RAGPulse runs as two independent servers sharing the same MongoDB, built from this codebase:

| App     | Image                               | Serves                                                                         |
| ------- | ----------------------------------- | ------------------------------------------------------------------------------ |
| Admin   | `ghcr.io/ramadasnet/ragpulse-admin` | Dashboard (`/admin`), login, admin API, MCP (`/mcp`), source sync scheduler    |
| Chat    | `ghcr.io/ramadasnet/ragpulse-chat`  | Visitor chat page (`/chat/:projectId`), chat API (`/api/chat/**`), `/embed.js` |
| Landing | static files                        | Landing page at `/`, no server, for Cloudflare Pages/Workers                   |

The build target is selected with `RAGPULSE_APP=admin|chat|landing` (`bun run build:admin` / `bun run build:chat` /
`bun run build:landing`, or `docker build --target admin|chat`). Without it (e.g. `bun run dev`) all apps are served
by one server (the landing page is then at `/landing`). Project changes reach the chat instance within 30 seconds
(public project cache TTL).

Public builds use an app root without dashboard notifications or confirmation dialogs. Chat loads only shared reset,
typography and motion defaults plus its own component styles; landing adds the design tokens and presentation it uses.
Dashboard controls, tables and other admin-only styles are loaded only by the admin and combined development builds.

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
`NUXT_PUBLIC_CHAT_URL` at build time so the live chat embedded on the page points at the chat instance.

`make docker-build` builds both Docker images, `make up` / `make down` start and stop the Docker Compose stack.

`git` must be installed on the admin server to index git repositories (the admin Docker image includes it).

## Configuration

All settings are environment variables, see [`.env.example`](.env.example). Both apps take the same configuration. The important ones:

| Variable                                                                             | Description                                                                                                                                   |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `NUXT_PUBLIC_ADMIN_URL`                                                              | Public URL of the admin app (OAuth redirects, MCP endpoint, links in support emails)                                                          |
| `NUXT_PUBLIC_CHAT_URL`                                                               | Public URL of the chat app (embed snippets, chat links, appearance preview)                                                                   |
| `NUXT_APP_SECRET`                                                                    | 32+ chars secret for the admin session cookie and visitor IP hashing                                                                          |
| `NUXT_ADMIN_EMAILS`                                                                  | Emails auto-provisioned as admins on first login. Everyone else must be invited from **Users**                                                |
| `NUXT_MONGODB_URI`                                                                   | MongoDB connection string                                                                                                                     |
| `NUXT_OPENROUTER_API_KEY`                                                            | OpenRouter key, used for chat and embeddings. Change it on **Global Settings** instead (see below)                                            |
| `NUXT_CUSTOM_AI_PROVIDER` / `NUXT_AI_PROVIDER_BASE_URL` / `NUXT_AI_PROVIDER_API_KEY` | Custom OpenAI-compatible endpoint used instead of OpenRouter. Change it on **Global Settings** instead (see below)                            |
| `NUXT_EMBEDDING_MODEL` / `NUXT_EMBEDDING_DIMENSIONS`                                 | Default embedding model (default `openai/text-embedding-3-small`, 1536). Change it on **Global Settings** instead (see below)                 |
| `NUXT_VISION_MODEL` / `NUXT_VISION_MAX_PER_SYNC`                                     | Vision model for images and scanned PDFs (default `openrouter/free`, empty disables), max new files per sync (100)                            |
| `NUXT_CODE_SUMMARY_MODEL` / `NUXT_CODE_SUMMARY_MAX_PER_SYNC`                         | Default model for source code summaries (`openrouter/free`, empty disables), max new files per sync (500)                                     |
| `NUXT_CRAWLER_USER_AGENT` / `NUXT_CRAWLER_REQUEST_INTERVAL_MS`                       | Default website crawler User-Agent (empty = `RAGPulseBot/1.0 (+chat URL)`) and delay between requests to one site (500)                       |
| `NUXT_OAUTH_GOOGLE_*`, `NUXT_OAUTH_MICROSOFT_*`                                      | Social login. Redirect URIs: `/auth/google`, `/auth/microsoft`                                                                                |
| `NUXT_GOOGLE_SERVICE_ACCOUNT_KEY`                                                    | Service account JSON key (single-line or base64) for Google Drive sources; folders are shared with its client_email                           |
| `NUXT_SMTP_PASS` / `NUXT_SMTP_FROM`                                                  | Outgoing email for escalations, replies and invites: Cloudflare API token and sender address (see below)                                      |
| `NUXT_CHAT_SESSION_RETENTION_DAYS`                                                   | Days without activity after which chat sessions, their messages and questions are deleted (default 180, `0` keeps them forever)               |
| `NUXT_SYNC_HISTORY_DAYS`                                                             | Days sync runs are kept in each source's history (default 30, max 365). Change it on **Global Settings** instead (see below)                  |
| `NUXT_ANSWER_EMAIL_DELAY_MINUTES`                                                    | Minutes before an answer is emailed to a visitor who isn't in the chat (default 10, max 1440). Change it on **Global Settings** instead       |
| `RAGPULSE_LOG_LEVEL`                                                                 | Minimum log level: `debug`, `info`, `warn` or `error` (default `info`)                                                                        |
| `RAGPULSE_LOG_JSON`                                                                  | One JSON line per log entry for log collectors (default enabled in production, disabled in development)                                       |
| `RAGPULSE_ALLOW_PRIVATE_URLS`                                                        | Allow source, branding, AI-provider and webhook URLs at private/internal addresses (intranet installs, local inference). Keep unset otherwise |

### Global Settings page

Admins can change these workspace-wide settings on **Global Settings**; saved values override the environment defaults above:

- **AI provider**: OpenRouter by default (the API key is editable here), or a custom OpenAI-compatible endpoint behind the
  **Use a custom AI provider** toggle — set its base URL (e.g. `https://api.openai.com/v1` or `http://localhost:11434/v1`) and an
  optional API key. Applies to chat answers, embeddings, vision and code summaries of all projects.
- **Global system instructions**: base rules added to the chat answers of **all projects**, with precedence over each project's
  own instructions. The default forbids sharing credentials, private keys, environment variables, secrets and personal
  information, and guards against prompt injection. Leave empty to disable.
- **Embedding model** and optional **dimensions** (any embedding model the configured provider offers). The model is tested before it is applied.
  Vectors of different models can't be compared, so changing it re-indexes the knowledge of **all projects**: the scheduler
  re-embeds the stored chunks in the background (no re-fetching), the vector index is updated automatically, and progress is
  shown on **Global Settings** and **System**. Until it finishes, answers only use the knowledge that has already been re-indexed.
- **Source code summaries**: the model that summarizes git repository code (or off).
- **Website crawler**: the User-Agent and the minimum delay between two requests to the same site.
- **Cleanup**: after how many days without messages conversations are closed (default 7, `0` = never; the visitor then gets a new
  chat), how many days each source's sync runs (files, total size and duration per run) are kept, and how many days escalated
  questions are kept (default 365, `0` = forever); older entries are deleted automatically. FAQ entries created from answered
  questions or learned from conversations are never deleted by this cleanup.
- **Answer emails**: how many minutes to wait before emailing an answer to a visitor who isn't looking at the chat (default 10, `0` = right away).

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

Each project is a website/app/service with its own title, website, system instructions, chat model, chat theme,
knowledge, rate limit (max visitor messages per session before redirecting to support), support email and allowed domains.

When a project is created, its website's home page and stylesheets are analyzed in the background (theme-color, brand
custom properties, buttons, links, page background) and the chat theme preset with the closest colours is selected,
in light or dark mode like the website. It can be changed any time under **Appearance**. The website's favicon becomes
the project icon, falling back to a two-letter mark when none is found; it can be changed under **Settings**. The chat shows
the icon as the assistant's avatar.

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
  Images and scanned PDFs are transcribed by the configured vision model (`NUXT_VISION_MODEL`); tiny images such as icons are
  skipped and results are cached, so unchanged files are never sent twice.

Everything is converted to Markdown, split into heading-aware chunks, embedded through the configured AI provider and stored in MongoDB.
Unchanged documents and chunks are never re-embedded. Sources refresh automatically: every 2 days by default, configurable per
project and per source (every 2, 4, 12 or 24 hours, every 2, 3, 7 or 14 days, or **Manual only** — synced only when you click
Sync). Sources are edited on their own page; the type of a source (website, git, Drive) can't be changed once it's added. Each source keeps a history of its sync runs (files, total size and duration per run,
for `NUXT_SYNC_HISTORY_DAYS` days), opened from the history button in the source list.

#### Index detail

Each project picks how much of its sources is indexed (**Settings → Knowledge → Index detail**). Every chunk stores an
embedding (~20 KB in MongoDB at 1536 dimensions, far more than its text), so the presets mostly differ in how many chunks
they produce. Changing the preset re-indexes all sources of the project.

| Preset                 | What is indexed                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Chunks                   |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| **Compact**            | Headings and lists only: emphasis, links, images, quotes and HTML are removed, tables become lists, code blocks are cut after 100 lines. Repeated blocks are removed within a document and across the documents of a source (site footers, PDF letterheads). Code files keep only a short summary (no source code, or the source without comments when no summary is available), trivial files are skipped. Vision transcribes only key text and skips more small images. | ~2400 chars, no overlap  |
| **Balanced** (default) | Clean Markdown, code summaries followed by the source code with its comments stripped (the summaries are still written from the full source). Only exact repeats are removed, always keeping one copy: repeated paragraphs within a document, identical blocks of 200+ characters across the documents of a source, and identical long lines on nearly every page of a PDF (letterheads, footers).                                                                        | ~1800 chars, 200 overlap |
| **Detailed**           | All Markdown styles (images with alt text, strikethrough, keys, task and definition lists, captions, embedded videos as links). In-depth code summaries with references, intricacies and source comments, source code with its comments, richer application overview and vision transcriptions.                                                                                                                                                                           | ~1400 chars, 300 overlap |

Projects without a preset use **Balanced**. Code summaries and vision results are cached per preset.

### Conversations & escalation

Visitors tell the chat how they want to be called, then ask away. Answers are generated from the retrieved knowledge only. When the
model can't answer confidently, the visitor asks to talk to a human (in any language), or a visitor hits the rate limit, the
question becomes an **escalated question**: it's emailed to the project's support email and shows up in the admin inbox and over MCP. Projects can also get the
event pushed to an HTTP endpoint: **Settings → Escalation webhook** POSTs the escalation as JSON, with an editable `{{placeholder}}` body template (project, chat URL, visitor,
question and up to 500 conversation messages) and optional headers. Replies (from the admin UI or an agent via MCP) are posted
into the visitor's chat and added to the project FAQ (once per question, with a link from the answered question to view or
delete the entry). Visitors who left an email only get it by email when they don't see it in the chat: the chat reports when it's
open and visible (the embed widget also tells it when it's closed). Visitors in the chat are never emailed; otherwise the email
waits for the **Answer emails** delay on **Global Settings** and is cancelled if the visitor opens the chat meanwhile.

Answers list their sources in two groups, **documents** and **source code**: an icon for each group sits at the bottom right of
the answer and shows its links on hover (or tap on mobile). **Settings → AI → Show source code references** hides the source
code group; the assistant can still link to code in the answer itself when the visitor asks about it.

When a team member replies to a visitor from the conversation page while a question is open, the conversation is flagged as
**handled by a human**: the assistant stops answering (and the message limit no longer applies) so the two can chat back and
forth. Opening the question in the inbox then pre-fills **Your answer** with a summary of what was answered in the chat;
**Set answer** records it (and adds it to the FAQ) without posting it to the chat again. Once no question of the
conversation is open (answered, dismissed, or the conversation is finished), the assistant takes over again.

When a conversation is done, an admin or agent flags it as **finished** (conversation page, or `finish_session` over MCP). If it had
human replies, the service summarizes it into a new FAQ entry so the assistant learns the answer — self-learning knowledge. Personal
and sensitive data is stripped from the entry (visitor name and email, other email addresses, phone/card/order numbers, tokens).
Re-finishing a conversation updates its learned entry instead of duplicating it, and any new message reopens the conversation.
When the visitor starts a new conversation (the reset button in the chat header), the previous one is flagged as **ended**, as are
conversations without messages for **Global Settings → Cleanup → Close inactive conversations** days (default 7, `0` = never). A visitor
returning to an ended conversation gets a new chat from scratch, and the team can no longer post into it from the conversation page or over MCP (`send_session_message`), and answering one of its
questions only records the answer (FAQ, email) without posting it to the chat. Ended conversations can still be finished.
Each answered question has exactly one FAQ entry: learning skips everything up to the conversation's last answered question, and
answering a question of an already finished conversation reuses the entry learned from it.
Conversations without activity for 180 days (`NUXT_CHAT_SESSION_RETENTION_DAYS`) are deleted automatically by the scheduler.

### Roles

- **Admin** — full access, manages projects, users and system.
- **Assistant** — access to assigned projects only, with per-project permissions: analytics, conversations, escalated questions,
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

Tools include `list_projects`, `get_project`, `get_project_stats`, `list_sessions`, `get_session`, `send_session_message`,
`finish_session`, `list_unanswered_questions`, `reply_to_question`, `dismiss_question`, `search_knowledge`, `get_document`,
`list_faqs`, `add_faq`, `update_faq`, `delete_faq`, `list_sources` and `trigger_sync`. Tokens act with the permissions of the user
who created them and can optionally be scoped to specific projects, permissions and an expiration period.
