import {z} from "zod"
import type {User} from "#shared/types"

const schema = z.object({
    name: z.string().trim().min(1, "Name cannot be empty").max(120).optional(),
    role: z.enum(["admin", "assistant"]).optional(),
    projects: projectAccessListSchema.optional(),
    disabled: z.boolean().optional()
})

export default defineEventHandler(async (event) => {
    const admin = await requireAdmin(event)
    const userId = getRouterParam(event, "userId")!
    const body = await readZodBody(event, schema)
    const {users} = await useCollections()
    const target = await users.findOne({_id: userId})
    if (!target) throw createError({statusCode: 404, statusMessage: "User not found"})

    const demoting = body.role === "assistant" && target.role === "admin"
    const disabling = body.disabled === true && !target.disabled
    if (target._id === admin._id && (demoting || disabling)) {
        throw createError({statusCode: 400, statusMessage: "You cannot demote or disable your own account"})
    }
    if (target.role === "admin" && !target.disabled && (demoting || disabling) && (await countOtherActiveAdmins(target._id)) === 0) {
        throw createError({statusCode: 400, statusMessage: "At least one active admin is required"})
    }

    const update: Partial<User> = {}
    if (body.name !== undefined) update.name = body.name
    if (body.role !== undefined) update.role = body.role
    if (body.disabled !== undefined) update.disabled = body.disabled
    const role = body.role ?? target.role
    if (role === "admin") update.projects = []
    else if (body.projects !== undefined) update.projects = await normalizeProjectAccess(body.projects)

    const updated = await users.findOneAndUpdate({_id: target._id}, {$set: update}, {returnDocument: "after"})
    if (!updated) throw createError({statusCode: 404, statusMessage: "User not found"})
    return serializeUser(updated)
})
