// Thin LLM client: chat completions (streaming and not) and embeddings over the OpenAI-compatible API of the
// provider of each model (Global Settings → AI Providers). Model ids are `provider:model`, see shared/utils/ai-providers.
import {randomUUID} from "node:crypto"
import {parseRetryAfter} from "./ingest/throttle"
import logger from "./logger"
import {assertPublicHost} from "./public-url"
import type {AppSettings} from "#shared/types"
import {AI_PROVIDERS, aiProviderInfo, splitModelId, type AiProviderId} from "#shared/utils/ai-providers"

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
    /** Conversation id, sent to OpenCode for routing and prompt caching */
    session?: string
    /** Logs the call (model, duration, outcome, token usage) under `action` with the ids in `context`. The texts are never logged. */
    log?: {action: string; context: string[]}
}

/** `model` is sent when the fallback model takes over, before any of its text */
export type ChatStreamEvent = {type: "delta"; text: string} | {type: "usage"; usage: LlmUsage} | {type: "model"; model: string}

/** Deadlines for provider calls without a caller-supplied signal — a hung endpoint must not stall sync jobs */
const CHAT_TIMEOUT_MS = 300_000
const EMBEDDINGS_TIMEOUT_MS = 120_000
const MODELS_TIMEOUT_MS = 30_000

/** Resolved endpoint of one AI provider. */
export interface AiProvider {
    id: AiProviderId
    name: string
    baseUrl: string
    /** Bearer token; empty for custom endpoints without authentication */
    apiKey: string
    appName: string
    baseAppUrl: string
}

/** The provider of a model id: its prefix, or for ids without one OpenRouter (the custom provider when it replaced OpenRouter). */
export function modelProviderId(app: AppSettings, modelId: string): AiProviderId {
    return splitModelId(modelId).provider ?? (app.customAiProvider ? "custom" : "openrouter")
}

/** Whether a provider is enabled: it has an API key, the custom provider a base URL. */
export function providerEnabled(app: AppSettings, id: AiProviderId): boolean {
    return id === "custom" ? !!app.aiProviderBaseUrl.trim() : !!app.aiProviders[id].apiKey
}

/** Resolves a provider of a settings snapshot. Throws a 503 when it is not enabled. */
export function resolveAiProvider(app: AppSettings, id: AiProviderId): AiProvider {
    const config = useRuntimeConfig()
    const info = aiProviderInfo(id)
    if (!providerEnabled(app, id)) {
        const missing = id === "custom" ? "has no base URL" : `has no API key (Global Settings → AI Providers or ${info.env})`
        throw createError({statusCode: 503, statusMessage: `${info.name} ${missing}`})
    }
    const baseUrl = id === "custom" ? app.aiProviderBaseUrl : id === "openrouter" ? String(config.openrouterBaseUrl || info.baseUrl) : info.baseUrl
    return {
        id,
        name: info.name,
        baseUrl: baseUrl.trim().replace(/\/+$/, ""),
        apiKey: app.aiProviders[id].apiKey,
        appName: String(config.public.appName || "RAGPulse"),
        baseAppUrl: String(config.public.chatUrl || config.public.adminUrl || "https://github.com/ramadasnet/ragpulse")
    }
}

/** The provider of a model id and the id the provider knows it by (without the prefix). */
export function resolveModel(app: AppSettings, modelId: string): {provider: AiProvider; model: string} {
    return {provider: resolveAiProvider(app, modelProviderId(app, modelId)), model: splitModelId(modelId).model}
}

/** Checks that a provider accepts its credentials with an authenticated request. Throws with the provider's error. */
export async function testAiProvider(p: AiProvider): Promise<void> {
    await guardProvider(p)
    // OpenRouter's model list is public, its key endpoint isn't (OpenCode's list checks a key when one is sent)
    const path = p.id === "openrouter" ? "key" : p.id === "anthropic" ? "models?limit=1" : "models"
    const res = await fetch(`${p.baseUrl}/${path}`, {redirect: p.id === "custom" ? "error" : "follow", headers: headers(p), signal: AbortSignal.timeout(MODELS_TIMEOUT_MS)})
    if (!res.ok) await failFromResponse(res, "key test", p.name)
    await res.body?.cancel().catch(() => {})
}

/** Whether chat and embeddings can run: at least one provider is enabled. */
export async function hasAiProvider(): Promise<boolean> {
    const app = await getAppSettings()
    return AI_PROVIDERS.some((p) => providerEnabled(app, p.id))
}

/** A custom endpoint is re-checked before every request: DNS can change after the base URL was saved. */
async function guardProvider(p: Pick<AiProvider, "baseUrl" | "id">): Promise<void> {
    if (p.id !== "custom") return
    try {
        await assertPublicHost(p.baseUrl, "The AI provider base URL")
    } catch (err: any) {
        throw createError({statusCode: 502, statusMessage: String(err?.message || "Invalid AI provider base URL")})
    }
}

function headers(p: AiProvider, session?: string) {
    const h: Record<string, string> = {"Content-Type": "application/json", "User-Agent": `${p.appName}/1.0 (+${p.baseAppUrl})`}
    if (p.apiKey) h.Authorization = `Bearer ${p.apiKey}`
    // App attribution headers are OpenRouter-specific
    if (p.id === "openrouter") {
        h["HTTP-Referer"] = p.baseAppUrl
        h["X-Title"] = p.appName
    }
    // Anthropic's own endpoints (e.g. the model list) authenticate with x-api-key
    if (p.id === "anthropic") {
        h["x-api-key"] = p.apiKey
        h["anthropic-version"] = "2023-06-01"
    }
    // OpenCode Go requires a stable id per conversation
    if (p.id === "opencode" || p.id === "opencode-go") h["x-opencode-session"] = `ses_${session || randomUUID()}`
    return h
}

/** Request body of a chat completion, with the parameters the provider accepts. */
function chatBody(p: AiProvider, model: string, opts: ChatCompletionOptions, stream: boolean) {
    // OpenAI takes max_completion_tokens, and its reasoning models (o-series, GPT-5) only their default temperature
    const openai = p.id === "openai"
    const fixedTemperature = openai && /^(o\d|gpt-5)/.test(model)
    return {
        model,
        messages: opts.messages,
        ...(fixedTemperature ? {} : {temperature: opts.temperature}),
        ...(openai ? {max_completion_tokens: opts.maxTokens} : {max_tokens: opts.maxTokens}),
        ...(stream ? {stream: true} : {}),
        // OpenRouter's usage accounting; the others report usage in the last chunk when asked with stream_options
        ...(p.id === "openrouter" ? {usage: {include: true}} : stream && aiProviderInfo(p.id).streamUsage ? {stream_options: {include_usage: true}} : {})
    }
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

/** The fallback model (Global Settings) to retry a failed request with, or undefined when there is none or the caller aborted. */
async function fallbackOptions(opts: ChatCompletionOptions): Promise<ChatCompletionOptions | undefined> {
    if (opts.signal?.aborted) return undefined
    const {fallbackModel} = await getAppSettings()
    return fallbackModel && fallbackModel !== opts.model ? {...opts, model: fallbackModel} : undefined
}

/** Non streaming chat completion, logged when `opts.log` is set. Retried once with the fallback model when it fails. */
export async function chatCompletion(opts: ChatCompletionOptions): Promise<{content: string; usage?: LlmUsage}> {
    const startedAt = Date.now()
    try {
        const res = await requestChatCompletion(opts)
        logCompletion(opts, startedAt, {usage: res.usage})
        return res
    } catch (error) {
        logCompletion(opts, startedAt, {error})
        const fallback = await fallbackOptions(opts)
        if (!fallback) throw error
        const fallbackStartedAt = Date.now()
        try {
            const res = await requestChatCompletion(fallback)
            logCompletion(fallback, fallbackStartedAt, {usage: res.usage})
            return res
        } catch (fallbackError) {
            logCompletion(fallback, fallbackStartedAt, {error: fallbackError})
            // The original failure is the one worth reporting
            throw error
        }
    }
}

async function requestChatCompletion(opts: ChatCompletionOptions): Promise<{content: string; usage?: LlmUsage}> {
    const {provider: s, model} = resolveModel(await getAppSettings(), opts.model)
    await guardProvider(s)
    const res = await fetch(`${s.baseUrl}/chat/completions`, {
        redirect: s.id === "custom" ? "error" : "follow",
        method: "POST",
        headers: headers(s, opts.session),
        signal: opts.signal ?? AbortSignal.timeout(CHAT_TIMEOUT_MS),
        body: JSON.stringify(chatBody(s, model, opts, false))
    })
    if (!res.ok) await failFromResponse(res, "chat completion", s.name)
    const data: any = await res.json()
    if (data?.error) throw createError({statusCode: 502, statusMessage: `${s.name}: ${data.error.message || "unknown error"}`})
    return {content: data?.choices?.[0]?.message?.content ?? "", usage: mapUsage(data?.usage)}
}

/**
 * Streaming chat completion, yields text deltas and (at the end) usage. Logged when `opts.log` is set.
 * Retried with the fallback model when it fails before any text was streamed, announced by a `model` event.
 */
export async function* streamChatCompletion(opts: ChatCompletionOptions): AsyncGenerator<ChatStreamEvent> {
    let current = opts
    while (true) {
        const startedAt = Date.now()
        let usage: LlmUsage | undefined
        let started = false
        try {
            for await (const ev of requestChatStream(current)) {
                if (ev.type === "usage") usage = ev.usage
                else started = true
                yield ev
            }
        } catch (error) {
            logCompletion(current, startedAt, {error})
            const fallback = current === opts && !started ? await fallbackOptions(opts) : undefined
            if (!fallback) throw error
            current = fallback
            yield {type: "model", model: fallback.model}
            continue
        }
        logCompletion(current, startedAt, {usage})
        return
    }
}

async function* requestChatStream(opts: ChatCompletionOptions): AsyncGenerator<ChatStreamEvent> {
    const {provider: s, model} = resolveModel(await getAppSettings(), opts.model)
    await guardProvider(s)
    const res = await fetch(`${s.baseUrl}/chat/completions`, {
        redirect: s.id === "custom" ? "error" : "follow",
        method: "POST",
        headers: headers(s, opts.session),
        signal: opts.signal ?? AbortSignal.timeout(CHAT_TIMEOUT_MS),
        body: JSON.stringify(chatBody(s, model, opts, true))
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
    /** Resolves the provider with these settings instead of the saved ones (e.g. testing a settings change before it is saved) */
    settings?: AppSettings
}

/** Embeds texts with the configured (or given) embedding model. Batches automatically. */
export async function createEmbeddings(texts: string[], opts: EmbeddingOptions = {}): Promise<{embeddings: number[][]; model: string; key: string; tokens: number}> {
    const app = opts.settings ?? (await getAppSettings())
    let model = opts.model
    let dimensions = opts.dimensions
    let key: string | undefined
    if (!model) {
        model = app.embeddingModel
        dimensions = app.embeddingDimensionsParam ? app.embeddingDimensions : undefined
        key = embeddingKey(app)
    }
    const {provider: s, model: providerModel} = resolveModel(app, model)
    const embeddings: number[][] = []
    let tokens = 0
    const batchSize = 64
    for (let i = 0; i < texts.length; i += batchSize) {
        const batch = texts.slice(i, i + batchSize)
        let attempt = 0
        while (true) {
            await guardProvider(s)
            const res = await fetch(`${s.baseUrl}/embeddings`, {
                redirect: s.id === "custom" ? "error" : "follow",
                method: "POST",
                headers: headers(s),
                signal: AbortSignal.timeout(EMBEDDINGS_TIMEOUT_MS),
                body: JSON.stringify({model: providerModel, input: batch, ...(dimensions ? {dimensions} : {})})
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

export interface ModelInfo {
    /** `provider:model` */
    id: string
    provider: AiProviderId
    name: string
    contextLength: number
    /** USD per 1M tokens, unset when the provider doesn't publish prices */
    promptPrice?: number
    completionPrice?: number
}

const modelsCache = new Map<string, {at: number; models: ModelInfo[]}>()

/** Model ids of other kinds (audio, images, moderation…) on providers whose model lists don't tell the kind */
const NON_CHAT_MODEL = /embed|whisper|tts|dall-e|imagen|image|veo|sora|moderation|transcribe|realtime|audio|aqa|davinci|babbage|computer-use|ocr/i

/** Whether an entry of a provider's model list is of the requested kind. Custom endpoints can't be filtered. */
function matchesKind(id: AiProviderId, m: any, kind: "chat" | "embedding"): boolean {
    if (id === "custom") return true
    if (id === "openrouter") return !m?.architecture?.output_modalities || m.architecture.output_modalities.includes(kind === "embedding" ? "embeddings" : "text")
    // OpenCode tells the kind
    if (typeof m?.type === "string") return m.type === kind
    if (kind === "embedding") return /embed/i.test(m.id)
    return !NON_CHAT_MODEL.test(m.id) && m?.capabilities?.completion_chat !== false
}

/** The chat or embedding models of one provider (cached for 1 hour). */
async function providerModels(p: AiProvider, kind: "chat" | "embedding"): Promise<ModelInfo[]> {
    const cacheKey = `${kind}:${p.id}:${p.baseUrl}`
    const cached = modelsCache.get(cacheKey)
    if (cached && Date.now() - cached.at < 3600_000) return cached.models
    await guardProvider(p)
    // OpenRouter has a dedicated embeddings list; Anthropic pages its list (20 by default)
    const path = p.id === "openrouter" && kind === "embedding" ? "embeddings/models" : p.id === "anthropic" ? "models?limit=1000" : "models"
    const res = await fetch(`${p.baseUrl}/${path}`, {redirect: p.id === "custom" ? "error" : "follow", headers: headers(p), signal: AbortSignal.timeout(MODELS_TIMEOUT_MS)})
    if (!res.ok) await failFromResponse(res, "models", p.name)
    const data: any = await res.json()
    const models: ModelInfo[] = (data?.data || [])
        .filter((m: any) => !!m?.id && matchesKind(p.id, m, kind))
        .map((m: any) => {
            // Gemini lists `models/gemini-…`
            const id = String(m.id).replace(/^models\//, "")
            // Prices: OpenRouter per token, OpenCode per 1M tokens
            const cost = m.cost?.text
            return {
                id: `${p.id}:${id}`,
                provider: p.id,
                name: String(m.name || m.display_name || id),
                contextLength: Number(m.context_length || m.limit?.context || m.max_context_length || 0),
                promptPrice: m.pricing ? Number(m.pricing.prompt || 0) * 1e6 : cost ? Number(cost.input?.price || 0) : undefined,
                completionPrice: m.pricing ? Number(m.pricing.completion || 0) * 1e6 : cost ? Number(cost.output?.price || 0) : undefined
            }
        })
    modelsCache.set(cacheKey, {at: Date.now(), models})
    return models
}

/** Lists the models of all enabled providers, or their embedding models with `kind: "embedding"`. */
export async function listModels(kind: "chat" | "embedding" = "chat"): Promise<ModelInfo[]> {
    const app = await getAppSettings()
    const providers = AI_PROVIDERS.filter((p) => (kind === "chat" || p.embeddings) && providerEnabled(app, p.id)).map((p) => resolveAiProvider(app, p.id))
    const results = await Promise.allSettled(providers.map((p) => providerModels(p, kind)))
    const failed = results.flatMap((r, i) => (r.status === "rejected" ? [{provider: providers[i]!, reason: r.reason}] : []))
    // One unreachable provider must not hide the models of the others
    if (failed.length && failed.length === results.length) throw failed[0]!.reason
    for (const f of failed) logger.warn("Models.list", f.provider.name, String(f.reason?.statusMessage || f.reason?.message || f.reason))
    return results.flatMap((r) => (r.status === "fulfilled" ? r.value : [])).sort((a, b) => a.id.localeCompare(b.id))
}

/** Rough token estimate (~4 chars per token) for budgeting context. */
export function estimateTokens(text: string): number {
    return Math.ceil(text.length / 4)
}
