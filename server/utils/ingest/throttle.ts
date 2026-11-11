// Per-host request pacing and Retry-After parsing for polite crawling. Pure module (no Nuxt auto-imports).

/** Upper bound for the per-host interval after repeated 429 responses */
export const MAX_HOST_INTERVAL_MS = 10_000

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
}

/**
 * Spaces out request starts per host. Each `wait()` reserves the next free slot, so concurrent
 * workers queue up instead of bursting. `penalize()` slows a host down after a 429.
 */
export class HostThrottle {
    private hosts = new Map<string, HostState>()

    constructor(
        private minIntervalMs: number,
        private now: () => number = Date.now,
        private sleep: (ms: number, signal?: AbortSignal) => Promise<void> = abortableSleep
    ) {}

    private state(host: string): HostState {
        let s = this.hosts.get(host)
        if (!s) {
            s = {interval: this.minIntervalMs, nextAt: 0}
            this.hosts.set(host, s)
        }
        return s
    }

    /** Current interval between requests to `host`, in milliseconds */
    interval(host: string): number {
        return this.state(host).interval
    }

    /** Raises the interval of a host, e.g. to honour a robots.txt `Crawl-delay`. */
    setMinInterval(host: string, ms: number) {
        const s = this.state(host)
        s.interval = Math.max(s.interval, ms)
    }

    /** Waits until a request to `host` may start. */
    async wait(host: string, signal?: AbortSignal): Promise<void> {
        const s = this.state(host)
        const now = this.now()
        const start = Math.max(now, s.nextAt)
        s.nextAt = start + s.interval
        await this.sleep(start - now, signal)
    }

    /** Backs off after a 429/503: no request to `host` before `delayMs`, and a doubled interval from then on. */
    penalize(host: string, delayMs: number) {
        const s = this.state(host)
        s.interval = Math.min(MAX_HOST_INTERVAL_MS, Math.max(s.interval * 2, 1000))
        s.nextAt = Math.max(s.nextAt, this.now() + delayMs)
    }
}
