import type {AppSettingsView, EmbeddingStatus} from "#shared/types"

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
    const {openrouterApiKey: _openrouterKey, aiProviderApiKey: _aiProviderKey, ...rest} = s
    const view: AppSettingsView = {
        ...rest,
        hasOpenrouterApiKey: !!s.openrouterApiKey,
        savedOpenrouterApiKey: !!doc?.openrouterApiKey,
        envOpenrouterApiKey: !!config.openrouterApiKey,
        hasAiProviderApiKey: !!s.aiProviderApiKey,
        savedAiProviderApiKey: !!doc?.aiProviderApiKey,
        envAiProviderApiKey: !!config.aiProviderApiKey
    }
    return {settings: view, defaults: {userAgent: defaultUserAgent()}, embedding, vectorMode: getVectorMode(), projectCount}
}
