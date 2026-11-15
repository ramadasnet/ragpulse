// Git repository fetcher: shallow clone → walk files → markdown. Pure module (no Nuxt auto-imports).
import {execFile} from "node:child_process"
import type {IngestDetail} from "#shared/types"
import {mkdtemp, open, readdir, readFile, rm, stat} from "node:fs/promises"
import {tmpdir} from "node:os"
import {basename, extname, join} from "node:path"
import {binaryMimeFromName, MAX_BINARY_BYTES} from "./binary"
import {stripComments} from "./comments"
import {matchesAnyGlob} from "./glob"
import {adocToMarkdown, tidyMarkdown, htmlToMarkdown, prepareMarkdownFile, rstToMarkdown} from "./markdown"
import {emptyFetchOutcome, type CodeFile, type CodeSummaries, type FetchContext, type FetchOutcome} from "./types"
import {assertPublicHost} from "../public-url"

const CLONE_TIMEOUT_MS = 120_000
const LS_REMOTE_TIMEOUT_MS = 30_000
/** Bump to re-index all repositories after converter changes (part of the stored revision) */
export const GIT_CONVERTER_VERSION = "2"
const MAX_FILE_BYTES = 300 * 1024
const MAX_FILES = 3000

/** Documentation files, always indexed with the default include patterns */
export const DOCS_GIT_INCLUDE = ["**/*.md", "**/*.mdx", "**/*.markdown", "**/*.txt", "**/*.rst", "**/*.adoc", "**/README*", "**/*.pdf", "**/*.{docx,pptx,xlsx}", "docs/**"]

/** Programming language extensions treated as source code (indexed and summarized) */
export const CODE_EXTENSIONS = [
    "ts",
    "tsx",
    "mts",
    "cts",
    "js",
    "jsx",
    "mjs",
    "cjs",
    "vue",
    "svelte",
    "astro",
    "py",
    "rb",
    "go",
    "rs",
    "java",
    "kt",
    "kts",
    "scala",
    "groovy",
    "swift",
    "m",
    "mm",
    "php",
    "cs",
    "fs",
    "vb",
    "c",
    "h",
    "cc",
    "cpp",
    "cxx",
    "hpp",
    "hh",
    "zig",
    "nim",
    "dart",
    "lua",
    "pl",
    "pm",
    "r",
    "jl",
    "ex",
    "exs",
    "erl",
    "hrl",
    "hs",
    "clj",
    "cljs",
    "elm",
    "ml",
    "sol",
    "sh",
    "bash",
    "zsh",
    "fish",
    "ps1",
    "sql",
    "graphql",
    "gql",
    "proto",
    "prisma",
    "tf"
]
/** Build, dependency and deployment manifests that explain how an application is put together */
const MANIFEST_FILES = new Set([
    "package.json",
    "dockerfile",
    "containerfile",
    "makefile",
    "justfile",
    "procfile",
    "pyproject.toml",
    "setup.py",
    "setup.cfg",
    "cargo.toml",
    "go.mod",
    "gemfile",
    "composer.json",
    "pom.xml",
    "build.gradle",
    "build.gradle.kts",
    "settings.gradle",
    "mix.exs",
    "pubspec.yaml",
    "deno.json",
    "nuxt.config.ts",
    ".env.example",
    "env.example",
    "fly.toml",
    "wrangler.toml",
    "netlify.toml",
    "vercel.json",
    "app.yaml",
    "serverless.yml"
])
export const CODE_GIT_INCLUDE = [`**/*.{${CODE_EXTENSIONS.join(",")}}`, `**/{${[...MANIFEST_FILES].join(",")}}`, "**/{docker-compose,compose}*.{yml,yaml}", "**/openapi*.{json,yaml,yml}", "**/swagger*.{json,yaml,yml}"]
/** Tests, generated code and fixtures add noise (and summary cost): skipped unless included explicitly */
export const CODE_GIT_EXCLUDE = [
    "**/*.{test,spec,test-d,bench}.*",
    "**/{test,tests,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx,py,rb}",
    "**/*_test.{go,py,rb,exs}",
    "**/test_*.py",
    "**/{test,tests,__tests__,__mocks__,__snapshots__,__fixtures__,fixtures,testdata,e2e,cypress}/**",
    "**/*.d.ts",
    "**/*.{generated,gen,pb}.*",
    "**/*_pb2*.py",
    "**/*.snap"
]
/** Default include patterns of a git source */
export function defaultGitInclude(code = true): string[] {
    return code ? [...DOCS_GIT_INCLUDE, ...CODE_GIT_INCLUDE] : DOCS_GIT_INCLUDE
}

/** Ref of the generated "how the application works" document of a repository */
export const OVERVIEW_REF = "ragpulse://overview"
const MAX_SUMMARY_INPUT_CHARS = 60_000
const MAX_README_CHARS = 8000

const SKIP_DIRS = new Set([
    ".git",
    "node_modules",
    "dist",
    "build",
    "vendor",
    ".next",
    ".nuxt",
    ".output",
    "coverage",
    ".cache",
    ".turbo",
    ".venv",
    "venv",
    "__pycache__",
    "target",
    "bower_components",
    ".idea",
    ".vscode",
    ".svelte-kit",
    ".docusaurus",
    ".vitepress/cache"
])
const LOCK_FILES = new Set([
    "package-lock.json",
    "yarn.lock",
    "pnpm-lock.yaml",
    "bun.lock",
    "bun.lockb",
    "cargo.lock",
    "composer.lock",
    "gemfile.lock",
    "poetry.lock",
    "pipfile.lock",
    "go.sum",
    "flake.lock",
    "mix.lock",
    "pubspec.lock",
    "packages.lock.json"
])
const DEFAULT_EXCLUDE = ["**/*.lock", "**/*.min.*", "**/requirements*.txt", "**/CMakeLists.txt", "**/robots.txt", "**/*.map"]
const BINARY_EXT =
    /\.(png|jpe?g|gif|webp|avif|svg|ico|bmp|tiff?|psd|ai|eps|pdf|zip|gz|tgz|tar|bz2|xz|7z|rar|jar|war|exe|dll|so|dylib|o|a|class|pyc|wasm|bin|dat|db|sqlite3?|woff2?|ttf|otf|eot|mp3|mp4|m4a|wav|ogg|webm|avi|mov|mkv|flac|docx?|xlsx?|pptx?|odt|ods|key|numbers|pages|dmg|iso|pkg|deb|rpm|msi|apk|ipa|npy|pkl|pt|onnx|parquet|avro)$/i
const MARKDOWN_EXT = new Set([".md", ".mdx", ".markdown"])
const PLAIN_EXT = new Set([".txt", ".text", ""])

const CODE_LANG: Record<string, string> = {
    ".ts": "ts",
    ".tsx": "tsx",
    ".js": "js",
    ".jsx": "jsx",
    ".mjs": "js",
    ".cjs": "js",
    ".vue": "vue",
    ".svelte": "svelte",
    ".py": "python",
    ".rb": "ruby",
    ".go": "go",
    ".rs": "rust",
    ".java": "java",
    ".kt": "kotlin",
    ".swift": "swift",
    ".php": "php",
    ".cs": "csharp",
    ".c": "c",
    ".h": "c",
    ".cpp": "cpp",
    ".hpp": "cpp",
    ".sh": "bash",
    ".bash": "bash",
    ".zsh": "bash",
    ".ps1": "powershell",
    ".sql": "sql",
    ".json": "json",
    ".jsonc": "json",
    ".yaml": "yaml",
    ".yml": "yaml",
    ".toml": "toml",
    ".ini": "ini",
    ".xml": "xml",
    ".css": "css",
    ".scss": "scss",
    ".graphql": "graphql",
    ".proto": "protobuf",
    ".tf": "hcl",
    ".dockerfile": "dockerfile",
    ".env": "bash",
    ".lua": "lua",
    ".dart": "dart",
    ".ex": "elixir",
    ".exs": "elixir"
}

const CODE_EXT_SET = new Set(CODE_EXTENSIONS.map((e) => `.${e}`))

/** Source code or a build/deployment manifest: summarized when code summaries are enabled. */
export function isCodeFile(path: string): boolean {
    const name = basename(path).toLowerCase()
    if (CODE_EXT_SET.has(extname(name))) return true
    return MANIFEST_FILES.has(name) || /^(docker-)?compose.*\.ya?ml$/.test(name) || /^(openapi|swagger).*\.(json|ya?ml)$/.test(name)
}

function codeLang(path: string): string {
    const ext = extname(path).toLowerCase()
    const name = basename(path).toLowerCase()
    if (name === "dockerfile" || name === "containerfile") return "dockerfile"
    if (name === "makefile") return "makefile"
    return CODE_LANG[ext] ?? ext.slice(1)
}

/**
 * Markdown document of a code file: its summary (when available) followed by the source. Compact keeps only the summary.
 * Balanced and compact index the source without its comments (detailed keeps them).
 */
export function codeToMarkdown(file: CodeFile, summary?: string, detail?: IngestDetail): string {
    if (detail === "compact" && summary?.trim()) return `# ${file.path}\n\n${summary.trim()}`
    const source = file.content.replace(/\r\n?/g, "\n").replace(/\s+$/, "")
    const stripped = detail === "balanced" || detail === "compact" ? stripComments(source, file.path) : source
    // A file made only of comments keeps them
    const body = stripped.trim() ? stripped : source
    const fence = body.includes("```") ? "~~~~" : "```"
    const code = `${fence}${file.lang}\n${body}\n${fence}`
    if (!summary?.trim()) return `# ${file.path}\n\n${code}`
    return `# ${file.path}\n\n## Summary\n\n${summary.trim()}\n\n## Source\n\n${code}`
}

/** Replaces any credentials (the token itself and `user:pass@` URL parts) in a message. */
export function scrubGitSecrets(message: string, secrets: Array<string | undefined> = []): string {
    let out = message
    for (const s of secrets) {
        if (s && s.length >= 4) out = out.split(s).join("***")
        if (s) out = out.split(encodeURIComponent(s)).join("***")
    }
    return out.replace(/(\/\/)[^/@\s:]+:[^/@\s]+@/g, "$1***@")
}

function tokenUsername(host: string): string {
    if (host.includes("gitlab")) return "oauth2"
    if (host === "bitbucket.org") return "x-token-auth"
    return "x-access-token"
}

/** The clone needs a minimal environment — server secrets stay out of child processes. */
const GIT_ENV_KEYS = [
    "PATH",
    "HOME",
    "TMPDIR",
    "TEMP",
    "TMP",
    "SYSTEMROOT",
    "COMSPEC",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "NO_PROXY",
    "http_proxy",
    "https_proxy",
    "no_proxy",
    "ALL_PROXY",
    "all_proxy",
    "GIT_EXEC_PATH",
    "GIT_SSH_COMMAND",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
    "GIT_SSL_CAINFO"
]

function gitEnv(): Record<string, string> {
    const env: Record<string, string> = {}
    for (const key of GIT_ENV_KEYS) {
        if (process.env[key]) env[key] = process.env[key]!
    }
    env.GIT_TERMINAL_PROMPT = "0"
    env.GIT_ASKPASS = "echo"
    env.SSH_ASKPASS = "echo"
    env.GCM_INTERACTIVE = "never"
    env.GIT_LFS_SKIP_SMUDGE = "1"
    return env
}

/**
 * Pins git's connection to the addresses that passed the public-host check, so the clone can't resolve the
 * hostname to something else in between (DNS rebinding). No-op for IP literals and when private URLs are allowed.
 */
function pinArgs(url: URL, addresses: string[]): string[] {
    if (!addresses.length) return []
    const port = url.port || "443"
    const list = addresses.map((a) => (a.includes(":") ? `[${a}]` : a)).join(",")
    return ["-c", `http.curloptResolve=${url.hostname}:${port}:${list}`]
}

function run(cmd: string, args: string[], opts: {cwd?: string; timeout: number}): Promise<string> {
    return new Promise((resolve, reject) => {
        execFile(
            cmd,
            args,
            {
                cwd: opts.cwd,
                timeout: opts.timeout,
                maxBuffer: 4 * 1024 * 1024,
                env: gitEnv()
            },
            (err, stdout, stderr) => {
                if (err) {
                    const detail = String(stderr || "")
                        .trim()
                        .split("\n")
                        .filter((l) => l && !l.startsWith("Cloning into"))
                        .slice(-3)
                        .join(" ")
                    const e = new Error((err as any).killed ? "git clone timed out" : detail || err.message) as Error & {code?: unknown}
                    e.code = (err as any).code
                    reject(e)
                } else {
                    resolve(String(stdout))
                }
            }
        )
    })
}

/** Commit of a branch/tag (or HEAD) in `git ls-remote` output. Branches win over tags, peeled tags over tag objects. */
export function parseLsRemote(output: string, branch?: string): string | undefined {
    const refs = new Map<string, string>()
    for (const line of output.split("\n")) {
        const m = /^([0-9a-f]{40,64})\s+(\S+)$/.exec(line.trim())
        if (m) refs.set(m[2]!, m[1]!)
    }
    if (!branch) return refs.get("HEAD")
    return refs.get(`refs/heads/${branch}`) ?? refs.get(`refs/tags/${branch}^{}`) ?? refs.get(`refs/tags/${branch}`)
}

/** Current commit of the branch on the remote, without cloning. Undefined when it can't be determined. */
async function remoteCommit(cloneUrl: string, branch?: string, pin: string[] = []): Promise<string | undefined> {
    const patterns = branch ? [`refs/heads/${branch}`, `refs/tags/${branch}`, `refs/tags/${branch}^{}`] : ["HEAD"]
    try {
        const out = await run("git", [...pin, "-c", "credential.helper=", "ls-remote", "--", cloneUrl, ...patterns], {timeout: LS_REMOTE_TIMEOUT_MS})
        return parseLsRemote(out, branch)
    } catch {
        return undefined
    }
}

/** Web URL of a file for well-known hosts, so answers can link to the source. */
export function gitFileUrl(repoUrl: string, branch: string, path: string): string | undefined {
    try {
        const u = new URL(repoUrl)
        const repo = u.pathname.replace(/\/+$/, "").replace(/\.git$/, "")
        const host = u.hostname.toLowerCase()
        const p = path.split("/").map(encodeURIComponent).join("/")
        const b = branch.split("/").map(encodeURIComponent).join("/")
        if (host === "github.com") return `https://github.com${repo}/blob/${b}/${p}`
        if (host === "gitlab.com") return `https://gitlab.com${repo}/-/blob/${b}/${p}`
        if (host === "bitbucket.org") return `https://bitbucket.org${repo}/src/${b}/${p}`
        if (host === "codeberg.org") return `https://codeberg.org${repo}/src/branch/${b}/${p}`
    } catch {}
    return undefined
}

async function walk(root: string, include: string[], exclude: string[], allowBinary: boolean, onSkip: (ref: string, reason: string) => void): Promise<string[]> {
    const files: string[] = []
    const stack: string[] = [""]
    while (stack.length && files.length < MAX_FILES) {
        const rel = stack.pop()!
        let entries
        try {
            entries = await readdir(join(root, rel), {withFileTypes: true})
        } catch {
            continue
        }
        entries.sort((a, b) => a.name.localeCompare(b.name))
        for (const entry of entries) {
            const path = rel ? `${rel}/${entry.name}` : entry.name
            // Symlinks could point outside the clone: never follow them
            if (entry.isSymbolicLink()) continue
            if (entry.isDirectory()) {
                if (!SKIP_DIRS.has(entry.name) && !SKIP_DIRS.has(path)) stack.push(path)
                continue
            }
            if (!entry.isFile()) continue
            if (LOCK_FILES.has(entry.name.toLowerCase())) continue
            if (BINARY_EXT.test(entry.name) && !(allowBinary && binaryMimeFromName(entry.name))) continue
            if (!matchesAnyGlob(path, include) || matchesAnyGlob(path, exclude)) continue
            if (files.length >= MAX_FILES) {
                onSkip(path, `file limit (${MAX_FILES}) reached`)
                break
            }
            files.push(path)
        }
    }
    return files.sort()
}

async function looksBinary(file: string): Promise<boolean> {
    const fh = await open(file, "r")
    try {
        const buf = Buffer.alloc(8000)
        const {bytesRead} = await fh.read(buf, 0, buf.length, 0)
        return buf.subarray(0, bytesRead).includes(0)
    } finally {
        await fh.close()
    }
}

function titleFromPath(path: string, repoName: string): string {
    const name = basename(path)
    if (/^readme/i.test(name)) {
        const dir = path.split("/").slice(-2, -1)[0]
        return dir ? `${dir} · README` : `${repoName} · README`
    }
    return (
        name
            .replace(/\.[^.]+$/, "")
            .replace(/[-_]+/g, " ")
            .trim() || name
    )
}

/** Converts a fetched text file (markdown, html, rst, adoc, plain text, code) to a markdown document. */
export function textFileToMarkdown(path: string, text: string, fallbackTitle: string, detail?: IngestDetail): {title: string; markdown: string} {
    const ext = extname(path).toLowerCase()
    if (MARKDOWN_EXT.has(ext)) {
        const {title, markdown} = prepareMarkdownFile(text, {mdx: ext === ".mdx", detail})
        return {title: title || fallbackTitle, markdown}
    }
    if (ext === ".html" || ext === ".htm") {
        const page = htmlToMarkdown(text, `file:///${path}`, {detail})
        return {title: page.title || fallbackTitle, markdown: page.markdown}
    }
    if (ext === ".rst") {
        const markdown = rstToMarkdown(text)
        return {title: /^#\s+(.+)$/m.exec(markdown)?.[1]?.trim() || fallbackTitle, markdown}
    }
    if (ext === ".adoc" || ext === ".asciidoc") {
        const markdown = adocToMarkdown(text)
        return {title: /^#\s+(.+)$/m.exec(markdown)?.[1]?.trim() || fallbackTitle, markdown}
    }
    if (PLAIN_EXT.has(ext)) {
        // README without extension may well be markdown
        const {title, markdown} = prepareMarkdownFile(text, {detail})
        return {title: title || fallbackTitle, markdown}
    }
    return {title: path, markdown: codeToMarkdown({path, lang: codeLang(path), content: text}, undefined, detail)}
}

export interface GitSourceOptions {
    branch?: string
    include?: string[]
    exclude?: string[]
    accessToken?: string
    /** Index source code with the default include patterns and summarize it (default true) */
    code?: boolean
}

/** Shallow-clones a repository and converts matching files to markdown documents (ref = file path). */
export async function fetchGitSource(repoUrl: string, options: GitSourceOptions, ctx: FetchContext): Promise<FetchOutcome> {
    const outcome = emptyFetchOutcome()
    const token = options.accessToken?.trim() || undefined
    let url: URL
    try {
        url = new URL(repoUrl)
    } catch {
        throw new Error("Invalid repository URL")
    }
    if (url.protocol !== "https:") throw new Error("Only https:// repository URLs are supported")
    const addresses = await assertPublicHost(url, "Repository URL", {fresh: true})
    const pin = pinArgs(url, addresses)
    url.username = ""
    url.password = ""
    const cloneUrl = new URL(url.href)
    if (token) {
        cloneUrl.username = tokenUsername(url.hostname.toLowerCase())
        cloneUrl.password = token
    }
    const branch = options.branch?.trim() || undefined
    if (branch && !/^[\w][\w./-]*$/.test(branch)) throw new Error("Invalid branch name")

    const revisionOf = (commit: string) => `${GIT_CONVERTER_VERSION}:${commit}:${ctx.revisionSalt ?? ""}`
    if (ctx.knownRevision) {
        const commit = await remoteCommit(cloneUrl.href, branch, pin)
        if (commit && revisionOf(commit) === ctx.knownRevision) {
            ctx.log?.(`${url.hostname}${url.pathname}@${branch || "HEAD"}: unchanged since the last sync (${commit.slice(0, 12)}), not cloned`)
            return {...outcome, revision: ctx.knownRevision, upToDate: true}
        }
    }

    const dir = await mkdtemp(join(tmpdir(), "ragpulse-git-"))
    const secrets = [token]
    try {
        const args = [...pin, "-c", "credential.helper=", "-c", "core.symlinks=false", "clone", "--depth", "1", "--single-branch", "--no-tags"]
        if (branch) args.push("--branch", branch)
        args.push("--", cloneUrl.href, dir)
        try {
            await run("git", args, {timeout: CLONE_TIMEOUT_MS})
        } catch (err: any) {
            if (err?.code === "ENOENT") throw new Error("git is not installed on the server")
            const msg = scrubGitSecrets(String(err?.message || err), secrets)
            if (branch && /Remote branch .* not found/i.test(msg)) throw new Error(`Branch "${branch}" not found`)
            if (/could not read Username|Authentication failed|terminal prompts disabled|\b40[13]\b|not found/i.test(msg)) {
                throw new Error(`Repository not found or access denied${token ? " (check the access token)" : " (private repositories need an access token)"}`)
            }
            throw new Error(`git clone failed: ${msg}`.slice(0, 400))
        }

        const headCommit = (await run("git", ["rev-parse", "HEAD"], {cwd: dir, timeout: 10_000}).catch(() => "")).trim()
        if (/^[0-9a-f]{40,64}$/.test(headCommit)) outcome.revision = revisionOf(headCommit)
        let headBranch = branch
        if (!headBranch) {
            headBranch = (await run("git", ["rev-parse", "--abbrev-ref", "HEAD"], {cwd: dir, timeout: 10_000}).catch(() => "")).trim() || "HEAD"
        }
        const repoName =
            url.pathname
                .replace(/\/+$/, "")
                .replace(/\.git$/, "")
                .split("/")
                .pop() || url.hostname
        const withCode = options.code !== false
        const customInclude = !!options.include?.length
        const include = customInclude ? options.include! : defaultGitInclude(withCode)
        const exclude = [...DEFAULT_EXCLUDE, ...(customInclude || !withCode ? [] : CODE_GIT_EXCLUDE), ...(options.exclude ?? [])]
        const files = await walk(dir, include, exclude, !!ctx.extractBinary, (ref, reason) => outcome.skipped.push({ref, reason}))
        const summarize = withCode ? ctx.summarizeCode : undefined
        const codeFiles: CodeFile[] = []
        let readme = ""

        for (const path of files) {
            if (ctx.signal?.aborted) throw new Error("Sync aborted")
            const abs = join(dir, path)
            try {
                const mime = ctx.extractBinary ? binaryMimeFromName(path) : undefined
                if ((await stat(abs)).size > (mime ? MAX_BINARY_BYTES : MAX_FILE_BYTES)) {
                    outcome.skipped.push({ref: path, reason: `larger than ${mime ? `${MAX_BINARY_BYTES / 1024 / 1024} MB` : `${MAX_FILE_BYTES / 1024} KB`}`})
                    continue
                }
                const content = await readFile(abs)
                if (mime) {
                    const extracted = await ctx.extractBinary!({name: basename(path), mime, bytes: content})
                    const clean = "skipped" in extracted ? "" : tidyMarkdown(extracted.markdown)
                    if (!clean) {
                        outcome.skipped.push({ref: path, reason: "skipped" in extracted ? extracted.skipped : "empty"})
                        continue
                    }
                    const title = ("title" in extracted && extracted.title) || titleFromPath(path, repoName)
                    outcome.documents.push({ref: path, url: gitFileUrl(url.href, headBranch, path), title: title.slice(0, 300), markdown: clean})
                    continue
                }
                if (await looksBinary(abs)) {
                    outcome.skipped.push({ref: path, reason: "binary file"})
                    continue
                }
                const text = content.toString("utf8")
                if (!path.includes("/") && /^readme(\.(md|markdown|mdx|txt|rst|adoc))?$/i.test(path)) readme ||= text.slice(0, MAX_README_CHARS)
                if (summarize && isCodeFile(path)) {
                    if (text.trim()) codeFiles.push({path, lang: codeLang(path), content: text})
                    else outcome.skipped.push({ref: path, reason: "empty"})
                    continue
                }
                const {title, markdown} = textFileToMarkdown(path, text, titleFromPath(path, repoName), ctx.detail)
                const clean = tidyMarkdown(markdown)
                if (!clean) {
                    outcome.skipped.push({ref: path, reason: "empty"})
                    continue
                }
                outcome.documents.push({ref: path, url: gitFileUrl(url.href, headBranch, path), title: title.slice(0, 300), markdown: clean})
            } catch (err: any) {
                outcome.failedRefs.push(path)
                if (outcome.errors.length < 5) outcome.errors.push(`${path}: ${scrubGitSecrets(String(err?.message || err), secrets)}`)
            }
        }
        if (summarize && codeFiles.length) {
            const repoUrl = url.href.replace(/\.git$/, "")
            let summaries: CodeSummaries
            try {
                summaries = await summarize(
                    {name: repoName, url: repoUrl, readme, tree: files},
                    codeFiles.map((f) => ({...f, content: f.content.slice(0, MAX_SUMMARY_INPUT_CHARS)}))
                )
            } catch (err: any) {
                if (ctx.signal?.aborted) throw err
                summaries = {files: new Map(), overviewError: String(err?.message || err), incomplete: `code summaries failed: ${String(err?.message || err).slice(0, 200)}`}
            }
            for (const file of codeFiles) {
                // Compact: trivial files are not worth their source code
                if (ctx.detail === "compact" && summaries.trivial?.has(file.path)) {
                    outcome.skipped.push({ref: file.path, reason: "no meaningful content"})
                    continue
                }
                outcome.documents.push({ref: file.path, url: gitFileUrl(url.href, headBranch, file.path), title: file.path.slice(0, 300), markdown: tidyMarkdown(codeToMarkdown(file, summaries.files.get(file.path), ctx.detail))})
            }
            if (summaries.overview?.trim()) {
                outcome.documents.push({ref: OVERVIEW_REF, url: repoUrl, title: `${repoName} · How the application works`, markdown: tidyMarkdown(summaries.overview)})
            } else if (summaries.overviewError) {
                // Keep the previous overview until it can be regenerated
                outcome.failedRefs.push(OVERVIEW_REF)
            }
            if (summaries.incomplete) outcome.incomplete = summaries.incomplete
        }
        ctx.log?.(`${url.hostname}${url.pathname}@${headBranch}: ${files.length} file(s) matched, ${outcome.documents.length} indexed (${codeFiles.length} code), ${outcome.skipped.length} skipped`)
        return outcome
    } finally {
        await rm(dir, {recursive: true, force: true}).catch(() => {})
    }
}
