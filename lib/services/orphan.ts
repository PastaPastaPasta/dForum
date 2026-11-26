/**
 * The orphan rule (data-model.md): a thread is LISTABLE only when it has an
 * opening post — the earliest post whose $ownerId equals the thread owner,
 * ordered by ($createdAt, $id) — regardless of that post's moderation state.
 * The opening post must itself be visible: not moderated, and not past the
 * lock. Every live listing and the snapshot apply this single rule; nothing
 * else computes orphan status.
 *
 * The opening post is located via the post.byAuthor index ($ownerId +
 * $createdAt ≥ thread.createdAt, ascending) — a single query that works at any
 * depth of pre-opening spam. The pure tie-break compares decoded id bytes,
 * not base58 strings (those order by string, not by the chain's byte order).
 *
 * Fails open (keeps the thread) on read errors — a flaky network must not
 * silently drop threads from a live view; the static index is the guarded
 * path (scripts/snapshot.mjs, which throws).
 */
import bs58 from 'bs58'
import { query } from '@/lib/services/document-service'

export interface Listable {
  id: string
  ownerId: string | null
  lockedAt?: number | null
  createdAt?: number
}

export interface OpeningPost {
  id: string
  createdAt: number
  modState: number | null
}

function idBytes(id: string): Uint8Array | null {
  try {
    return bs58.decode(id)
  } catch {
    return null
  }
}

/** Byte-order comparison of the $id identifiers — the chain's ordering. */
export function compareIds(a: string, b: string): number {
  const ba = idBytes(a)
  const bb = idBytes(b)
  if (ba && bb) {
    const n = Math.min(ba.length, bb.length)
    for (let i = 0; i < n; i++) {
      if (ba[i] !== bb[i]) return ba[i] - bb[i]
    }
    return ba.length - bb.length
  }
  return a < b ? -1 : a > b ? 1 : 0
}

/** ($createdAt, $id) ordering, exactly as the chain defines it. */
export function beforePost<T extends { createdAt: number; id: string }>(a: T, b: T): boolean {
  return a.createdAt < b.createdAt || (a.createdAt === b.createdAt && compareIds(a.id, b.id) < 0)
}

/** The earliest owner-owned post in a list — pure, shared by all paths. */
export function openingPostFromPosts<T extends { createdAt: number; id: string; ownerId: string; properties?: Record<string, unknown> }>(
  posts: T[],
  ownerId: string,
): T | null {
  const ownerPosts = posts.filter((p) => p.ownerId === ownerId)
  if (ownerPosts.length === 0) return null
  ownerPosts.sort((a, b) => (beforePost(a, b) ? -1 : beforePost(b, a) ? 1 : 0))
  return ownerPosts[0]
}

/** The opening post of a thread (see the orphan rule) — located via the
 * post.byAuthor index — or null when the thread has no owner-owned post. */
export async function earliestOwnerPost(
  threadId: string,
  ownerId: string,
  threadCreatedAt?: number,
): Promise<OpeningPost | null> {
  if (!ownerId) return null
  const where: [string, string, unknown][] = [['$ownerId', '==', ownerId]]
  if (threadCreatedAt != null) where.push(['$createdAt', '>=', threadCreatedAt])
  const posts = await query('post', {
    where,
    orderBy: [['$createdAt', 'asc']],
    limit: 25,
  })
  const mine = posts.filter((p) => p.properties?.threadId === threadId)
  const opening = openingPostFromPosts(mine, ownerId)
  if (!opening) return null
  return {
    id: opening.id,
    createdAt: opening.createdAt,
    modState: (opening.properties?.modState as number | null) ?? null,
  }
}

export async function hasOpeningPost(thread: Listable): Promise<boolean> {
  const ownerId = thread.ownerId
  if (!ownerId) return false
  const lockedAt = thread.lockedAt ?? null
  const opening = await earliestOwnerPost(thread.id, ownerId, thread.createdAt)
  if (!opening) return false
  if (opening.modState != null) return false // opening post hidden → not listed
  if (lockedAt != null && opening.createdAt > lockedAt) return false
  return true
}

/** Orphan-filter a list of threads. Fails open (keeps the thread) on errors. */
export async function filterListable<T extends Listable>(threads: T[], concurrency = 4): Promise<T[]> {
  const out: T[] = []
  for (let i = 0; i < threads.length; i += concurrency) {
    const batch = threads.slice(i, i + concurrency)
    const results = await Promise.all(batch.map(async (t) => {
      try {
        return [t, await hasOpeningPost(t)] as const
      } catch {
        return [t, true] as const
      }
    }))
    for (const [t, ok] of results) if (ok) out.push(t)
  }
  return out
}
