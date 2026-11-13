// Startup, request-error, and shutdown logging hooks.
import logger from "../utils/logger"

export default defineNitroPlugin((nitroApp) => {
    const app = process.env.RAGPULSE_APP || "all"
    logger.info("RAGPulse.startup", `PID ${process.pid}`, `Environment ${process.env.NODE_ENV || "development"}`, `App ${app}`)

    nitroApp.hooks.hook("error", (error, context) => {
        const statusCode = "statusCode" in error && typeof error.statusCode === "number" ? error.statusCode : 500
        const request = context.event ? `${context.event.method} ${getRequestURL(context.event).pathname}` : "Non-request error"
        if (statusCode >= 500) {
            logger.error("RAGPulse.request", request, `Status ${statusCode}`, error)
        } else {
            logger.warn("RAGPulse.request", request, `Status ${statusCode}`, error.message)
        }
    })

    nitroApp.hooks.hook("close", () => logger.info("RAGPulse.shutdown", `PID ${process.pid}`))
})
