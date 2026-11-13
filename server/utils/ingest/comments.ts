// Removes comments from source code (balanced and compact index presets). Pure module (no Nuxt auto-imports).
// A light scanner per language family: strings, template literals and regex literals are skipped, so comment markers
// inside them are kept. When in doubt, code is kept rather than removed.
import {basename, extname} from "node:path"

interface Syntax {
    /** Line comment markers */
    line?: string[]
    /** Where a line comment may start: anywhere, after whitespace (shell-like), or as the first text of a line */
    lineAt?: "any" | "word" | "start"
    /** Block comment delimiters (checked before line comments) */
    block?: Array<[string, string]>
    /** Quotes of single-line strings */
    quotes?: string
    /** Delimiters of strings that may span lines */
    multi?: Array<[string, string]>
    /** JavaScript template literals (`…${expr}…`) */
    template?: boolean
    /** JavaScript regex literals */
    regex?: boolean
    /** Haskell/Elm: `--` followed by a symbol is an operator */
    dashOperator?: boolean
    /** `'` starts a character literal only when it is one (Rust lifetimes, OCaml type variables) */
    charLiterals?: boolean
    /** PHP: `#[` starts an attribute, not a comment */
    hashAttributes?: boolean
}

const C_LIKE: Syntax = {line: ["//"], block: [["/*", "*/"]], quotes: `"'`}
const JS: Syntax = {...C_LIKE, template: true, regex: true}
const JVM: Syntax = {
    ...C_LIKE,
    multi: [
        ['"""', '"""'],
        ["'''", "'''"]
    ]
}
// `//` is no comment in CSS (`url(http://…)`)
const CSS: Syntax = {block: [["/*", "*/"]], quotes: `"'`}
const HASH: Syntax = {line: ["#"], quotes: `"'`}
const SHELL: Syntax = {line: ["#"], lineAt: "word", quotes: `"'`}
const CONFIG: Syntax = {line: ["#"], lineAt: "word", quotes: `"'`}

const BY_EXT: Record<string, Syntax> = {}
const register = (exts: string, syntax: Syntax) => {
    for (const ext of exts.split(" ")) BY_EXT[ext] = syntax
}
register("ts tsx mts cts js jsx mjs cjs", JS)
register("m mm cs c h cc cpp cxx hpp hh sol proto zig prisma jsonc", C_LIKE)
register("java kt kts scala groovy gradle swift dart", JVM)
register("css less scss sass", CSS)
register("go", {...C_LIKE, multi: [["`", "`"]]})
register("rs", {...C_LIKE, charLiterals: true})
register("php", {line: ["//", "#"], block: [["/*", "*/"]], quotes: `"'`, hashAttributes: true})
register("fs", {line: ["//"], block: [["(*", "*)"]], quotes: `"`, multi: [['"""', '"""']]})
register("py", {
    ...HASH,
    multi: [
        ['"""', '"""'],
        ["'''", "'''"]
    ]
})
register("rb pl pm r nim cr", HASH)
register("ex exs", {
    ...HASH,
    multi: [
        ['"""', '"""'],
        ["'''", "'''"]
    ]
})
register("jl", {line: ["#"], block: [["#=", "=#"]], quotes: `"`, multi: [['"""', '"""']]})
register("sh bash zsh fish", SHELL)
register("ps1", {line: ["#"], lineAt: "word", block: [["<#", "#>"]], quotes: `"'`})
register("tf hcl", {line: ["#", "//"], block: [["/*", "*/"]], quotes: `"`})
register("yaml yml", CONFIG)
register("graphql gql toml", {
    ...CONFIG,
    multi: [
        ['"""', '"""'],
        ["'''", "'''"]
    ]
})
register("ini cfg", {line: ["#", ";"], lineAt: "start", quotes: ""})
register("sql", {line: ["--"], block: [["/*", "*/"]], quotes: `"'`})
register("lua", {line: ["--"], block: [["--[[", "]]"]], quotes: `"'`, multi: [["[[", "]]"]]})
register("hs elm", {line: ["--"], block: [["{-", "-}"]], quotes: `"'`, charLiterals: true, dashOperator: true})
register("erl hrl", {line: ["%"], quotes: `"`})
register("clj cljs cljc edn", {line: [";"], quotes: `"`})
register("ml mli", {block: [["(*", "*)"]], quotes: `"'`, charLiterals: true})
register("vb", {line: ["'"], quotes: `"`})

const BY_NAME: Record<string, Syntax> = {
    dockerfile: {line: ["#"], lineAt: "start", quotes: ""},
    containerfile: {line: ["#"], lineAt: "start", quotes: ""},
    makefile: {line: ["#"], lineAt: "word", quotes: ""},
    justfile: SHELL,
    procfile: SHELL,
    gemfile: HASH,
    ".env.example": {line: ["#"], lineAt: "start", quotes: ""},
    "env.example": {line: ["#"], lineAt: "start", quotes: ""},
    "go.mod": {line: ["//"], quotes: `"`}
}

const MARKUP = new Set(["vue", "svelte", "astro", "html", "htm", "xml", "svg"])
const REGEX_PREFIX = new Set("(,=:[!&|?{};+-*%<>~^".split(""))
const REGEX_KEYWORDS = new Set(["return", "typeof", "case", "do", "else", "in", "of", "new", "delete", "void", "throw", "yield", "await"])
const HASKELL_SYMBOLS = new Set("!#$%&*+./<=>?@\\^|~:".split(""))
const CHAR_LITERAL = /'(?:\\(?:x[0-9a-fA-F]{2}|u\{[0-9a-fA-F]{1,6}\}|.)|[^\\'\n])'/y

/** Keeps only the line breaks of removed text, so line positions are preserved */
const newlines = (text: string) => text.replace(/[^\n]/g, "")

class Scanner {
    private pos = 0
    private out = ""
    constructor(
        private readonly src: string,
        private readonly syn: Syntax
    ) {}

    run(): string {
        this.code(false)
        return this.out
    }

    private startsWith(token: string) {
        return this.src.startsWith(token, this.pos)
    }

    /** Copies the source up to (excluding) `end`. */
    private copyTo(end: number) {
        this.out += this.src.slice(this.pos, end)
        this.pos = end
    }

    /** Index after the closing quote of a single-line string at `pos`, or -1 when it does not close on this line */
    private stringEnd(quote: string): number {
        if (quote === "'" && this.syn.charLiterals) {
            CHAR_LITERAL.lastIndex = this.pos
            return CHAR_LITERAL.test(this.src) ? CHAR_LITERAL.lastIndex : -1
        }
        for (let i = this.pos + 1; i < this.src.length; i++) {
            const c = this.src[i]
            if (c === "\\") i++
            else if (c === quote) return i + 1
            else if (c === "\n") return -1
        }
        return -1
    }

    private regexEnd(): number {
        let inClass = false
        for (let i = this.pos + 1; i < this.src.length; i++) {
            const c = this.src[i]
            if (c === "\\") i++
            else if (c === "\n") return -1
            else if (inClass) inClass = c !== "]"
            else if (c === "[") inClass = true
            else if (c === "/") return i + 1
        }
        return -1
    }

    private regexAllowed(): boolean {
        let end = this.out.length
        while (end > 0 && /\s/.test(this.out[end - 1]!)) end--
        if (!end) return true
        if (REGEX_PREFIX.has(this.out[end - 1]!)) return true
        const word = /[A-Za-z_$][\w$]*$/.exec(this.out.slice(Math.max(0, end - 12), end))?.[0]
        return !!word && REGEX_KEYWORDS.has(word)
    }

    private lineCommentAllowed(): boolean {
        const at = this.syn.lineAt ?? "any"
        if (at === "any") return true
        const lineStart = this.src.lastIndexOf("\n", this.pos - 1) + 1
        const before = this.src.slice(lineStart, this.pos)
        if (at === "start") return !before.trim()
        return !before || /[\s;]$/.test(before)
    }

    /** Removes a block comment; returns false (keeping the text) when it is never closed. */
    private removeBlock(end: string, startLength: number): boolean {
        const close = this.src.indexOf(end, this.pos + startLength)
        if (close < 0) return false
        const stop = close + end.length
        const removed = this.src.slice(this.pos, stop)
        // An inline comment between two tokens must not join them
        this.out += removed.includes("\n") ? newlines(removed) : " "
        this.pos = stop
        return true
    }

    private template() {
        this.copyTo(this.pos + 1)
        while (this.pos < this.src.length) {
            const c = this.src[this.pos]
            if (c === "\\") this.copyTo(this.pos + 2)
            else if (c === "`") return this.copyTo(this.pos + 1)
            else if (c === "$" && this.src[this.pos + 1] === "{") {
                this.copyTo(this.pos + 2)
                this.code(true)
            } else this.copyTo(this.pos + 1)
        }
    }

    /** Scans code; inside a template expression, returns after its closing brace. */
    private code(inExpression: boolean) {
        const syn = this.syn
        let depth = 0
        while (this.pos < this.src.length) {
            const c = this.src[this.pos]!
            if (inExpression) {
                if (c === "{") depth++
                else if (c === "}" && depth-- === 0) return this.copyTo(this.pos + 1)
            }
            if (syn.template && c === "`") {
                this.template()
                continue
            }
            const multi = syn.multi?.find(([open]) => this.startsWith(open))
            const block = syn.block?.find(([open]) => this.startsWith(open))
            // Lua: `--[[` is a comment, `[[` a string; the longest opening wins
            if (multi && !(block && block[0].length > multi[0].length)) {
                const close = this.src.indexOf(multi[1], this.pos + multi[0].length)
                this.copyTo(close < 0 ? this.src.length : close + multi[1].length)
                continue
            }
            if (block && this.removeBlock(block[1], block[0].length)) continue
            const line = syn.line?.find((marker) => this.startsWith(marker))
            if (line && this.lineCommentAllowed() && !(syn.hashAttributes && line === "#" && this.startsWith("#["))) {
                let operator = false
                if (syn.dashOperator) {
                    let i = this.pos
                    while (this.src[i] === "-") i++
                    operator = HASKELL_SYMBOLS.has(this.src[i] ?? "")
                }
                if (!operator) {
                    const end = this.src.indexOf("\n", this.pos)
                    this.pos = end < 0 ? this.src.length : end
                    continue
                }
            }
            if (syn.quotes?.includes(c)) {
                const end = this.stringEnd(c)
                if (end > 0) {
                    this.copyTo(end)
                    continue
                }
            }
            if (syn.regex && c === "/" && this.regexAllowed()) {
                const end = this.regexEnd()
                if (end > 0) {
                    this.copyTo(end)
                    continue
                }
            }
            this.copyTo(this.pos + 1)
        }
    }
}

/** Markup files (Vue, Svelte, Astro, HTML): HTML comments, plus code comments inside script and style blocks */
function stripMarkup(code: string, ext: string): string {
    let text = code
    let prefix = ""
    if (ext === "astro") {
        const front = /^---\n[\s\S]*?\n---(?=\n|$)/.exec(text)
        if (front) {
            prefix = new Scanner(front[0], JS).run()
            text = text.slice(front[0].length)
        }
    }
    let out = ""
    let last = 0
    const blocks = /(<script\b[^>]*>)([\s\S]*?)(<\/script\s*>)|(<style\b[^>]*>)([\s\S]*?)(<\/style\s*>)/gi
    const html = (part: string) => part.replace(/<!--[\s\S]*?-->/g, (m) => (m.includes("\n") ? newlines(m) : ""))
    for (const m of text.matchAll(blocks)) {
        out += html(text.slice(last, m.index))
        const [open, body, close] = m[1] ? [m[1], m[2]!, m[3]!] : [m[4]!, m[5]!, m[6]!]
        const lang = /\blang\s*=\s*["']?(\w+)/i.exec(open)?.[1]?.toLowerCase()
        const syntax = m[1] ? JS : (BY_EXT[lang ?? "css"] ?? CSS)
        out += open + new Scanner(body, syntax).run() + close
        last = m.index + m[0].length
    }
    return prefix + out + html(text.slice(last))
}

/** Comment syntax of a file, or undefined when unknown (the file is then kept as is). */
function syntaxOf(path: string): Syntax | "markup" | undefined {
    const name = basename(path).toLowerCase()
    if (BY_NAME[name]) return BY_NAME[name]
    if (/^(docker-)?compose.*\.ya?ml$/.test(name)) return CONFIG
    const ext = extname(name).slice(1)
    if (MARKUP.has(ext)) return "markup"
    return BY_EXT[ext]
}

/**
 * Source code without its comments. Lines left empty by a removed comment are dropped and blank lines are collapsed.
 * Unknown languages are returned unchanged.
 */
export function stripComments(code: string, path: string): string {
    const syntax = syntaxOf(path)
    if (!syntax) return code
    const src = code.replace(/\r\n?/g, "\n")
    // A shebang tells which interpreter runs the file: kept
    const shebang = /^#![^\n]*/.exec(src)?.[0] ?? ""
    const body = src.slice(shebang.length)
    const stripped = syntax === "markup" ? stripMarkup(body, extname(path).slice(1).toLowerCase()) : new Scanner(body, syntax).run()
    const before = body.split("\n")
    const after = stripped.split("\n")
    // Removed comments keep their line breaks, so lines still match one to one
    if (before.length !== after.length) return code
    const lines: string[] = []
    after.forEach((line, i) => {
        const kept = line.replace(/\s+$/, "")
        if (!kept && before[i]!.trim()) return
        if (!kept && !lines[lines.length - 1]) return
        lines.push(kept)
    })
    while (lines.length && !lines[lines.length - 1]) lines.pop()
    while (lines.length && !lines[0]) lines.shift()
    return (shebang ? [shebang, ...lines] : lines).join("\n")
}
