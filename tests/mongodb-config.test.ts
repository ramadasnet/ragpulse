import {expect, test} from "bun:test"
import {readFile} from "node:fs/promises"
import {fileURLToPath} from "node:url"
import {loadNuxtConfig} from "@nuxt/kit"

test("default MongoDB URI matches the local development example and uses a direct connection", async () => {
    const cwd = fileURLToPath(new URL("../", import.meta.url))
    const config = await loadNuxtConfig({cwd, dotenv: false})
    const example = await readFile(new URL("../.env.example", import.meta.url), "utf8")
    const exampleUri = example.match(/^NUXT_MONGODB_URI=(.+)$/m)?.[1]

    expect(exampleUri).toBeDefined()
    expect(config.runtimeConfig.mongodbUri).toBe(exampleUri)
    expect(new URL(config.runtimeConfig.mongodbUri).searchParams.get("directConnection")).toBe("true")
})
