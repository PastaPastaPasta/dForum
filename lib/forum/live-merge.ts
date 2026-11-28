/**
 * Folding the live delta (everything changed since the snapshot) into snapshot views. Pure.
 * Every reader goes through `livePostThread`, so locks, hidden threads, moves and archived
 * forums apply to live content exactly as the snapshot applies them.
 */
import type { LastPost, RawDoc, ThreadSummary } from './types.ts'
import {
  archiveAuthor, archiveId, type ArchiveRef, effectiveAt, isArchive, isHidden, isLocked, isRetracted, num, str, threadForumId, threadTags,
} from './model.ts'

export interface DeltaDocs {
  /** Changed threads plus the threads of every live post (the overlay resolves them). */
  threads: RawDoc[]
  posts: RawDoc[]
}

export interface LiveContext {
  snapshotAt: number
  archive?: ArchiveRef
  /** Forums that only staff and the archivist may write to. */
  archivedForums?: ReadonlySet<string>
  /** Owner and moderators. */
  staff?: ReadonlySet<string>
}

export interface ForumActivity {
  threads: number
  posts: number
  last?: LastPost
}

/** The serializable form pages receive from the server. */
export interface LiveContextProps {
  snapshotAt: number
  archive?: ArchiveRef
  archivedForums: string[]
  staff: string[]
}

export function toLiveContext(p: LiveContextProps): LiveContext {
  return { snapshotAt: p.snapshotAt, archive: p.archive, archivedForums: new Set(p.archivedForums), staff: new Set(p.staff) }
}

const visible = (d: RawDoc) => !isHidden(d) && !isRetracted(d)

/** Archived forums accept writes from staff and the archivist only (enforced by every reader). */
export function mayWriteIn(forumId: string, ownerId: string, ctx: Pick<LiveContext, 'archive' | 'archivedForums' | 'staff'>): boolean {
  if (!ctx.archivedForums?.has(forumId)) return true
  return ownerId === archiveId(ctx.archive) || !!ctx.staff?.has(ownerId)
}

/** The thread a live post belongs to, when the post may be shown; null otherwise. */
export function livePostThread(p: RawDoc, threads: ReadonlyMap<string, RawDoc>, ctx: LiveContext): RawDoc | null {
  if (!visible(p)) return null
  const thread = threads.get(str(p, 'threadId') ?? '')
  if (!thread || isHidden(thread)) return null
  const forumId = threadForumId(thread)
  if (!mayWriteIn(forumId, p.ownerId, ctx) || !mayWriteIn(forumId, thread.ownerId, ctx)) return null
  return thread
}

const byId = (docs: RawDoc[]) => new Map(docs.map((d) => [d.id, d]))

/** New listable threads (opening post present and visible) created after the snapshot. */
export function newThreads(delta: DeltaDocs, ctx: LiveContext): RawDoc[] {
  return delta.threads.filter((t) => t.createdAt > ctx.snapshotAt && !isHidden(t) && mayWriteIn(threadForumId(t), t.ownerId, ctx)
    && delta.posts.some((p) => str(p, 'threadId') === t.id && p.ownerId === t.ownerId && visible(p)))
}

/** New posts since the snapshot that may be shown, with their threads. */
export function newPosts(delta: DeltaDocs, ctx: LiveContext): Array<{ post: RawDoc; thread: RawDoc }> {
  const threads = byId(delta.threads)
  const out: Array<{ post: RawDoc; thread: RawDoc }> = []
  for (const post of delta.posts) {
    if (post.createdAt <= ctx.snapshotAt) continue
    const thread = livePostThread(post, threads, ctx)
    if (thread) out.push({ post, thread })
  }
  return out
}

/** Per-forum additions since the snapshot, keyed by the thread's current forum. */
export function forumActivity(delta: DeltaDocs, ctx: LiveContext): Map<string, ForumActivity> {
  const out = new Map<string, ForumActivity>()
  const get = (id: string) => out.get(id) ?? (out.set(id, { threads: 0, posts: 0 }), out.get(id) as ForumActivity)
  for (const t of newThreads(delta, ctx)) get(threadForumId(t)).threads += 1
  for (const { post, thread } of newPosts(delta, ctx)) {
    const a = get(threadForumId(thread))
    a.posts += 1
    const at = effectiveAt(post, ctx.archive)
    if (!a.last || at > a.last.at) {
      a.last = { postId: post.id, threadId: thread.id, threadTitle: str(thread, 'title') ?? '', at, authorId: post.ownerId, archiveAuthor: archiveAuthor(post, ctx.archive) }
    }
  }
  return out
}

/** Thread summaries for a forum with the delta applied: new threads (only when `includeNew`), new
 * replies, title edits, and moderation (hidden or moved-away threads drop out). */
export function mergeForumThreads(
  base: ThreadSummary[],
  forumId: string,
  delta: DeltaDocs,
  ctx: LiveContext,
  includeNew = true,
): ThreadSummary[] {
  const summaries = new Map(base.map((s) => [s.id, { ...s }]))
  for (const t of delta.threads) {
    const cur = summaries.get(t.id)
    if (!cur) continue
    if (isHidden(t) || threadForumId(t) !== forumId) { summaries.delete(t.id); continue }
    cur.title = str(t, 'title') ?? cur.title
    cur.tags = threadTags(t)
    cur.sticky = t.p.sticky === true
    cur.locked = isLocked(t)
  }
  if (includeNew) {
    for (const t of newThreads(delta, ctx)) {
      if (threadForumId(t) !== forumId || summaries.has(t.id)) continue
      summaries.set(t.id, {
        id: t.id, forumId, title: str(t, 'title') ?? '', tags: threadTags(t), ownerId: t.ownerId,
        archiveAuthor: archiveAuthor(t, ctx.archive), createdAt: effectiveAt(t, ctx.archive), sticky: t.p.sticky === true,
        locked: isLocked(t), replies: -1, posts: 0, reactions: 0, lastPostAt: effectiveAt(t, ctx.archive), lastPostAuthorId: t.ownerId,
        ...(isArchive(t, ctx.archive) && num(t, 'origId') !== undefined ? { origId: num(t, 'origId') } : {}),
      })
    }
  }
  for (const { post } of newPosts(delta, ctx)) {
    const s = summaries.get(str(post, 'threadId') ?? '')
    if (!s) continue
    s.replies += 1
    s.posts = (s.posts ?? s.replies) + 1
    const at = effectiveAt(post, ctx.archive)
    if (at >= s.lastPostAt) {
      s.lastPostAt = at
      s.lastPostAuthorId = post.ownerId
      s.lastPostArchiveAuthor = archiveAuthor(post, ctx.archive)
      s.lastPostId = post.id
    }
  }
  return [...summaries.values()].map((s) => ({ ...s, replies: Math.max(0, s.replies) }))
}
