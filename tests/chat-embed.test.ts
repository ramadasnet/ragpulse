import {expect, test} from "bun:test"
import {runInNewContext} from "node:vm"

test("an open mobile chat panel follows the visual viewport", async () => {
    const globals = globalThis as typeof globalThis & Record<string, unknown>
    const {defineEventHandler, setResponseHeaders} = globals
    let script: string
    try {
        globals.defineEventHandler = (handler: unknown) => handler
        globals.setResponseHeaders = () => {}
        const {default: handleEmbed} = await import("../server/routes/embed.js.ts")
        script = await handleEmbed({} as Parameters<typeof handleEmbed>[0])
    } finally {
        if (defineEventHandler === undefined) delete globals.defineEventHandler
        else globals.defineEventHandler = defineEventHandler
        if (setResponseHeaders === undefined) delete globals.setResponseHeaders
        else globals.setResponseHeaders = setResponseHeaders
    }

    const viewport = Object.assign(new EventTarget(), {height: 700, offsetTop: 0, scale: 1})
    const frames = new Map<number, () => void>()
    let nextFrameId = 0
    const window = Object.assign(new EventTarget(), {
        visualViewport: viewport,
        requestAnimationFrame(callback: () => void) {
            frames.set(++nextFrameId, callback)
            return nextFrameId
        },
        cancelAnimationFrame(id: number) {
            frames.delete(id)
        }
    }) as EventTarget & {RAGPulse: {open(): void; close(): void}}
    function paint() {
        const callbacks = [...frames.values()]
        frames.clear()
        for (const callback of callbacks) callback()
    }
    const style = new Map<string, string>()
    const panel = {style: {setProperty: style.set.bind(style), removeProperty: style.delete.bind(style)}, appendChild() {}}
    const button = {addEventListener() {}, setAttribute() {}, focus() {}}
    const root = {querySelector: (selector: string) => ({".p": panel, ".l": button, ".w": {classList: {add() {}, remove() {}}}})[selector]}
    const location = new URL("https://www.example.com")
    const document = {
        currentScript: {src: "https://chat.example.com/embed.js", getAttribute: (name: string) => (name === "data-project" ? "demo" : null)},
        body: {appendChild() {}},
        createElement: (tag: string) => (tag === "div" ? {attachShadow: () => root, style: {}, setAttribute() {}} : {contentWindow: {postMessage() {}}}),
        addEventListener() {}
    }
    runInNewContext(script, {window, document, location, URL, fetch: async () => ({ok: true, json: async () => ({allowedHosts: [location.hostname]})}), setTimeout() {}})
    window.RAGPulse.open()
    await Bun.sleep(0)
    expect(style.get("--viewport-height")).toBe("700px")

    viewport.dispatchEvent(new Event("resize"))
    viewport.dispatchEvent(new Event("scroll"))
    paint()
    viewport.height = 420
    viewport.offsetTop = 280
    paint()
    expect(style.get("--viewport-height")).toBe("420px")
    expect(style.get("--viewport-top")).toBe("280px")

    viewport.offsetTop = 260
    window.dispatchEvent(new Event("scroll"))
    paint()
    paint()
    expect(style.get("--viewport-top")).toBe("260px")

    viewport.dispatchEvent(new Event("resize"))
    paint()
    window.RAGPulse.close()
    viewport.height = 700
    viewport.offsetTop = 0
    viewport.dispatchEvent(new Event("resize"))
    window.dispatchEvent(new Event("scroll"))
    expect(frames.size).toBe(0)
    expect(style.get("--viewport-height")).toBe("420px")
    window.RAGPulse.open()
    expect(style.get("--viewport-height")).toBe("700px")
    expect(style.get("--viewport-top")).toBe("0px")
})
