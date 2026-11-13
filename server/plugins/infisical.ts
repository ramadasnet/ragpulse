// Logs which variables server/preload.ts loaded from Infisical (names only, never values).
import logger from "../utils/logger"

export default defineNitroPlugin(() => {
    const loadedKeysJson = process.env[infisicalLoadedKeysEnv]
    delete process.env[infisicalLoadedKeysEnv]
    if (!loadedKeysJson) return
    try {
        const loadedKeys: unknown = JSON.parse(loadedKeysJson)
        if (Array.isArray(loadedKeys) && loadedKeys.every((key) => typeof key === "string")) {
            logger.info("Infisical", `Loaded keys: ${loadedKeys.join(", ") || "(none)"}`)
            return
        }
    } catch {}
    logger.warn("Infisical", "Invalid loaded-key startup metadata")
})
