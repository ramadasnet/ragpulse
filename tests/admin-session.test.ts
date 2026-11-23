import {expect, mock, setSystemTime, test} from "bun:test"

const runtimeConfig = {appSecret: "test-secret-long-enough-to-seal-sessions", session: {maxAge: 0}}
mock.module("nuxt/internal/server-runtime-config", () => ({useRuntimeConfig: () => runtimeConfig}))
mock.module("nuxt/internal/server-app-config", () => ({default: {}}))

test("opening the admin app extends the cookie and server session by 30 days, but background requests do not", async () => {
    const globals = globalThis as typeof globalThis & Record<string, unknown>
    const names = ["defineNuxtConfig", "defineEventHandler", "createError", "useRuntimeConfig", "useCollections", "getUserSession", "setUserSession", "clearUserSession", "requireUser", "serializeUser", "setResponseHeader"]
    const original = names.map((name) => Object.getOwnPropertyDescriptor(globals, name))
    const day = 86_400_000
    const start = Date.UTC(2026, 0, 1)
    const user = {_id: "user-1", email: "admin@example.com", name: "Admin", role: "admin"}

    function request(cookie = "") {
        return {req: {headers: new Headers({cookie})}, res: {headers: new Headers()}, context: {}}
    }

    function sessionCookie(event: ReturnType<typeof request>) {
        const header = event.res.headers.get("set-cookie") ?? ""
        expect(header.includes("Max-Age=2592000")).toBe(true)
        return header.split(";")[0]!
    }

    try {
        globals.defineNuxtConfig = (config: unknown) => config
        const {default: config} = await import("../nuxt.config")
        runtimeConfig.session = (config.runtimeConfig?.session as typeof runtimeConfig.session) ?? {maxAge: 0}
        const {getUserSession, setUserSession, clearUserSession} = await import("../node_modules/nuxt-auth-utils/dist/runtime/server/utils/session.js")
        const {requireUser, serializeUser} = await import("../server/utils/auth")
        Object.assign(globals, {
            defineEventHandler: (handler: unknown) => handler,
            createError: (error: object) => Object.assign(new Error(), error),
            useRuntimeConfig: () => runtimeConfig,
            useCollections: async () => ({users: {findOne: async () => user}}),
            getUserSession,
            setUserSession,
            clearUserSession,
            requireUser,
            serializeUser,
            setResponseHeader: (event: ReturnType<typeof request>, name: string, value: string) => event.res.headers.set(name, value)
        })
        const {default: openAdmin} = await import("../server/api/me.get")
        const asEvent = (event: ReturnType<typeof request>) => event as unknown as Parameters<typeof requireUser>[0]

        setSystemTime(start)
        const login = request()
        const session = {user: {id: user._id}, loggedInAt: new Date().toISOString()}
        await setUserSession(login, session)
        const originalCookie = sessionCookie(login)
        const legacyLogin = request()
        await setUserSession(legacyLogin, session, {maxAge: 0})
        const legacyCookie = legacyLogin.res.headers.get("set-cookie")!.split(";")[0]!

        setSystemTime(start + 29 * day)
        const reopened = request(originalCookie)
        await expect(openAdmin(asEvent(reopened))).resolves.toMatchObject({_id: user._id})
        const renewedCookie = sessionCookie(reopened)

        setSystemTime(start + 30 * day)
        await expect(openAdmin(asEvent(request(originalCookie)))).rejects.toMatchObject({statusCode: 401})
        await expect(openAdmin(asEvent(request(legacyCookie)))).rejects.toMatchObject({statusCode: 401})

        setSystemTime(start + 58 * day)
        const backgroundRequest = request(renewedCookie)
        await expect(requireUser(asEvent(backgroundRequest))).resolves.toMatchObject({_id: user._id})
        expect(backgroundRequest.res.headers.has("set-cookie")).toBe(false)

        setSystemTime(start + 59 * day)
        await expect(openAdmin(asEvent(request(renewedCookie)))).rejects.toMatchObject({statusCode: 401})
    } finally {
        setSystemTime()
        for (const [index, name] of names.entries()) {
            const descriptor = original[index]
            if (descriptor) Object.defineProperty(globals, name, descriptor)
            else delete globals[name]
        }
    }
})
