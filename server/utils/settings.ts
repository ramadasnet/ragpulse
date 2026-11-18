// Workspace settings stored in MongoDB (`settings` collection, one document), with environment variables as defaults.
// Both the admin and the chat instance read them; the cache keeps the chat instance in sync within CACHE_TTL_MS.
import {z} from "zod"
import type {AppSettings} from "#shared/types"
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

export interface SettingsDoc extends Partial<AppSettings> {
    _id: string
    updatedAt?: Date
    updatedBy?: string
}

let cache: {at: number; value: AppSettings} | null = null

/** Defaults from the runtime config (environment variables). */
export function defaultAppSettings(): AppSettings {
    const config = useRuntimeConfig()
    return {
        openrouterApiKey: String(config.openrouterApiKey || ""),
        customAiProvider: config.customAiProvider === true || String(config.customAiProvider).toLowerCase() === "true",
        aiProviderBaseUrl: String(config.aiProviderBaseUrl || "").trim(),
        aiProviderApiKey: String(config.aiProviderApiKey || ""),
        embeddingModel: String(config.embeddingModel || "openai/text-embedding-3-small"),
        embeddingDimensions: Number(config.embeddingDimensions) || 1536,
        embeddingDimensionsParam: true,
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
    const {_id, updatedAt: _u, updatedBy: _b, ...stored} = doc ?? {_id: SETTINGS_ID}
    const value: AppSettings = {...defaultAppSettings()}
    for (const [key, v] of Object.entries(stored)) {
        if (v !== undefined && v !== null && key in value) (value as any)[key] = v
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

export function invalidateAppSettings() {
    cache = null
}

const modelId = z
    .string()
    .trim()
    .min(1, "Model is required")
    .max(200)
    .regex(/^[\w.:/@~-]+$/, "Invalid model id")

/** API keys: a value replaces the saved one, "" removes the saved override (the environment variable applies again). */
const apiKey = z.string().trim().max(500)

export const settingsPatchSchema = z
    .object({
        openrouterApiKey: apiKey,
        customAiProvider: z.boolean(),
        aiProviderBaseUrl: z
            .string()
            .trim()
            .max(500)
            .refine((v) => !v || isHttpUrl(v), "Enter a valid http(s) base URL"),
        aiProviderApiKey: apiKey,
        embeddingModel: modelId,
        /** null = the model's native size */
        embeddingDimensions: z.number().int().min(32).max(8192).nullable(),
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

/** Saves settings; keys in `unset` are removed from the document so their environment defaults apply again. */
export async function saveAppSettings(patch: Partial<AppSettings>, userId?: string, unset?: (keyof AppSettings)[]): Promise<AppSettings> {
    const {settings} = await useCollections()
    const update: Record<string, unknown> = {$set: {...patch, updatedAt: new Date(), ...(userId ? {updatedBy: userId} : {})}}
    if (unset?.length) update.$unset = Object.fromEntries(unset.map((key) => [key, ""]))
    await settings.updateOne({_id: SETTINGS_ID}, update, {upsert: true})
    invalidateAppSettings()
    return getAppSettings({fresh: true})
}
