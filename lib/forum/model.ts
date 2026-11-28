/**
 * Forum rules shared by the snapshot builder and the browser. Pure functions over RawDoc, no
 * imports outside this folder, so Node scripts can load the file directly.
 *
 * - Archive provenance (orig*) is trusted only on documents owned by settings.archiveOwnerId.
 * - Effective date = origCreatedAt for trusted archive documents, else $createdAt.
 * - Opening post = earliest post (effective date, then $id bytes) owned by the thread owner.
 *   A thread is listed only when its opening post exists, is visible and is not retracted.
 * - Hidden = modState set. Locked (moderator `locked`) threads refuse new posts, edits and reactions at consensus (v4).
 * - A moderator move (movedToForumId) re-homes a thread; forumId stays as written.
 */
import type { CategoryView, ForumView, LastPost, RawDoc, ReactionCounts, ThreadSummary } from './types.ts'

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
const B58_INDEX: Record<string, number> = Object.fromEntries([...B58].map((c, i) => [c, i]))

function b58Bytes(id: string): number[] | null {
  const bytes: number[] = []
  for (const ch of id) {
    const v = B58_INDEX[ch]
    if (v === undefined) return null
    let carry = v
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i] * 58
      bytes[i] = carry & 0xff
      carry >>= 8
    }
    while (carry > 0) {
      bytes.push(carry & 0xff)
      carry >>= 8
    }
  }
  for (const ch of id) {
    if (ch !== '1') break
    bytes.push(0)
  }
  return bytes.reverse()
}

/** Byte order of base58 identifiers — the chain's tie-break order. */
export function compareIds(a: string, b: string): number {
  const ba = b58Bytes(a)
  const bb = b58Bytes(b)
  if (!ba || !bb) return a < b ? -1 : a > b ? 1 : 0
  const n = Math.min(ba.length, bb.length)
  for (let i = 0; i < n; i++) if (ba[i] !== bb[i]) return ba[i] - bb[i]
  return ba.length - bb.length
}

export const str = (doc: RawDoc | undefined, key: string): string | undefined => {
  const v = doc?.p[key]
  return typeof v === 'string' ? v : undefined
}
export const num = (doc: RawDoc | undefined, key: string): number | undefined => {
  const v = doc?.p[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

/** The archivist and, optionally, the time after which its provenance is no longer trusted. */
// Invisible and direction-changing characters: controls, bidi overrides and isolates, zero-width
// spaces, fillers and tag characters. Short public strings (names, titles) lose them, so nobody can
// pose as another member or reorder a title. Emoji joiners (U+200D) stay.
const INVISIBLE = /[\u0000-\u001F\u007F-\u009F\u00AD\u061C\u115F\u180E\u200B\u200E\u200F\u2028-\u202E\u2060-\u2064\u2066-\u2069\u3164\uFEFF\uFFA0]|\uDB40[\uDC00-\uDC7F]/g
const SHORT_TEXT = ['displayName', 'title', 'customTitle', 'location', 'origAuthor', 'role'] as const

/** Strips invisible characters from the short text fields of a document's properties, in place. */
export function cleanShortText(p: Record<string, unknown>): Record<string, unknown> {
  for (const k of SHORT_TEXT) {
    const v = p[k]
    if (typeof v === 'string') p[k] = v.replace(INVISIBLE, '').replace(/\s+/g, ' ').trim()
  }
  return p
}

export type ArchiveRef = string | { id: string; until?: number } | undefined

export const archiveId = (ref: ArchiveRef): string | undefined => (typeof ref === 'string' ? ref : ref?.id)

export function archiveRef(settings: { archiveOwnerId?: string; archiveTrustUntil?: number }): ArchiveRef {
  return settings.archiveOwnerId ? { id: settings.archiveOwnerId, until: settings.archiveTrustUntil } : undefined
}

export function isArchive(doc: RawDoc, archiveOwnerId?: ArchiveRef): boolean {
  const id = archiveId(archiveOwnerId)
  const until = typeof archiveOwnerId === 'object' ? archiveOwnerId.until : undefined
  // Both dates: a document edited after the window closed (a leaked archivist key) loses its trust.
  // Moderator changes don't move $updatedAt, so hiding an imported post keeps it trusted.
  return !!id && doc.ownerId === id && num(doc, 'origCreatedAt') !== undefined
    && (until === undefined || (doc.createdAt <= until && doc.updatedAt <= until))
}

export function effectiveAt(doc: RawDoc, archiveOwnerId?: ArchiveRef): number {
  return isArchive(doc, archiveOwnerId) ? (num(doc, 'origCreatedAt') as number) : doc.createdAt
}

export function archiveAuthor(doc: RawDoc, archiveOwnerId?: ArchiveRef): string | undefined {
  return isArchive(doc, archiveOwnerId) ? str(doc, 'origAuthor') ?? 'unknown' : undefined
}

export const isHidden = (doc: RawDoc): boolean => doc.p.modState !== undefined && doc.p.modState !== null
export const isRetracted = (doc: RawDoc): boolean => doc.p.retracted === true
export const isEdited = (doc: RawDoc): boolean => doc.updatedAt > doc.createdAt

export function postBody(doc: RawDoc): string {
  return (str(doc, 'body') ?? '') + (str(doc, 'body2') ?? '')
}

export function threadForumId(thread: RawDoc): string {
  return str(thread, 'movedToForumId') ?? (str(thread, 'forumId') as string)
}

export const isLocked = (thread: RawDoc): boolean => thread.p.locked === true

export function threadTags(thread: RawDoc): string[] {
  const t = thread.p.tags
  return Array.isArray(t) ? t.filter((x): x is string => typeof x === 'string') : []
}

export function byEffective(archiveOwnerId?: ArchiveRef) {
  return (a: RawDoc, b: RawDoc): number =>
    effectiveAt(a, archiveOwnerId) - effectiveAt(b, archiveOwnerId) || a.createdAt - b.createdAt || compareIds(a.id, b.id)
}

export interface ThreadPostsView {
  opening: RawDoc | null
  /** Opening post first, then the replies that count (posts written before the opening post are dropped). */
  posts: RawDoc[]
  listable: boolean
}

export function threadPosts(thread: RawDoc, posts: RawDoc[], archiveOwnerId?: ArchiveRef): ThreadPostsView {
  const sorted = posts.filter((p) => str(p, 'threadId') === thread.id).sort(byEffective(archiveOwnerId))
  const openingIndex = sorted.findIndex((p) => p.ownerId === thread.ownerId)
  if (openingIndex < 0) return { opening: null, posts: [], listable: false }
  const opening = sorted[openingIndex]
  const kept = sorted.slice(openingIndex)
  const listable = !isHidden(thread) && !isHidden(opening) && !isRetracted(opening)
  return { opening, posts: kept, listable }
}

/** Newest revision wins; a moderator change bumps $revision too. */
export function mergeDocs(base: RawDoc[], delta: RawDoc[]): RawDoc[] {
  const byId = new Map(base.map((d) => [d.id, d]))
  for (const d of delta) {
    const cur = byId.get(d.id)
    if (!cur || d.revision > cur.revision || (d.revision === cur.revision && (d.moderatedAt ?? 0) > (cur.moderatedAt ?? 0))) {
      byId.set(d.id, d)
    }
  }
  return [...byId.values()]
}

export function countReactions(reactions: RawDoc[]): Record<string, ReactionCounts> {
  const out: Record<string, ReactionCounts> = {}
  for (const r of reactions) {
    const postId = str(r, 'postId')
    const kind = num(r, 'kind')
    if (!postId || kind === undefined) continue
    const counts = (out[postId] ??= {})
    counts[kind] = (counts[kind] ?? 0) + 1
  }
  return out
}

export const reactionTotal = (counts?: ReactionCounts): number =>
  counts ? Object.values(counts).reduce((a, b) => a + b, 0) : 0

export function summarizeThread(
  thread: RawDoc,
  view: ThreadPostsView,
  reactions: Record<string, ReactionCounts>,
  archiveOwnerId?: ArchiveRef,
): ThreadSummary {
  const visible = view.posts.filter((p) => !isHidden(p) && !isRetracted(p))
  const last = visible[visible.length - 1] ?? view.opening ?? thread
  const origId = isArchive(thread, archiveOwnerId) ? num(thread, 'origId') : undefined
  return {
    id: thread.id,
    forumId: threadForumId(thread),
    title: str(thread, 'title') ?? '(untitled)',
    tags: threadTags(thread),
    ownerId: thread.ownerId,
    archiveAuthor: archiveAuthor(thread, archiveOwnerId),
    ...(origId !== undefined ? { origId } : {}),
    createdAt: effectiveAt(thread, archiveOwnerId),
    sticky: thread.p.sticky === true,
    locked: isLocked(thread),
    replies: Math.max(0, visible.length - 1),
    posts: view.posts.length,
    reactions: visible.reduce((n, p) => n + reactionTotal(reactions[p.id]), 0),
    lastPostAt: effectiveAt(last, archiveOwnerId),
    lastPostAuthorId: last.ownerId,
    lastPostArchiveAuthor: archiveAuthor(last, archiveOwnerId),
    lastPostId: last === thread ? undefined : last.id,
  }
}

/** Sticky first, then latest activity. */
export function sortThreadSummaries(threads: ThreadSummary[]): ThreadSummary[] {
  return [...threads].sort((a, b) => Number(b.sticky) - Number(a.sticky) || b.lastPostAt - a.lastPostAt || compareIds(b.id, a.id))
}

export function lastPostOf(s: ThreadSummary): LastPost | undefined {
  if (!s.lastPostAt) return undefined
  return {
    postId: s.lastPostId ?? s.id,
    threadId: s.id,
    threadTitle: s.title,
    at: s.lastPostAt,
    authorId: s.lastPostAuthorId,
    archiveAuthor: s.lastPostArchiveAuthor,
  }
}

/** Parent links are trusted only when the parent exists, shares the category and is acyclic. */
export function resolveForumTree(forums: ForumView[], categories: CategoryView[]): ForumView[] {
  const byId = new Map(forums.map((f) => [f.id, f]))
  const catIds = new Set(categories.map((c) => c.id))
  return forums
    .filter((f) => catIds.has(f.categoryId))
    .map((f) => {
      const seen = new Set([f.id])
      let parent = f.parentForumId ? byId.get(f.parentForumId) : undefined
      let ok = !!parent && parent.categoryId === f.categoryId
      while (ok && parent) {
        if (seen.has(parent.id)) { ok = false; break }
        seen.add(parent.id)
        parent = parent.parentForumId ? byId.get(parent.parentForumId) : undefined
        if (parent && parent.categoryId !== f.categoryId) ok = false
      }
      return ok ? f : { ...f, parentForumId: undefined }
    })
    .sort((a, b) => a.sort - b.sort || a.title.localeCompare(b.title))
}

export function childForums(forums: ForumView[], parentId?: string): ForumView[] {
  return forums.filter((f) => (f.parentForumId ?? undefined) === parentId)
}

/** All descendants (for rolled-up counts and last post). */
export function forumDescendants(forums: ForumView[], id: string): ForumView[] {
  const out: ForumView[] = []
  const stack = [id]
  while (stack.length) {
    const cur = stack.pop() as string
    for (const f of forums) if (f.parentForumId === cur) { out.push(f); stack.push(f.id) }
  }
  return out
}

export function excerpt(markdown: string, max = 180): string {
  const text = markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^>.*$/gm, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`~#>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > max ? text.slice(0, max - 1).trimEnd() + '…' : text
}

export function shortId(id: string): string {
  return id.length > 10 ? `${id.slice(0, 4)}…${id.slice(-4)}` : id
}

/** How a member with no display name and no Dash username is shown, everywhere. */
export const memberLabel = (id: string): string => `Member ${shortId(id)}`

export function slugify(title: string): string {
  return title.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'thread'
}
