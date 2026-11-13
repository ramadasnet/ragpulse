import {z} from "zod"
import type {ApiToken} from "#shared/types"

const MAX_TOKENS_PER_USER = 20

const bodySchema = z.object({
    name: z.string().trim().min(1, "Name is required").max(80, "Name is too long")
})

export default defineEventHandler(async (event) => {
    const user = await requireUser(event)
    const parsed = bodySchema.safeParse(await readBody(event).catch(() => null))
    if (!parsed.success) throw createError({statusCode: 400, statusMessage: parsed.error.issues[0]?.message || "Invalid body"})

    const {apiTokens} = await useCollections()
    const count = await apiTokens.countDocuments({userId: user._id})
    if (count >= MAX_TOKENS_PER_USER) {
        throw createError({statusCode: 409, statusMessage: `Token limit reached (${MAX_TOKENS_PER_USER}). Revoke an unused token first.`})
    }

    const {token, prefix, tokenHash} = generateApiToken()
    const record: ApiToken = {_id: newId(), userId: user._id, name: parsed.data.name, prefix, tokenHash, createdAt: new Date()}
    await apiTokens.insertOne(record)
    return {token, _id: record._id, name: record.name, prefix, createdAt: record.createdAt}
})
