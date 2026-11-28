'use client'

/**
 * The live layer over the static snapshot: everything that changed on chain since the snapshot,
 * from a handful of global delta queries (byUpdated + moderated). Pages merge it into their
 * snapshot data with the same rules the snapshot used (lib/forum/model.ts).
 */
import { useSyncExternalStore } from 'react'
import type { RawDoc } from '@/lib/forum/types'
import { isHidden, mergeDocs, str } from '@/lib/forum/model'
import { getDoc, queryPage } from './platform'

const OVERLAP_MS = 10 * 60_000
const POLL_MS = 45_000

export type LiveStatus = 'idle' | 'loading' | 'live' | 'offline'

export interface LiveState {
  status: LiveStatus
  threads: RawDoc[]
  posts: RawDoc[]
  reactions: RawDoc[]
  profiles: RawDoc[]
  /** Threads whose first posts are loaded into `posts`, with the createdAt of the last one loaded
   * (Infinity when the thread had fewer, i.e. every post is loaded). */
  heads: Record<string, number>
  updatedAt: number
  truncated: boolean
}

const EMPTY: LiveState = { status: 'idle', threads: [], posts: [], reactions: [], profiles: [], heads: {}, updatedAt: 0, truncated: false }
let state: LiveState = EMPTY
let since = 0
let timer: ReturnType<typeof setInterval> | null = null
let inflight: Promise<void> | null = null
const listeners = new Set<() => void>()

function set(next: Partial<LiveState>) {
  state = { ...state, ...next }
  listeners.forEach((l) => l())
}

// Per type and field, the value the next poll starts from. Each poll pages forward by value from
// its cursor (a busy page continues next poll), so a capped poll never drops the newest changes.
interface Cursor { at: number; after?: string; capped: boolean }
const cursors = new Map<string, Cursor>()
// Threads whose first posts have been loaded (see refreshLive).
const headsFetched = new Map<string, number>()
const headsPending = new Set<string>()
// Bumped when `since` changes, so a poll started before can't write back stale cursors.
let generation = 0
const HEAD_WORKERS = 6
// Bounded per poll so a flood of touched threads can't delay every update; the rest stay pending
// (judged as unknown, which fails closed) and load over the next polls.
const HEADS_PER_POLL = 120
const HEAD_PAGE = 100
const HEAD_FIRST_PAGE = 5
const HEAD_DEADLINE_MS = 10_000
const HEADS_BUDGET_MS = 20_000
const HEAD_MAX_PAGES = 6 // 5 + 5 × 100 posts

/** A thread's opening post (its owner's first post), found by paging the thread. Only that post is
 * kept (the rule needs nothing else, and heads stay in memory all session). The cutoff is its
 * createdAt; Infinity when the thread ended without one (no opening post: unlisted); NaN when the
 * cap ran out first (no evidence: new replies wait, the snapshot's listing stands). Imported threads
 * order by original date, so for those the whole thread is read and the earliest by that date wins;
 * past the cap they fall back to their chain-first post. */
async function loadHead(thread: RawDoc, stop: { aborted: boolean }): Promise<{ docs: RawDoc[]; cutoff: number }> {
  const archive = thread.p.origId !== undefined
  let best: RawDoc | undefined
  let first: RawDoc | undefined
  let startAfter: string | undefined
  for (let i = 0; i < HEAD_MAX_PAGES; i++) {
    if (stop.aborted) throw new Error('aborted')
    // The opening post is nearly always first: a small first page, then full pages.
    const limit = i === 0 ? HEAD_FIRST_PAGE : HEAD_PAGE
    const page = await queryPage('post', { where: [['threadId', '==', thread.id]], orderBy: [['$createdAt', 'asc']], limit, startAfter })
    first ??= page.docs[0]
    for (const p of page.docs) {
      if (p.ownerId !== thread.ownerId) continue
      if (!archive) return { docs: [p], cutoff: p.createdAt }
      if (!best || origAt(p) < origAt(best)) best = p
    }
    if (!page.full || !page.last) return best ? { docs: [best], cutoff: Infinity } : { docs: [], cutoff: Infinity }
    startAfter = page.last
  }
  if (archive && first?.ownerId === thread.ownerId) return { docs: [first], cutoff: first.createdAt }
  return { docs: [], cutoff: NaN }
}

const origAt = (p: RawDoc) => (typeof p.p.origCreatedAt === 'number' ? p.p.origCreatedAt : p.createdAt)

const STEP_OVERLAP_MS = 2 * 60_000
const MAX_PAGES = 10

async function scan(type: string, field: '$updatedAt' | '$moderatedAt') {
  const key = `${type}:${field}`
  const prev = cursors.get(key)
  // After a capped scan, resume exactly where it stopped (no overlap, or a burst bigger than the cap
  // would be re-read forever); once caught up, re-read a short overlap for late-indexed writes.
  let from = prev?.capped ? prev.at : Math.max(since, (prev?.at ?? since) - STEP_OVERLAP_MS)
  const docs: RawDoc[] = []
  let tieAfter: string | undefined = prev?.capped ? prev.after : undefined
  // The parked id is resolved by Platform against the document as it is now: if it was deleted or
  // edited since, resume from its value without it (re-reading part of a tie block is harmless).
  if (tieAfter) {
    const parked = await getDoc(type, tieAfter).catch(() => null)
    if (!parked || ((field === '$moderatedAt' ? parked.moderatedAt : parked.updatedAt) ?? 0) !== from) tieAfter = undefined
  }
  let truncated = true
  for (let i = 0; i < MAX_PAGES; i++) {
    const page = await queryPage(type, { where: [[field, '>=', from]], orderBy: [[field, 'asc']], startAfter: tieAfter })
      .catch((e) => {
        // Deleted between the check and the query: retry the page without it.
        if (tieAfter && /not found/i.test(String((e as { message?: unknown })?.message ?? e))) { tieAfter = undefined; return queryPage(type, { where: [[field, '>=', from]], orderBy: [[field, 'asc']] }) }
        throw e
      })
    docs.push(...page.docs)
    if (!page.full || !page.docs.length) { truncated = false; break }
    const value = (d: RawDoc) => (field === '$moderatedAt' ? d.moderatedAt : d.updatedAt) ?? 0
    const last = value(page.docs[page.docs.length - 1])
    if (last === value(page.docs[0])) { tieAfter = page.last; continue }
    tieAfter = undefined
    from = last
  }
  const max = docs.reduce((m, d) => Math.max(m, (field === '$moderatedAt' ? d.moderatedAt : d.updatedAt) ?? 0), prev?.at ?? since)
  const next: Cursor = truncated ? { at: from, after: tieAfter, capped: true } : { at: max, capped: false }
  // Capped while still re-reading the overlap of an already caught-up scan: nothing new is missing yet,
  // so don't report truncation (it would hide new threads); the next poll resumes from the cursor.
  const overlapOnly = truncated && !prev?.capped && from <= (prev?.at ?? -Infinity)
  // Returned, not stored: cursors move only once the whole poll has been applied.
  return { docs, truncated: truncated && !overlapOnly, capped: truncated, next: [[key, next]] as Array<[string, Cursor]> }
}

type Scan = Awaited<ReturnType<typeof scan>>
const EMPTY_SCAN: Scan = { docs: [], truncated: false, capped: false, next: [] }

// Contracts without moderation have no $moderatedAt index; stop asking once that's clear.
let moderationIndexes = true

async function delta(type: string, moderated: boolean) {
  const mod = moderated && moderationIndexes
    ? scan(type, '$moderatedAt').catch((e) => {
        if (/non indexed|not indexed|no index/i.test(String((e as { message?: unknown })?.message ?? e))) moderationIndexes = false
        else throw e
        return EMPTY_SCAN
      })
    : Promise.resolve(EMPTY_SCAN)
  const [a, b] = await Promise.all([scan(type, '$updatedAt'), mod])
  return { docs: [...a.docs, ...b.docs], truncated: a.truncated || b.truncated, capped: a.capped || b.capped, next: [...a.next, ...b.next] }
}

export function refreshLive(): Promise<void> {
  if (!since) return Promise.resolve()
  if (inflight) return inflight
  if (state.status === 'idle') set({ status: 'loading' })
  const myGeneration = generation
  inflight = (async () => {
    try {
      const [threads, posts, reactions, profiles] = await Promise.all([
        delta('thread', true), delta('post', true), delta('reaction', false), delta('profile', true),
      ])
      // Every live post needs its thread (hidden? locked? which forum?) to be shown correctly;
      // fetch the threads the delta didn't include.
      const allThreads = mergeDocs(state.threads, threads.docs)
      const known = new Set(allThreads.map((t) => t.id))
      const missing = [...new Set(posts.docs.map((p) => str(p, 'threadId')).filter((id): id is string => !!id && !known.has(id)))]
      for (let i = 0; i < missing.length; i += 100) {
        const page = await queryPage('thread', { where: [['$id', 'in', missing.slice(i, i + 100)]], orderBy: [['$id', 'asc']] })
        allThreads.push(...page.docs)
      }
      // A live post counts only while its thread is listable (opening post present and visible), the
      // same rule as the snapshot, so the overlay needs each such thread's posts up to its opening
      // post. Loaded once per thread, all within this poll (no partial state is ever shown); later
      // moderation of them arrives through the $moderatedAt scan.
      const threadById = new Map(allThreads.map((t) => [t.id, t]))
      for (const p of posts.docs) {
        const id = str(p, 'threadId')
        if (id && !headsFetched.has(id)) headsPending.add(id)
      }
      // A thread a moderator changed (moved, moved back, hidden…) may be listed live in another forum,
      // which needs its listability too.
      for (const t of threads.docs) if ((t.moderatedAt ?? 0) > since && !isHidden(t) && !headsFetched.has(t.id)) headsPending.add(t.id)
      const cutoffs = new Map<string, number>()
      const heads: RawDoc[] = []
      const queue: string[] = []
      for (const id of headsPending) {
        const t = threadById.get(id)
        // Created after `since`: every post of it is in this delta already (unless the scan was capped).
        if (!t) headsPending.delete(id) // thread gone (moderator delete): nothing to judge
        else if (t.createdAt > since) { if (!posts.truncated) cutoffs.set(id, Infinity) } // else: next poll
        else if (queue.length < HEADS_PER_POLL) queue.push(id) // the rest stay pending for later polls
      }
      // A stalled query must not hold every other update: each load has a deadline, and head loading
      // as a whole a budget; whatever misses them stays pending (judged unknown, failing closed).
      const budgetEnds = Date.now() + HEADS_BUDGET_MS
      await Promise.all(Array.from({ length: Math.min(HEAD_WORKERS, queue.length) }, async () => {
        for (let id = queue.shift(); id && Date.now() < budgetEnds; id = queue.shift()) {
          const stop = { aborted: false }
          let timer: ReturnType<typeof setTimeout> | undefined
          try {
            const got = await Promise.race([
              loadHead(threadById.get(id) as RawDoc, stop),
              new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('head deadline')), HEAD_DEADLINE_MS) }),
            ])
            heads.push(...got.docs)
            cutoffs.set(id, got.cutoff)
          } catch {
            stop.aborted = true
          } finally {
            clearTimeout(timer)
          }
        }
      }))
      // `start` moved `since` while this poll ran: its results and cursors belong to the old range.
      if (generation !== myGeneration) { setTimeout(() => void refreshLive(), 0); return }
      set({
        status: 'live',
        // Merged against the current state: a local write (injectLocal) may have landed meanwhile.
        threads: mergeDocs(state.threads, allThreads),
        posts: mergeDocs(state.posts, [...posts.docs, ...heads]),
        heads: Object.fromEntries([...headsFetched, ...cutoffs]),
        reactions: mergeDocs(state.reactions, reactions.docs),
        profiles: mergeDocs(state.profiles, profiles.docs),
        truncated: threads.truncated || posts.truncated || reactions.truncated || profiles.truncated,
        updatedAt: Date.now(),
      })
      for (const [key, value] of [...threads.next, ...posts.next, ...reactions.next, ...profiles.next]) cursors.set(key, value)
      for (const [id, cutoff] of cutoffs) { headsFetched.set(id, cutoff); headsPending.delete(id) }
      // A capped poll, or heads still pending, resumes right away until it has caught up.
      const capped = threads.capped || posts.capped || reactions.capped || profiles.capped
      if (capped || (headsPending.size && cutoffs.size)) setTimeout(() => void refreshLive(), 1500)
    } catch {
      set({ status: state.status === 'live' ? 'live' : 'offline' })
    } finally {
      inflight = null
    }
  })()
  return inflight
}

/** Show a write immediately, before the next poll returns it. */
export function injectLocal(type: 'thread' | 'post' | 'reaction' | 'profile', doc: RawDoc) {
  const key = (type === 'thread' ? 'threads' : type === 'post' ? 'posts' : type === 'reaction' ? 'reactions' : 'profiles') as
    'threads' | 'posts' | 'reactions' | 'profiles'
  set({ [key]: mergeDocs(state[key], [doc]) } as Partial<LiveState>)
}

function start(snapshotAt: number) {
  if (typeof window === 'undefined') return
  const from = Math.max(0, snapshotAt - OVERLAP_MS)
  if (since && since <= from) return
  since = from
  generation++
  cursors.clear()
  void refreshLive()
  if (!timer) {
    timer = setInterval(() => { if (document.visibilityState === 'visible') void refreshLive() }, POLL_MS)
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void refreshLive() })
  }
}

export function useLive(snapshotAt: number): LiveState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      start(snapshotAt)
      return () => listeners.delete(cb)
    },
    () => state,
    () => EMPTY,
  )
}
