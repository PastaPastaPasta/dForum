'use client'

/**
 * The live layer over the static snapshot: everything that changed on chain since the snapshot,
 * from a handful of global delta queries (byUpdated + moderated). Pages merge it into their
 * snapshot data with the same rules the snapshot used (lib/forum/model.ts).
 */
import { useSyncExternalStore } from 'react'
import type { RawDoc } from '@/lib/forum/types'
import { mergeDocs, str } from '@/lib/forum/model'
import { queryPage } from './platform'

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

/** A thread's posts from the first up to its owner's first post (the opening post). The cutoff is that
 * post's createdAt; Infinity when the thread ended first (all posts loaded, no opening post); the last
 * loaded post's when the cap ran out first (the opening post is then out of reach: fails closed). */
async function loadHead(thread: RawDoc, stop: { aborted: boolean }): Promise<{ docs: RawDoc[]; cutoff: number }> {
  const docs: RawDoc[] = []
  let startAfter: string | undefined
  // Imported threads order by original date, not chain order, so their opening post can be any of
  // the archivist's posts: load the whole thread (up to the cap).
  const archive = thread.p.origId !== undefined
  for (let i = 0; i < HEAD_MAX_PAGES; i++) {
    if (stop.aborted) throw new Error('aborted')
    // The opening post is nearly always first: a small first page, then full pages.
    const limit = i === 0 ? HEAD_FIRST_PAGE : HEAD_PAGE
    const page = await queryPage('post', { where: [['threadId', '==', thread.id]], orderBy: [['$createdAt', 'asc']], limit, startAfter })
    docs.push(...page.docs)
    const opening = archive ? undefined : page.docs.find((p) => p.ownerId === thread.ownerId)
    if (opening) return { docs, cutoff: opening.createdAt }
    if (!page.full || !page.last) return { docs, cutoff: Infinity }
    startAfter = page.last
  }
  // Cap reached. An imported thread (the archivist owns every post) falls back to its chain-first post,
  // which is its opening post unless history was imported out of order. Otherwise the opening post is
  // out of reach: no evidence either way (NaN): new replies wait, the snapshot's listing stands.
  if (archive && docs[0]?.ownerId === thread.ownerId) return { docs, cutoff: docs[0].createdAt }
  return { docs, cutoff: NaN }
}
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
  let truncated = true
  for (let i = 0; i < MAX_PAGES; i++) {
    const page = await queryPage(type, { where: [[field, '>=', from]], orderBy: [[field, 'asc']], startAfter: tieAfter })
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
  // Returned, not stored: cursors move only once the whole poll has been applied.
  return { docs, truncated, next: [[key, next]] as Array<[string, Cursor]> }
}

type Scan = Awaited<ReturnType<typeof scan>>
const EMPTY_SCAN: Scan = { docs: [], truncated: false, next: [] }

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
  return { docs: [...a.docs, ...b.docs], truncated: a.truncated || b.truncated, next: [...a.next, ...b.next] }
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
      for (const t of threads.docs) if ((t.moderatedAt ?? 0) > since && !headsFetched.has(t.id)) headsPending.add(t.id)
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
      if (state.truncated || (headsPending.size && cutoffs.size)) setTimeout(() => void refreshLive(), 1500)
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
