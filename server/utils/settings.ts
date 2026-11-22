// Workspace settings stored in MongoDB (`settings` collection, one document), with environment variables as defaults.
// Both the admin and the chat instance read them; the cache keeps the chat instance in sync within CACHE_TTL_MS.
import {z} from "zod"
import type {AiProviderSettings, AppSettings, Project} from "#shared/types"
import {createHash} from "node:crypto"
import {AI_PROVIDERS, aiProviderInfo, type AiProviderId} from "#shared/utils/ai-providers"
import {
    ANSWER_EMAIL_MAX_DELAY_MINUTES,
    CHAT_AUTO_CLOSE_MAX_DAYS,
    DEFAULT_ANSWER_EMAIL_DELAY_MINUTES,
    DEFAULT_CHAT_AUTO_CLOSE_DAYS,
    DEFAULT_HUMAN_TAKEOVER_WAIT_MINUTES,
    DEFAULT_QUESTION_RETENTION_DAYS,
    HUMAN_TAKEOVER_MAX_WAIT_MINUTES,
    QUESTION_RETENTION_MAX_DAYS,
    SYNC_HISTORY_MAX_DAYS
} from "#shared/types"
import {DEFAULT_GLOBAL_INSTRUCTIONS} from "#shared/utils/instructions"

export const SETTINGS_ID = "app"
const CACHE_TTL_MS = 30_000

export interface SettingsDoc extends Partial<Omit<AppSettings, "aiProviders">> {
    _id: string
    /** Only the keys entered on Global Settings are saved, the rest falls back to the environment */
    aiProviders?: Partial<Record<AiProviderId, Partial<AiProviderSettings>>>
    /** Keys saved before multiple providers were supported (OpenRouter and custom provider) */
    openrouterApiKey?: string
    aiProviderApiKey?: string
    updatedAt?: Date
    updatedBy?: string
}

/** Fields of the keys saved before multiple providers were supported, removed together with the provider's key */
export const LEGACY_KEY_FIELDS: Partial<Record<AiProviderId, "openrouterApiKey" | "aiProviderApiKey">> = {openrouter: "openrouterApiKey", custom: "aiProviderApiKey"}

/** Fingerprint of a provider's current credentials: a passed test is only valid for exactly these. */
export function credentialFingerprint(app: AppSettings, id: AiProviderId): string {
    const baseUrl = id === "custom" ? app.aiProviderBaseUrl : ""
    return createHash("sha256").update(`${id}\0${baseUrl}\0${app.aiProviders[id].apiKey}`).digest("hex").slice(0, 32)
}

/** Whether a provider's current credentials passed a test. */
export function providerVerified(app: AppSettings, id: AiProviderId): boolean {
    return !!app.aiProviders[id].verified && app.aiProviders[id].verified === credentialFingerprint(app, id)
}

/**
 * The global models (default, fallback, decision, summary, embedding) must belong to an enabled provider: a model that was changed,
 * or whose provider is disabled by this change. Throws a 400 otherwise.
 */
export function assertGlobalModelProviders(current: AppSettings, candidate: AppSettings) {
    const models = {defaultModel: "default model", fallbackModel: "fallback model", decisionModel: "decision model", codeSummaryModel: "summary model", embeddingModel: "embedding model"} as const
    for (const [key, label] of Object.entries(models) as [keyof typeof models, string][]) {
        const id = candidate[key]
        if (!id) continue
        const providerId = modelProviderId(candidate, id)
        if (!providerEnabled(candidate, providerId) && (id !== current[key] || providerEnabled(current, providerId))) {
            const missing = providerId === "custom" ? "base URL" : "API key"
            throw createError({statusCode: 400, statusMessage: `The ${label} “${id}” needs ${aiProviderInfo(providerId).name}, which has no ${missing}`})
        }
    }
}

/** The API key of a provider saved in the settings document, if any. */
export function savedApiKey(doc: SettingsDoc | null | undefined, id: AiProviderId): string {
    const legacy = LEGACY_KEY_FIELDS[id]
    return doc?.aiProviders?.[id]?.apiKey || (legacy && doc?.[legacy]) || ""
}

let cache: {at: number; value: AppSettings} | null = null

/** Defaults from the runtime config (environment variables). */
export function defaultAppSettings(): AppSettings {
    const config = useRuntimeConfig()
    return {
        aiProviders: Object.fromEntries(AI_PROVIDERS.map((p) => [p.id, {apiKey: String((config as Record<string, unknown>)[p.configKey] || ""), verified: ""}])) as AppSettings["aiProviders"],
        aiProviderBaseUrl: String(config.aiProviderBaseUrl || "").trim(),
        customAiProvider: config.customAiProvider === true || String(config.customAiProvider).toLowerCase() === "true",
        embeddingModel: String(config.embeddingModel || "openai/text-embedding-3-small"),
        embeddingDimensions: Number(config.embeddingDimensions) || 1536,
        embeddingDimensionsParam: true,
        defaultModel: String(config.defaultChatModel || "openrouter/free").trim(),
        fallbackModel: String(config.fallbackModel ?? "").trim(),
        decisionModel: String(config.decisionModel ?? "").trim(),
        codeSummaryModel: String(config.codeSummaryModel ?? "").trim(),
        userAgent: String(config.crawlerUserAgent || "").trim(),
        requestIntervalMs: Math.max(0, Number(config.crawlerRequestIntervalMs ?? 500) || 0),
        syncHistoryDays: syncHistoryDays(config.syncHistoryDays),
        questionRetentionDays: DEFAULT_QUESTION_RETENTION_DAYS,
        globalInstructions: DEFAULT_GLOBAL_INSTRUCTIONS,
        answerEmailDelayMinutes: answerEmailDelayMinutes(config.answerEmailDelayMinutes),
        humanTakeoverWaitMinutes: humanTakeoverWaitMinutes(config.humanTakeoverWaitMinutes),
        chatAutoCloseDays: DEFAULT_CHAT_AUTO_CLOSE_DAYS
    }
}

/** Answer email delay from the environment, clamped to the allowed range. */
function answerEmailDelayMinutes(value: unknown): number {
    const n = Math.round(Number(value ?? DEFAULT_ANSWER_EMAIL_DELAY_MINUTES))
    return Number.isFinite(n) ? Math.min(ANSWER_EMAIL_MAX_DELAY_MINUTES, Math.max(0, n)) : DEFAULT_ANSWER_EMAIL_DELAY_MINUTES
}

/** Human takeover wait from the environment, clamped to the allowed range. */
function humanTakeoverWaitMinutes(value: unknown): number {
    const n = Math.round(Number(value ?? DEFAULT_HUMAN_TAKEOVER_WAIT_MINUTES))
    return Number.isFinite(n) ? Math.min(HUMAN_TAKEOVER_MAX_WAIT_MINUTES, Math.max(0, n)) : DEFAULT_HUMAN_TAKEOVER_WAIT_MINUTES
}

/** Default crawler User-Agent, used when the setting is empty. */
export function defaultUserAgent(): string {
    const {adminUrl, chatUrl} = useRuntimeConfig().public
    const base = String(chatUrl || adminUrl || "").trim() || "https://github.com/ramadasnet/ragpulse"
    return `RAGPulseBot/1.0 (+${base})`
}

export async function getAppSettings(opts: {fresh?: boolean} = {}): Promise<AppSettings> {
    if (!opts.fresh && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.value
    const {settings} = await useCollections()
    const doc = await settings.findOne({_id: SETTINGS_ID})
    const {_id, updatedAt: _u, updatedBy: _b, aiProviders: _p, ...stored} = doc ?? {_id: SETTINGS_ID}
    const value: AppSettings = {...defaultAppSettings()}
    for (const [key, v] of Object.entries(stored)) {
        if (v !== undefined && v !== null && key in value) (value as any)[key] = v
    }
    // Provider by provider: a saved key overrides the environment
    for (const p of AI_PROVIDERS) {
        value.aiProviders[p.id].apiKey = savedApiKey(doc, p.id) || value.aiProviders[p.id].apiKey
        value.aiProviders[p.id].verified = doc?.aiProviders?.[p.id]?.verified || ""
    }
    cache = {at: Date.now(), value}
    return value
}

/**
 * Identifies the vector space of an embedding: `model#dimensions`. Stored on chunks as `embeddingModel`, so a change of
 * either the model or the vector size makes chunks stale (and search never compares vectors of different spaces).
 */
export function embeddingKey(s: Pick<AppSettings, "embeddingModel" | "embeddingDimensions">): string {
    return `${s.embeddingModel}#${s.embeddingDimensions}`
}

/** The chat model of a project: its own, or the default model of the Global Settings when it has none. */
export async function projectModel(project: Pick<Project, "model">): Promise<string> {
    return project.model || (await getAppSettings()).defaultModel
}

export function invalidateAppSettings() {
    cache = null
}

const modelId = z
    .string()
    .trim()
    .min(1, "Model is required")
    .max(200)
    .regex(/^[\w.:/@~-]+$/, "Invalid model id")

/**
 * Credentials of a provider to test, and save when they work. Unset fields keep the current ones, so an empty body tests
 * the configured credentials (e.g. a key from the environment).
 */
export const providerCredentialsSchema = z.object({
    apiKey: z.string().trim().min(1).max(500).optional(),
    /** Custom provider only */
    baseUrl: z
        .string()
        .trim()
        .max(500)
        .refine((v) => isHttpUrl(v), "Enter a valid http(s) base URL")
        .optional()
})

/** Provider credentials are changed with `/api/system/ai-providers/:id` (tested before they are saved), not here. */
export const settingsPatchSchema = z
    .object({
        embeddingModel: modelId,
        /** null = the model's native size */
        embeddingDimensions: z.number().int().min(32).max(8192).nullable(),
        defaultModel: modelId,
        fallbackModel: z.union([z.literal(""), modelId]),
        decisionModel: z.union([z.literal(""), modelId]),
        codeSummaryModel: z.union([z.literal(""), modelId]),
        userAgent: z
            .string()
            .trim()
            .max(300)
            .regex(/^[\x20-\x7E]*$/, "User-Agent may only contain printable ASCII characters"),
        requestIntervalMs: z.number().int().min(0).max(60_000),
        syncHistoryDays: z.number().int().min(1).max(SYNC_HISTORY_MAX_DAYS),
        /** 0 = keep forever */
        questionRetentionDays: z.number().int().min(0).max(QUESTION_RETENTION_MAX_DAYS),
        globalInstructions: z.string().trim().max(20_000),
        answerEmailDelayMinutes: z.number().int().min(0).max(ANSWER_EMAIL_MAX_DELAY_MINUTES),
        humanTakeoverWaitMinutes: z.number().int().min(0).max(HUMAN_TAKEOVER_MAX_WAIT_MINUTES),
        /** 0 = never */
        chatAutoCloseDays: z.number().int().min(0).max(CHAT_AUTO_CLOSE_MAX_DAYS)
    })
    .partial()

export type SettingsPatch = z.output<typeof settingsPatchSchema>

/**
 * Saves settings; fields in `unset` are removed from the document so their environment defaults apply again.
 * Provider fields are set with dotted paths (`aiProviders.openai.apiKey`), so the others keep their defaults.
 */
export async function saveAppSettings(patch: Record<string, unknown>, userId?: string, unset?: string[]): Promise<AppSettings> {
    const {settings} = await useCollections()
    const update: Record<string, unknown> = {$set: {...patch, updatedAt: new Date(), ...(userId ? {updatedBy: userId} : {})}}
    if (unset?.length) update.$unset = Object.fromEntries(unset.map((key) => [key, ""]))
    await settings.updateOne({_id: SETTINGS_ID}, update, {upsert: true})
    invalidateAppSettings()
    return getAppSettings({fresh: true})
}
