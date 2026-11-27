/**
 * The orphan rule (data-model.md): a thread is LISTABLE only when it has an
 * opening post — the earliest post whose $ownerId equals the thread owner,
 * ordered by ($createdAt, $id) — regardless of that post's moderation state.
 * The opening post must itself be visible: not moderated, and not past the
 * lock. Every live listing and the snapshot apply this single rule; the pure
 * helpers live in ./orphan-rules.ts and are shared with the snapshot script.
 *
 * The opening post is located via the post.byAuthor index ($ownerId +
 * $createdAt ≥ thread.createdAt, ascending), paginating so pre-opening
 * spam cannot hide it — this is NOT one free query: the chain cannot serve
 * (threadId + ownerId) equality, so the scan filters on threadId in the
 * client. It therefore carries a 12-page budget and throws
 * OrphanScanExhaustedError when it is spent — the honest signal, not a
 * "no opening post" verdict. Fail-closed paths (the static index) throw;
 * live callers choose fail-open (keep the thread) and report failures.
 */
import { queryRaw } from '@/lib/services/document-service'
import {
  compareIds,
  beforePost,
  openingPostFromPosts,
  type idBytes,
} from '@/lib/services/orphan-rules'

export { compareIds, beforePost, openingPostFromPosts }
export type { idBytes }

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

/** Thrown when the post-scan hits the page budget. Distinct from "no
 * opening post" (a legitimate null) so callers never mistake one for the
 * other. */
export class OrphanScanExhaustedError extends Error {
  constructor() {
    super('orphan scan exhausted its page budget')
    this.name = 'OrphanScanExhaustedError'
  }
}

/** The opening post of a thread (see the orphan rule) — located via the
 * post.byAuthor index, paginating so pre-opening spam cannot hide it.
 * Returns null when the thread has no owner-owned post. Throws
 * OrphanScanExhaustedError when the page budget is exhausted, and any read
 * error otherwise — the static index is the guarded path (scripts/snapshot.mjs);
 * live callers decide fail-open vs fail-closed. */
export async function earliestOwnerPost(
  threadId: string,
  ownerId: string,
  threadCreatedAt?: number,
): Promise<OpeningPost | null> {
  if (!ownerId) return null
  const where: [string, string, unknown][] = [['$ownerId', '==', ownerId]]
  if (threadCreatedAt != null) where.push(['$createdAt', '>=', threadCreatedAt])
  let after: string | undefined
  // Bounded: 12 pages of 25 posts = the first 300 owner posts. At the
  // next registration the orphan index (post.byThreadAuthor) makes this one
  // query with limit 1 — see docs/design/contract-next-registration.md.
  for (let page = 0; page < 12; page++) {
    const { docs: posts, rawCount, lastId } = await queryRaw('post', {
      where,
      orderBy: [['$createdAt', 'asc']],
      limit: 25,
      ...(after ? { startAfter: after } : {}),
    })
    const mine = posts.filter((p) => p.properties?.threadId === threadId)
    const opening = openingPostFromPosts(mine, ownerId)
    if (opening) {
      return {
        id: opening.id,
        createdAt: opening.createdAt,
        modState: (opening.properties?.modState as number | null) ?? null,
      }
    }
    if (rawCount < 25) return null // index exhausted — the thread has no opening post
    if (lastId == null) break // could not compute a cursor — refuse to loop forever
    after = lastId
  }
  // Budget exhausted (or untrackable cursor): unknown, not "no opening post".
  throw new OrphanScanExhaustedError()
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
  const { listed } = await filterListableWithFailures(threads, concurrency)
  return listed
}

/** Orphan-filter, reporting which threads the checks failed on. Callers that
 * cache verdicts (e.g. the search page) must keep only verdicts for threads
 * that did NOT fail — a failed check is an unknown, not a "listable". */
export async function filterListableWithFailures<T extends Listable>(
  threads: T[],
  concurrency = 4,
): Promise<{ listed: T[]; failed: Set<string> }> {
  const out: T[] = []
  const failed = new Set<string>()
  for (let i = 0; i < threads.length; i += concurrency) {
    const batch = threads.slice(i, i + concurrency)
    const results = await Promise.all(batch.map(async (t) => {
      try {
        return [t, await hasOpeningPost(t), false] as const
      } catch {
        return [t, true, true] as const
      }
    }))
    for (const [t, ok, failedCheck] of results) {
      if (failedCheck) failed.add(t.id)
      if (ok) out.push(t)
    }
  }
  return { listed: out, failed }
}
