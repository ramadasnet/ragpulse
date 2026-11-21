import type {AppSettings} from "#shared/types"
import {AI_PROVIDERS} from "#shared/utils/ai-providers"
import logger from "../../utils/logger"

const MAX_INDEX_DIMENSIONS = 8192

export default defineEventHandler(async (event) => {
    const admin = await requireAdmin(event)
    const input = await readZodBody(event, settingsPatchSchema)
    const current = await getAppSettings({fresh: true})
    // Every enabled provider must have passed a test of its current credentials (Global Settings → AI Providers)
    const untested = AI_PROVIDERS.find((p) => providerEnabled(current, p.id) && !providerVerified(current, p.id))
    if (untested) throw createError({statusCode: 400, statusMessage: `Test the ${untested.name} ${untested.id === "custom" ? "base URL and key" : "API key"} first`})
    const patch: Partial<AppSettings> = {}
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

    const candidate: AppSettings = {...current, ...patch}
    // A picked model must belong to an enabled provider
    assertGlobalModelProviders(current, {...candidate, embeddingModel: input.embeddingModel ?? candidate.embeddingModel})

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
                const {embeddings} = await createEmbeddings(["RAGPulse embedding model check"], {model, dimensions: requested ?? undefined, settings: candidate})
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

    if (Object.keys(patch).length) {
        const saved = await saveAppSettings(patch, admin._id)
        logger.info("Settings.patch", `By ${admin.email}`, `Changed: ${Object.keys(patch).join(", ")}`)
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
