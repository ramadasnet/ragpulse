import type { H3Event } from 'h3'

// In-memory sliding window rate limiter (per process). Good enough for a single instance deployment.

const windows = new Map<string, number[]>()
let lastSweep = Date.now()

function sweep(now: number) {
  if (now - lastSweep < 60_000) return
  lastSweep = now
  for (const [key, hits] of windows) {
    // Windows are at most a few hours long
    if (!hits.length || now - hits[hits.length - 1]! > 6 * 3600_000) windows.delete(key)
  }
}

/** Client IP (honours `X-Forwarded-For` as RAGPulse usually runs behind a reverse proxy). */
export function chatClientIp(event: H3Event): string {
  return getRequestIP(event, { xForwardedFor: true }) || 'unknown'
}

/**
 * Records a hit for `bucket` + client IP and throws 429 when more than `limit` hits happened within `windowMs`.
 */
export function enforceRateLimit(event: H3Event, bucket: string, limit: number, windowMs: number): void {
  const now = Date.now()
  sweep(now)
  const key = `${bucket}:${chatClientIp(event)}`
  const hits = (windows.get(key) || []).filter(t => now - t < windowMs)
  if (hits.length >= limit) {
    windows.set(key, hits)
    const retryAfter = Math.max(1, Math.ceil((hits[0]! + windowMs - now) / 1000))
    setResponseHeader(event, 'Retry-After', retryAfter)
    throw createError({ statusCode: 429, statusMessage: 'Too many requests, please slow down and try again later' })
  }
  hits.push(now)
  windows.set(key, hits)
}
