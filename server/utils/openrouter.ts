// Thin LLM client: chat completions (streaming and not) and embeddings, over OpenRouter
// or a custom OpenAI-compatible endpoint (Global Settings → AI Provider).
// Docs: https://openrouter.ai/docs/api-reference
import {parseRetryAfter} from "./ingest/throttle"
import logger from "./logger"
import {assertPublicHost} from "./public-url"
import type {AppSettings} from "#shared/types"

export type LlmContentPart = {type: "text"; text: string} | {type: "image_url"; image_url: {url: string}} | {type: "file"; file: {filename: string; file_data: string}}

export interface LlmMessage {
    role: "system" | "user" | "assistant"
    content: string | LlmContentPart[]
}

export interface LlmUsage {
    promptTokens: number
    completionTokens: number
    cost?: number
}

export interface ChatCompletionOptions {
    model: string
    messages: LlmMessage[]
    temperature?: number
    maxTokens?: number
    signal?: AbortSignal
    /** Logs the call (model, duration, outcome, token usage) under `action` with the ids in `context`. The texts are never logged. */
    log?: {action: string; context: string[]}
}

export type ChatStreamEvent = {type: "delta"; text: string} | {type: "usage"; usage: LlmUsage}

/** Deadlines for provider calls without a caller-supplied signal — a hung endpoint must not stall sync jobs */
const CHAT_TIMEOUT_MS = 300_000
const EMBEDDINGS_TIMEOUT_MS = 120_000
const MODELS_TIMEOUT_MS = 30_000

/** Resolved endpoint for chat and embeddings: OpenRouter, or a custom OpenAI-compatible API. */
export interface AiProvider {
    name: string
    baseUrl: string
    /** Bearer token; empty for endpoints without authentication */
    apiKey: string
    /** OpenRouter-only app attribution headers */
    openrouter: boolean
    appName: string
    baseAppUrl: string
}

/**
 * Resolves the AI provider for a settings snapshot: the custom OpenAI-compatible endpoint when
 * `customAiProvider` is set, otherwise OpenRouter. Throws a 503 when the provider is not usable.
 */
export function resolveAiProvider(app: AppSettings): AiProvider {
    const config = useRuntimeConfig()
    const appName = String(config.public.appName || "RAGPulse")
    const baseAppUrl = String(config.public.chatUrl || config.public.adminUrl || "https://github.com/ramadasnet/ragpulse")
    if (app.customAiProvider) {
        const baseUrl = app.aiProviderBaseUrl.trim().replace(/\/+$/, "")
        if (!baseUrl) throw createError({statusCode: 503, statusMessage: "The custom AI provider has no base URL (Global Settings → AI Provider)"})
        return {name: "AI provider", baseUrl, apiKey: app.aiProviderApiKey, openrouter: false, appName, baseAppUrl}
    }
    if (!app.openrouterApiKey) {
        throw createError({statusCode: 503, statusMessage: "OpenRouter API key is not configured (Global Settings → AI Provider or NUXT_OPENROUTER_API_KEY)"})
    }
    return {
        name: "OpenRouter",
        baseUrl: String(config.openrouterBaseUrl || "https://openrouter.ai/api/v1").replace(/\/+$/, ""),
        apiKey: app.openrouterApiKey,
        openrouter: true,
        appName,
        baseAppUrl
    }
}

/** The provider of the saved settings. */
async function provider(): Promise<AiProvider> {
    return resolveAiProvider(await getAppSettings())
}

/** Whether chat and embeddings can run: an OpenRouter key is set, or a custom endpoint is configured. */
export async function hasAiProvider(): Promise<boolean> {
    const app = await getAppSettings()
    return app.customAiProvider ? !!app.aiProviderBaseUrl.trim() : !!app.openrouterApiKey
}

/** A custom endpoint is re-checked before every request: DNS can change after the base URL was saved. */
async function guardProvider(p: Pick<AiProvider, "baseUrl" | "openrouter">): Promise<void> {
    if (p.openrouter) return
    try {
        await assertPublicHost(p.baseUrl, "The AI provider base URL")
    } catch (err: any) {
        throw createError({statusCode: 502, statusMessage: String(err?.message || "Invalid AI provider base URL")})
    }
}

function headers(p: AiProvider) {
    const h: Record<string, string> = {"Content-Type": "application/json"}
    if (p.apiKey) h.Authorization = `Bearer ${p.apiKey}`
    // App attribution headers are OpenRouter-specific
    if (p.openrouter) {
        h["HTTP-Referer"] = p.baseAppUrl
        h["X-Title"] = p.appName
    }
    return h
}

function mapUsage(u: any): LlmUsage | undefined {
    if (!u) return undefined
    return {
        promptTokens: Number(u.prompt_tokens || 0),
        completionTokens: Number(u.completion_tokens || 0),
        cost: typeof u.cost === "number" ? u.cost : undefined
    }
}

async function failFromResponse(res: Response, what: string, providerName = "AI provider"): Promise<never> {
    let detail = ""
    try {
        const body: any = await res.json()
        detail = body?.error?.message || JSON.stringify(body)
    } catch {
        detail = res.statusText
    }
    throw createError({statusCode: 502, statusMessage: `${providerName} ${what} failed (${res.status}): ${detail}`.slice(0, 300)})
}

/** Logs a completion requested with `opts.log`: model, duration, success or failure and token usage, never the texts. */
function logCompletion(opts: ChatCompletionOptions, startedAt: number, outcome: {usage?: LlmUsage} | {error: unknown}) {
    if (!opts.log) return
    const {action, context} = opts.log
    const took = `${Date.now() - startedAt} ms`
    if ("error" in outcome) {
        const err = outcome.error as any
        // Only the status code or error type: a provider's error text can echo the prompt
        const reason = typeof err?.statusCode === "number" ? `Status ${err.statusCode}` : String(err?.name || "Error")
        logger.warn(action, ...context, `Model ${opts.model}`, `Failed after ${took}`, reason)
        return
    }
    const u = outcome.usage
    const tokens = u ? `Tokens ${u.promptTokens} in, ${u.completionTokens} out${u.cost !== undefined ? `, cost $${u.cost}` : ""}` : "No token usage reported"
    logger.info(action, ...context, `Model ${opts.model}`, `Done in ${took}`, tokens)
}

/** Non streaming chat completion, logged when `opts.log` is set. */
export async function chatCompletion(opts: ChatCompletionOptions): Promise<{content: string; usage?: LlmUsage}> {
    const startedAt = Date.now()
    try {
        const res = await requestChatCompletion(opts)
        logCompletion(opts, startedAt, {usage: res.usage})
        return res
    } catch (error) {
        logCompletion(opts, startedAt, {error})
        throw error
    }
}

async function requestChatCompletion(opts: ChatCompletionOptions): Promise<{content: string; usage?: LlmUsage}> {
    const s = await provider()
    await guardProvider(s)
    const res = await fetch(`${s.baseUrl}/chat/completions`, {
        redirect: s.openrouter ? "follow" : "error",
        method: "POST",
        headers: headers(s),
        signal: opts.signal ?? AbortSignal.timeout(CHAT_TIMEOUT_MS),
        body: JSON.stringify({
            model: opts.model,
            messages: opts.messages,
            temperature: opts.temperature,
            max_tokens: opts.maxTokens,
            ...(s.openrouter ? {usage: {include: true}} : {})
        })
    })
    if (!res.ok) await failFromResponse(res, "chat completion", s.name)
    const data: any = await res.json()
    if (data?.error) throw createError({statusCode: 502, statusMessage: `${s.name}: ${data.error.message || "unknown error"}`})
    return {content: data?.choices?.[0]?.message?.content ?? "", usage: mapUsage(data?.usage)}
}

/** Streaming chat completion, yields text deltas and (at the end) usage. Logged when `opts.log` is set. */
export async function* streamChatCompletion(opts: ChatCompletionOptions): AsyncGenerator<ChatStreamEvent> {
    const startedAt = Date.now()
    let usage: LlmUsage | undefined
    try {
        for await (const ev of requestChatStream(opts)) {
            if (ev.type === "usage") usage = ev.usage
            yield ev
        }
    } catch (error) {
        logCompletion(opts, startedAt, {error})
        throw error
    }
    logCompletion(opts, startedAt, {usage})
}

async function* requestChatStream(opts: ChatCompletionOptions): AsyncGenerator<ChatStreamEvent> {
    const s = await provider()
    await guardProvider(s)
    const res = await fetch(`${s.baseUrl}/chat/completions`, {
        redirect: s.openrouter ? "follow" : "error",
        method: "POST",
        headers: headers(s),
        signal: opts.signal ?? AbortSignal.timeout(CHAT_TIMEOUT_MS),
        body: JSON.stringify({
            model: opts.model,
            messages: opts.messages,
            temperature: opts.temperature,
            max_tokens: opts.maxTokens,
            stream: true,
            // OpenRouter-only usage accounting; OpenAI-compatible endpoints use stream_options
            ...(s.openrouter ? {usage: {include: true}} : {stream_options: {include_usage: true}})
        })
    })
    if (!res.ok || !res.body) await failFromResponse(res, "chat completion", s.name)

    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    let buffer = ""
    while (true) {
        const {done, value} = await reader.read()
        if (done) break
        buffer += decoder.decode(value, {stream: true})
        let nl: number
        while ((nl = buffer.indexOf("\n")) !== -1) {
            const line = buffer.slice(0, nl).trim()
            buffer = buffer.slice(nl + 1)
            // Comments (": OPENROUTER PROCESSING") and empty lines are keep-alives
            if (!line.startsWith("data:")) continue
            const payload = line.slice(5).trim()
            if (payload === "[DONE]") return
            let data: any
            try {
                data = JSON.parse(payload)
            } catch {
                continue
            }
            if (data?.error) throw createError({statusCode: 502, statusMessage: `${s.name}: ${data.error.message || "stream error"}`})
            const text = data?.choices?.[0]?.delta?.content
            if (text) yield {type: "delta", text}
            const usage = mapUsage(data?.usage)
            if (usage) yield {type: "usage", usage}
        }
    }
}

export interface EmbeddingOptions {
    /** Defaults to the embedding model of the workspace settings */
    model?: string
    /** Requested vector size, sent as `dimensions`. Defaults to the settings; undefined = the model's native size. */
    dimensions?: number
    /** Calls this provider instead of the configured one (e.g. testing a settings change before it is saved) */
    provider?: AiProvider
}

/** Embeds texts with the configured (or given) embedding model. Batches automatically. */
export async function createEmbeddings(texts: string[], opts: EmbeddingOptions = {}): Promise<{embeddings: number[][]; model: string; key: string; tokens: number}> {
    const s = opts.provider ?? (await provider())
    let model = opts.model
    let dimensions = opts.dimensions
    let key: string | undefined
    if (!model) {
        const app = await getAppSettings()
        model = app.embeddingModel
        dimensions = app.embeddingDimensionsParam ? app.embeddingDimensions : undefined
        key = embeddingKey(app)
    }
    const embeddings: number[][] = []
    let tokens = 0
    const batchSize = 64
    for (let i = 0; i < texts.length; i += batchSize) {
        const batch = texts.slice(i, i + batchSize)
        let attempt = 0
        while (true) {
            await guardProvider(s)
            const res = await fetch(`${s.baseUrl}/embeddings`, {
                redirect: s.openrouter ? "follow" : "error",
                method: "POST",
                headers: headers(s),
                signal: AbortSignal.timeout(EMBEDDINGS_TIMEOUT_MS),
                body: JSON.stringify({model, input: batch, ...(dimensions ? {dimensions} : {})})
            })
            if ((res.status === 429 || res.status >= 500) && attempt < 3) {
                attempt++
                const retryAfter = parseRetryAfter(res.headers.get("retry-after"))
                await res.body?.cancel().catch(() => {})
                await new Promise((r) => setTimeout(r, Math.min(60_000, retryAfter ?? 1000 * 2 ** attempt)))
                continue
            }
            if (!res.ok) await failFromResponse(res, "embeddings", s.name)
            const data: any = await res.json()
            if (data?.error) throw createError({statusCode: 502, statusMessage: `${s.name} embeddings: ${data.error.message || "unknown error"}`.slice(0, 300)})
            if (!Array.isArray(data?.data) || data.data.length !== batch.length) throw createError({statusCode: 502, statusMessage: `${s.name} embeddings: invalid response`})
            const sorted = [...data.data].sort((a: any, b: any) => a.index - b.index)
            for (const item of sorted) embeddings.push(item.embedding)
            tokens += Number(data?.usage?.prompt_tokens || data?.usage?.total_tokens || 0)
            break
        }
    }
    return {embeddings, model, key: key ?? embeddingKey({embeddingModel: model, embeddingDimensions: embeddings[0]?.length ?? 0}), tokens}
}

/** Embeds a search query, returning the vector and its embedding key (`model#dimensions`). */
export async function embedQuery(text: string): Promise<{vector: number[]; key: string}> {
    const {embeddings, key} = await createEmbeddings([text])
    return {vector: embeddings[0]!, key}
}

export interface OpenRouterModel {
    id: string
    name: string
    contextLength: number
    /** USD per 1M tokens */
    promptPrice: number
    completionPrice: number
}

const modelsCache = new Map<string, {at: number; models: OpenRouterModel[]}>()

/**
 * Lists available models, or embedding models with `kind: "embedding"` (cached for 1 hour per provider).
 * OpenRouter exposes a dedicated embeddings list; a custom provider is queried at its standard
 * `/models` endpoint, which can't be filtered by kind (it also has no pricing metadata).
 */
export async function listModels(kind: "chat" | "embedding" = "chat"): Promise<OpenRouterModel[]> {
    const app = await getAppSettings()
    const config = useRuntimeConfig()
    const custom = app.customAiProvider
    const baseUrl = (custom ? app.aiProviderBaseUrl.trim() : String(config.openrouterBaseUrl || "https://openrouter.ai/api/v1")).replace(/\/+$/, "")
    if (!baseUrl) return []
    const cacheKey = `${kind}:${baseUrl}`
    const cached = modelsCache.get(cacheKey)
    if (cached && Date.now() - cached.at < 3600_000) return cached.models
    // OpenRouter's model lists are public; a custom endpoint may need its key
    if (custom) await guardProvider({baseUrl, openrouter: false})
    const res = await fetch(`${baseUrl}/${custom || kind === "chat" ? "models" : "embeddings/models"}`, {
        redirect: custom ? "error" : "follow",
        headers: custom && app.aiProviderApiKey ? {Authorization: `Bearer ${app.aiProviderApiKey}`} : {},
        signal: AbortSignal.timeout(MODELS_TIMEOUT_MS)
    })
    if (!res.ok) await failFromResponse(res, "models", custom ? "AI provider" : "OpenRouter")
    const data: any = await res.json()
    const output = kind === "embedding" ? "embeddings" : "text"
    const models: OpenRouterModel[] = (data?.data || [])
        .filter((m: any) => !!m?.id && (custom || !m?.architecture?.output_modalities || m.architecture.output_modalities.includes(output)))
        .map((m: any) => ({
            id: m.id,
            name: m.name || m.id,
            contextLength: Number(m.context_length || 0),
            promptPrice: Number(m.pricing?.prompt || 0) * 1e6,
            completionPrice: Number(m.pricing?.completion || 0) * 1e6
        }))
        .sort((a: OpenRouterModel, b: OpenRouterModel) => a.id.localeCompare(b.id))
    modelsCache.set(cacheKey, {at: Date.now(), models})
    return models
}

/** Rough token estimate (~4 chars per token) for budgeting context. */
export function estimateTokens(text: string): number {
    return Math.ceil(text.length / 4)
}
