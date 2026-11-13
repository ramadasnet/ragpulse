import type {H3Event} from "h3"
import type {RequestEvent} from "nuxt/server"
import type {User} from "#shared/types"

/** nuxt-auth-utils types handlers with Nuxt's RequestEvent; at runtime (Nitro 2) it is an H3Event. */
export function asH3Event(event: unknown): H3Event {
    return event as H3Event
}

interface ProviderProfile {
    /** `dev` is only used by the development login shortcut and never links a provider */
    provider: "google" | "microsoft" | "dev"
    providerId: string
    email: string
    name?: string
    avatar?: string
}

function adminEmails(): string[] {
    return String(useRuntimeConfig().adminEmails || "")
        .split(",")
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean)
}

/**
 * Signs in a user coming from a social provider.
 * Only pre-registered users (invited by an admin) or emails listed in NUXT_ADMIN_EMAILS can sign in.
 */
export async function loginWithProvider(requestEvent: H3Event | RequestEvent, profile: ProviderProfile) {
    const event = asH3Event(requestEvent)
    const email = profile.email?.trim().toLowerCase()
    if (!email) return sendRedirect(event, "/login?error=no_email")

    const {users} = await useCollections()
    let user = await users.findOne({email})
    const now = new Date()

    if (!user) {
        if (!adminEmails().includes(email)) return sendRedirect(event, "/login?error=not_invited")
        user = {
            _id: newId(),
            email,
            name: profile.name || email.split("@")[0]!,
            avatar: profile.avatar,
            role: "admin",
            projects: [],
            providers: profile.provider === "dev" ? {} : {[profile.provider]: profile.providerId},
            createdAt: now,
            lastLoginAt: now
        } satisfies User
        await users.insertOne(user)
    } else {
        if (user.disabled) return sendRedirect(event, "/login?error=disabled")
        const update: Partial<User> = {lastLoginAt: now, avatar: profile.avatar || user.avatar}
        if (profile.provider !== "dev") {
            const linkedId = user.providers?.[profile.provider]
            if (linkedId && linkedId !== profile.providerId) return sendRedirect(event, "/login?error=provider_mismatch")
            update.providers = {...user.providers, [profile.provider]: profile.providerId}
        }
        // Invited users get their real name on first login
        if (profile.name && (!user.name || user.name === email.split("@")[0])) update.name = profile.name
        // Admin emails are always admins
        if (adminEmails().includes(email)) update.role = "admin"
        await users.updateOne({_id: user._id}, {$set: update})
        user = {...user, ...update}
    }

    await setUserSession(event, {
        user: {id: user._id, email: user.email, name: user.name, avatar: user.avatar, role: user.role},
        loggedInAt: now.toISOString()
    })
    return sendRedirect(event, "/admin")
}
