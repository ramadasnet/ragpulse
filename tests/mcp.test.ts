import {describe, expect, test} from "bun:test"
import type {User} from "../shared/types"
import {accessibleProjectIds, canAccessProject, hasProjectPermission, projectPermissions, restrictUserByToken} from "../server/utils/auth"
import {effectiveSessionEnd} from "../server/utils/mcp/sessions"

const baseAdmin: User = {
    _id: "u-admin",
    email: "admin@example.com",
    name: "Admin",
    role: "admin",
    projects: [],
    providers: {},
    createdAt: new Date("2026-01-01T00:00:00Z")
}

const baseAssistant: User = {
    _id: "u-assist",
    email: "assist@example.com",
    name: "Assistant",
    role: "assistant",
    projects: [
        {projectId: "p1", permissions: ["questions:reply", "sessions:read"]},
        {projectId: "p2", permissions: ["analytics:read"]}
    ],
    providers: {},
    createdAt: new Date("2026-01-01T00:00:00Z")
}

describe("restrictUserByToken", () => {
    test("keeps full owner access when no token scope is set", () => {
        const eff = restrictUserByToken(baseAdmin, {})
        expect(eff.role).toBe("admin")
        expect(accessibleProjectIds(eff)).toBeNull()
        expect(hasProjectPermission(eff, "any-project", "sources:manage")).toBe(true)
    })

    test("restricts an admin token to selected projects and drops admin role", () => {
        const eff = restrictUserByToken(baseAdmin, {projectIds: ["p1"]})
        expect(eff.role).toBe("assistant")
        expect(canAccessProject(eff, "p1")).toBe(true)
        expect(canAccessProject(eff, "p2")).toBe(false)
        expect(hasProjectPermission(eff, "p1", "sources:manage")).toBe(true)
    })

    test("restricts an admin token to selected permissions across all projects", () => {
        const eff = restrictUserByToken(baseAdmin, {permissions: ["questions:reply"]}, ["p1", "p2"])
        expect(eff.role).toBe("assistant")
        expect(projectPermissions(eff, "p1")).toEqual(["questions:reply"])
        expect(hasProjectPermission(eff, "p2", "questions:reply")).toBe(true)
        expect(hasProjectPermission(eff, "p1", "sources:manage")).toBe(false)
    })

    test("never elevates an assistant beyond their own projects or permissions", () => {
        const eff = restrictUserByToken(baseAssistant, {
            projectIds: ["p1", "p3"],
            permissions: ["questions:reply", "sources:manage"]
        })
        expect(accessibleProjectIds(eff)).toEqual(["p1"])
        expect(canAccessProject(eff, "p3")).toBe(false)
        expect(projectPermissions(eff, "p1")).toEqual(["questions:reply"])
        expect(hasProjectPermission(eff, "p1", "sessions:read")).toBe(false)
    })

    test("supports read-only tokens with empty permission list", () => {
        const eff = restrictUserByToken(baseAdmin, {projectIds: ["p1"], permissions: []})
        expect(canAccessProject(eff, "p1")).toBe(true)
        expect(projectPermissions(eff, "p1")).toEqual([])
        expect(hasProjectPermission(eff, "p1", "questions:reply")).toBe(false)
    })
})

describe("effectiveSessionEnd", () => {
    test("flags sessions past the inactivity threshold as inactive", () => {
        const old = new Date(Date.now() - 10 * 86400_000)
        const recent = new Date(Date.now() - 2 * 86400_000)
        expect(effectiveSessionEnd({lastMessageAt: old}, 7).endReason).toBe("inactive")
        expect(effectiveSessionEnd({lastMessageAt: recent}, 7).endedAt).toBeUndefined()
        expect(effectiveSessionEnd({lastMessageAt: old}, 0).endedAt).toBeUndefined()
    })
})
