/**
 * Folding the live delta (everything changed since the snapshot) into snapshot views. Pure.
 */
import type { LastPost, RawDoc, ThreadSummary } from './types.ts'
import { archiveAuthor, effectiveAt, isHidden, isRetracted, str, threadForumId, threadTags, threadLockedAt, isArchive, num } from './model.ts'

export interface DeltaDocs {
  threads: RawDoc[]
  posts: RawDoc[]
}

export interface ForumActivity {
  threads: number
  posts: number
  last?: LastPost
}

const visible = (d: RawDoc) => !isHidden(d) && !isRetracted(d)

/** New listable threads (opening post present and visible) created after the snapshot. */
export function newThreads(delta: DeltaDocs, snapshotAt: number): RawDoc[] {
  return delta.threads.filter((t) => t.createdAt > snapshotAt && !isHidden(t) && delta.posts.some(
    (p) => str(p, 'threadId') === t.id && p.ownerId === t.ownerId && visible(p),
  ))
}

/** Per-forum additions since the snapshot. Replies count toward post.forumId (the forum the
 * thread was written in); a moved thread's new replies land on its original forum until the next
 * snapshot. */
export function forumActivity(delta: DeltaDocs, snapshotAt: number, archiveOwnerId?: string): Map<string, ForumActivity> {
  const out = new Map<string, ForumActivity>()
  const get = (id: string) => out.get(id) ?? (out.set(id, { threads: 0, posts: 0 }), out.get(id) as ForumActivity)
  const titles = new Map(delta.threads.map((t) => [t.id, str(t, 'title') ?? '']))
  for (const t of newThreads(delta, snapshotAt)) get(threadForumId(t)).threads += 1
  for (const p of delta.posts) {
    if (p.createdAt <= snapshotAt || !visible(p)) continue
    const forumId = str(p, 'forumId')
    if (!forumId) continue
    const a = get(forumId)
    a.posts += 1
    const at = effectiveAt(p, archiveOwnerId)
    if (!a.last || at > a.last.at) {
      a.last = { postId: p.id, threadId: str(p, 'threadId') ?? '', threadTitle: titles.get(str(p, 'threadId') ?? '') ?? '', at, authorId: p.ownerId, archiveAuthor: archiveAuthor(p, archiveOwnerId) }
    }
  }
  return out
}

/** Thread summaries for a forum with the delta applied: new threads, new replies, edits to titles,
 * moderation (hidden threads drop out) and moves. */
export function mergeForumThreads(
  base: ThreadSummary[],
  forumId: string,
  delta: DeltaDocs,
  snapshotAt: number,
  archiveOwnerId?: string,
): ThreadSummary[] {
  const byId = new Map(base.map((s) => [s.id, { ...s }]))
  for (const t of delta.threads) {
    const cur = byId.get(t.id)
    if (cur) {
      if (isHidden(t) || threadForumId(t) !== forumId) { byId.delete(t.id); continue }
      cur.title = str(t, 'title') ?? cur.title
      cur.tags = threadTags(t)
      cur.sticky = t.p.sticky === true
      cur.locked = threadLockedAt(t) !== undefined
    }
  }
  for (const t of newThreads(delta, snapshotAt)) {
    if (threadForumId(t) !== forumId || byId.has(t.id)) continue
    byId.set(t.id, {
      id: t.id, forumId, title: str(t, 'title') ?? '', tags: threadTags(t), ownerId: t.ownerId,
      archiveAuthor: archiveAuthor(t, archiveOwnerId), createdAt: effectiveAt(t, archiveOwnerId), sticky: t.p.sticky === true,
      locked: threadLockedAt(t) !== undefined, replies: -1, reactions: 0, lastPostAt: effectiveAt(t, archiveOwnerId), lastPostAuthorId: t.ownerId,
      ...(isArchive(t, archiveOwnerId) && num(t, 'origId') !== undefined ? { origId: num(t, 'origId') } : {}),
    })
  }
  for (const p of delta.posts) {
    if (p.createdAt <= snapshotAt || !visible(p)) continue
    const s = byId.get(str(p, 'threadId') ?? '')
    if (!s) continue
    s.replies += 1
    const at = effectiveAt(p, archiveOwnerId)
    if (at >= s.lastPostAt) {
      s.lastPostAt = at
      s.lastPostAuthorId = p.ownerId
      s.lastPostArchiveAuthor = archiveAuthor(p, archiveOwnerId)
      s.lastPostId = p.id
    }
  }
  return [...byId.values()].map((s) => ({ ...s, replies: Math.max(0, s.replies) }))
}
