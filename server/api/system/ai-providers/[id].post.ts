import {z} from "zod"
import type {AppSettings} from "#shared/types"
import {AI_PROVIDER_IDS, aiProviderInfo} from "#shared/utils/ai-providers"
import logger from "../../../utils/logger"

/**
 * Tests the credentials of a provider and saves them only when the provider accepts them. Without credentials in the
 * body, the configured ones are tested (e.g. a key from the environment). A passed test is recorded: settings can only
 * be saved while every enabled provider passed one.
 */
export default defineEventHandler(async (event) => {
    const admin = await requireAdmin(event)
    const parsed = z.enum(AI_PROVIDER_IDS).safeParse(getRouterParam(event, "id"))
    if (!parsed.success) throw createError({statusCode: 404, statusMessage: "Unknown AI provider"})
    const id = parsed.data
    const info = aiProviderInfo(id)
    const input = await readZodBody(event, providerCredentialsSchema)
    if (input.baseUrl !== undefined && id !== "custom") throw createError({statusCode: 400, statusMessage: "Only the custom AI provider has a base URL"})

    const current = await getAppSettings({fresh: true})
    const candidate: AppSettings = {...current, aiProviders: structuredClone(current.aiProviders)}
    if (input.apiKey) candidate.aiProviders[id].apiKey = input.apiKey
    if (input.baseUrl) candidate.aiProviderBaseUrl = input.baseUrl.replace(/\/+$/, "")
    if (!providerEnabled(candidate, id)) throw createError({statusCode: 400, statusMessage: id === "custom" ? "Enter the base URL" : `Enter the ${info.name} API key`})
    if (input.baseUrl) {
        try {
            await assertPublicHost(candidate.aiProviderBaseUrl, "The AI provider base URL")
        } catch (err: any) {
            throw createError({statusCode: 400, statusMessage: String(err?.message || "Invalid AI provider base URL")})
        }
    }

    try {
        await testAiProvider(resolveAiProvider(candidate, id))
    } catch (err: any) {
        logger.warn("Settings.aiProvider", `${info.name} test failed`, `By ${admin.email}`, `Status ${err?.statusCode ?? "unknown"}`)
        throw createError({statusCode: 400, statusMessage: String(err?.statusMessage || err?.message || `${info.name} test failed`).slice(0, 300)})
    }

    const set: Record<string, unknown> = {[`aiProviders.${id}.verified`]: credentialFingerprint(candidate, id)}
    if (input.apiKey) set[`aiProviders.${id}.apiKey`] = input.apiKey
    if (input.baseUrl) set.aiProviderBaseUrl = candidate.aiProviderBaseUrl
    await saveAppSettings(set, admin._id)
    logger.info("Settings.aiProvider", `${info.name} tested`, `By ${admin.email}`, input.apiKey || input.baseUrl ? "Credentials saved" : "Configured credentials")
    return settingsResponse()
})
