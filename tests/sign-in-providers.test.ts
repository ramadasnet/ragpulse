import {expect, test} from "bun:test"
import {configuredSignInProviders} from "../server/utils/auth"
import {signInProviderNames} from "../shared/utils/sign-in"

test.each([
    [true, true, "Google or Microsoft"],
    [true, false, "Google"],
    [false, true, "Microsoft"],
    [false, false, ""]
] as const)("invite copy only names configured providers (Google: %s, Microsoft: %s)", (google, microsoft, expected) => {
    const providers = configuredSignInProviders({
        google: {clientId: "test-id", clientSecret: google ? "test-secret" : "", redirectURL: ""},
        microsoft: {clientId: microsoft ? "test-id" : "", clientSecret: "test-secret", redirectURL: "", tenant: "common"}
    })
    expect(providers).toEqual({google, microsoft})
    expect(signInProviderNames(providers)).toBe(expected)
})

test("no provider names appear if OAuth settings or availability data are missing", () => {
    expect(signInProviderNames(configuredSignInProviders())).toBe("")
    expect(signInProviderNames(null)).toBe("")
})
