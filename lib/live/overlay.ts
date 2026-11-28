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
  updatedAt: number
  truncated: boolean
}

const EMPTY: LiveState = { status: 'idle', threads: [], posts: [], reactions: [], profiles: [], updatedAt: 0, truncated: false }
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
const cursors = new Map<string, number>()
const STEP_OVERLAP_MS = 2 * 60_000
const MAX_PAGES = 10

async function scan(type: string, field: '$updatedAt' | '$moderatedAt') {
  const key = `${type}:${field}`
  let from = Math.max(since, (cursors.get(key) ?? since) - STEP_OVERLAP_MS)
  const docs: RawDoc[] = []
  let tieAfter: string | undefined
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
  const max = docs.reduce((m, d) => Math.max(m, (field === '$moderatedAt' ? d.moderatedAt : d.updatedAt) ?? 0), cursors.get(key) ?? since)
  cursors.set(key, max)
  return { docs, truncated }
}

// Contracts without moderation have no $moderatedAt index; stop asking once that's clear.
let moderationIndexes = true

async function delta(type: string, moderated: boolean) {
  const mod = moderated && moderationIndexes
    ? scan(type, '$moderatedAt').catch((e) => {
        if (/non indexed|not indexed|no index/i.test(String((e as { message?: unknown })?.message ?? e))) moderationIndexes = false
        else throw e
        return { docs: [] as RawDoc[], truncated: false }
      })
    : Promise.resolve({ docs: [] as RawDoc[], truncated: false })
  const [a, b] = await Promise.all([scan(type, '$updatedAt'), mod])
  return { docs: [...a.docs, ...b.docs], truncated: a.truncated || b.truncated }
}

export function refreshLive(): Promise<void> {
  if (!since) return Promise.resolve()
  if (inflight) return inflight
  if (state.status === 'idle') set({ status: 'loading' })
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
      set({
        status: 'live',
        threads: allThreads,
        posts: mergeDocs(state.posts, posts.docs),
        reactions: mergeDocs(state.reactions, reactions.docs),
        profiles: mergeDocs(state.profiles, profiles.docs),
        truncated: threads.truncated || posts.truncated || reactions.truncated || profiles.truncated,
        updatedAt: Date.now(),
      })
      // A capped poll resumes from its cursors right away until it has caught up.
      if (state.truncated) setTimeout(() => void refreshLive(), 1500)
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
