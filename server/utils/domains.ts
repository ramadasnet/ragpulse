import type {Project} from "#shared/types"

// Allowed embedding hosts = host of project.website + project.allowedDomains.
// Entries may look like `example.com`, `*.example.com`, `https://app.example.com`, `example.com:8080`.
// A wildcard entry matches the apex domain and any subdomain.

export interface DomainRule {
    /** Lowercase hostname without wildcard prefix */
    host: string
    wildcard: boolean
    scheme?: "http" | "https"
    port?: string
}

const HOST_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/
const IPV6_RE = /^\[[0-9a-f:.]+\]$/

/** Parses a domain entry. Returns null when it is not a valid host pattern. */
export function parseDomainEntry(entry: string): DomainRule | null {
    let value = String(entry || "")
        .trim()
        .toLowerCase()
    if (!value) return null
    let scheme: DomainRule["scheme"]
    const schemeMatch = value.match(/^([a-z][a-z0-9+.-]*):\/\//)
    if (schemeMatch) {
        if (schemeMatch[1] !== "http" && schemeMatch[1] !== "https") return null
        scheme = schemeMatch[1]
        value = value.slice(schemeMatch[0].length)
    }
    value = value.replace(/[/?#].*$/, "").replace(/^[^@]*@/, "")
    let port: string | undefined
    const portMatch = value.match(/:(\d{1,5})$/)
    if (portMatch) {
        port = portMatch[1]
        value = value.slice(0, -portMatch[0].length)
    }
    value = value.replace(/\.$/, "")
    let wildcard = false
    if (value.startsWith("*.")) {
        wildcard = true
        value = value.slice(2)
    }
    if (!value || (!HOST_RE.test(value) && !IPV6_RE.test(value))) return null
    if (wildcard && !value.includes(".")) return null
    return {host: value, wildcard, scheme, port}
}

/** Canonical string form of an entry (used to store/display allowed domains). */
export function normalizeDomainEntry(entry: string): string | null {
    const rule = parseDomainEntry(entry)
    if (!rule) return null
    return `${rule.scheme ? `${rule.scheme}://` : ""}${rule.wildcard ? "*." : ""}${rule.host}${rule.port ? `:${rule.port}` : ""}`
}

/** All rules for a project: website host (+ its www/apex twin) and the allowed domains. */
export function domainRules(project: Pick<Project, "website" | "allowedDomains">): DomainRule[] {
    const rules: DomainRule[] = []
    const site = parseDomainEntry(project.website || "")
    if (site) {
        rules.push({host: site.host, wildcard: false, port: site.port})
        const twin = site.host.startsWith("www.") ? site.host.slice(4) : `www.${site.host}`
        if (twin.includes(".")) rules.push({host: twin, wildcard: false, port: site.port})
    }
    for (const entry of project.allowedDomains || []) {
        const rule = parseDomainEntry(entry)
        if (rule) rules.push(rule)
    }
    const seen = new Set<string>()
    return rules.filter((r) => {
        const key = `${r.scheme}|${r.wildcard}|${r.host}|${r.port}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
    })
}

function hostMatches(rule: DomainRule, hostname: string): boolean {
    if (hostname === rule.host) return true
    return rule.wildcard && hostname.endsWith(`.${rule.host}`)
}

function splitHost(host: string): {hostname: string; port?: string} {
    const value = host.trim().toLowerCase().replace(/\.$/, "")
    const m = value.match(/^(.*?)(?::(\d{1,5}))?$/)
    return {hostname: (m?.[1] || value).replace(/\.$/, ""), port: m?.[2]}
}

/** True when the host (`example.com` or `example.com:8080`) may embed the project's chat. Ports are only checked if the rule has one. */
export function isHostAllowed(project: Pick<Project, "website" | "allowedDomains">, host: string): boolean {
    if (!host) return false
    const {hostname, port} = splitHost(host)
    return domainRules(project).some((r) => hostMatches(r, hostname) && (!r.port || r.port === port))
}

/** True when a full origin (`https://example.com`) is allowed (checks scheme and port when the rule specifies them). */
export function isOriginAllowed(project: Pick<Project, "website" | "allowedDomains">, origin: string): boolean {
    let url: URL
    try {
        url = new URL(origin)
    } catch {
        return false
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") return false
    const scheme = url.protocol.slice(0, -1)
    const hostname = url.hostname.toLowerCase()
    const port = url.port || (scheme === "https" ? "443" : "80")
    return domainRules(project).some((r) => {
        if (!hostMatches(r, hostname)) return false
        if (r.scheme && r.scheme !== scheme) return false
        if (r.port) return r.port === port
        // No port in the rule: only default ports
        return !url.port
    })
}

/** CSP `frame-ancestors` source list (without `'self'`). */
export function frameAncestors(project: Pick<Project, "website" | "allowedDomains">): string[] {
    const sources = new Set<string>()
    for (const r of domainRules(project)) {
        const scheme = r.scheme ? `${r.scheme}://` : ""
        const port = r.port ? `:${r.port}` : ""
        sources.add(`${scheme}${r.host}${port}`)
        if (r.wildcard) sources.add(`${scheme}*.${r.host}${port}`)
    }
    return [...sources]
}

/** Host patterns (`example.com`, `*.example.com`, `localhost:5173`) for the client side check in embed.js. */
export function allowedHostPatterns(project: Pick<Project, "website" | "allowedDomains">): string[] {
    return [...new Set(domainRules(project).map((r) => `${r.wildcard ? "*." : ""}${r.host}${r.port ? `:${r.port}` : ""}`))]
}
