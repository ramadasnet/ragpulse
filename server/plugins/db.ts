// Connects to MongoDB on startup (creating indexes and the vector search index) and closes on shutdown.
export default defineNitroPlugin((nitroApp) => {
  useCollections().catch(err => console.error(`[db] connection failed: ${err?.message || err}`))
  nitroApp.hooks.hook('close', async () => {
    await closeDb()
  })
})
