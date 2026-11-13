// Connects to MongoDB on startup (creating indexes and the vector search index) and closes on shutdown.
import logger from "../utils/logger"

export default defineNitroPlugin((nitroApp) => {
    useCollections().catch((err) => logger.error("Database.connect", err))
    nitroApp.hooks.hook("close", async () => {
        await closeDb()
    })
})
