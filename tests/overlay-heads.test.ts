import { describe, expect, it, vi } from 'vitest'
import type { RawDoc } from '@/lib/forum/types'
import { deltaChanges, newPosts } from '@/lib/forum/live-merge'

// The overlay against an in-memory Platform: page queries are answered from `store`.
const SNAP = 1_000_000_000
const doc = (id: string, ownerId: string, createdAt: number, p: Record<string, unknown>): RawDoc =>
  ({ id, ownerId, revision: 1, createdAt, updatedAt: createdAt, p })
const store: { posts: RawDoc[]; threads: RawDoc[] } = { posts: [], threads: [] }

vi.mock('@/lib/live/platform', () => ({
  queryPage: async (type: string, opts: { where?: Array<[string, string, unknown]>; orderBy?: Array<[string, string]>; limit?: number; startAfter?: string }) => {
    let docs = type === 'post' ? store.posts : type === 'thread' ? store.threads : []
    for (const [f, op, v] of opts.where ?? []) {
      if (f === '$updatedAt' && op === '>=') docs = docs.filter((d) => d.updatedAt >= (v as number))
      else if (f === '$moderatedAt') docs = []
      else if (f === 'threadId') docs = docs.filter((d) => d.p.threadId === v)
      else if (f === '$id') docs = docs.filter((d) => (v as string[]).includes(d.id))
    }
    const key = opts.orderBy?.[0]?.[0]
    docs = [...docs].sort((a, b) => (key === '$updatedAt' ? a.updatedAt - b.updatedAt : key === '$createdAt' ? a.createdAt - b.createdAt : 0) || (a.id < b.id ? -1 : 1))
    if (opts.startAfter) docs = docs.slice(docs.findIndex((d) => d.id === opts.startAfter) + 1)
    const limit = opts.limit ?? 100
    const page = docs.slice(0, limit)
    return { docs: page, last: page[page.length - 1]?.id, full: page.length >= limit }
  },
}))
const hook: { sub?: (cb: () => void) => () => void; get?: () => unknown } = {}
vi.mock('react', () => ({ useSyncExternalStore: (sub: typeof hook.sub, get: typeof hook.get) => { hook.sub = sub; hook.get = get; return get?.() } }))

describe('overlay heads', () => {
  it('loads every active thread up to its opening post within one poll', async () => {
    ;(globalThis as { window?: unknown }).window = {}
    ;(globalThis as { document?: unknown }).document = { visibilityState: 'hidden', addEventListener() {} }
    // 60 older threads with a reply each after the snapshot (past any per-poll cap)…
    for (let i = 0; i < 60; i++) {
      const id = `T${String(i).padStart(2, '0')}`
      store.threads.push(doc(id, `u${i}`, SNAP - 86_400_000, { forumId: 'F', title: id }))
      store.posts.push(doc(`O${id}`, `u${i}`, SNAP - 86_400_000 + 1, { threadId: id, forumId: 'F', body: 'open' }))
      store.posts.push(doc(`R${id}`, 'x', SNAP + 60_000 + i * 30_000, { threadId: id, forumId: 'F', body: 'reply' }))
    }
    // …and one whose opening post came after five early replies by someone else.
    store.threads.push(doc('LATE', 'alice', SNAP - 86_400_000, { forumId: 'F', title: 'late opening' }))
    for (let i = 1; i <= 5; i++) store.posts.push(doc(`E${i}`, 'mallory', SNAP - 86_400_000 + i, { threadId: 'LATE', forumId: 'F', body: 'early' }))
    store.posts.push(doc('LOPEN', 'alice', SNAP - 86_400_000 + 10, { threadId: 'LATE', forumId: 'F', body: 'open' }))
    store.posts.push(doc('LREPLY', 'bob', SNAP + 5_000, { threadId: 'LATE', forumId: 'F', body: 'reply' }))

    const overlay = await import('@/lib/live/overlay')
    overlay.useLive(SNAP)
    hook.sub?.(() => undefined)
    await overlay.refreshLive()
    const state = hook.get?.() as { threads: RawDoc[]; posts: RawDoc[]; heads: Record<string, number> }
    expect(Object.keys(state.heads)).toHaveLength(61)
    expect(newPosts(state, { snapshotAt: SNAP })).toHaveLength(61)
    expect(deltaChanges(state).threadGone('LATE')).toBe(false)
  })
})
