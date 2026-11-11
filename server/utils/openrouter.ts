// Thin OpenRouter client: chat completions (streaming and not) and embeddings.
// Docs: https://openrouter.ai/docs/api-reference
import {parseRetryAfter} from "./ingest/throttle"

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
}

export type ChatStreamEvent = {type: "delta"; text: string} | {type: "usage"; usage: LlmUsage}

function settings() {
    const config = useRuntimeConfig()
    if (!config.openrouterApiKey) {
        throw createError({statusCode: 503, statusMessage: "OpenRouter API key is not configured (NUXT_OPENROUTER_API_KEY)"})
    }
    return {
        baseUrl: String(config.openrouterBaseUrl || "https://openrouter.ai/api/v1").replace(/\/$/, ""),
        apiKey: String(config.openrouterApiKey),
        appName: String(config.public.appName || "RAGPulse"),
        baseAppUrl: String(config.public.chatUrl || config.public.adminUrl || "https://github.com/ramadasnet/ragpulse")
    }
}

function headers(s: ReturnType<typeof settings>) {
    return {
        Authorization: `Bearer ${s.apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": s.baseAppUrl,
        "X-Title": s.appName
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

async function failFromResponse(res: Response, what: string): Promise<never> {
    let detail = ""
    try {
        const body: any = await res.json()
        detail = body?.error?.message || JSON.stringify(body)
    } catch {
        detail = res.statusText
    }
    throw createError({statusCode: 502, statusMessage: `OpenRouter ${what} failed (${res.status}): ${detail}`.slice(0, 300)})
}

/** Non streaming chat completion. */
export async function chatCompletion(opts: ChatCompletionOptions): Promise<{content: string; usage?: LlmUsage}> {
    const s = settings()
    const res = await fetch(`${s.baseUrl}/chat/completions`, {
        method: "POST",
        headers: headers(s),
        signal: opts.signal,
        body: JSON.stringify({
            model: opts.model,
            messages: opts.messages,
            temperature: opts.temperature,
            max_tokens: opts.maxTokens,
            usage: {include: true}
        })
    })
    if (!res.ok) await failFromResponse(res, "chat completion")
    const data: any = await res.json()
    if (data?.error) throw createError({statusCode: 502, statusMessage: `OpenRouter: ${data.error.message || "unknown error"}`})
    return {content: data?.choices?.[0]?.message?.content ?? "", usage: mapUsage(data?.usage)}
}

/** Streaming chat completion, yields text deltas and (at the end) usage. */
export async function* streamChatCompletion(opts: ChatCompletionOptions): AsyncGenerator<ChatStreamEvent> {
    const s = settings()
    const res = await fetch(`${s.baseUrl}/chat/completions`, {
        method: "POST",
        headers: headers(s),
        signal: opts.signal,
        body: JSON.stringify({
            model: opts.model,
            messages: opts.messages,
            temperature: opts.temperature,
            max_tokens: opts.maxTokens,
            stream: true,
            usage: {include: true}
        })
    })
    if (!res.ok || !res.body) await failFromResponse(res, "chat completion")

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
            if (data?.error) throw createError({statusCode: 502, statusMessage: `OpenRouter: ${data.error.message || "stream error"}`})
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
}

/** Embeds texts with the configured (or given) embedding model. Batches automatically. */
export async function createEmbeddings(texts: string[], opts: EmbeddingOptions = {}): Promise<{embeddings: number[][]; model: string; key: string; tokens: number}> {
    const s = settings()
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
            const res = await fetch(`${s.baseUrl}/embeddings`, {
                method: "POST",
                headers: headers(s),
                body: JSON.stringify({model, input: batch, ...(dimensions ? {dimensions} : {})})
            })
            if ((res.status === 429 || res.status >= 500) && attempt < 3) {
                attempt++
                const retryAfter = parseRetryAfter(res.headers.get("retry-after"))
                await res.body?.cancel().catch(() => {})
                await new Promise((r) => setTimeout(r, Math.min(60_000, retryAfter ?? 1000 * 2 ** attempt)))
                continue
            }
            if (!res.ok) await failFromResponse(res, "embeddings")
            const data: any = await res.json()
            if (data?.error) throw createError({statusCode: 502, statusMessage: `OpenRouter embeddings: ${data.error.message || "unknown error"}`.slice(0, 300)})
            if (!Array.isArray(data?.data) || data.data.length !== batch.length) throw createError({statusCode: 502, statusMessage: "OpenRouter embeddings: invalid response"})
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

/** Lists available chat models, or embedding models with `kind: "embedding"` (cached for 1 hour). */
export async function listModels(kind: "chat" | "embedding" = "chat"): Promise<OpenRouterModel[]> {
    const cached = modelsCache.get(kind)
    if (cached && Date.now() - cached.at < 3600_000) return cached.models
    const config = useRuntimeConfig()
    const baseUrl = String(config.openrouterBaseUrl || "https://openrouter.ai/api/v1").replace(/\/$/, "")
    const res = await fetch(`${baseUrl}/${kind === "embedding" ? "embeddings/models" : "models"}`)
    if (!res.ok) await failFromResponse(res, "models")
    const data: any = await res.json()
    const output = kind === "embedding" ? "embeddings" : "text"
    const models: OpenRouterModel[] = (data?.data || [])
        .filter((m: any) => !m?.architecture?.output_modalities || m.architecture.output_modalities.includes(output))
        .map((m: any) => ({
            id: m.id,
            name: m.name || m.id,
            contextLength: Number(m.context_length || 0),
            promptPrice: Number(m.pricing?.prompt || 0) * 1e6,
            completionPrice: Number(m.pricing?.completion || 0) * 1e6
        }))
        .sort((a: OpenRouterModel, b: OpenRouterModel) => a.id.localeCompare(b.id))
    modelsCache.set(kind, {at: Date.now(), models})
    return models
}

/** Rough token estimate (~4 chars per token) for budgeting context. */
export function estimateTokens(text: string): number {
    return Math.ceil(text.length / 4)
}
