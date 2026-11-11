import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import { createVerify, generateKeyPairSync } from 'node:crypto'
import { strToU8, zipSync } from 'fflate'
import { DOCX_MIME } from '../server/utils/ingest/binary'
import { DRIVE_CONVERTER_VERSION, fetchDriveSource, getDriveFolder, parseServiceAccountKey } from '../server/utils/ingest/drive'
import { officeToMarkdown } from '../server/utils/ingest/office'
import { driveFolderUrl, parseDriveFolderId } from '../shared/utils/drive'

const FOLDER_MIME = 'application/vnd.google-apps.folder'
const G_DOC = 'application/vnd.google-apps.document'
const SHORTCUT = 'application/vnd.google-apps.shortcut'
const ROOT = 'rootFolderId_123'
const EMAIL = 'sa@project.iam.gserviceaccount.com'

const { publicKey, privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
})
const KEY_OBJECT = { type: 'service_account', client_email: EMAIL, private_key: privateKey, token_uri: 'https://oauth2.googleapis.com/token', project_id: 'proj' }
const key = parseServiceAccountKey(KEY_OBJECT)

const TINY_DOCX = zipSync({ 'word/document.xml': strToU8('<w:document xmlns:w="w"><w:body><w:p><w:r><w:t>Hello from Drive</w:t></w:r></w:p></w:body></w:document>') })

interface ApiFile {
  id: string
  name: string
  mimeType: string
  version?: string
  size?: string
  webViewLink?: string
  shortcutDetails?: { targetId: string; targetMimeType: string }
}

/** Files by folder id; `meta`/`downloads`/`exports` hold responses for files.get / alt=media / export. */
function mockDrive(opts: {
  folders: Record<string, ApiFile[]>
  meta?: Record<string, any>
  downloads?: Record<string, Uint8Array | string>
  exports?: Record<string, Uint8Array | string | Response>
  statuses?: Record<string, Response[]>
}) {
  const calls: string[] = []
  const fileMeta: Record<string, any> = { ...opts.meta }
  const spy = spyOn(globalThis, 'fetch').mockImplementation(async (input: any, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input.url)
    const path = url.pathname
    calls.push(`${init?.method ?? 'GET'} ${path}${url.search}`)

    if (path === '/token' || url.hostname === 'oauth2.googleapis.com') {
      // Verify the signed JWT bearer assertion
      const params = new URLSearchParams(String(init?.body ?? ''))
      const assertion = params.get('assertion') ?? ''
      const [h, p, s] = assertion.split('.')
      const claims = JSON.parse(Buffer.from(p!, 'base64url').toString())
      expect(claims.iss).toBe(EMAIL)
      expect(claims.scope).toBe('https://www.googleapis.com/auth/drive.readonly')
      expect(claims.aud).toBe('https://oauth2.googleapis.com/token')
      const verify = createVerify('RSA-SHA256')
      verify.update(`${h}.${p}`)
      expect(verify.verify(publicKey, s!, 'base64url')).toBe(true)
      return Response.json({ access_token: 'tok-1', expires_in: 3600 })
    }

    const fileMatch = /^\/drive\/v3\/files\/([^/]+)(\/export)?$/.exec(path)
    if (path === '/drive/v3/files') {
      const queued = opts.statuses?.list?.length ? opts.statuses.list.shift()! : undefined
      if (queued) return queued
      const parent = /'([^']+)' in parents/.exec(url.searchParams.get('q') ?? '')?.[1] ?? ''
      const pageToken = url.searchParams.get('pageToken')
      const all = opts.folders[parent] ?? []
      const pageSize = Number(url.searchParams.get('pageSize') ?? 1000)
      const start = pageToken ? Number(pageToken) : 0
      const page = all.slice(start, start + Math.min(pageSize, 2)) // force pagination past 2 entries
      return Response.json({ files: page, ...(start + 2 < all.length ? { nextPageToken: String(start + 2) } : {}) })
    }
    if (fileMatch) {
      const id = decodeURIComponent(fileMatch[1]!)
      const queued = opts.statuses?.[id]?.length ? opts.statuses[id]!.shift()! : undefined
      if (queued) return queued
      if (fileMatch[2]) {
        const mime = url.searchParams.get('mimeType') ?? ''
        const out = opts.exports?.[`${id}::${mime}`] ?? opts.exports?.[id]
        if (out instanceof Response) return out.clone()
        if (out !== undefined) return new Response(typeof out === 'string' ? strToU8(out) : out)
        return new Response('not found', { status: 404 })
      }
      if (url.searchParams.get('alt') === 'media') {
        const out = opts.downloads?.[id]
        if (out === undefined) return new Response('not found', { status: 404 })
        return new Response(typeof out === 'string' ? strToU8(out) : out)
      }
      const meta = fileMeta[id]
      if (!meta) return Response.json({ error: { code: 404, message: 'File not found', errors: [{ reason: 'notFound' }] } }, { status: 404 })
      return Response.json(meta)
    }
    return new Response('unexpected', { status: 500 })
  })
  return { spy, calls }
}

const ctxBase = { userAgent: 'TestBot/1.0' }
const extractBinary = async (f: { name: string; mime: any; bytes: Uint8Array }) => officeToMarkdown(f)
const noSleep = async () => {}

describe('parseDriveFolderId', () => {
  test('accepts folder links and bare ids', () => {
    const id = '1AbC_def-XYZ0123456'
    expect(parseDriveFolderId(`https://drive.google.com/drive/folders/${id}`)).toBe(id)
    expect(parseDriveFolderId(`https://drive.google.com/drive/folders/${id}?usp=sharing`)).toBe(id)
    expect(parseDriveFolderId(`https://drive.google.com/drive/u/0/folders/${id}`)).toBe(id)
    expect(parseDriveFolderId(`https://drive.google.com/open?id=${id}`)).toBe(id)
    expect(parseDriveFolderId(`https://drive.google.com/drive/folders/${id}/`)).toBe(id)
    expect(parseDriveFolderId(`  ${id}  `)).toBe(id)
    expect(driveFolderUrl(id)).toBe(`https://drive.google.com/drive/folders/${id}`)
  })

  test('rejects non-folder input', () => {
    expect(parseDriveFolderId('https://example.com/drive/folders/1AbC_def-XYZ0123456')).toBeUndefined()
    expect(parseDriveFolderId('https://drive.google.com/file/d/1AbC_def-XYZ0123456/view')).toBeUndefined()
    expect(parseDriveFolderId('http://drive.google.com/drive/folders/1AbC_def-XYZ0123456')).toBeUndefined()
    expect(parseDriveFolderId('abc')).toBeUndefined()
    expect(parseDriveFolderId('')).toBeUndefined()
  })
})

describe('parseServiceAccountKey', () => {
  test('accepts an object, a JSON string and base64-encoded JSON', () => {
    expect(parseServiceAccountKey(KEY_OBJECT).client_email).toBe(EMAIL)
    expect(parseServiceAccountKey(JSON.stringify(KEY_OBJECT)).client_email).toBe(EMAIL)
    expect(parseServiceAccountKey(Buffer.from(JSON.stringify(KEY_OBJECT)).toString('base64')).client_email).toBe(EMAIL)
    expect(parseServiceAccountKey({ ...KEY_OBJECT, private_key: privateKey.replace(/\n/g, '\\n') }).private_key).toContain('PRIVATE KEY')
  })

  test('rejects bad input with readable errors', () => {
    expect(() => parseServiceAccountKey('')).toThrow('empty')
    expect(() => parseServiceAccountKey('not json')).toThrow('not valid JSON')
    expect(() => parseServiceAccountKey({ client_email: EMAIL })).toThrow('private_key')
    expect(() => parseServiceAccountKey({ private_key: privateKey })).toThrow('client_email')
    expect(() => parseServiceAccountKey({ ...KEY_OBJECT, type: 'user' })).toThrow('service_account')
    expect(() => parseServiceAccountKey({ ...KEY_OBJECT, token_uri: 'https://evil.example.com/token' })).toThrow('token_uri')
  })
})

describe('fetchDriveSource', () => {
  let restore: (() => void) | undefined
  afterEach(() => {
    restore?.()
    restore = undefined
  })

  test('indexes files recursively, follows file shortcuts and skips the rest', async () => {
    const folders: Record<string, ApiFile[]> = {
      [ROOT]: [
        { id: 'doc1', name: 'Spec Doc', mimeType: G_DOC, version: '7', webViewLink: 'https://docs.google.com/document/d/doc1/edit' },
        { id: 'sub', name: 'Sub', mimeType: FOLDER_MIME },
        { id: 'cut', name: 'Link', mimeType: SHORTCUT, shortcutDetails: { targetId: 'tgt1', targetMimeType: 'text/markdown' } },
        { id: 'cutf', name: 'Folder link', mimeType: SHORTCUT, shortcutDetails: { targetId: 'otherfolder', targetMimeType: FOLDER_MIME } },
        { id: 'form', name: 'Survey', mimeType: 'application/vnd.google-apps.form' },
        { id: 'big', name: 'huge.pdf', mimeType: 'application/pdf', size: String(30 * 1024 * 1024) }
      ],
      sub: [{ id: 'md1', name: 'notes.md', mimeType: 'text/markdown', size: '30', version: '2' }]
    }
    const { spy, calls } = mockDrive({
      folders,
      meta: {
        [ROOT]: { id: ROOT, name: 'Root', mimeType: FOLDER_MIME },
        tgt1: { id: 'tgt1', name: 'target.md', mimeType: 'text/markdown', version: '3' }
      },
      exports: { doc1: TINY_DOCX },
      downloads: { md1: '# Notes\n\nsome text', tgt1: '# Target\n\nmore text' }
    })
    restore = () => spy.mockRestore()

    const outcome = await fetchDriveSource(`https://drive.google.com/drive/folders/${ROOT}`, { serviceAccountKey: key, sleep: noSleep }, { ...ctxBase, extractBinary })

    const byRef = new Map(outcome.documents.map((d) => [d.ref, d]))
    // Google Doc exported as docx and converted locally; ref is the file id, url the webViewLink
    expect(byRef.get('doc1')?.markdown).toContain('Hello from Drive')
    expect(byRef.get('doc1')?.title).toBe('Spec Doc')
    expect(byRef.get('doc1')?.url).toBe('https://docs.google.com/document/d/doc1/edit')
    expect(byRef.get('doc1')?.version).toBe(`${DRIVE_CONVERTER_VERSION}:7`)
    // markdown in subfolder via alt=media
    expect(byRef.get('md1')?.markdown).toContain('# Notes')
    expect(byRef.get('md1')?.title).toBe('notes')
    // shortcut to file indexes the target
    expect(byRef.get('tgt1')?.markdown).toContain('# Target')
    // skipped: shortcut to folder, unsupported Google type, oversized binary
    const reasons = new Map(outcome.skipped.map((s) => [s.ref, s.reason]))
    expect(reasons.get('cutf')).toBe('shortcut to folder')
    expect(reasons.get('form')).toContain('unsupported Google file')
    expect(reasons.get('big')).toContain('larger than')
    expect(outcome.failedRefs).toEqual([])

    // API shape: q filter, fields, pagination and shared-drive flags
    const listCalls = calls.filter((c) => c.includes('drive/v3/files?'))
    expect(listCalls.some((c) => c.includes('pageToken'))).toBe(true)
    const q = new URL(`https://x/${listCalls[0]!.slice(4)}`).searchParams
    expect(q.get('q')).toContain('in parents and trashed = false')
    expect(q.get('fields')).toContain('shortcutDetails')
    expect(q.get('supportsAllDrives')).toBe('true')
    expect(q.get('includeItemsFromAllDrives')).toBe('true')
  })

  test('uses corpora=drive when the root folder lives on a shared drive', async () => {
    const { spy, calls } = mockDrive({
      folders: { [ROOT]: [{ id: 'md1', name: 'a.md', mimeType: 'text/markdown' }] },
      meta: { [ROOT]: { id: ROOT, name: 'Root', mimeType: FOLDER_MIME, driveId: 'sharedDrive9' } },
      downloads: { md1: 'text' }
    })
    restore = () => spy.mockRestore()
    await fetchDriveSource(ROOT, { serviceAccountKey: key, sleep: noSleep }, ctxBase)
    const listCall = calls.find((c) => c.includes('drive/v3/files?'))!
    const q = new URL(`https://x/${listCall.slice(4)}`).searchParams
    expect(q.get('corpora')).toBe('drive')
    expect(q.get('driveId')).toBe('sharedDrive9')
  })

  test('survives folder cycles', async () => {
    const folders: Record<string, ApiFile[]> = {
      [ROOT]: [{ id: 'a', name: 'A', mimeType: FOLDER_MIME }],
      a: [
        { id: 'b', name: 'B', mimeType: FOLDER_MIME },
        { id: 'md1', name: 'x.md', mimeType: 'text/markdown' }
      ],
      b: [{ id: 'a', name: 'A again', mimeType: FOLDER_MIME }]
    }
    const { spy } = mockDrive({ folders, meta: { [ROOT]: { id: ROOT, name: 'Root', mimeType: FOLDER_MIME } }, downloads: { md1: 'x' } })
    restore = () => spy.mockRestore()
    const outcome = await fetchDriveSource(ROOT, { serviceAccountKey: key, sleep: noSleep }, ctxBase)
    expect(outcome.documents.map((d) => d.ref)).toEqual(['md1'])
  })

  test('skips unchanged files without downloading them', async () => {
    const { spy, calls } = mockDrive({
      folders: {
        [ROOT]: [
          { id: 'same', name: 'same.md', mimeType: 'text/markdown', version: '9' },
          { id: 'new', name: 'new.md', mimeType: 'text/markdown', version: '1' }
        ]
      },
      meta: { [ROOT]: { id: ROOT, name: 'Root', mimeType: FOLDER_MIME } },
      downloads: { new: 'fresh' }
    })
    restore = () => spy.mockRestore()
    const outcome = await fetchDriveSource(ROOT, { serviceAccountKey: key, sleep: noSleep }, { ...ctxBase, knownVersions: new Map([['same', `${DRIVE_CONVERTER_VERSION}:9`]]) })
    expect(outcome.unchanged).toEqual(['same'])
    expect(outcome.documents.map((d) => d.ref)).toEqual(['new'])
    expect(calls.some((c) => c.includes('/files/same?alt=media') || c.includes('/files/same/'))).toBe(false)
  })

  test('reports a shared folder error with the client_email', async () => {
    const { spy } = mockDrive({ folders: {} })
    restore = () => spy.mockRestore()
    await expect(fetchDriveSource(ROOT, { serviceAccountKey: key, sleep: noSleep }, ctxBase)).rejects.toThrow(`Folder not found or not shared with ${EMAIL}`)
    await expect(getDriveFolder(ROOT, key)).rejects.toThrow('Folder not found or not shared')
  })

  test('retries 429 and succeeds', async () => {
    const { spy } = mockDrive({
      folders: { [ROOT]: [{ id: 'md1', name: 'x.md', mimeType: 'text/markdown' }] },
      meta: { [ROOT]: { id: ROOT, name: 'Root', mimeType: FOLDER_MIME } },
      downloads: { md1: 'x' },
      statuses: { list: [new Response('slow down', { status: 429 })] }
    })
    restore = () => spy.mockRestore()
    const outcome = await fetchDriveSource(ROOT, { serviceAccountKey: key, sleep: noSleep }, ctxBase)
    expect(outcome.documents.map((d) => d.ref)).toEqual(['md1'])
  })

  test('drops a dead token on 401 and retries with a fresh one', async () => {
    const { spy, calls } = mockDrive({
      folders: { [ROOT]: [{ id: 'md1', name: 'x.md', mimeType: 'text/markdown' }] },
      meta: { [ROOT]: { id: ROOT, name: 'Root', mimeType: FOLDER_MIME } },
      downloads: { md1: 'x' },
      statuses: { [ROOT]: [new Response('unauthorized', { status: 401 })] }
    })
    restore = () => spy.mockRestore()
    const outcome = await fetchDriveSource(ROOT, { serviceAccountKey: key, sleep: noSleep }, ctxBase)
    expect(outcome.documents.map((d) => d.ref)).toEqual(['md1'])
    // The 401 invalidated the cached token: a fresh token was fetched, then the file get was retried
    expect(calls.some((c) => c.startsWith('POST /token'))).toBe(true)
    expect(calls.filter((c) => c.startsWith(`GET /drive/v3/files/${ROOT}?`)).length).toBe(2)
  })

  test('does not report a rate-limited root folder as not shared', async () => {
    const { spy } = mockDrive({
      folders: {},
      statuses: {
        [ROOT]: Array.from({ length: 5 }, () =>
          Response.json({ error: { code: 403, message: 'Rate limit exceeded', errors: [{ reason: 'rateLimitExceeded' }] } }, { status: 403 }))
      }
    })
    restore = () => spy.mockRestore()
    try {
      await fetchDriveSource(ROOT, { serviceAccountKey: key, sleep: noSleep }, ctxBase)
      expect.unreachable()
    } catch (err: any) {
      expect(String(err?.message)).toContain('Google Drive request failed')
      expect(String(err?.message)).not.toContain('not shared')
    }
  })

  test('falls back to text/plain when the export exceeds the limit', async () => {
    const { spy, calls } = mockDrive({
      folders: { [ROOT]: [{ id: 'doc1', name: 'Big Doc', mimeType: G_DOC }] },
      meta: { [ROOT]: { id: ROOT, name: 'Root', mimeType: FOLDER_MIME } },
      exports: {
        'doc1::application/vnd.openxmlformats-officedocument.wordprocessingml.document': Response.json(
          { error: { code: 403, message: 'too big', errors: [{ reason: 'exportSizeLimitExceeded' }] } }, { status: 403 }),
        'doc1::text/plain': 'plain text content'
      }
    })
    restore = () => spy.mockRestore()
    const outcome = await fetchDriveSource(ROOT, { serviceAccountKey: key, sleep: noSleep }, { ...ctxBase, extractBinary })
    const exportCalls = calls.filter((c) => c.includes('/export'))
    expect(exportCalls.some((c) => c.includes('text%2Fplain'))).toBe(true)
    expect(outcome.documents.map((d) => d.ref)).toEqual(['doc1'])
    expect(outcome.documents[0]?.markdown).toContain('plain text content')
  })
})
