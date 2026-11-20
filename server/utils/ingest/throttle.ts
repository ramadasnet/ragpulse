// Per-host request pacing and Retry-After parsing for polite crawling. Pure module (no Nuxt auto-imports).

/** Upper bound for the per-host interval after repeated 429 responses */
export const MAX_HOST_INTERVAL_MS = 10_000
/** Idle host throttle state expires after this duration so old 429s don't slow down future crawls forever */
const HOST_STATE_TTL_MS = 30 * 60_000
/** Cap tracked hosts so a shared process-wide throttle stays tiny in RAM */
const MAX_TRACKED_HOSTS = 500

/** Parses a `Retry-After` header (delay in seconds or an HTTP date) into milliseconds. */
export function parseRetryAfter(value: string | null | undefined, now = Date.now()): number | undefined {
    const v = value?.trim()
    if (!v) return undefined
    if (/^\d+(\.\d+)?$/.test(v)) return Math.round(Number(v) * 1000)
    const at = Date.parse(v)
    return Number.isNaN(at) ? undefined : Math.max(0, at - now)
}

export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
    if (ms <= 0) return Promise.resolve()
    return new Promise((resolve, reject) => {
        if (signal?.aborted) return reject(signal.reason ?? new Error("Aborted"))
        const onAbort = () => {
            clearTimeout(timer)
            reject(signal!.reason ?? new Error("Aborted"))
        }
        const timer = setTimeout(() => {
            signal?.removeEventListener("abort", onAbort)
            resolve()
        }, ms)
        signal?.addEventListener("abort", onAbort, {once: true})
    })
}

interface HostState {
    interval: number
    nextAt: number
    penalized: boolean
    lastUsedAt: number
}

/**
 * Spaces out request starts per host. Each `wait()` reserves the next free slot, so concurrent
 * workers queue up instead of bursting. `penalize()` slows a host down after a 429.
 * Safe to share across syncs: idle hosts expire after 30 minutes and the map is size-capped.
 */
export class HostThrottle {
    private hosts = new Map<string, HostState>()

    constructor(
        private minIntervalMs: number,
        private now: () => number = Date.now,
        private sleep: (ms: number, signal?: AbortSignal) => Promise<void> = abortableSleep
    ) {}

    private expired(s: HostState, now: number): boolean {
        return now - s.lastUsedAt > HOST_STATE_TTL_MS && s.nextAt <= now
    }

    private prune(now: number) {
        for (const [host, s] of this.hosts) {
            if (this.expired(s, now)) this.hosts.delete(host)
        }
        while (this.hosts.size >= MAX_TRACKED_HOSTS) {
            const oldest = this.hosts.keys().next().value
            if (oldest === undefined) break
            this.hosts.delete(oldest)
        }
    }

    private state(host: string): HostState {
        const now = this.now()
        let s = this.hosts.get(host)
        if (s && this.expired(s, now)) {
            this.hosts.delete(host)
            s = undefined
        }
        if (!s) {
            if (this.hosts.size >= MAX_TRACKED_HOSTS) this.prune(now)
            s = {interval: this.minIntervalMs, nextAt: 0, penalized: false, lastUsedAt: now}
            this.hosts.set(host, s)
        } else {
            s.lastUsedAt = now
        }
        return s
    }

    /** Current interval between requests to `host`, in milliseconds */
    interval(host: string): number {
        return this.state(host).interval
    }

    /** True while `host` has recently returned a 429/503 and should be crawled at concurrency 1. */
    isPenalized(host: string): boolean {
        const s = this.hosts.get(host)
        if (!s || this.expired(s, this.now())) return false
        return s.penalized
    }

    /** Raises the interval of a host, e.g. to honour a robots.txt `Crawl-delay`. */
    setMinInterval(host: string, ms: number) {
        const s = this.state(host)
        s.interval = Math.max(s.interval, ms)
    }

    /** Waits until a request to `host` may start. Optional `minIntervalMs` raises the base spacing for this call. */
    async wait(host: string, signal?: AbortSignal, minIntervalMs?: number): Promise<void> {
        const s = this.state(host)
        const now = this.now()
        const spacing = Math.max(s.interval, minIntervalMs ?? this.minIntervalMs)
        const start = Math.max(now, s.nextAt)
        s.nextAt = start + spacing
        s.lastUsedAt = start
        await this.sleep(start - now, signal)
    }

    /** Backs off after a 429/503: no request to `host` before `delayMs`, and a doubled interval from then on. */
    penalize(host: string, delayMs: number) {
        const s = this.state(host)
        const now = this.now()
        s.penalized = true
        s.interval = Math.min(MAX_HOST_INTERVAL_MS, Math.max(s.interval * 2, 1000))
        s.nextAt = Math.max(s.nextAt, now + delayMs)
        s.lastUsedAt = now
    }
}
