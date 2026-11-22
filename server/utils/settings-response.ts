import type {AppSettingsView, EmbeddingStatus} from "#shared/types"
import {AI_PROVIDERS} from "#shared/utils/ai-providers"

export interface SettingsResponse {
    settings: AppSettingsView
    defaults: {userAgent: string}
    embedding: EmbeddingStatus
    vectorMode: VectorMode
    projectCount: number
}

/** Payload of the settings API: the settings with secrets stripped, plus context for the Global Settings page. */
export async function settingsResponse(): Promise<SettingsResponse> {
    const config = useRuntimeConfig()
    const {settings: settingsCol, projects} = await useCollections()
    const [s, embedding, projectCount, doc] = await Promise.all([getAppSettings({fresh: true}), embeddingStatus(), projects.estimatedDocumentCount(), settingsCol.findOne({_id: SETTINGS_ID})])
    const {aiProviders, ...rest} = s
    const view: AppSettingsView = {
        ...rest,
        aiProviders: Object.fromEntries(
            AI_PROVIDERS.map((p) => [
                p.id,
                {
                    hasApiKey: !!aiProviders[p.id].apiKey,
                    saved: !!savedApiKey(doc, p.id) || (p.id === "custom" && !!doc?.aiProviderBaseUrl),
                    envApiKey: !!(config as Record<string, unknown>)[p.configKey],
                    verified: providerVerified(s, p.id)
                }
            ])
        ) as AppSettingsView["aiProviders"]
    }
    return {settings: view, defaults: {userAgent: defaultUserAgent()}, embedding, vectorMode: getVectorMode(), projectCount}
}
