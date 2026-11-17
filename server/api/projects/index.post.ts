import logger, {urlForLog} from "../../utils/logger"

export default defineEventHandler(async (event) => {
    const admin = await requireAdmin(event)
    const input = await readZodBody(event, projectCreateSchema)
    const project = buildProject(input)
    const {projects, sources} = await useCollections()
    await projects.insertOne(project)
    if (input.indexWebsite !== false) {
        // The project website becomes the first knowledge source (crawled, first sync starts right away)
        const url = validateSourceUrl("url", project.website)
        await sources.insertOne(newSource(project._id, {type: "url", url, options: buildSourceOptions("url", {crawl: true, maxPages: WEBSITE_SOURCE_MAX_PAGES})}))
        syncEvents.emit("kick")
    }
    logger.info("Projects.create", `Project ${project._id} "${project.title}"`, urlForLog(project.website), `By ${admin.email}`)
    // Match the chat colours and icon to the website in the background (keeps the defaults on failure)
    applyWebsiteBranding(project).catch((err) => logger.warn("WebsiteTheme.apply", project.website, err))
    setResponseStatus(event, 201)
    return project
})
