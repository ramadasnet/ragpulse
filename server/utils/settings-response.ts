import type { AppSettings, EmbeddingStatus } from '#shared/types'

export interface SettingsResponse {
  settings: AppSettings
  defaults: { userAgent: string }
  embedding: EmbeddingStatus
  vectorMode: VectorMode
  projectCount: number
}

/** Payload of the settings API: the settings plus context for the Settings page. */
export async function settingsResponse(): Promise<SettingsResponse> {
  const { projects } = await useCollections()
  const [settings, embedding, projectCount] = await Promise.all([getAppSettings({ fresh: true }), embeddingStatus(), projects.estimatedDocumentCount()])
  return { settings, defaults: { userAgent: defaultUserAgent() }, embedding, vectorMode: getVectorMode(), projectCount }
}
