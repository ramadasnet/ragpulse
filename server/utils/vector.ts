import type { Chunk, ChunkSourceType } from '#shared/types'

export interface SearchHit {
  _id: string
  sourceId: string
  documentId: string
  sourceType: ChunkSourceType
  title: string
  url?: string
  heading?: string
  content: string
  /** Cosine similarity in [-1, 1] (normalized across atlas & fallback modes) */
  score: number
}

export interface SearchOptions {
  limit?: number
  /** Drop hits below this cosine similarity */
  minScore?: number
  /** Only chunks of this embedding key, `model#dimensions` (vectors of different models are not comparable) */
  embeddingModel?: string
}

function cosine(a: number[], b: number[]): number {
  let dot = 0
  let na = 0
  let nb = 0
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) {
    const x = a[i]!
    const y = b[i]!
    dot += x * y
    na += x * x
    nb += y * y
  }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0
}

const projection = { _id: 1, sourceId: 1, documentId: 1, sourceType: 1, title: 1, url: 1, heading: 1, content: 1 } as const

/** Vector similarity search over a project's chunks. */
export async function searchChunks(projectId: string, queryVector: number[], opts: SearchOptions = {}): Promise<SearchHit[]> {
  const limit = opts.limit ?? 6
  const minScore = opts.minScore ?? -1
  const { chunks } = await useCollections()
  const filter: Record<string, string> = opts.embeddingModel ? { projectId, embeddingModel: opts.embeddingModel } : { projectId }

  if (getVectorMode() === 'atlas') {
    try {
      const hits = await chunks.aggregate<SearchHit>([
        {
          $vectorSearch: {
            index: VECTOR_INDEX_NAME,
            path: 'embedding',
            queryVector,
            numCandidates: Math.max(100, limit * 20),
            limit,
            filter
          }
        },
        // vectorSearchScore for cosine is (1 + cos) / 2, convert back to cosine
        { $project: { ...projection, score: { $subtract: [{ $multiply: [{ $meta: 'vectorSearchScore' }, 2] }, 1] } } }
      ]).toArray()
      return hits.filter(h => h.score >= minScore)
    }
    catch (err: any) {
      const message = String(err?.message || err)
      // Dimension mismatches happen briefly after an embedding model change: fall back for this query only
      if (/dimension/i.test(message)) {
        console.warn(`[vector] $vectorSearch failed, using in-app similarity for this query: ${message}`)
      }
      else {
        console.warn(`[vector] $vectorSearch failed, switching to fallback: ${message}`)
        setVectorMode('fallback')
      }
    }
  }

  // Fallback: brute force cosine similarity. Fine for up to tens of thousands of chunks per project.
  const top: SearchHit[] = []
  const cursor = chunks.find(filter, { projection: { ...projection, embedding: 1 } })
  for await (const doc of cursor as AsyncIterable<Chunk>) {
    const score = cosine(queryVector, doc.embedding)
    if (score < minScore) continue
    if (top.length < limit || score > top[top.length - 1]!.score) {
      const { embedding: _e, ...rest } = doc
      top.push({ ...(rest as any), score })
      top.sort((a, b) => b.score - a.score)
      if (top.length > limit) top.pop()
    }
  }
  return top
}

/** Embeds the query and searches the project's knowledge. */
export async function searchKnowledge(projectId: string, query: string, opts: SearchOptions = {}): Promise<SearchHit[]> {
  const { vector, key } = await embedQuery(query)
  return searchChunks(projectId, vector, { ...opts, embeddingModel: key })
}
