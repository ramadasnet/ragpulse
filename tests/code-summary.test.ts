import { beforeAll, describe, expect, test } from 'bun:test'
import { changedShare, createCodeSummarizer } from '../server/utils/ingest/code-summary'
import type { CodeFile } from '../server/utils/ingest/types'

/** In-memory stand-in for the `extractions` collection (only what the summarizer uses) */
function memoryCollection() {
  const docs = new Map<string, any>()
  const project = (d: any) => (d ? { ...d } : null)
  return {
    find: (q: any) => ({ toArray: async () => q._id.$in.filter((id: string) => docs.has(id)).map((id: string) => project(docs.get(id))) }),
    findOne: async (q: any) => project(docs.get(q._id)),
    findOneAndUpdate: async (q: any, u: any) => {
      const d = docs.get(q._id)
      if (d) Object.assign(d, u.$set)
      return project(d)
    },
    updateMany: async () => ({}),
    updateOne: async (q: any, u: any, o?: any) => {
      const d = docs.get(q._id)
      if (d) Object.assign(d, u.$set)
      else if (o?.upsert) docs.set(q._id, { _id: q._id, ...u.$setOnInsert, ...u.$set })
    }
  }
}

describe('application overview', () => {
  const calls = { file: 0, overview: 0 }
  beforeAll(() => {
    const extractions = memoryCollection()
    Object.assign(globalThis, {
      useCollections: async () => ({ extractions }),
      chatCompletion: async (opts: any) => {
        const user = String(opts.messages[1].content)
        if (user.includes('# File: ')) {
          calls.file++
          return { content: `Summary of ${/# File: (\S+)/.exec(user)![1]} v${calls.file}` }
        }
        calls.overview++
        return { content: `Overview ${calls.overview}` }
      }
    })
  })

  test('is regenerated only when at least 10% of its inputs changed', async () => {
    const repo = { name: 'app', url: 'https://example.com/app', readme: 'Readme', tree: [] as string[] }
    const files: CodeFile[] = Array.from({ length: 20 }, (_, i) => ({ path: `src/f${i}.ts`, lang: 'ts', content: `export const f${i} = ${i}` }))
    const run = (list: CodeFile[]) => createCodeSummarizer('model', { maxPerSync: 100 })!(repo, list)

    const first = await run(files)
    expect([calls.file, calls.overview]).toEqual([20, 1])

    // 1 of 21 inputs (5%) changed: the file is summarized again, the overview is kept
    files[0] = { ...files[0]!, content: 'export const f0 = "changed"' }
    const second = await run(files)
    expect([calls.file, calls.overview]).toEqual([21, 1])
    expect(second.overview).toBe(first.overview)

    // 3 of 21 inputs (14%) differ from the overview's inputs: regenerated
    files[1] = { ...files[1]!, content: 'export const f1 = "changed"' }
    files[2] = { ...files[2]!, content: 'export const f2 = "changed"' }
    const third = await run(files)
    expect([calls.file, calls.overview]).toEqual([23, 2])
    expect(third.overview).not.toBe(first.overview)
  })

  test('counts added, removed and modified inputs', () => {
    expect(changedShare(['a\0' + '1', 'b\0' + '1'], ['a\0' + '1', 'b\0' + '1'])).toBe(0)
    expect(changedShare(['a\0' + '1', 'b\0' + '1', 'c\0' + '1'], ['a\0' + '2', 'b\0' + '1', 'd\0' + '1'])).toBe(0.75)
    expect(changedShare([], [])).toBe(0)
  })
})
