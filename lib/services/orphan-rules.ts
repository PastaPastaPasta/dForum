/**
 * The orphan rule's pure helpers — the single source of truth for "which
 * post opens this thread". Used by every path that computes listability:
 * the live listings (lib/services/orphan.ts), the static snapshot
 * (scripts/snapshot.mjs) and the home pinned re-verify.
 *
 * Rules (data-model.md):
 *  - the opening post is the earliest post whose $ownerId equals the thread
 *    owner, ordered by ($createdAt, $id) — regardless of its moderation state
 *  - ordering compares decoded id bytes, not base58 strings (those sort by
 *    string, not by the chain's byte order)
 *  - the thread is listable only when that opening post exists AND is visible
 *    (not moderated, and not past the lock)
 */
import bs58 from 'bs58'

export function idBytes(id: string): Uint8Array | null {
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

/** The earliest owner-owned post in a list of posts. */
export function openingPostFromPosts<T extends { createdAt: number; id: string; ownerId: string; properties?: Record<string, unknown> }>(
  posts: T[],
  ownerId: string,
): T | null {
  const ownerPosts = posts.filter((p) => p.ownerId === ownerId)
  if (ownerPosts.length === 0) return null
  ownerPosts.sort((a, b) => (beforePost(a, b) ? -1 : beforePost(b, a) ? 1 : 0))
  return ownerPosts[0]
}
