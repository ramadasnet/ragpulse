import {expect, test} from "bun:test"
import {parseRobotsTxt} from "../server/utils/ingest/url"
import {comparisonPath, comparisonRows, comparisons, faq, mcpSupport, siteUrl} from "../shared/marketing"

test("marketing robots rules block admin routes but allow public admin screenshots", async () => {
    const text = await Bun.file(new URL("../landing/public/robots.txt", import.meta.url)).text()
    for (const agent of ["Googlebot", "GPTBot", "ClaudeBot", "PerplexityBot", "example"]) {
        const {rules, sitemaps} = parseRobotsTxt(text, agent.toLowerCase())
        const allowed = (path: string) => rules.filter(({regex}) => regex.test(path)).sort((a, b) => b.length - a.length)[0]?.allow ?? true
        for (const path of ["/admin", "/admin?project=example", "/admin/projects", "/api/chat", "/chat/example"]) expect(allowed(path)).toBe(false)
        for (const path of ["/admin-overview.webp", "/admin-knowledge-mobile.webp", "/compare/chatbase"]) expect(allowed(path)).toBe(true)
        expect(sitemaps).toContain(siteUrl + "/sitemap.xml")
    }
})

test("marketing discovery includes every public page and excludes application routes", async () => {
    const globals = globalThis as typeof globalThis & Record<string, unknown>
    const original = {defineEventHandler: globals.defineEventHandler, getRequestURL: globals.getRequestURL, setHeader: globals.setHeader}
    let path = "/sitemap.xml"
    const headers = new Headers()

    try {
        globals.defineEventHandler = (handler: unknown) => handler
        globals.getRequestURL = () => new URL(path, "http://localhost")
        globals.setHeader = (_event: unknown, name: string, value: string) => headers.set(name, value)

        const {default: discover} = await import("../landing/discovery")
        const event = {} as Parameters<typeof discover>[0]
        const sitemap = discover(event)
        const comparisonUrls = comparisons.map(({slug}) => siteUrl + comparisonPath(slug))
        expect(headers.get("content-type")).toBe("application/xml; charset=utf-8")
        expect(Array.from(sitemap.matchAll(/<loc>(.*?)<\/loc>/g), ([, url]) => url)).toEqual([siteUrl + "/", siteUrl + "/compare", ...comparisonUrls])
        expect(new Set(comparisonUrls).size).toBe(comparisonUrls.length)

        path = "/llms.txt"
        const index = discover(event)
        expect(headers.get("content-type")).toBe("text/plain; charset=utf-8")
        for (const url of comparisonUrls) expect(index).toContain(url)
        expect(index).toContain(`${siteUrl}/compare#${mcpSupport.id}`)

        path = "/llms-full.txt"
        const full = discover(event)
        for (const {question, answer} of faq) expect(full).toContain(`### ${question}\n\n${answer}`)
        for (const {name, verdict, fit, cells} of comparisons) {
            expect(full).toContain(verdict)
            for (const paragraph of fit) expect(full).toContain(paragraph)
            for (const {key, topic, ragpulse} of comparisonRows) expect(full).toContain(`- ${topic}: RAGPulse: ${ragpulse} ${name}: ${cells[key]}`)
        }
        expect(full).toContain(mcpSupport.summary)
        for (const step of mcpSupport.example) expect(full).toContain(step)
        for (const {names} of mcpSupport.tools) for (const name of names) expect(full).toContain(`\`${name}\``)
    } finally {
        for (const [name, value] of Object.entries(original)) {
            if (value === undefined) delete globals[name]
            else globals[name] = value
        }
    }
})
