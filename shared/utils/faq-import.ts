// Lenient parsing of pasted FAQ content, shared by the import modal (app) and the
// AI parse endpoint (server). Accepts JavaScript-object-style JSON: comments, unquoted
// keys, single-quoted strings and trailing commas. Extra fields are ignored and field
// names are matched case-insensitively against the `question`/`q` and `answer`/`a` aliases.

export interface FaqDraft {
    question: string
    answer: string
}

/** Removes `//` and `/* … *\/` comments outside of strings (double-quoted, single-quoted and template), so JSON-with-comments parses. */
export function stripJsonComments(input: string): string {
    let out = ""
    let quote = ""
    for (let i = 0; i < input.length; i++) {
        const c = input[i]!
        if (quote) {
            out += c
            if (c === "\\") out += input[++i] ?? ""
            else if (c === quote || (c === "\n" && quote !== "`")) quote = ""
            continue
        }
        if (c === '"' || c === "'" || c === "`") {
            quote = c
            out += c
        } else if (c === "/" && input[i + 1] === "/") {
            while (i < input.length && input[i] !== "\n") i++
            out += "\n"
        } else if (c === "/" && input[i + 1] === "*") {
            i += 2
            while (i < input.length && !(input[i] === "*" && input[i + 1] === "/")) i++
            i++
        } else {
            out += c
        }
    }
    return out
}

const JS_ESCAPES: Record<string, string> = {n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", v: "\v", "0": "\0"}

/** Reads a JS string literal at src[i] (opened by `q`), returning its value and the index after the closing quote. */
function readJsString(src: string, i: number, q: string): {value: string; next: number} {
    let s = ""
    for (let j = i + 1; j < src.length; j++) {
        const c = src[j]!
        if (c === q) return {value: s, next: j + 1}
        if (q !== "`" && c === "\n") return {value: s, next: j}
        if (c === "\\") {
            const e = src[j + 1]
            if (e === undefined) break
            if (e === "\n" || e === "\r") {
                j++
                continue
            }
            if (e === "x" || e === "u") {
                let len = 2
                if (e === "u" && src[j + 2] === "{") {
                    const close = src.indexOf("}", j + 3)
                    const cp = close > 0 ? parseInt(src.slice(j + 3, close), 16) : NaN
                    if (close > 0 && !Number.isNaN(cp)) {
                        s += String.fromCodePoint(cp)
                        j = close
                        continue
                    }
                } else if (e === "u") len = 4
                const code = parseInt(src.slice(j + 2, j + 2 + len), 16)
                if (Number.isNaN(code)) {
                    s += e
                    j += 1
                } else {
                    s += String.fromCharCode(code)
                    j += 1 + len
                }
                continue
            }
            s += JS_ESCAPES[e] ?? e
            j++
            continue
        }
        s += c
    }
    return {value: s, next: src.length}
}

/** `0x…`, `0o…`, `0b…` and bigint `…n` literals as plain JSON numbers. */
function normalizeNumber(token: string): string {
    if (/^0x[0-9a-f]+$/i.test(token)) return String(parseInt(token, 16))
    if (/^0o[0-7]+$/i.test(token)) return String(parseInt(token.slice(2), 8))
    if (/^0b[01]+$/i.test(token)) return String(parseInt(token.slice(2), 2))
    if (/^\d[\d.]*n$/.test(token)) return token.slice(0, -1)
    if (token.startsWith(".")) return `0${token}`
    return token
}

const isIdentStart = (c: string) => /[A-Za-z_$]/.test(c)
const isIdentChar = (c: string) => /[\w$]/.test(c)
const isDigit = (c: string) => c >= "0" && c <= "9"

/**
 * Turns JavaScript-object-style input into strict JSON: `//` and `/* … *\/` comments are stripped, unquoted
 * keys get quoted, single-quoted and template strings become double-quoted, `undefined`/`NaN`/`Infinity`
 * and other number literals are normalized, bare words in value position become strings and trailing
 * commas are dropped. Anything still invalid is left for the caller's JSON.parse to reject.
 */
export function jsObjectToJson(input: string): string {
    const src = stripJsonComments(input)
    let out = ""
    // Index in `out` of the last comma emitted; dropped when only whitespace follows before ] or }
    let comma = -1
    for (let i = 0; i < src.length;) {
        const c = src[i]!
        if (c === '"' || c === "'" || c === "`") {
            const {value, next} = readJsString(src, i, c)
            out += JSON.stringify(value)
            i = next
            continue
        }
        const num = isDigit(c) || (c === "." && isDigit(src[i + 1] ?? ""))
        if (isIdentStart(c) || num) {
            let j = i + 1
            while (j < src.length && (num ? /[\w$.+-]/.test(src[j]!) : isIdentChar(src[j]!))) j++
            const word = src.slice(i, j)
            let k = j
            while (k < src.length && /\s/.test(src[k]!)) k++
            if (src[k] === ":") {
                out += JSON.stringify(word)
            } else if (num) {
                out += normalizeNumber(word)
            } else if (word === "true" || word === "false" || word === "null") {
                out += word
            } else if (word === "undefined" || word === "NaN" || word === "Infinity") {
                out += "null"
            } else {
                out += JSON.stringify(word)
            }
            i = j
            continue
        }
        // Unary plus: +5 → 5
        if (c === "+" && isDigit(src[i + 1] ?? "")) {
            i++
            continue
        }
        if (c === ",") comma = out.length
        if ((c === "]" || c === "}") && comma >= 0 && !out.slice(comma + 1).trim()) {
            out = out.slice(0, comma)
            comma = -1
        }
        out += c
        i++
    }
    return out
}

/** First string value of the given keys (case-insensitive), trimmed. Objects, arrays and other types are not valid FAQ text. */
function field(x: any, ...names: string[]): string {
    if (!x || typeof x !== "object") return ""
    for (const key of Object.keys(x)) {
        const v = x[key]
        if (names.includes(key.toLowerCase()) && typeof v === "string") return v.trim()
    }
    return ""
}

/** Normalizes one entry to `{question, answer}`; extra fields are ignored. */
export function faqItemFrom(x: any): FaqDraft {
    return {question: field(x, "question", "q"), answer: field(x, "answer", "a")}
}

/** Finds the entry list in parsed JSON: a top-level array, a single entry object, or the first array-valued field (`items`, `faqs`, `data`, …). */
export function faqListFrom(data: any): unknown[] {
    if (Array.isArray(data)) return data
    if (!data || typeof data !== "object") return []
    if (field(data, "question", "q")) return [data]
    return Object.values(data).find(Array.isArray) ?? []
}

/** Parses JSON / JS-object-style input into normalized entries; entries without both fields are counted as `invalid`. Throws on invalid input. */
export function parseFaqJson(raw: string): {items: FaqDraft[]; invalid: number} {
    const list = faqListFrom(JSON.parse(jsObjectToJson(raw)))
    const items = list.map(faqItemFrom).filter((x) => x.question && x.answer)
    return {items, invalid: list.length - items.length}
}
