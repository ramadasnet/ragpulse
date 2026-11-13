export default defineEventHandler(async (event) => {
    const user = await requireUser(event)
    const {apiTokens} = await useCollections()
    return apiTokens
        .find({userId: user._id}, {projection: {_id: 1, name: 1, prefix: 1, lastUsedAt: 1, createdAt: 1}})
        .sort({createdAt: -1})
        .toArray()
})
