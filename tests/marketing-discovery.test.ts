import {expect, test} from "bun:test"
import {comparisonPath, comparisons, faq, siteUrl} from "../shared/marketing"

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

        path = "/llms-full.txt"
        const full = discover(event)
        for (const {question, answer} of faq) expect(full).toContain(`### ${question}\n\n${answer}`)
        for (const {verdict, fit} of comparisons) {
            expect(full).toContain(verdict)
            expect(full).toContain(fit)
        }
    } finally {
        for (const [name, value] of Object.entries(original)) {
            if (value === undefined) delete globals[name]
            else globals[name] = value
        }
    }
})
