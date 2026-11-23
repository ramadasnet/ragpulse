import {expect, mock, test} from "bun:test"

mock.module("#shared/types", () => import("../shared/types/index.ts"))

test("sign-out waits for in-flight /api/me renewals and ignores their responses", async () => {
    const globals = globalThis as typeof globalThis & Record<string, unknown>
    const names = ["useUserSession", "useState", "computed", "$fetch"]
    const originals = names.map((name) => Object.getOwnPropertyDescriptor(globals, name))
    const session = {value: {user: {id: "user-1"}} as unknown}
    const me = {value: null as unknown}
    const calls: string[] = []
    let finishRenewal: (user: unknown) => void = () => {}

    try {
        Object.assign(globals, {
            useUserSession: () => ({session}),
            useState: () => me,
            computed: (read: () => unknown) => ({
                get value() {
                    return read()
                }
            }),
            $fetch: mock((url: string) => {
                calls.push(url)
                if (url === "/api/me") return new Promise((resolve) => (finishRenewal = resolve))
                return Promise.resolve({ok: true})
            })
        })
        const {useMe} = await import("../app/composables/useMe")
        const {refresh, signOut} = useMe()

        const renewal = refresh()
        const signingOut = signOut()
        await Promise.resolve()
        expect(calls).toEqual(["/api/me"])
        await expect(refresh()).resolves.toBe("unauthorized")

        finishRenewal({_id: "user-1"})
        await expect(renewal).resolves.toBe("unauthorized")
        await signingOut
        expect(calls).toEqual(["/api/me", "/auth/logout"])
        expect(me.value).toBeNull()
        expect(session.value).toBeNull()
    } finally {
        for (const [index, name] of names.entries()) {
            const descriptor = originals[index]
            if (descriptor) Object.defineProperty(globals, name, descriptor)
            else delete globals[name]
        }
    }
})
