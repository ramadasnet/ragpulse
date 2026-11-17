import {parseDriveFolderId} from "#shared/utils/drive"
import logger, {urlForLog} from "../../../../utils/logger"

export default defineEventHandler(async (event) => {
    const {user, project} = await requireProjectAccess(event, "sources:manage")
    const body = await readIngestBody(event, sourceCreateSchema)
    const url = validateSourceUrl(body.type, body.url)
    let title = body.title
    if (body.type === "drive") {
        const raw = body.options?.serviceAccountKey || useRuntimeConfig().googleServiceAccountKey
        if (!raw) throw createError({statusCode: 400, statusMessage: "No Google service account key configured (NUXT_GOOGLE_SERVICE_ACCOUNT_KEY)"})
        try {
            const folder = await getDriveFolder(parseDriveFolderId(url)!, parseServiceAccountKey(raw))
            if (!title) title = folder.name
        } catch (err: any) {
            throw createError({statusCode: 400, statusMessage: String(err?.message || "Could not access the Google Drive folder")})
        }
    }
    const source = newSource(project._id, {
        type: body.type,
        url,
        title,
        refreshIntervalHours: body.refreshIntervalHours,
        options: buildSourceOptions(body.type, body.options)
    })
    const {sources} = await useCollections()
    await sources.insertOne(source)
    syncEvents.emit("kick")
    logger.info("Sources.create", `Source ${source._id} "${source.title}" (${source.type})`, urlForLog(source.url), `Project ${project._id}`, `By ${user.email}`)
    setResponseStatus(event, 201)
    return serializeSource(source)
})
