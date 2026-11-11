import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { codeToMarkdown, defaultGitInclude, CODE_GIT_EXCLUDE, isCodeFile } from '../server/utils/ingest/git'
import { matchesAnyGlob } from '../server/utils/ingest/glob'
import { HostThrottle, MAX_HOST_INTERVAL_MS, parseRetryAfter } from '../server/utils/ingest/throttle'
import { fetchUrlSource, parseRobotsTxt, robotsAgent } from '../server/utils/ingest/url'
import { vectorIndexOutdated } from '../server/utils/db'

describe('Retry-After', () => {
  test('parses seconds and HTTP dates', () => {
    const now = Date.parse('2026-01-01T00:00:00Z')
    expect(parseRetryAfter('120', now)).toBe(120_000)
    expect(parseRetryAfter('Thu, 01 Jan 2026 00:00:30 GMT', now)).toBe(30_000)
    expect(parseRetryAfter('Wed, 31 Dec 2025 23:00:00 GMT', now)).toBe(0)
    expect(parseRetryAfter('soon', now)).toBeUndefined()
    expect(parseRetryAfter(null, now)).toBeUndefined()
  })
})

describe('HostThrottle', () => {
  function setup(interval: number) {
    let now = 0
    const waits: number[] = []
    const throttle = new HostThrottle(interval, () => now, async (ms) => {
      waits.push(ms)
    })
    return { throttle, waits, advance: (ms: number) => (now += ms) }
  }

  test('spaces requests to the same host, not across hosts', async () => {
    const { throttle, waits } = setup(500)
    await Promise.all([throttle.wait('a.com'), throttle.wait('a.com'), throttle.wait('a.com'), throttle.wait('b.com')])
    expect(waits).toEqual([0, 500, 1000, 0])
  })

  test('backs off after a 429 and honours a longer crawl delay', async () => {
    const { throttle, waits } = setup(500)
    await throttle.wait('a.com')
    throttle.penalize('a.com', 5000)
    await throttle.wait('a.com')
    expect(waits[1]).toBe(5000)
    expect(throttle.interval('a.com')).toBe(1000)
    for (let i = 0; i < 10; i++) throttle.penalize('a.com', 0)
    expect(throttle.interval('a.com')).toBe(MAX_HOST_INTERVAL_MS)
    throttle.setMinInterval('b.com', 3000)
    expect(throttle.interval('b.com')).toBe(3000)
  })
})

describe('robots.txt', () => {
  test('reads the crawl delay of the matching group', () => {
    const text = 'User-agent: *\nCrawl-delay: 2\nDisallow: /private\n\nUser-agent: ragpulsebot\nCrawl-delay: 0.5\nDisallow: /x'
    expect(parseRobotsTxt(text).crawlDelayMs).toBe(500)
    expect(parseRobotsTxt(text, 'otherbot').crawlDelayMs).toBe(2000)
  })

  test('derives the robots agent from the User-Agent', () => {
    expect(robotsAgent('RAGPulseBot/1.0 (+https://example.com)')).toBe('ragpulsebot')
    expect(robotsAgent('AcmeCrawler')).toBe('acmecrawler')
  })
})

describe('URL fetching with rate limits', () => {
  let server: ReturnType<typeof Bun.serve>
  const hits = new Map<string, number>()
  const base = () => `http://127.0.0.1:${server.port}`
  const ctx = { userAgent: 'TestBot/1.0', requestIntervalMs: 0 }

  beforeAll(() => {
    server = Bun.serve({
      port: 0,
      fetch(req) {
        const path = new URL(req.url).pathname
        const n = (hits.get(path) ?? 0) + 1
        hits.set(path, n)
        const html = (body: string) => new Response(`<html><head><title>${path}</title></head><body><main><h1>${path}</h1><p>${body}</p></main></body></html>`, { headers: { 'content-type': 'text/html' } })
        if (path === '/robots.txt') return new Response('User-agent: *\nAllow: /', { headers: { 'content-type': 'text/plain' } })
        if (path === '/flaky' && n === 1) return new Response('slow down', { status: 429, headers: { 'retry-after': '0' } })
        if (path === '/docs' || path === '/docs/') {
          const links = Array.from({ length: 6 }, (_, i) => `<a href="/docs/p${i}">Page ${i}</a>`).join(' ')
          return html(`The documentation index with enough readable text to be indexed. ${links}`)
        }
        if (path.startsWith('/docs/p')) return new Response('busy', { status: 429, headers: { 'retry-after': '3600' } })
        return html('A page with enough readable text to be indexed by the crawler.')
      }
    })
  })
  afterAll(() => server.stop(true))

  test('retries a 429 after Retry-After', async () => {
    const outcome = await fetchUrlSource(`${base()}/flaky`, {}, ctx)
    expect(hits.get('/flaky')).toBe(2)
    expect(outcome.documents).toHaveLength(1)
  })

  test('stops a crawl that stays rate limited and marks it incomplete', async () => {
    const outcome = await fetchUrlSource(`${base()}/docs/`, { crawl: true, maxPages: 20 }, ctx)
    expect(outcome.documents).toHaveLength(1)
    expect(outcome.incomplete).toContain('rate limiting')
    // Retry-After beyond the wait cap: no retries, and the crawl stops early
    expect([...hits.entries()].filter(([p]) => p.startsWith('/docs/p')).every(([, n]) => n === 1)).toBe(true)
    expect(outcome.failedRefs.length).toBeLessThanOrEqual(2)
  })
})

describe('git source code', () => {
  test('default patterns include code and manifests, but skip tests', () => {
    const include = defaultGitInclude(true)
    const indexed = (path: string) => matchesAnyGlob(path, include) && !matchesAnyGlob(path, CODE_GIT_EXCLUDE)
    for (const path of ['src/server/app.ts', 'main.go', 'web/App.vue', 'package.json', 'Dockerfile', 'deploy/docker-compose.prod.yml', 'docs/guide.md']) {
      expect(indexed(path)).toBe(true)
    }
    for (const path of ['src/app.test.ts', 'index.test-d.ts', 'test.js', 'tests/api/a.py', 'pkg/server_test.go', 'src/__tests__/a.ts', 'types/index.d.ts', 'assets/data.json']) {
      expect(indexed(path)).toBe(false)
    }
    expect(matchesAnyGlob('src/app.ts', defaultGitInclude(false))).toBe(false)
  })

  test('detects code files and puts the summary before the source', () => {
    expect(isCodeFile('server/api/x.post.ts')).toBe(true)
    expect(isCodeFile('Dockerfile')).toBe(true)
    expect(isCodeFile('README.md')).toBe(false)
    const md = codeToMarkdown({ path: 'src/a.ts', lang: 'ts', content: 'export const a = 1\n' }, 'Defines `a`.')
    expect(md).toBe('# src/a.ts\n\n## Summary\n\nDefines `a`.\n\n## Source\n\n```ts\nexport const a = 1\n```')
    expect(codeToMarkdown({ path: 'src/a.ts', lang: 'ts', content: 'x' })).toBe('# src/a.ts\n\n```ts\nx\n```')
  })
})

describe('vector index', () => {
  const fields = (dims: number, filters: string[]) => ({ latestDefinition: { fields: [{ type: 'vector', path: 'embedding', numDimensions: dims }, ...filters.map(path => ({ type: 'filter', path }))] } })

  test('is updated when dimensions or filter fields change', () => {
    expect(vectorIndexOutdated(fields(1536, ['projectId', 'sourceType', 'embeddingModel']), 1536)).toBe(false)
    expect(vectorIndexOutdated(fields(1536, ['projectId', 'sourceType']), 1536)).toBe(true)
    expect(vectorIndexOutdated(fields(1536, ['projectId', 'sourceType', 'embeddingModel']), 3072)).toBe(true)
  })
})
