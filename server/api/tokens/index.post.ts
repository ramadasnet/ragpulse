import {z} from "zod"
import type {ApiToken} from "#shared/types"
import {PROJECT_PERMISSIONS} from "#shared/types"
import logger from "../../utils/logger"

const MAX_TOKENS_PER_USER = 20

const bodySchema = z.object({
    name: z.string().trim().min(1, "Name is required").max(80, "Name is too long"),
    projectIds: z.array(z.string().trim().min(1).max(64)).min(1, "Select at least one project").max(500).optional(),
    permissions: z.array(z.enum(PROJECT_PERMISSIONS)).max(PROJECT_PERMISSIONS.length).optional(),
    expiresInDays: z.number().int().min(1).max(3650).optional()
})

export default defineEventHandler(async (event) => {
    const user = await requireUser(event)
    const parsed = bodySchema.safeParse(await readBody(event).catch(() => null))
    if (!parsed.success) throw createError({statusCode: 400, statusMessage: parsed.error.issues[0]?.message || "Invalid body"})

    const {apiTokens, projects} = await useCollections()
    const count = await apiTokens.countDocuments({userId: user._id})
    if (count >= MAX_TOKENS_PER_USER) {
        throw createError({statusCode: 409, statusMessage: `Token limit reached (${MAX_TOKENS_PER_USER}). Revoke an unused token first.`})
    }

    let projectIds: string[] | undefined
    if (parsed.data.projectIds) {
        projectIds = [...new Set(parsed.data.projectIds)]
        const forbidden = projectIds.find((id) => !canAccessProject(user, id))
        if (forbidden) throw createError({statusCode: 403, statusMessage: `No access to project: ${forbidden}`})
        const existing = await projects.countDocuments({_id: {$in: projectIds}})
        if (existing !== projectIds.length) throw createError({statusCode: 400, statusMessage: "One or more selected projects do not exist"})
    }
    const permissions = parsed.data.permissions ? PROJECT_PERMISSIONS.filter((p) => parsed.data.permissions!.includes(p)) : undefined
    const now = new Date()
    const expiresAt = parsed.data.expiresInDays ? new Date(now.getTime() + parsed.data.expiresInDays * 86400_000) : undefined

    const {token, prefix, tokenHash} = generateApiToken()
    const record: ApiToken = {
        _id: newId(),
        userId: user._id,
        name: parsed.data.name,
        prefix,
        tokenHash,
        ...(projectIds ? {projectIds} : {}),
        ...(permissions ? {permissions} : {}),
        ...(expiresAt ? {expiresAt} : {}),
        createdAt: now
    }
    await apiTokens.insertOne(record)
    logger.info(
        "Tokens.create",
        `Token ${record._id} "${record.name}" (${record.prefix}…)`,
        `By ${user.email}`,
        `${projectIds ? `${projectIds.length} project(s)` : "all projects"}${permissions ? `, ${permissions.length} permission(s)` : ""}${expiresAt ? `, expires ${expiresAt.toISOString().slice(0, 10)}` : ", no expiry"}`
    )
    return {
        token,
        _id: record._id,
        name: record.name,
        prefix,
        projectIds: record.projectIds,
        permissions: record.permissions,
        expiresAt: record.expiresAt,
        createdAt: record.createdAt
    }
})
