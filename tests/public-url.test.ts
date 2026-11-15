import {afterEach, beforeEach, describe, expect, test} from "bun:test"
import {assertPublicHost, publicUrlIssue, safeFetch} from "../server/utils/public-url"

// Other test files allow private URLs for their local Bun.serve fixtures: force the strict mode here
beforeEach(() => {
    delete process.env.RAGPULSE_ALLOW_PRIVATE_URLS
})
afterEach(() => {
    process.env.RAGPULSE_ALLOW_PRIVATE_URLS = "true"
})

describe("publicUrlIssue", () => {
    test("allows public http(s) URLs", () => {
        expect(publicUrlIssue("https://docs.example.com/page")).toBeNull()
        expect(publicUrlIssue("http://example.com")).toBeNull()
        expect(publicUrlIssue("https://93.184.216.34/")).toBeNull()
    })

    test("blocks loopback, private and link-local IPv4 literals", () => {
        for (const host of ["127.0.0.1", "10.0.0.5", "192.168.1.10", "172.16.0.1", "169.254.169.254", "100.64.1.1", "0.0.0.0", "224.0.0.1"]) {
            expect(publicUrlIssue(`http://${host}/`)).toContain("private or reserved")
        }
    })

    test("blocks obfuscated IPv4 forms (the URL parser normalizes them)", () => {
        expect(publicUrlIssue("http://2130706433/")).toContain("private or reserved") // 127.0.0.1
        expect(publicUrlIssue("http://0x7f.0.0.1/")).toContain("private or reserved")
        expect(publicUrlIssue("http://0177.0.0.1/")).toContain("private or reserved")
        expect(publicUrlIssue("http://127.1/")).toContain("private or reserved")
    })

    test("blocks loopback, local and v4-mapped IPv6 literals", () => {
        expect(publicUrlIssue("http://[::1]/")).toContain("private or reserved")
        expect(publicUrlIssue("http://[::ffff:127.0.0.1]/")).toContain("private or reserved")
        expect(publicUrlIssue("http://[::ffff:0a0a:0a0a]/")).toContain("private or reserved")
        expect(publicUrlIssue("http://[fd00::1]/")).toContain("private or reserved")
        expect(publicUrlIssue("http://[fe80::1]/")).toContain("private or reserved")
    })

    test("blocks localhost-style and single-label hostnames", () => {
        expect(publicUrlIssue("http://localhost:3000/")).toContain("local hostname")
        expect(publicUrlIssue("http://app.internal/")).toContain("local hostname")
        expect(publicUrlIssue("http://dokploy:3000/")).toContain("can't resolve publicly")
        expect(publicUrlIssue("http://localhost./")).toContain("local hostname")
    })

    test("ignores non-http schemes (callers validate them)", () => {
        expect(publicUrlIssue("ftp://127.0.0.1/")).toBeNull()
    })

    test("RAGPULSE_ALLOW_PRIVATE_URLS disables all checks", () => {
        process.env.RAGPULSE_ALLOW_PRIVATE_URLS = "true"
        expect(publicUrlIssue("http://127.0.0.1/")).toBeNull()
        expect(publicUrlIssue("http://localhost/")).toBeNull()
    })
})

describe("assertPublicHost", () => {
    test("rejects localhost", async () => {
        await expect(assertPublicHost("http://localhost/")).rejects.toThrow("local hostname")
    })

    test("rejects unresolvable hosts", async () => {
        await expect(assertPublicHost("https://nonexistent.invalid/")).rejects.toThrow("nonexistent.invalid")
    })

    test("literal checks apply without DNS", async () => {
        await expect(assertPublicHost("http://169.254.169.254/")).rejects.toThrow("private or reserved")
        await expect(assertPublicHost("http://metadata/")).rejects.toThrow("can't resolve publicly")
    })
})

describe("safeFetch", () => {
    test("rejects a private first hop", async () => {
        await expect(safeFetch("http://127.0.0.1:1/")).rejects.toThrow("private or reserved")
    })

    test("follows redirects manually and reports the final URL", async () => {
        process.env.RAGPULSE_ALLOW_PRIVATE_URLS = "true"
        const server = Bun.serve({
            port: 0,
            fetch(req) {
                const path = new URL(req.url).pathname
                if (path === "/a") return new Response(null, {status: 302, headers: {Location: "/b"}})
                if (path === "/loop") return new Response(null, {status: 302, headers: {Location: "/loop"}})
                return new Response("ok")
            }
        })
        try {
            const res = await safeFetch(`http://127.0.0.1:${server.port}/a`)
            expect(await res.text()).toBe("ok")
            expect(res.url).toBe(`http://127.0.0.1:${server.port}/b`)
            await expect(safeFetch(`http://127.0.0.1:${server.port}/loop`)).rejects.toThrow("too many times")
        } finally {
            server.stop(true)
        }
    })
})
