export default defineEventHandler(async (event) => {
  const { project } = await requireProjectAccess(event, 'sources:manage')
  const sourceId = getRouterParam(event, 'sourceId')
  const { documents } = await useCollections()
  return documents.aggregate<{ _id: string, ref: string, url?: string, title: string, chunkCount: number, updatedAt: Date, size: number }>([
    { $match: { projectId: project._id, sourceId } },
    { $sort: { ref: 1 } },
    { $project: { _id: 1, ref: 1, url: 1, title: 1, chunkCount: 1, updatedAt: 1, size: { $strLenBytes: { $ifNull: ['$markdown', ''] } } } }
  ]).toArray()
})
