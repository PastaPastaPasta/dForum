/**
 * Folding the live delta (everything changed since the snapshot) into snapshot views. Pure.
 * Live posts go through `livePostThread`, so hidden threads and moves apply to live content exactly
 * as the snapshot applies them; locks and archived forums are refused at consensus.
 */
import type { LastPost, RawDoc, ThreadSummary } from './types.ts'
import {
  archiveAuthor, type ArchiveRef, effectiveAt, isArchive, isHidden, isLocked, isRetracted, num, str, threadForumId, threadPosts, threadTags,
} from './model.ts'

export interface DeltaDocs {
  /** Changed threads plus the threads of every live post (the overlay resolves them). */
  threads: RawDoc[]
  posts: RawDoc[]
}

export interface LiveContext {
  snapshotAt: number
  archive?: ArchiveRef
  /** Archived (read-only) forums. Consensus refuses new threads and posts in them (contract v3). */
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
const byId = (docs: RawDoc[]) => new Map(docs.map((d) => [d.id, d]))

/** Whether new replies can land in this thread: consensus checks the post's forumId, which is the
 * thread's original forum, and the thread's lock; the app also closes threads moved into an
 * archived forum. */
export function acceptsReplies(thread: RawDoc, ctx: Pick<LiveContext, 'archivedForums'>): boolean {
  if (isLocked(thread) || isHidden(thread)) return false
  const archived = ctx.archivedForums
  return !archived?.has(str(thread, 'forumId') ?? '') && !archived?.has(threadForumId(thread))
}

/** Moderation and edits the live delta has seen on documents the static index already lists. */
export interface DeltaChanges {
  /** Hidden, or its opening post (when the delta has it) hidden or retracted by its author. */
  threadGone(id: string): boolean
  postGone(id: string): boolean
  thread(id: string): RawDoc | undefined
}

export function deltaChanges(delta: DeltaDocs): DeltaChanges {
  const threads = byId(delta.threads)
  const posts = byId(delta.posts)
  return {
    threadGone: (id) => {
      const t = threads.get(id)
      if (!t) return false
      if (isHidden(t)) return true
      // The opening post is written right after its thread. When the delta holds the owner's first
      // post from that moment, it is the opening post (archive threads included: they load in order).
      const first = delta.posts
        .filter((p) => str(p, 'threadId') === id && p.ownerId === t.ownerId)
        .sort((a, b) => a.createdAt - b.createdAt)[0]
      return !!first && first.createdAt - t.createdAt < STRADDLE_MS && !visible(first)
    },
    postGone: (id) => { const p = posts.get(id); return !!p && !visible(p) },
    thread: (id) => threads.get(id),
  }
}

/** The thread a live post belongs to, when the post may be shown; null otherwise. */
export function livePostThread(p: RawDoc, threads: ReadonlyMap<string, RawDoc>, ctx: LiveContext): RawDoc | null {
  if (!visible(p)) return null
  const thread = threads.get(str(p, 'threadId') ?? '')
  if (!thread || isHidden(thread)) return null
  return thread
}


/** A thread and its opening post are two writes a few seconds apart; a snapshot can fall between them. */
const STRADDLE_MS = 120_000

/** New listable threads (opening post present and visible) that the snapshot could not list: created
 * after it, or created just before it with an opening post that landed after it. */
export function newThreads(delta: DeltaDocs, ctx: LiveContext): RawDoc[] {
  return delta.threads.filter((t) => {
    // The same rule the snapshot applies: the thread and its opening post are visible.
    const view = threadPosts(t, delta.posts, ctx.archive)
    if (!view.listable || !view.opening) return false
    if (t.createdAt > ctx.snapshotAt) return true
    return t.createdAt > ctx.snapshotAt - STRADDLE_MS && view.opening.createdAt > ctx.snapshotAt
  })
}

/** New posts since the snapshot that may be shown, with their threads. */
export function newPosts(delta: DeltaDocs, ctx: LiveContext): Array<{ post: RawDoc; thread: RawDoc }> {
  const threads = byId(delta.threads)
  const changes = deltaChanges(delta)
  const out: Array<{ post: RawDoc; thread: RawDoc }> = []
  for (const post of delta.posts) {
    if (post.createdAt <= ctx.snapshotAt) continue
    const thread = livePostThread(post, threads, ctx)
    // A thread whose opening post was hidden is unlisted: replies (a spammer's bump) don't revive it.
    if (thread && !changes.threadGone(thread.id)) out.push({ post, thread })
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
