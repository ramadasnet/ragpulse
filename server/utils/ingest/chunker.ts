// Markdown-aware chunker. Pure module (no Nuxt auto-imports).
import { createHash } from 'node:crypto'

export interface MarkdownChunk {
  /** Section breadcrumb below the document title, e.g. "Install › Docker" */
  heading?: string
  /** Breadcrumb line + section text (what gets embedded) */
  content: string
  hash: string
  tokens: number
}

export interface ChunkOptions {
  /** Target chunk size in characters */
  target?: number
  /** Hard maximum chunk size in characters */
  max?: number
  /** Overlap between consecutive parts of a long section */
  overlap?: number
  /** Drop chunks with less real text than this */
  minChars?: number
}

interface Section {
  path: string[]
  headingLine?: string
  body: string
}

interface Unit {
  path: string[]
  headingLine?: string
  text: string
  /** Part of a split long section: never merged with neighbours */
  split?: boolean
}

const FENCE = /^\s*(`{3,}|~{3,})/
const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function cleanHeading(text: string): string {
  return text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\\(.)/g, '$1')
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
}

function parseSections(md: string): Section[] {
  const sections: Section[] = []
  const stack: Array<{ level: number, text: string }> = []
  let current: Section = { path: [], body: '' }
  let lines: string[] = []
  let fence: string | null = null

  const flush = () => {
    current.body = lines.join('\n').trim()
    if (current.body || current.headingLine) sections.push(current)
    lines = []
  }

  for (const line of md.split('\n')) {
    const f = FENCE.exec(line)
    if (f) {
      if (!fence) fence = f[1]!
      else if (f[1]![0] === fence[0] && f[1]!.length >= fence.length) fence = null
      lines.push(line)
      continue
    }
    const h = fence ? null : HEADING.exec(line)
    if (h) {
      flush()
      const level = h[1]!.length
      const text = cleanHeading(h[2]!)
      while (stack.length && stack[stack.length - 1]!.level >= level) stack.pop()
      stack.push({ level, text })
      current = { path: stack.map(s => s.text).filter(Boolean), headingLine: line.trim(), body: '' }
      continue
    }
    lines.push(line)
  }
  flush()
  return sections
}

/** Splits text into blocks separated by blank lines, keeping fenced code blocks whole. */
export function splitBlocks(text: string): string[] {
  const blocks: string[] = []
  let buf: string[] = []
  let fence: string | null = null
  const push = () => {
    const b = buf.join('\n').trim()
    if (b) blocks.push(b)
    buf = []
  }
  for (const line of text.split('\n')) {
    const f = FENCE.exec(line)
    if (f) {
      if (!fence) {
        push()
        fence = f[1]!
        buf.push(line)
        continue
      }
      if (f[1]![0] === fence[0] && f[1]!.length >= fence.length) {
        buf.push(line)
        fence = null
        push()
        continue
      }
    }
    if (!fence && !line.trim()) {
      push()
      continue
    }
    buf.push(line)
  }
  push()
  return blocks
}

/** Splits a single oversized block into pieces <= max. Code blocks are re-fenced per piece. */
function splitOversized(block: string, target: number, max: number): string[] {
  const f = FENCE.exec(block)
  if (f) {
    const lines = block.split('\n')
    const open = lines[0]!
    const hasClose = lines.length > 1 && FENCE.test(lines[lines.length - 1]!)
    const close = hasClose ? lines[lines.length - 1]!.trim() : f[1]!
    const inner = lines.slice(1, hasClose ? -1 : undefined)
    const pieces: string[] = []
    let buf: string[] = []
    let size = 0
    const budget = target - open.length - close.length - 2
    for (const raw of inner) {
      const line = raw.length > budget ? raw.slice(0, budget) : raw
      if (size + line.length + 1 > budget && buf.length) {
        pieces.push(`${open}\n${buf.join('\n')}\n${close}`)
        buf = []
        size = 0
      }
      buf.push(line)
      size += line.length + 1
    }
    if (buf.length) pieces.push(`${open}\n${buf.join('\n')}\n${close}`)
    return pieces
  }

  // Prose: split on sentence ends / line breaks, then by words if needed
  const sentences = block.split(/(?<=[.!?])\s+|\n/)
  const pieces: string[] = []
  let buf = ''
  for (let s of sentences) {
    while (s.length > max) {
      const cut = s.lastIndexOf(' ', target) > target / 2 ? s.lastIndexOf(' ', target) : target
      if (buf) {
        pieces.push(buf)
        buf = ''
      }
      pieces.push(s.slice(0, cut))
      s = s.slice(cut).trim()
    }
    if (buf && buf.length + s.length + 1 > target) {
      pieces.push(buf)
      buf = ''
    }
    buf = buf ? `${buf} ${s}` : s
  }
  if (buf) pieces.push(buf)
  return pieces
}

function overlapTail(text: string, overlap: number): string {
  if (overlap <= 0 || text.length <= overlap) return ''
  let tail = text.slice(-overlap)
  if (/`{3}|~{3}/.test(tail)) return ''
  const sentence = tail.search(/(?<=[.!?])\s+\S/)
  if (sentence !== -1 && sentence < overlap / 2) tail = tail.slice(sentence).trim()
  else {
    const space = tail.indexOf(' ')
    if (space !== -1) tail = tail.slice(space + 1)
  }
  return tail.trim() ? `…${tail.trim()}` : ''
}

function packBlocks(blocks: string[], target: number, max: number, overlap: number): string[] {
  const parts: string[] = []
  let acc = ''
  for (const block of blocks.flatMap(b => (b.length > max ? splitOversized(b, target, max) : [b]))) {
    if (acc && acc.length + block.length + 2 > target) {
      parts.push(acc)
      const tail = overlapTail(acc, overlap)
      acc = tail && tail.length + block.length + 2 <= max ? `${tail}\n\n${block}` : block
    }
    else {
      acc = acc ? `${acc}\n\n${block}` : block
    }
  }
  if (acc) parts.push(acc)
  return parts
}

function commonPrefix(paths: string[][]): string[] {
  if (!paths.length) return []
  const first = paths[0]!
  let n = first.length
  for (const p of paths) {
    let i = 0
    while (i < n && i < p.length && p[i] === first[i]) i++
    n = i
  }
  return first.slice(0, n)
}

/** Length of human-readable text (markdown syntax, URLs and whitespace removed). */
export function realTextLength(text: string): number {
  return text
    .replace(/\]\([^)]*\)/g, ']')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[`~#>*_\-|=[\]()!:]+/g, '')
    .replace(/\s+/g, '')
    .length
}

/**
 * Splits markdown into retrieval chunks: by headings first, small neighbouring sections are merged,
 * long sections are split by paragraphs with overlap. Every chunk starts with a breadcrumb line
 * ("Title › Section › Sub") so embeddings carry the document context.
 */
export function chunkMarkdown(markdown: string, opts: ChunkOptions & { title?: string } = {}): MarkdownChunk[] {
  const target = opts.target ?? 1800
  const max = opts.max ?? 3000
  const overlap = opts.overlap ?? 200
  const minChars = opts.minChars ?? 40
  const title = (opts.title || '').replace(/\s+/g, ' ').trim()

  const sections = parseSections(markdown.replace(/\r\n?/g, '\n'))
  // The page H1 usually repeats the title: drop it from breadcrumbs
  if (title) {
    const t = normalize(title)
    for (const s of sections) {
      const first = s.path.length ? normalize(s.path[0]!) : ''
      if (first && (first === t || t.includes(first))) {
        s.path = s.path.slice(1)
        if (!s.path.length) s.headingLine = undefined
      }
    }
  }

  const units: Unit[] = []
  for (const s of sections) {
    const full = (s.headingLine ? s.headingLine.length + 2 : 0) + s.body.length
    if (full <= target) {
      units.push({ path: s.path, headingLine: s.headingLine, text: s.body })
      continue
    }
    for (const part of packBlocks(splitBlocks(s.body), target, max, overlap)) {
      units.push({ path: s.path, headingLine: s.headingLine, text: part, split: true })
    }
  }

  const groups: Unit[][] = []
  let group: Unit[] = []
  let size = 0
  for (const u of units) {
    const len = u.text.length + (u.headingLine?.length ?? 0) + 2
    if (u.split || (group.length && size + len > target) || group[0]?.split) {
      if (group.length) groups.push(group)
      group = []
      size = 0
    }
    group.push(u)
    size += len
  }
  if (group.length) groups.push(group)

  const chunks: MarkdownChunk[] = []
  const seen = new Set<string>()
  for (const g of groups) {
    const prefix = commonPrefix(g.map(u => u.path))
    const body = g
      .map(u => (u.path.length > prefix.length && u.headingLine ? `${u.headingLine}\n\n${u.text}` : u.text))
      .filter(Boolean)
      .join('\n\n')
      .trim()
    if (realTextLength(body) < minChars) continue
    const breadcrumb = [title, ...prefix].filter(Boolean).join(' › ')
    const content = breadcrumb ? `${breadcrumb}\n\n${body}` : body
    const hash = sha256(content)
    if (seen.has(hash)) continue
    seen.add(hash)
    chunks.push({
      heading: prefix.length ? prefix.join(' › ') : undefined,
      content,
      hash,
      tokens: Math.ceil(content.length / 4)
    })
  }
  return chunks
}
