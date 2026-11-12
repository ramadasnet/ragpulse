import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { detectFavicon, detectProjectFavicon, faviconUrls, sniffImageMime } from '../server/utils/website-theme'

const page = (head: string) => `<!doctype html><html><head>${head}</head><body></body></html>`

describe('faviconUrls', () => {
  const base = 'https://example.com/app/'

  test('resolves icon links against the page url and sorts the best candidates first', () => {
    const html = page(`
      <link rel="icon" sizes="16x16" href="/favicon-16.png">
      <link rel="icon" type="image/svg+xml" href="/icon.svg">
      <link rel="apple-touch-icon" href="/apple.png">
      <link rel="mask-icon" href="/mask.svg">
      <link rel="stylesheet" href="/site.css">
    `)
    expect(faviconUrls(html, base)).toEqual([
      'https://example.com/icon.svg',
      'https://example.com/apple.png',
      'https://example.com/favicon-16.png',
      'https://example.com/mask.svg',
      'https://example.com/favicon.ico'
    ])
  })

  test('relative hrefs and data: icons are kept', () => {
    const html = page('<link rel="icon" href="icons/favicon.png"><link rel="shortcut icon" href="data:image/png;base64,AAAA">')
    const urls = faviconUrls(html, base)
    expect(urls).toEqual([
      'https://example.com/app/icons/favicon.png',
      'data:image/png;base64,AAAA',
      'https://example.com/favicon.ico'
    ])
  })

  test('a page without icon links falls back to /favicon.ico', () => {
    expect(faviconUrls(page('<link rel="stylesheet" href="/a.css">'), 'https://example.com/')).toEqual(['https://example.com/favicon.ico'])
  })

  test('non-http(s) and javascript: hrefs are skipped', () => {
    const html = page('<link rel="icon" href="javascript:void(0)"><link rel="icon" href="chrome://x">')
    expect(faviconUrls(html, 'https://example.com/')).toEqual(['https://example.com/favicon.ico'])
  })
})

describe('sniffImageMime', () => {
  test('recognizes common image signatures', () => {
    expect(sniffImageMime(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('image/png')
    expect(sniffImageMime(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg')
    expect(sniffImageMime(new TextEncoder().encode('GIF89a....'))).toBe('image/gif')
    expect(sniffImageMime(new Uint8Array([0, 0, 1, 0, 1]))).toBe('image/x-icon')
    expect(sniffImageMime(new TextEncoder().encode('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>'))).toBe('image/svg+xml')
  })

  test('returns null for non-image content', () => {
    expect(sniffImageMime(new TextEncoder().encode('<!doctype html><html>'))).toBeNull()
  })
})

describe('detectProjectFavicon', () => {
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
  const ICO = new Uint8Array([0, 0, 1, 0, 1])
  let server: ReturnType<typeof Bun.serve>

  beforeAll(() => {
    server = Bun.serve({
      port: 0,
      fetch(req) {
        const { pathname } = new URL(req.url)
        if (pathname === '/with-icon' || pathname === '/') {
          return new Response(page('<link rel="icon" href="/icon.png">'), { headers: { 'content-type': 'text/html' } })
        }
        if (pathname === '/icon.png') return new Response(PNG, { headers: { 'content-type': 'image/png' } })
        if (pathname === '/broken') return new Response(page('<link rel="icon" href="/missing.png">'), { headers: { 'content-type': 'text/html' } })
        if (pathname === '/favicon.ico') return new Response(ICO, { headers: { 'content-type': 'application/octet-stream' } })
        return new Response('not found', { status: 404 })
      }
    })
  })
  afterAll(() => server.stop(true))

  test('downloads the linked icon as a data uri', async () => {
    const icon = await detectProjectFavicon(`http://localhost:${server.port}/with-icon`, { userAgent: 'test' })
    expect(icon).toBe(`data:image/png;base64,${Buffer.from(PNG).toString('base64')}`)
  })

  test('sniffs the type of a mislabelled icon and falls back to /favicon.ico', async () => {
    const icon = await detectProjectFavicon(`http://localhost:${server.port}/broken`, { userAgent: 'test' })
    expect(icon).toBe(`data:image/x-icon;base64,${Buffer.from(ICO).toString('base64')}`)
  })

  test('passes through a data: icon href', async () => {
    const data = `data:image/png;base64,${Buffer.from(PNG).toString('base64')}`
    const icon = await detectFavicon(page(`<link rel="icon" href="${data}">`), `http://localhost:${server.port}/`, { userAgent: 'test' })
    expect(icon).toBe(data)
  })

  test('returns null when the website cannot be read', async () => {
    expect(await detectProjectFavicon(`http://localhost:${server.port}/missing`, { userAgent: 'test' })).toBeNull()
  })
})
