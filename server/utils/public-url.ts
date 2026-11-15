// Outbound-fetch safety for admin-configured endpoints (URL/git sources, website branding, custom AI
// provider): rejects loopback, private, link-local and reserved targets so indexing can't reach the
// internal network. Pure module (no Nuxt auto-imports).
//
// `RAGPULSE_ALLOW_PRIVATE_URLS=true` disables all checks (intranet installs, local inference).

const LOCAL_HOSTNAMES = new Set(["localhost", "ip6-localhost", "ip6-loopback", "broadcasthost"])
/** Hostname suffixes that only ever name internal machines */
const LOCAL_SUFFIXES = [".localhost", ".local", ".internal", ".lan", ".home.arpa", ".corp", ".localdomain"]
const IPV4_RE = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/
const DNS_CACHE_TTL_MS = 5 * 60_000

/** Intranet indexing / local inference opt-out: skip every private-address check. */
export function allowPrivateUrls(): boolean {
    const value = process.env.RAGPULSE_ALLOW_PRIVATE_URLS
    return !!value && value !== "0" && value.toLowerCase() !== "false"
}

/** Hostname without IPv6 brackets or a trailing root dot; null when the URL can't be parsed. */
function hostOf(input: string | URL): {url: URL; host: string} | null {
    let url: URL
    try {
        url = typeof input === "string" ? new URL(input) : input
    } catch {
        return null
    }
    return {
        url,
        host: url.hostname
            .replace(/^\[|\]$/g, "")
            .replace(/\.$/, "")
            .toLowerCase()
    }
}

/** True for a dotted-quad IPv4 or an IPv6 literal (they never go through DNS). */
function isIpLiteral(host: string): boolean {
    return (IPV4_RE.test(host) && host.split(".").every((part) => Number(part) <= 255)) || host.includes(":")
}

function privateIpv4(ip: string): boolean {
    const [a = 0, b = 0, c = 0] = ip.split(".").map(Number)
    return (
        a === 0 || // "this" network
        a === 10 ||
        a === 127 ||
        (a === 169 && b === 254) || // link-local
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168) ||
        (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
        (a === 192 && b === 0) || // IETF protocol assignments + TEST-NET-1
        (a === 198 && (b === 18 || b === 19)) || // benchmarking
        (a === 198 && b === 51 && c === 100) || // TEST-NET-2
        (a === 203 && b === 0 && c === 113) || // TEST-NET-3
        a >= 224 // multicast + reserved
    )
}

/** Expands an IPv6 literal to its eight hextets (`::ffff:1.2.3.4` tails become hextets). Null when unparsable. */
function hextets(ip: string): number[] | null {
    if (ip.includes(".")) {
        const idx = ip.lastIndexOf(":")
        const parts = ip
            .slice(idx + 1)
            .split(".")
            .map(Number)
        if (parts.length !== 4 || parts.some((n) => n > 255)) return null
        ip = `${ip.slice(0, idx)}:${(((parts[0] ?? 0) << 8) | parts[1]!).toString(16)}:${(((parts[2] ?? 0) << 8) | parts[3]!).toString(16)}`
    }
    const halves = ip.split("::")
    if (halves.length > 2) return null
    const head = halves[0] ? halves[0]!.split(":") : []
    const tail = halves.length === 2 && halves[1] ? halves[1]!.split(":") : []
    const missing = 8 - head.length - tail.length
    if (missing < 0 || (halves.length === 1 && missing !== 0)) return null
    const out = [...head, ...Array(missing).fill("0"), ...tail].map((part) => parseInt(part, 16))
    return out.some((n) => Number.isNaN(n) || n > 0xffff) ? null : out
}

function privateIpv6(ip: string): boolean {
    const h = hextets(ip)
    if (!h) return true
    // IPv4-mapped (::ffff:x) and -compatible (::x, incl. :: and ::1) tails go through the IPv4 ranges
    if (h.slice(0, 5).every((n) => n === 0) && (h[5] === 0 || h[5] === 0xffff)) return privateIpv4(`${h[6]! >> 8}.${h[6]! & 255}.${h[7]! >> 8}.${h[7]! & 255}`)
    if ((h[0]! & 0xfe00) === 0xfc00 || (h[0]! & 0xffc0) === 0xfe80 || (h[0]! & 0xffc0) === 0xfec0) return true // unique local, link/site local
    if ((h[0]! & 0xff00) === 0xff00) return true // multicast
    if (h[0] === 0x64 && h[1] === 0xff9b) return true // NAT64 (embeds IPv4)
    if (h[0] === 0x2001 && (h[1] === 0 || h[1] === 0x0db8)) return true // Teredo (embeds IPv4) or documentation
    if (h[0] === 0x2002) return true // 6to4 (embeds IPv4)
    return false
}

/**
 * Reason an http(s) URL must not be fetched from this network, or null. Literal checks only: the hostname
 * as written (the URL parser already normalizes `0x7f.1`-style IPv4 forms) and local hostname patterns.
 * Non-http(s) schemes are not judged here — callers validate schemes.
 */
export function publicUrlIssue(input: string | URL): string | null {
    if (allowPrivateUrls()) return null
    const parsed = hostOf(input)
    if (!parsed || !parsed.host) return "is not a valid URL"
    const {url, host} = parsed
    if (url.protocol !== "http:" && url.protocol !== "https:") return null
    if (IPV4_RE.test(host) && host.split(".").every((part) => Number(part) <= 255)) return privateIpv4(host) ? `points to a private or reserved address (${host})` : null
    if (host.includes(":")) return privateIpv6(host) ? `points to a private or reserved address (${host})` : null
    if (LOCAL_HOSTNAMES.has(host) || LOCAL_SUFFIXES.some((suffix) => host.endsWith(suffix))) return `points to a local hostname (${host})`
    if (!host.includes(".")) return `uses a hostname that can't resolve publicly (${host})`
    return null
}

export function assertPublicUrl(input: string | URL, what = "URL"): void {
    const issue = publicUrlIssue(input)
    if (issue) throw new Error(`${what} ${issue}`)
}

const dnsCache = new Map<string, {at: number; issue: string | null}>()

/**
 * `assertPublicUrl` plus DNS resolution: every address the hostname resolves to must be public, catching
 * domains that point at private ranges. Results are cached for five minutes. Throws on any failure.
 */
export async function assertPublicHost(input: string | URL, what = "URL"): Promise<void> {
    assertPublicUrl(input, what)
    if (allowPrivateUrls()) return
    const {host} = hostOf(input)!
    if (isIpLiteral(host)) return
    const cached = dnsCache.get(host)
    if (cached && Date.now() - cached.at < DNS_CACHE_TTL_MS) {
        if (cached.issue) throw new Error(`${what} ${cached.issue}`)
        return
    }
    let issue: string | null = null
    try {
        const {lookup} = await import("node:dns/promises")
        const addresses = await lookup(host, {all: true})
        const bad = addresses.find((a) => (a.family === 4 ? privateIpv4(a.address) : privateIpv6(a.address)))
        if (bad) issue = `resolves to a private or reserved address (${host} → ${bad.address})`
        else if (!addresses.length) issue = `does not resolve (${host})`
    } catch (err: any) {
        issue = `could not be resolved (${host}${err?.code ? `: ${err.code}` : ""})`
    }
    if (dnsCache.size > 500) dnsCache.clear()
    dnsCache.set(host, {at: Date.now(), issue})
    if (issue) throw new Error(`${what} ${issue}`)
}
