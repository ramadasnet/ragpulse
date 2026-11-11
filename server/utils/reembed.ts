// Re-embedding after an embedding model change: stored chunks keep their text, so only the vectors are recomputed.
// Runs in the scheduler (admin instance) in batches until every chunk uses the current model.
import type { EmbeddingStatus } from '#shared/types'

const BATCH = 256

/** How many chunks already use the current embedding model. */
export async function embeddingStatus(): Promise<EmbeddingStatus> {
  const { chunks } = await useCollections()
  const settings = await getAppSettings()
  const [total, current] = await Promise.all([chunks.estimatedDocumentCount(), chunks.countDocuments({ embeddingModel: embeddingKey(settings) })])
  return { model: settings.embeddingModel, total: Math.max(total, current), current }
}

/**
 * Re-embeds chunks created with another model, for up to `timeBudgetMs`.
 * Returns the number of updated chunks and whether stale chunks remain.
 */
export async function reembedStaleChunks(opts: { timeBudgetMs?: number } = {}): Promise<{ updated: number, remaining: boolean }> {
  const { chunks } = await useCollections()
  const deadline = Date.now() + (opts.timeBudgetMs ?? 120_000)
  let updated = 0
  while (Date.now() < deadline) {
    const settings = await getAppSettings({ fresh: true })
    const key = embeddingKey(settings)
    // `distinct` + `$in` use the embeddingModel index, unlike `$ne`
    const stale = (await chunks.distinct('embeddingModel')).filter(m => m !== key)
    if (!stale.length) return { updated, remaining: false }
    const batch = await chunks.find({ embeddingModel: { $in: stale } }, { projection: { _id: 1, content: 1, hash: 1, embeddingModel: 1 } }).limit(BATCH).toArray()
    if (!batch.length) return { updated, remaining: false }

    const byHash = new Map<string, string>()
    for (const c of batch) if (!byHash.has(c.hash)) byHash.set(c.hash, c.content)
    const hashes = [...byHash.keys()]
    const { embeddings } = await createEmbeddings(hashes.map(h => byHash.get(h)!), {
      model: settings.embeddingModel,
      dimensions: settings.embeddingDimensionsParam ? settings.embeddingDimensions : undefined
    })
    const vectors = new Map(hashes.map((h, i) => [h, embeddings[i]]))
    const ops = batch
      .filter(c => vectors.get(c.hash)?.length === settings.embeddingDimensions)
      .map(c => ({
        updateOne: {
          // Skips chunks that were replaced or re-embedded meanwhile
          filter: { _id: c._id, embeddingModel: c.embeddingModel },
          update: { $set: { embedding: vectors.get(c.hash)!, embeddingModel: key } }
        }
      }))
    if (!ops.length) throw new Error(`embedding API returned no ${settings.embeddingDimensions}-dimensional vectors`)
    const res = await chunks.bulkWrite(ops, { ordered: false })
    updated += res.modifiedCount
  }
  return { updated, remaining: true }
}
