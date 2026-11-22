import {z} from "zod"
import type {AppSettings} from "#shared/types"
import {AI_PROVIDER_IDS, aiProviderInfo} from "#shared/utils/ai-providers"
import logger from "../../../utils/logger"

/**
 * Removes the credentials of a provider saved on Global Settings (the custom provider's also its base URL). Its
 * environment variables apply again, without them the provider is disabled.
 */
export default defineEventHandler(async (event) => {
    const admin = await requireAdmin(event)
    const parsed = z.enum(AI_PROVIDER_IDS).safeParse(getRouterParam(event, "id"))
    if (!parsed.success) throw createError({statusCode: 404, statusMessage: "Unknown AI provider"})
    const id = parsed.data
    const config = useRuntimeConfig()

    const current = await getAppSettings({fresh: true})
    const candidate: AppSettings = {...current, aiProviders: structuredClone(current.aiProviders)}
    candidate.aiProviders[id] = {apiKey: String((config as Record<string, unknown>)[aiProviderInfo(id).configKey] || ""), verified: ""}
    if (id === "custom") candidate.aiProviderBaseUrl = String(config.aiProviderBaseUrl || "").trim()
    assertGlobalModelProviders(current, candidate)

    const legacy = LEGACY_KEY_FIELDS[id]
    await saveAppSettings({}, admin._id, [`aiProviders.${id}`, ...(legacy ? [legacy] : []), ...(id === "custom" ? ["aiProviderBaseUrl"] : [])])
    logger.info("Settings.aiProvider", `${aiProviderInfo(id).name} credentials removed`, `By ${admin.email}`)
    return settingsResponse()
})
