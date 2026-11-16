import type {H3Event} from "h3"
import {createHash, randomBytes} from "node:crypto"
import type {ApiToken, Project, ProjectPermission, User} from "#shared/types"
import {PROJECT_PERMISSIONS} from "../../shared/types"

export function sha256(value: string): string {
    return createHash("sha256").update(value).digest("hex")
}

export function randomToken(bytes = 32): string {
    return randomBytes(bytes).toString("base64url")
}

/** Returns the authenticated, enabled user (fresh from the DB) or throws 401/403. */
export async function requireUser(event: H3Event): Promise<User> {
    if (event.context.user) return event.context.user as User
    const session = await getUserSession(event)
    if (!session.user?.id) throw createError({statusCode: 401, statusMessage: "Not authenticated"})
    const {users} = await useCollections()
    const user = await users.findOne({_id: session.user.id})
    if (!user) {
        await clearUserSession(event)
        throw createError({statusCode: 401, statusMessage: "Account not found"})
    }
    if (user.disabled) throw createError({statusCode: 403, statusMessage: "Account disabled"})
    event.context.user = user
    return user
}

export async function requireAdmin(event: H3Event): Promise<User> {
    const user = await requireUser(event)
    if (user.role !== "admin") throw createError({statusCode: 403, statusMessage: "Admin access required"})
    return user
}

/** Permissions a user has on a project. Admins have every permission. */
export function projectPermissions(user: User, projectId: string): ProjectPermission[] {
    if (user.role === "admin") return [...PROJECT_PERMISSIONS]
    return user.projects.find((p) => p.projectId === projectId)?.permissions ?? []
}

/** True if the user can see the project at all (admin or any assigned permission set). */
export function canAccessProject(user: User, projectId: string): boolean {
    return user.role === "admin" || user.projects.some((p) => p.projectId === projectId)
}

export function hasProjectPermission(user: User, projectId: string, permission?: ProjectPermission): boolean {
    if (!canAccessProject(user, projectId)) return false
    return !permission || projectPermissions(user, projectId).includes(permission)
}

/** Project ids visible to the user, or `null` meaning "all projects" (admins). */
export function accessibleProjectIds(user: User): string[] | null {
    return user.role === "admin" ? null : user.projects.map((p) => p.projectId)
}

/** Throws 403/404 unless the user can access the project (optionally with a permission). Returns the project. */
export async function assertProjectAccess(user: User, projectId: string, permission?: ProjectPermission): Promise<Project> {
    if (!hasProjectPermission(user, projectId, permission)) {
        throw createError({statusCode: 403, statusMessage: permission ? `Missing permission: ${permission}` : "No access to this project"})
    }
    const {projects} = await useCollections()
    const project = await projects.findOne({_id: projectId})
    if (!project) throw createError({statusCode: 404, statusMessage: "Project not found"})
    return project
}

/** For API routes under /api/projects/:id. Reads the `id` router param. */
export async function requireProjectAccess(event: H3Event, permission?: ProjectPermission): Promise<{user: User; project: Project}> {
    const user = await requireUser(event)
    const projectId = getRouterParam(event, "id")
    if (!projectId) throw createError({statusCode: 400, statusMessage: "Missing project id"})
    const project = await assertProjectAccess(user, projectId, permission)
    return {user, project}
}

/** Minimum interval between `lastUsedAt` writes on stateless API token requests. */
const TOKEN_TOUCH_MS = 60_000

/** Applies a token's optional project and permission restrictions to its owner's current access. */
export function restrictUserByToken(user: User, token: Pick<ApiToken, "projectIds" | "permissions">, allProjectIds?: string[]): User {
    if (token.projectIds === undefined && token.permissions === undefined) return user
    const baseIds = user.role === "admin" ? (token.projectIds ?? allProjectIds ?? []) : user.projects.map((p) => p.projectId)
    const allowedIds = token.projectIds ? baseIds.filter((id) => token.projectIds!.includes(id)) : baseIds
    const projects = [...new Set(allowedIds)].map((projectId) => {
        const current = projectPermissions(user, projectId)
        const permissions = token.permissions ? current.filter((p) => token.permissions!.includes(p)) : current
        return {projectId, permissions}
    })
    return {...user, role: "assistant", projects}
}

/** Authenticates an MCP / API bearer token (`rp_...`). Returns the effective user or null. */
export async function authenticateApiToken(token: string): Promise<User | null> {
    return (await authenticateApiTokenRecord(token))?.user ?? null
}

/** Like `authenticateApiToken`, but also returns the token record (without exposing it to clients). */
export async function authenticateApiTokenRecord(token: string): Promise<{user: User; token: ApiToken} | null> {
    if (!token?.startsWith("rp_")) return null
    const {apiTokens, users, projects} = await useCollections()
    const record = await apiTokens.findOne({tokenHash: sha256(token)})
    if (!record) return null
    if (record.expiresAt && new Date(record.expiresAt).getTime() <= Date.now()) return null
    const user = await users.findOne({_id: record.userId})
    if (!user || user.disabled) return null
    if (!record.lastUsedAt || Date.now() - new Date(record.lastUsedAt).getTime() >= TOKEN_TOUCH_MS) {
        apiTokens.updateOne({_id: record._id}, {$set: {lastUsedAt: new Date()}}).catch(() => {})
    }
    const allIds = user.role === "admin" && record.projectIds === undefined && record.permissions !== undefined ? (await projects.find({}, {projection: {_id: 1}}).toArray()).map((p) => p._id) : undefined
    return {user: restrictUserByToken(user, record, allIds), token: record}
}

/** Generates a new API token. The plain token is only returned here, we store its hash. */
export function generateApiToken(): {token: string; prefix: string; tokenHash: string} {
    const token = `rp_${randomToken(30)}`
    return {token, prefix: token.slice(0, 10), tokenHash: sha256(token)}
}

/** Public-safe user representation. */
export function serializeUser(user: User) {
    return {
        _id: user._id,
        email: user.email,
        name: user.name,
        avatar: user.avatar,
        role: user.role,
        projects: user.projects,
        disabled: !!user.disabled,
        createdAt: user.createdAt,
        lastLoginAt: user.lastLoginAt,
        providers: {google: !!user.providers?.google, microsoft: !!user.providers?.microsoft}
    }
}
