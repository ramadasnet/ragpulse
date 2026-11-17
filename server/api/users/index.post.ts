import {z} from "zod"
import type {User} from "#shared/types"
import logger from "../../utils/logger"

const schema = z.object({
    email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address")),
    name: z.string().trim().max(120).optional(),
    role: z.enum(["admin", "assistant"]),
    projects: projectAccessListSchema.default([])
})

export default defineEventHandler(async (event) => {
    const admin = await requireAdmin(event)
    const body = await readZodBody(event, schema)
    const {users} = await useCollections()
    if (await users.findOne({email: body.email}, {projection: {_id: 1}})) {
        throw createError({statusCode: 409, statusMessage: "A user with this email already exists"})
    }

    const user: User = {
        _id: newId(),
        email: body.email,
        name: body.name || body.email.split("@")[0]!,
        role: body.role,
        projects: body.role === "admin" ? [] : await normalizeProjectAccess(body.projects),
        providers: {},
        createdAt: new Date()
    }
    try {
        await users.insertOne(user)
    } catch (err: any) {
        if (err?.code === 11000) throw createError({statusCode: 409, statusMessage: "A user with this email already exists"})
        throw err
    }

    const {public: pub} = useRuntimeConfig()
    const appName = String(pub.appName || "RAGPulse")
    let inviteSent = false
    if (isMailConfigured()) {
        const link = publicUrl("admin", "/login")
        inviteSent = await sendMail({
            to: user.email,
            subject: `You've been invited to ${appName}`,
            text: `Hi ${user.name},\n\n${admin.name} invited you to ${appName} as ${user.role === "admin" ? "an admin" : "an assistant"}.\n\nSign in with your Google or Microsoft account using this email address (${user.email}):\n${link}\n`,
            html: `<p>Hi ${escapeHtml(user.name)},</p>
<p>${escapeHtml(admin.name)} invited you to <strong>${escapeHtml(appName)}</strong> as ${user.role === "admin" ? "an admin" : "an assistant"}.</p>
<p>Sign in with your Google or Microsoft account using this email address (${escapeHtml(user.email)}):</p>
<p><a href="${escapeHtml(link)}">${escapeHtml(link)}</a></p>`
        })
    }

    logger.info("Users.create", `User ${user._id} ${user.email} (${user.role})`, `Invited by ${admin.email}${inviteSent ? ", invite email sent" : ""}`)
    setResponseStatus(event, 201)
    return serializeUser(user)
})
