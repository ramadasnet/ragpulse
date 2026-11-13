// Application logging via anyhow: console output in development, one JSON line per entry when
// RAGPULSE_LOG_JSON is set (default in production, for log collectors). RAGPULSE_LOG_LEVEL sets the
// minimum level (debug, info, warn, error — default info). Kept free of Nitro imports so it can run anywhere.
import logger from "anyhow"

const jsonLogs = process.env.RAGPULSE_LOG_JSON ? process.env.RAGPULSE_LOG_JSON === "true" : process.env.NODE_ENV === "production"

logger.setup("console")
logger.setOptions({
    appName: "RAGPulse",
    timestamp: !jsonLogs,
    levelOnConsole: true,
    levels: levelsFrom(process.env.RAGPULSE_LOG_LEVEL || "info"),
    preprocessors: ["friendlyErrors", "maskSecrets"],
    preprocessorOptions: {
        maskedFields: [
            "authorization",
            "cookie",
            "set-cookie",
            "password",
            "pass",
            "passcode",
            "secret",
            "appsecret",
            "sessionsecret",
            "token",
            "accesstoken",
            "access_token",
            "refreshtoken",
            "refresh_token",
            "clientsecret",
            "client_secret",
            "apikey",
            "api_key",
            "apisecret",
            "api_secret",
            "privatekey",
            "private_key",
            "openrouterapikey",
            "serviceaccountkey",
            "tokenhash",
            "mongodburi"
        ]
    },
    uncaughtExceptions: true,
    unhandledRejections: true
})

// Emit one JSON line per log entry for cloud log collectors.
if (jsonLogs) {
    logger.setOptions({levelOnConsole: false})
    logger.setup({
        name: "json",
        log(level: string, message: string) {
            const severity = level.toUpperCase() === "WARN" ? "WARNING" : level.toUpperCase()
            console.log(JSON.stringify({severity, message, time: new Date().toISOString()}))
        }
    })
}

// Translate the minimum level into the list of enabled anyhow levels.
function levelsFrom(minimum: string): string[] {
    const all = ["debug", "info", "warn", "error"]
    return all.slice(Math.max(0, all.indexOf(minimum)))
}

export default logger
