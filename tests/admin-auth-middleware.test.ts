import {expect, mock, test} from "bun:test"

mock.module("#shared/types", () => import("../shared/types/index.ts"))

test("admin navigation redirects on confirmed auth failures, not failed session lookups", async () => {
    const globals = globalThis as typeof globalThis & Record<string, unknown>
    const names = ["defineNuxtRouteMiddleware", "useUserSession", "useMe", "useState", "computed", "$fetch", "navigateTo"]
    const originals = names.map((name) => Object.getOwnPropertyDescriptor(globals, name))
    const session = {value: null as {user?: {id: string}} | null}
    const me = {value: null}
    const route = {path: "/admin/projects/test", fullPath: "/admin/projects/test?tab=details"}
    const login = {path: "/login", query: {redirect: route.fullPath}}
    const navigateTo = mock((location: unknown) => location)
    const fetchMe = mock(async () => {})

    try {
        const {useMe} = await import("../app/composables/useMe")
        Object.assign(globals, {
            defineNuxtRouteMiddleware: (handler: unknown) => handler,
            useUserSession: () => ({
                session,
                loggedIn: {
                    get value() {
                        return Boolean(session.value?.user)
                    }
                }
            }),
            useMe,
            useState: () => me,
            computed: (read: () => unknown) => ({
                get value() {
                    return read()
                }
            }),
            $fetch: fetchMe,
            navigateTo
        })
        const {default: guard} = await import("../app/middleware/auth.global")
        const {guardProjectPage} = await import("../app/composables/useProjectGuard")
        const visit = () => guard(route as Parameters<typeof guard>[0], route as Parameters<typeof guard>[1])

        for (const statusCode of [undefined, 503]) {
            for (const authSession of [{user: {id: "user-1"}}, null]) {
                session.value = authSession
                fetchMe.mockRejectedValueOnce(Object.assign(new Error("Could not reach /api/me"), {statusCode}))
                await expect(visit()).resolves.toBeUndefined()
                expect(session.value).toBe(authSession)
                await expect(guardProjectPage("test", "analytics:read")).resolves.toBe(false)
            }
        }
        expect(navigateTo).not.toHaveBeenCalled()

        session.value = {}
        const calls = fetchMe.mock.calls.length
        await expect(visit()).resolves.toEqual(login)
        expect(fetchMe).toHaveBeenCalledTimes(calls)

        for (const statusCode of [401, 403]) {
            session.value = {user: {id: "user-1"}}
            fetchMe.mockRejectedValueOnce(Object.assign(new Error("Unauthorized"), {statusCode}))
            await expect(visit()).resolves.toEqual(login)
            expect(session.value).toBeNull()
        }
    } finally {
        for (const [index, name] of names.entries()) {
            const descriptor = originals[index]
            if (descriptor) Object.defineProperty(globals, name, descriptor)
            else delete globals[name]
        }
    }
})
