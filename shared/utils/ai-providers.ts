// AI providers for chat and embeddings, all called over their OpenAI-compatible APIs.
// Model ids carry their provider as a prefix: `openai:gpt-5`, `openrouter:z-ai/glm-4.6`. Ids without a known
// prefix were saved before multiple providers were supported and belong to OpenRouter (or the custom provider).

export const AI_PROVIDER_IDS = ["anthropic", "gemini", "mistral", "openai", "opencode-go", "opencode", "openrouter", "xai", "custom"] as const
export type AiProviderId = (typeof AI_PROVIDER_IDS)[number]

export interface AiProviderInfo {
    id: AiProviderId
    name: string
    /** OpenAI-compatible base URL, without /chat/completions. Empty for the custom provider (set on Global Settings). */
    baseUrl: string
    /** Environment variable with the API key, mapped to `configKey` of the runtime config */
    env: string
    configKey: string
    keyPlaceholder: string
    /** Has embedding models */
    embeddings: boolean
    /** Reports the token usage of streamed answers when asked with `stream_options` (others reject the parameter) */
    streamUsage: boolean
}

/** Ordered by name, the custom provider last. */
export const AI_PROVIDERS: AiProviderInfo[] = [
    {id: "anthropic", name: "Anthropic", baseUrl: "https://api.anthropic.com/v1", env: "NUXT_ANTHROPIC_API_KEY", configKey: "anthropicApiKey", keyPlaceholder: "sk-ant-…", embeddings: false, streamUsage: true},
    {id: "gemini", name: "Google Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", env: "NUXT_GEMINI_API_KEY", configKey: "geminiApiKey", keyPlaceholder: "AIza…", embeddings: true, streamUsage: true},
    {id: "mistral", name: "Mistral", baseUrl: "https://api.mistral.ai/v1", env: "NUXT_MISTRAL_API_KEY", configKey: "mistralApiKey", keyPlaceholder: "", embeddings: true, streamUsage: false},
    {id: "openai", name: "OpenAI", baseUrl: "https://api.openai.com/v1", env: "NUXT_OPENAI_API_KEY", configKey: "openaiApiKey", keyPlaceholder: "sk-…", embeddings: true, streamUsage: true},
    {id: "opencode-go", name: "OpenCode Go", baseUrl: "https://opencode.ai/inference/go/openai/v1", env: "NUXT_OPENCODE_GO_API_KEY", configKey: "opencodeGoApiKey", keyPlaceholder: "sk-…", embeddings: false, streamUsage: true},
    {id: "opencode", name: "OpenCode Zen", baseUrl: "https://opencode.ai/inference/openai/v1", env: "NUXT_OPENCODE_API_KEY", configKey: "opencodeApiKey", keyPlaceholder: "sk-…", embeddings: true, streamUsage: true},
    {id: "openrouter", name: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", env: "NUXT_OPENROUTER_API_KEY", configKey: "openrouterApiKey", keyPlaceholder: "sk-or-…", embeddings: true, streamUsage: true},
    {id: "xai", name: "xAI", baseUrl: "https://api.x.ai/v1", env: "NUXT_XAI_API_KEY", configKey: "xaiApiKey", keyPlaceholder: "xai-…", embeddings: false, streamUsage: true},
    {id: "custom", name: "Custom AI provider", baseUrl: "", env: "NUXT_AI_PROVIDER_API_KEY", configKey: "aiProviderApiKey", keyPlaceholder: "sk-…", embeddings: true, streamUsage: true}
]

/** Names of the providers with embedding models, for messages: "Google Gemini, Mistral, … or Custom AI provider" */
export const EMBEDDING_PROVIDER_NAMES = AI_PROVIDERS.filter((p) => p.embeddings)
    .map((p) => p.name)
    .join(", ")
    .replace(/, ([^,]+)$/, " or $1")

export function aiProviderInfo(id: AiProviderId): AiProviderInfo {
    return AI_PROVIDERS.find((p) => p.id === id)!
}

/** Splits `provider:model`. Ids without a known provider prefix return no provider. */
export function splitModelId(id: string): {provider?: AiProviderId; model: string} {
    const i = id.indexOf(":")
    const prefix = id.slice(0, i)
    return i > 0 && (AI_PROVIDER_IDS as readonly string[]).includes(prefix) ? {provider: prefix as AiProviderId, model: id.slice(i + 1)} : {model: id}
}
