// Build target: `admin` (dashboard, admin API, MCP, sync scheduler), `chat` (public chat page, chat API, embed.js)
// or unset to serve both from one server (development).
const target = process.env.RAGPULSE_APP || ""
if (target && target !== "admin" && target !== "chat") throw new Error(`Invalid RAGPULSE_APP "${target}", expected admin or chat`)

const chatOnly = ["app/pages/chat/**", "server/api/chat/**", "server/routes/embed.js.ts", "server/middleware/chat-security.ts"]
const adminOnly = [
    "app/pages/admin/**",
    "app/pages/index.vue",
    "app/pages/login.vue",
    "app/layouts/default.vue",
    "app/middleware/auth.global.ts",
    "server/api/*.ts",
    "server/api/projects/**",
    "server/api/system/**",
    "server/api/tokens/**",
    "server/api/users/**",
    "server/routes/auth/**",
    "server/routes/mcp.ts",
    "server/plugins/scheduler.ts"
]

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
    compatibilityDate: "2025-07-15",
    devtools: {enabled: false},
    modules: target === "chat" ? [] : ["nuxt-auth-utils"],
    ignore: target === "admin" ? chatOnly : target === "chat" ? adminOnly : [],
    css: ["~/assets/css/main.css"],

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
        mongodbUri: "mongodb://127.0.0.1:27017/ragpulse",
        openrouterApiKey: "",
        openrouterBaseUrl: "https://openrouter.ai/api/v1",
        // Defaults: the embedding model can be changed on the Settings page (stored chunks are then re-embedded)
        embeddingModel: "openai/text-embedding-3-small",
        embeddingDimensions: 1536,
        defaultChatModel: "openai/gpt-4o-mini",
        // Vision model for images and scanned PDFs (empty disables them; PDFs with text are always read locally)
        visionModel: "google/gemini-3.1-flash-lite",
        // Max images / scanned PDFs sent to the vision model per source sync, the rest continues on the next sync
        visionMaxPerSync: 100,
        // Model that summarizes source code of git repositories (empty disables summaries; can be changed on the Settings page)
        codeSummaryModel: "google/gemini-3.1-flash-lite",
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
            chatUrl: ""
        }
    },

    routeRules: {
        "/admin/**": {ssr: false},
        "/login": {ssr: false}
    },

    nitro: {
        preset: "bun"
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
