export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const input = await readZodBody(event, projectCreateSchema)
  const project = buildProject(input)
  const { projects, sources } = await useCollections()
  await projects.insertOne(project)
  if (input.indexWebsite !== false) {
    // The project website becomes the first knowledge source (crawled, first sync starts right away)
    const url = validateSourceUrl('url', project.website)
    await sources.insertOne(newSource(project._id, { type: 'url', url, options: buildSourceOptions('url', { crawl: true, maxPages: WEBSITE_SOURCE_MAX_PAGES }) }))
    syncEvents.emit('kick')
  }
  setResponseStatus(event, 201)
  return project
})
