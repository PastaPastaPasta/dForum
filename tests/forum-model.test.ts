import { describe, expect, it } from 'vitest'
import type { RawDoc } from '@/lib/forum/types'
import {
  compareIds, countReactions, effectiveAt, isArchive, mergeDocs, resolveForumTree, summarizeThread, threadPosts, sortThreadSummaries, excerpt,
} from '@/lib/forum/model'
import { acceptsReplies, deltaChanges, forumActivity, mergeForumThreads, newPosts, newThreads } from '@/lib/forum/live-merge'
import { isUnread } from '@/lib/seen'
import { splitBody, byteLength } from '@/lib/forum/actions'
import { normalizeTagInput } from '@/lib/forum/tags'

const ARCH = 'ARCHIVISTxxxxxxxxxxxxxxxxxxxxxxxxxxxx1'
let seq = 0
const id = () => `${'1'.repeat(3)}${(++seq).toString().padStart(4, '2')}${'A'.repeat(33)}`
const doc = (ownerId: string, createdAt: number, p: Record<string, unknown>, extra: Partial<RawDoc> = {}): RawDoc =>
  ({ id: id(), ownerId, revision: 1, createdAt, updatedAt: createdAt, p, ...extra })

describe('ordering and provenance', () => {
  it('compares base58 ids by byte value, not by string', () => {
    expect(compareIds('2', 'z')).toBeLessThan(0)
    expect(compareIds('11', '2')).toBeLessThan(0)
    expect(compareIds('zz', 'zz')).toBe(0)
  })
  it('trusts archive fields only from the archive owner', () => {
    const forged = doc('mallory', 5000, { origCreatedAt: 1, origAuthor: 'satoshi' })
    const real = doc(ARCH, 5000, { origCreatedAt: 1, origAuthor: 'satoshi' })
    expect(isArchive(forged, ARCH)).toBe(false)
    expect(effectiveAt(forged, ARCH)).toBe(5000)
    expect(isArchive(real, ARCH)).toBe(true)
    expect(effectiveAt(real, ARCH)).toBe(1)
    expect(isArchive(real, undefined)).toBe(false)
  })
})

describe('archive trust window', () => {
  it('trusts archivist documents created up to archiveTrustUntil and not after', () => {
    const before = doc(ARCH, 1_000, { origCreatedAt: 5, origAuthor: 'old' })
    const after = doc(ARCH, 3_000, { origCreatedAt: 5, origAuthor: 'forged' })
    const ref = { id: ARCH, until: 2_000 }
    expect(isArchive(before, ref)).toBe(true)
    expect(isArchive(after, ref)).toBe(false)
    expect(effectiveAt(after, ref)).toBe(3_000)
    expect(isArchive(after, { id: ARCH })).toBe(true)
    const rewritten = { ...before, updatedAt: 3_000 }
    expect(isArchive(rewritten, ref)).toBe(false)
    const moderated = { ...before, moderatedAt: 3_000, p: { ...before.p, modState: 1 } }
    expect(isArchive(moderated, ref)).toBe(true)
  })
  it('closes replies in locked threads and in threads whose original or current forum is archived', () => {
    const ctx = { archivedForums: new Set(['ARCHIVED']) }
    expect(acceptsReplies(doc('a', 1, { forumId: 'OPEN' }), ctx)).toBe(true)
    expect(acceptsReplies(doc('a', 1, { forumId: 'OPEN', locked: true }), ctx)).toBe(false)
    expect(acceptsReplies(doc('a', 1, { forumId: 'ARCHIVED', movedToForumId: 'OPEN' }), ctx)).toBe(false)
    expect(acceptsReplies(doc('a', 1, { forumId: 'OPEN', movedToForumId: 'ARCHIVED' }), ctx)).toBe(false)
  })
})

describe('unread tracking', () => {
  const seen = { since: 1_000, threads: {}, forums: {} }
  it('treats activity before the first visit as read', () => {
    expect(isUnread(seen, 900, undefined)).toBe(false)
    expect(isUnread(seen, 1_500, undefined)).toBe(true)
  })
  it('clears once viewed up to the latest activity', () => {
    expect(isUnread(seen, 1_500, 1_500)).toBe(false)
    expect(isUnread(seen, 1_600, 1_500)).toBe(true)
  })
})

describe('thread visibility', () => {
  const thread = doc('alice', 100, { title: 'Hello', forumId: 'F' })
  it('lists a thread whose opening post is the owner’s earliest visible post', () => {
    const noise = doc('bob', 50, { threadId: thread.id, body: 'before' })
    const open = doc('alice', 110, { threadId: thread.id, body: 'hi' })
    const reply = doc('bob', 120, { threadId: thread.id, body: 'yo' })
    const view = threadPosts(thread, [reply, noise, open], ARCH)
    expect(view.listable).toBe(true)
    expect(view.posts.map((p) => p.p.body)).toEqual(['hi', 'yo'])
  })
  it('hides threads whose opening post is hidden, retracted or missing', () => {
    expect(threadPosts(thread, [doc('bob', 110, { threadId: thread.id, body: 'x' })], ARCH).listable).toBe(false)
    expect(threadPosts(thread, [doc('alice', 110, { threadId: thread.id, body: 'x', modState: 1 })], ARCH).listable).toBe(false)
    expect(threadPosts(thread, [doc('alice', 110, { threadId: thread.id, body: 'x', retracted: true })], ARCH).listable).toBe(false)
  })
  it('orders archive posts by their original date even when imported out of order', () => {
    const t = doc(ARCH, 1000, { title: 'Old', forumId: 'F', origCreatedAt: 10, origId: 1, origAuthor: 'x' })
    const second = doc(ARCH, 1001, { threadId: t.id, body: 'second', origCreatedAt: 20, origAuthor: 'y' })
    const first = doc(ARCH, 1002, { threadId: t.id, body: 'first', origCreatedAt: 10, origAuthor: 'x' })
    const view = threadPosts(t, [second, first], ARCH)
    expect(view.opening?.p.body).toBe('first')
    const s = summarizeThread(t, view, {}, ARCH)
    expect(s).toMatchObject({ createdAt: 10, replies: 1, lastPostAt: 20, archiveAuthor: 'x', lastPostArchiveAuthor: 'y' })
  })
})

describe('merging and counting', () => {
  it('keeps the newest revision and the latest moderation of the same revision', () => {
    const a = doc('u', 1, { body: 'v1' })
    const b = { ...a, revision: 2, p: { body: 'v2' } }
    const c = { ...b, moderatedAt: 9, p: { body: 'v2', modState: 1 } }
    expect(mergeDocs([a], [b])[0].p.body).toBe('v2')
    expect(mergeDocs([b], [c])[0].p.modState).toBe(1)
    expect(mergeDocs([c], [a])[0].revision).toBe(2)
  })
  it('counts reactions per post and kind', () => {
    const r = (postId: string, kind: number) => doc('x', 1, { postId, kind })
    expect(countReactions([r('p', 1), r('p', 1), r('p', 2), r('q', 1)])).toEqual({ p: { 1: 2, 2: 1 }, q: { 1: 1 } })
  })
  it('resolves sub-forums and ignores cycles or cross-category parents', () => {
    const f = (fid: string, cat: string, parent?: string) => ({ id: fid, categoryId: cat, parentForumId: parent, slug: fid, title: fid, sort: 0, archived: false, threadCount: 0, postCount: 0 })
    const tree = resolveForumTree([f('a', 'c'), f('b', 'c', 'a'), f('x', 'c', 'y'), f('y', 'c', 'x'), f('z', 'd', 'a'), f('o', 'gone')], [{ id: 'c', slug: 'c', title: 'c', sort: 0 }, { id: 'd', slug: 'd', title: 'd', sort: 0 }])
    const parent = Object.fromEntries(tree.map((t) => [t.id, t.parentForumId]))
    expect(parent).toEqual({ a: undefined, b: 'a', x: undefined, y: undefined, z: undefined })
  })
  it('sorts pinned first, then by latest activity', () => {
    const s = (sid: string, sticky: boolean, lastPostAt: number) => ({ id: sid, sticky, lastPostAt }) as never
    expect(sortThreadSummaries([s('a', false, 5), s('b', true, 1), s('c', false, 9)]).map((x: { id: string }) => x.id)).toEqual(['b', 'c', 'a'])
  })
})

describe('live delta', () => {
  const snapshotAt = 1000
  const ctx = { snapshotAt }
  const t = doc('alice', 1500, { title: 'New', forumId: 'F' })
  const open = doc('alice', 1501, { threadId: t.id, forumId: 'F', body: 'hi' })
  const oldThread = { ...doc('carol', 5, { title: 'Old', forumId: 'F' }), id: 'OLD' }
  const reply = doc('bob', 1600, { threadId: 'OLD', forumId: 'F', body: 'reply' })
  const old = { id: 'OLD', forumId: 'F', title: 'Old', tags: [], ownerId: 'carol', createdAt: 10, sticky: false, locked: false, replies: 3, reactions: 0, lastPostAt: 500, lastPostAuthorId: 'carol' }
  it('adds new threads only once their opening post is visible', () => {
    expect(newThreads({ threads: [t], posts: [] }, ctx)).toHaveLength(0)
    expect(newThreads({ threads: [t], posts: [open] }, ctx)).toHaveLength(1)
  })
  it('bumps forum counts and the thread list', () => {
    const delta = { threads: [t, oldThread], posts: [open, reply] }
    expect(forumActivity(delta, ctx).get('F')).toMatchObject({ threads: 1, posts: 2 })
    const list = mergeForumThreads([old], 'F', delta, ctx)
    expect(list.find((x) => x.id === 'OLD')).toMatchObject({ replies: 4, lastPostAt: 1600, lastPostAuthorId: 'bob' })
    expect(list.find((x) => x.id === t.id)).toMatchObject({ replies: 0, title: 'New' })
    expect(mergeForumThreads([old], 'F', delta, ctx, false).find((x) => x.id === t.id)).toBeUndefined()
  })
  it('drops threads that were hidden or moved away since the snapshot', () => {
    const hidden = { ...oldThread, p: { ...oldThread.p, modState: 1 } }
    expect(mergeForumThreads([old], 'F', { threads: [hidden], posts: [] }, ctx)).toHaveLength(0)
    const moved = { ...oldThread, p: { ...oldThread.p, movedToForumId: 'G' } }
    expect(mergeForumThreads([old], 'F', { threads: [moved], posts: [] }, ctx)).toHaveLength(0)
  })
  it('ignores live posts in hidden or unknown threads', () => {
    expect(newPosts({ threads: [{ ...oldThread, p: { ...oldThread.p, modState: 1 } }], posts: [reply] }, ctx)).toHaveLength(0)
    expect(newPosts({ threads: [], posts: [reply] }, ctx)).toHaveLength(0)
  })
  it('keeps member content in forums archived after it was written', () => {
    const archived = { snapshotAt, archivedForums: new Set(['F']), staff: new Set(['carol']) }
    expect(newPosts({ threads: [oldThread], posts: [reply] }, archived)).toHaveLength(1)
  })
  it('lists a thread whose opening post landed just after the snapshot', () => {
    const at = { snapshotAt: 10_000_000 }
    const straddle = doc('dave', 9_999_990, { title: 'Straddle', forumId: 'F' })
    const first = doc('dave', 10_000_004, { threadId: straddle.id, forumId: 'F', body: 'first' })
    expect(newThreads({ threads: [straddle], posts: [first] }, at)).toHaveLength(1)
    const older = doc('carol', 5_000_000, { title: 'Older', forumId: 'F' })
    const ownerReply = doc('carol', 10_000_700, { threadId: older.id, forumId: 'F', body: 'later' })
    expect(newThreads({ threads: [older], posts: [ownerReply] }, at)).toHaveLength(0)
  })
  it('reports moderation of documents the static index lists', () => {
    const hiddenPost = { ...reply, p: { ...reply.p, modState: 1 } }
    const c = deltaChanges({ threads: [{ ...oldThread, p: { ...oldThread.p, modState: 1 } }], posts: [hiddenPost] })
    expect(c.threadGone('OLD')).toBe(true)
    expect(c.postGone(reply.id)).toBe(true)
    expect(c.threadGone('other')).toBe(false)
  })
  it('counts moved threads toward their new forum', () => {
    const moved = { ...oldThread, p: { ...oldThread.p, movedToForumId: 'G' } }
    const a = forumActivity({ threads: [moved], posts: [reply] }, ctx)
    expect(a.get('G')?.posts).toBe(1)
    expect(a.get('F')).toBeUndefined()
  })
})

describe('write helpers', () => {
  it('splits bodies into two 5120-byte parts on code-point boundaries', () => {
    expect(splitBody('short')).toEqual({ body: 'short' })
    const text = '€'.repeat(3000)
    const parts = splitBody(text)
    expect(byteLength(parts.body)).toBeLessThanOrEqual(5120)
    expect(parts.body + parts.body2).toBe(text)
    expect(() => splitBody('x'.repeat(10241))).toThrow(/too long/)
  })
  it('normalizes tags', () => {
    expect(normalizeTagInput('Dash Platform, wallet,, WALLET, a, b, c, d')).toEqual(['dash-platform', 'wallet', 'a', 'b', 'c'])
  })
  it('makes plain excerpts', () => {
    expect(excerpt('> quote\n**bold** [link](https://x) `code`\n```\nblock\n```', 100)).toBe('bold link code')
  })
})
