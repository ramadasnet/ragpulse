// Workspace settings stored in MongoDB (`settings` collection, one document), with environment variables as defaults.
// Both the admin and the chat instance read them; the cache keeps the chat instance in sync within CACHE_TTL_MS.
import { z } from 'zod'
import type { AppSettings } from '#shared/types'
import { SYNC_HISTORY_MAX_DAYS } from '#shared/types'

export const SETTINGS_ID = 'app'
const CACHE_TTL_MS = 30_000

export interface SettingsDoc extends Partial<AppSettings> {
  _id: string
  updatedAt?: Date
  updatedBy?: string
}

let cache: { at: number, value: AppSettings } | null = null

/** Defaults from the runtime config (environment variables). */
export function defaultAppSettings(): AppSettings {
  const config = useRuntimeConfig()
  return {
    embeddingModel: String(config.embeddingModel || 'openai/text-embedding-3-small'),
    embeddingDimensions: Number(config.embeddingDimensions) || 1536,
    embeddingDimensionsParam: true,
    codeSummaryModel: String(config.codeSummaryModel ?? '').trim(),
    userAgent: String(config.crawlerUserAgent || '').trim(),
    requestIntervalMs: Math.max(0, Number(config.crawlerRequestIntervalMs ?? 500) || 0),
    syncHistoryDays: syncHistoryDays(config.syncHistoryDays)
  }
}

/** Default crawler User-Agent, used when the setting is empty. */
export function defaultUserAgent(): string {
  const { adminUrl, chatUrl } = useRuntimeConfig().public
  const base = String(chatUrl || adminUrl || '').trim() || 'https://github.com/ramadasnet/ragpulse'
  return `RAGPulseBot/1.0 (+${base})`
}

export async function getAppSettings(opts: { fresh?: boolean } = {}): Promise<AppSettings> {
  if (!opts.fresh && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.value
  const { settings } = await useCollections()
  const doc = await settings.findOne({ _id: SETTINGS_ID })
  const { _id, updatedAt: _u, updatedBy: _b, ...stored } = doc ?? { _id: SETTINGS_ID }
  const value: AppSettings = { ...defaultAppSettings() }
  for (const [key, v] of Object.entries(stored)) {
    if (v !== undefined && v !== null && key in value) (value as any)[key] = v
  }
  cache = { at: Date.now(), value }
  return value
}

/**
 * Identifies the vector space of an embedding: `model#dimensions`. Stored on chunks as `embeddingModel`, so a change of
 * either the model or the vector size makes chunks stale (and search never compares vectors of different spaces).
 */
export function embeddingKey(s: Pick<AppSettings, 'embeddingModel' | 'embeddingDimensions'>): string {
  return `${s.embeddingModel}#${s.embeddingDimensions}`
}

export function invalidateAppSettings() {
  cache = null
}

const modelId = z.string().trim().min(1, 'Model is required').max(200).regex(/^[\w.:/@~-]+$/, 'Invalid model id')

export const settingsPatchSchema = z.object({
  embeddingModel: modelId,
  /** null = the model's native size */
  embeddingDimensions: z.number().int().min(32).max(8192).nullable(),
  codeSummaryModel: z.union([z.literal(''), modelId]),
  userAgent: z.string().trim().max(300).regex(/^[\x20-\x7E]*$/, 'User-Agent may only contain printable ASCII characters'),
  requestIntervalMs: z.number().int().min(0).max(60_000),
  syncHistoryDays: z.number().int().min(1).max(SYNC_HISTORY_MAX_DAYS)
}).partial()

export type SettingsPatch = z.output<typeof settingsPatchSchema>

export async function saveAppSettings(patch: Partial<AppSettings>, userId?: string): Promise<AppSettings> {
  const { settings } = await useCollections()
  await settings.updateOne(
    { _id: SETTINGS_ID },
    { $set: { ...patch, updatedAt: new Date(), ...(userId ? { updatedBy: userId } : {}) } },
    { upsert: true }
  )
  invalidateAppSettings()
  return getAppSettings({ fresh: true })
}
