import type {AppSettings} from "#shared/types"
import logger from "../../utils/logger"

const MAX_INDEX_DIMENSIONS = 8192

export default defineEventHandler(async (event) => {
    const admin = await requireAdmin(event)
    const input = await readZodBody(event, settingsPatchSchema)
    const current = await getAppSettings({fresh: true})
    const config = useRuntimeConfig()
    const patch: Partial<AppSettings> = {}
    const unset: (keyof AppSettings)[] = []
    // An empty API key removes the saved override so the environment variable applies again
    if (input.openrouterApiKey) patch.openrouterApiKey = input.openrouterApiKey
    else if (input.openrouterApiKey !== undefined) unset.push("openrouterApiKey")
    if (input.customAiProvider !== undefined) patch.customAiProvider = input.customAiProvider
    if (input.aiProviderBaseUrl !== undefined) patch.aiProviderBaseUrl = input.aiProviderBaseUrl.replace(/\/+$/, "")
    if (input.aiProviderApiKey) patch.aiProviderApiKey = input.aiProviderApiKey
    else if (input.aiProviderApiKey !== undefined) unset.push("aiProviderApiKey")
    if (input.defaultModel !== undefined) patch.defaultModel = input.defaultModel
    if (input.fallbackModel !== undefined) patch.fallbackModel = input.fallbackModel
    if (input.codeSummaryModel !== undefined) patch.codeSummaryModel = input.codeSummaryModel
    if (input.userAgent !== undefined) patch.userAgent = input.userAgent
    if (input.requestIntervalMs !== undefined) patch.requestIntervalMs = input.requestIntervalMs
    if (input.syncHistoryDays !== undefined) patch.syncHistoryDays = input.syncHistoryDays
    if (input.questionRetentionDays !== undefined) patch.questionRetentionDays = input.questionRetentionDays
    if (input.globalInstructions !== undefined) patch.globalInstructions = input.globalInstructions
    if (input.answerEmailDelayMinutes !== undefined) patch.answerEmailDelayMinutes = input.answerEmailDelayMinutes
    if (input.humanTakeoverWaitMinutes !== undefined) patch.humanTakeoverWaitMinutes = input.humanTakeoverWaitMinutes
    if (input.chatAutoCloseDays !== undefined) patch.chatAutoCloseDays = input.chatAutoCloseDays

    // The effective provider of this patch: a removed key falls back to its environment variable
    const candidate: AppSettings = {
        ...current,
        ...patch,
        openrouterApiKey: input.openrouterApiKey === undefined ? current.openrouterApiKey : input.openrouterApiKey || String(config.openrouterApiKey || ""),
        aiProviderApiKey: input.aiProviderApiKey === undefined ? current.aiProviderApiKey : input.aiProviderApiKey || String(config.aiProviderApiKey || "")
    }
    const providerChanged = candidate.customAiProvider !== current.customAiProvider || candidate.aiProviderBaseUrl !== current.aiProviderBaseUrl || patch.openrouterApiKey !== undefined || patch.aiProviderApiKey !== undefined || unset.length > 0
    if (candidate.customAiProvider && !candidate.aiProviderBaseUrl.trim()) {
        throw createError({statusCode: 400, statusMessage: "The custom AI provider needs a base URL"})
    }
    // Also when the provider is switched on with an already saved (or environment) URL
    if (candidate.aiProviderBaseUrl.trim() && (input.aiProviderBaseUrl?.trim() || (candidate.customAiProvider && input.customAiProvider === true))) {
        try {
            await assertPublicHost(candidate.aiProviderBaseUrl.trim(), "The AI provider base URL")
        } catch (err: any) {
            throw createError({statusCode: 400, statusMessage: String(err?.message || "Invalid AI provider base URL")})
        }
    }

    let embeddingChanged = false
    if (input.embeddingModel !== undefined || input.embeddingDimensions !== undefined) {
        const model = input.embeddingModel ?? current.embeddingModel
        // null = the model's native vector size
        const requested = input.embeddingDimensions !== undefined ? input.embeddingDimensions : current.embeddingDimensionsParam ? current.embeddingDimensions : null
        const unchanged = model === current.embeddingModel && (requested === null ? !current.embeddingDimensionsParam : current.embeddingDimensionsParam && requested === current.embeddingDimensions)
        if (!unchanged) {
            // Try the model before switching (against the provider of this patch), and learn its vector size
            let vector: number[] | undefined
            try {
                const {embeddings} = await createEmbeddings(["RAGPulse embedding model check"], {model, dimensions: requested ?? undefined, provider: resolveAiProvider(candidate)})
                vector = embeddings[0]
            } catch (err: any) {
                throw createError({statusCode: 400, statusMessage: `Could not use embedding model "${model}": ${err?.statusMessage || err?.message || err}`.slice(0, 300)})
            }
            if (!vector?.length) throw createError({statusCode: 400, statusMessage: `"${model}" returned no embedding`})
            if (requested && vector.length !== requested) {
                throw createError({statusCode: 400, statusMessage: `"${model}" returns ${vector.length}-dimensional vectors and does not support ${requested} dimensions. Leave dimensions empty to use its native size.`})
            }
            if (vector.length > MAX_INDEX_DIMENSIONS) {
                throw createError({statusCode: 400, statusMessage: `"${model}" returns ${vector.length}-dimensional vectors, the vector index supports at most ${MAX_INDEX_DIMENSIONS}. Set fewer dimensions.`})
            }
            patch.embeddingModel = model
            patch.embeddingDimensions = vector.length
            patch.embeddingDimensionsParam = !!requested
            embeddingChanged = true
        }
    }

    if (Object.keys(patch).length || unset.length) {
        const saved = await saveAppSettings(patch, admin._id, unset)
        const changed = [...Object.keys(patch), ...unset.map((k) => `-${k}`)]
        logger.info("Settings.patch", `By ${admin.email}`, `Changed: ${changed.join(", ")}`)
        if (providerChanged) {
            logger.info("Settings.patch", `AI provider changed to ${saved.customAiProvider ? "custom" : "OpenRouter"} by ${admin.email}`)
        }
        if (input.syncHistoryDays !== undefined && input.syncHistoryDays !== current.syncHistoryDays) {
            await purgeOldSyncRuns(await useCollections(), saved.syncHistoryDays).catch((err) => logger.warn("Settings.patch", "Sync history cleanup failed", err))
        }
        if (input.questionRetentionDays !== undefined && input.questionRetentionDays !== current.questionRetentionDays) {
            await purgeOldQuestions(await useCollections(), saved.questionRetentionDays).catch((err) => logger.warn("Settings.patch", "Escalated question cleanup failed", err))
        }
        if (input.chatAutoCloseDays !== undefined && input.chatAutoCloseDays !== current.chatAutoCloseDays) {
            await closeInactiveChatSessions(await useCollections(), saved.chatAutoCloseDays).catch((err) => logger.warn("Settings.patch", "Closing inactive chat sessions failed", err))
        }
        if (embeddingChanged) {
            await refreshVectorIndex(saved.embeddingDimensions)
            logger.info("Settings.patch", `Embedding model changed to ${saved.embeddingModel} (${saved.embeddingDimensions} dims) by ${admin.email}, re-embedding all knowledge`)
            // The scheduler re-embeds stored chunks in the background
            syncEvents.emit("kick")
        }
    }
    return settingsResponse()
})
