import {afterAll, beforeAll, describe, expect, test} from "bun:test"
import {analyzeWebsiteStyles, detectWebsiteTheme, parseCssColor, pickThemePreset} from "../server/utils/website-theme"

const page = (head: string, body = "", htmlAttrs = "") => `<!doctype html><html ${htmlAttrs}><head>${head}</head><body>${body}</body></html>`
const presetFor = (html: string) => {
    const match = pickThemePreset(analyzeWebsiteStyles(html))
    return `${match.preset.name}/${match.mode}`
}

describe("parseCssColor", () => {
    test("parses hex, rgb, hsl and oklch, and ignores transparent colours", () => {
        expect(parseCssColor("#0d6efd")).toEqual([13, 110, 253])
        expect(parseCssColor("#fff")).toEqual([255, 255, 255])
        expect(parseCssColor("rgb(37 99 235 / var(--tw-bg-opacity))")).toEqual([37, 99, 235])
        expect(parseCssColor("rgba(249, 115, 22, 0.9)")).toEqual([249, 115, 22])
        expect(parseCssColor("hsl(142 76% 36%)")).toEqual([22, 162, 73])
        expect(parseCssColor("oklch(54.6% 0.245 262.881)")).toEqual([21, 93, 252])
        expect(parseCssColor("rgb(0 0 0 / 0.1)")).toBeNull()
        expect(parseCssColor("#00000010")).toBeNull()
        expect(parseCssColor("currentColor")).toBeNull()
    })
})

describe("website theme matching", () => {
    test("theme-color and brand buttons on a light page pick the closest preset", () => {
        const html = page(
            `<meta name="theme-color" content="#0d6efd"><style>
        :root { --brand: #0d6efd; }
        body { background: #ffffff; color: #212529; }
        .btn-primary { background-color: var(--brand); }
      </style>`,
            '<a class="btn-primary">Go</a>'
        )
        expect(analyzeWebsiteStyles(html)).toMatchObject({primary: "#0d6efd", background: "#ffffff", mode: "light"})
        expect(presetFor(html)).toBe("Ocean/light")
    })

    test("dark page with orange call-to-action keeps the dark mode", () => {
        const html = page(
            `<style>
      html, body { background-color: #0b0b0f; color: #eee; }
      .cta { background: #ea580c; color: #fff; }
      a:hover { color: #f97316; }
    </style>`,
            '<a class="cta">Start</a><a class="cta">Buy</a>'
        )
        expect(presetFor(html)).toBe("Ember/dark")
    })

    test("colours of classes that are not on the page barely count (Tailwind / framework CSS)", () => {
        const html = page(
            `<style>
        .bg-pink-600 { background-color: rgb(219 39 119 / var(--tw-bg-opacity)); --tw-bg-opacity: 1; }
        .bg-green-700 { background-color: #15803d; }
        .text-green-700 { color: #15803d; }
      </style>`,
            '<button class="bg-green-700">A</button><span class="text-green-700">B</span>',
            'class="bg-white"'
        )
        expect(presetFor(html)).toBe("Forest/light")
    })

    test("dark variants are ignored unless the page is dark", () => {
        const css = `<style>
      :root { --background: #ffffff; --primary: #7c3aed; }
      .dark { --background: #09090b; --primary: #a3e635; }
      body { background: var(--background); }
    </style>`
        expect(analyzeWebsiteStyles(page(css))).toMatchObject({primary: "#7c3aed", mode: "light"})
        expect(analyzeWebsiteStyles(page(css, "", 'class="dark"'))).toMatchObject({primary: "#a3e635", background: "#09090b", mode: "dark"})
    })

    test("a site without brand colours gets the monochrome preset", () => {
        const html = page("<style>body { background: #fafafa; color: #111; } a { color: #333; } .btn { background: #000; }</style>")
        expect(analyzeWebsiteStyles(html).primary).toBeUndefined()
        expect(presetFor(html)).toBe("Mono/light")
    })

    test("keeps the preset's mode when its accent would be invisible in the website's mode", () => {
        expect(pickThemePreset({primary: "#a3ff7a", mode: "light"})).toMatchObject({preset: {name: "Lime"}, mode: "dark"})
        expect(pickThemePreset({mode: "dark"})).toMatchObject({preset: {name: "Mono"}, mode: "light"})
    })

    test("a brand colour never gets the monochrome preset, and an unknown mode is light", () => {
        expect(pickThemePreset({primary: "#38bdf8", mode: "dark"})).toMatchObject({preset: {name: "Ocean"}, mode: "dark"})
        expect(pickThemePreset({primary: "#533afd"})).toMatchObject({preset: {name: "Aurora"}, mode: "light"})
    })
})

describe("detectWebsiteTheme", () => {
    let server: ReturnType<typeof Bun.serve>
    beforeAll(() => {
        // The theme fetcher rejects private addresses; tests run against a local Bun.serve
        process.env.RAGPULSE_ALLOW_PRIVATE_URLS = "true"
        server = Bun.serve({
            port: 0,
            fetch(req) {
                const {pathname} = new URL(req.url)
                if (pathname === "/") {
                    return new Response(page('<link rel="stylesheet" href="/assets/site.css"><link rel="stylesheet" href="/print.css" media="print">', '<a class="button">Hi</a>'), {headers: {"content-type": "text/html; charset=utf-8"}})
                }
                if (pathname === "/assets/site.css") return new Response("body{background:#fff}.button{background:#db2777;color:#fff}", {headers: {"content-type": "text/css"}})
                if (pathname === "/print.css") return new Response(".button{background:#16a34a}", {headers: {"content-type": "text/css"}})
                return new Response("not found", {status: 404})
            }
        })
    })
    afterAll(() => server.stop(true))

    test("reads the linked screen stylesheets of the home page", async () => {
        const match = await detectWebsiteTheme(`http://localhost:${server.port}/`, {userAgent: "test"})
        expect(match?.style).toMatchObject({primary: "#db2777", mode: "light"})
        expect(match?.preset.name).toBe("Rose")
        expect(match?.mode).toBe("light")
    })

    test("returns null when the website cannot be read", async () => {
        expect(await detectWebsiteTheme(`http://localhost:${server.port}/missing`, {userAgent: "test"})).toBeNull()
    })
})
