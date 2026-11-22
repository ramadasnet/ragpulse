import {fileURLToPath} from "node:url"

// Build target: `admin` (dashboard, admin API, MCP, sync scheduler), `chat` (public chat page, chat API, embed.js),
// `landing` (static landing site, no server) or unset to serve everything from one server (development).
const target = process.env.RAGPULSE_APP || ""
if (target && target !== "admin" && target !== "chat" && target !== "landing") throw new Error(`Invalid RAGPULSE_APP "${target}", expected admin, chat or landing`)
const landing = target === "landing"

const chatOnly = ["app/pages/chat/**", "server/api/chat/**", "server/routes/embed.js.ts", "server/middleware/chat-security.ts"]
const adminOnly = [
    "app/pages/admin/**",
    "app/pages/index.vue",
    "app/pages/login.vue",
    "app/layouts/default.vue",
    "app/middleware/auth.global.ts",
    "server/api/*.ts",
    "server/api/models/**",
    "server/api/projects/**",
    "server/api/system/**",
    "server/api/tokens/**",
    "server/api/users/**",
    "server/routes/auth/**",
    "server/routes/mcp.ts",
    "server/plugins/scheduler.ts"
]
const landingOnly = ["app/pages/landing.vue"]

/** Baseline headers for routes that must never be framed (dashboard, login) — chat pages set their own CSP in server/middleware/chat-security.ts */
const noFrameHeaders = {
    "Content-Security-Policy": "frame-ancestors 'none'",
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains"
}
// Nitro's srcDir is `server/`: a bare `server/**` ignore collapses to `**` there, which also excludes every public
// asset when Nitro copies them — so server files are excluded per directory instead.
const serverOnly = ["server/api/**", "server/middleware/**", "server/plugins/**", "server/routes/**", "server/utils/**", "server/preload.ts"]

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
    compatibilityDate: "2025-07-15",
    devtools: {enabled: false},
    modules: target === "chat" || landing ? [] : ["nuxt-auth-utils"],
    ignore: target === "admin" ? [...chatOnly, ...landingOnly] : target === "chat" ? [...adminOnly, ...landingOnly] : landing ? [...adminOnly, ...chatOnly, ...serverOnly] : [],
    // The per-app dev servers (dev:admin / dev:chat / dev:landing) pass RAGPULSE_BUILD_DIR so they can run at
    // the same time without overwriting each other's generated files in .nuxt
    buildDir: process.env.RAGPULSE_BUILD_DIR || ".nuxt",

    hooks: {
        // Public builds do not import the dashboard's global dialogs or notifications.
        "app:resolve"(app) {
            if (target === "chat" || landing) app.mainComponent = fileURLToPath(new URL("./app/app.public.vue", import.meta.url))
        },
        // The landing site serves its marketing page on /
        "pages:extend"(pages) {
            const home = pages.find((p) => p.path === "/landing")
            if (landing && home) home.path = "/"
        }
    },
    css: target === "chat" ? ["~/assets/css/base.css"] : landing ? ["~/assets/css/base.css", "~/assets/css/theme.css"] : ["~/assets/css/main.css"],

    app: {
        head: {
            htmlAttrs: {lang: "en"},
            title: "RAGPulse",
            meta: [
                {name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover"},
                {name: "color-scheme", content: "dark light"},
                {name: "theme-color", content: "#0a0b0e"}
            ],
            link: [{rel: "icon", type: "image/svg+xml", href: "/favicon.svg"}]
        }
    },

    runtimeConfig: {
        // Build target (RAGPULSE_APP): empty when one server serves both the admin and the chat
        appTarget: target,
        mongodbUri: "mongodb://127.0.0.1:27017/ragpulse?directConnection=true",
        openrouterApiKey: "",
        openrouterBaseUrl: "https://openrouter.ai/api/v1",
        // Custom OpenAI-compatible provider used instead of OpenRouter (overridden by Global Settings → AI Provider)
        customAiProvider: false,
        aiProviderBaseUrl: "",
        aiProviderApiKey: "",
        // Defaults: the embedding model can be changed on the Settings page (stored chunks are then re-embedded)
        embeddingModel: "openai/text-embedding-3-small",
        embeddingDimensions: 1536,
        // Default chat model of projects without their own (can be changed on the Settings page)
        defaultChatModel: "openrouter/free",
        // Chat model tried when the model of a request fails (empty = no fallback; can be changed on the Settings page)
        fallbackModel: "",
        // Small, cheap model for yes / no decisions such as tagging escalated questions as user specific (empty = the project's model; can be changed on the Settings page)
        decisionModel: "typesafe/jev-router",
        // Vision model for images and scanned PDFs (empty disables them; PDFs with text are always read locally)
        visionModel: "openrouter/free",
        // Max images / scanned PDFs sent to the vision model per source sync, the rest continues on the next sync
        visionMaxPerSync: 100,
        // Model that summarizes source code of git repositories (empty disables summaries; can be changed on the Settings page)
        codeSummaryModel: "openrouter/free",
        // Max new code files summarized per source sync, the rest continues on the next sync (within an hour)
        codeSummaryMaxPerSync: 500,
        // Website crawler User-Agent (empty = RAGPulseBot/1.0 (+chat URL)) and minimum delay between requests to one site
        crawlerUserAgent: "",
        crawlerRequestIntervalMs: 500,
        // Google Drive sources: service account JSON key (single-line JSON or base64); folders are shared with its client_email
        googleServiceAccountKey: "",
        // Comma separated list of emails that are auto-provisioned as admins on first login
        adminEmails: "",
        // Enables /auth/dev?email=... (only works in development builds)
        devLogin: false,
        // Seconds between scheduler ticks checking for sources due for a refresh
        syncTickSeconds: 60,
        // Days without activity after which the scheduler deletes chat sessions with their messages and questions (0 keeps them forever)
        chatSessionRetentionDays: 180,
        // Days sync runs are kept in each source's history, can be changed on the Settings page
        syncHistoryDays: 30,
        // Minutes to wait before emailing an answer to a visitor who is not in the chat, can be changed on the Settings page
        answerEmailDelayMinutes: 10,
        // Minutes an escalated chat waits for a human to take over before telling the visitor the answer comes by email, can be changed on the Settings page
        humanTakeoverWaitMinutes: 5,
        // Cloudflare Email Service by default: set NUXT_SMTP_PASS (API token) and NUXT_SMTP_FROM to send email
        smtp: {
            host: "smtp.mx.cloudflare.net",
            port: 465,
            // Empty: implicit TLS on port 465, STARTTLS on other ports
            secure: "",
            user: "api_token",
            pass: "",
            from: ""
        },
        oauth: {
            google: {clientId: "", clientSecret: "", redirectURL: ""},
            microsoft: {clientId: "", clientSecret: "", tenant: "common", redirectURL: ""}
        },
        public: {
            appName: "RAGPulse",
            // Public URLs of the admin and chat instances, e.g. https://admin.ragpulse.example.com (empty = current origin)
            adminUrl: "",
            chatUrl: "",
            // Project whose live chat is embedded on the landing page
            chatProject: ""
        }
    },

    // Landing is a fully static site: its headers live in landing/public/_headers instead (routeRules would
    // emit a generated _headers and clobber it)
    routeRules: landing
        ? {}
        : {
              "/": {headers: noFrameHeaders},
              "/admin/**": {ssr: false, headers: noFrameHeaders},
              "/login": {ssr: false, headers: noFrameHeaders},
              "/embed.js": {headers: {"X-Content-Type-Options": "nosniff"}}
          },

    nitro: {
        preset: landing ? "static" : "bun",
        // Cloudflare Pages/Workers headers for the static landing build
        publicAssets: landing ? [{dir: "landing/public", baseURL: "/"}] : []
    },

    vite: {
        optimizeDeps: {
            include: ["marked", "dompurify"]
        }
    },

    typescript: {
        strict: true
    }
})
