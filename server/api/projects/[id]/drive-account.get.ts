export default defineEventHandler(async (event) => {
    await requireProjectAccess(event, "sources:manage")
    const raw = useRuntimeConfig().googleServiceAccountKey
    let email: string | null = null
    try {
        email = raw ? parseServiceAccountKey(raw).client_email : null
    } catch {}
    return {email}
})
