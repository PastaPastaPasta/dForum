'use client'

/**
 * The live layer over the static snapshot: everything that changed on chain since the snapshot,
 * from a handful of global delta queries (byUpdated + moderated). Pages merge it into their
 * snapshot data with the same rules the snapshot used (lib/forum/model.ts).
 */
import { useSyncExternalStore } from 'react'
import type { RawDoc } from '@/lib/forum/types'
import { mergeDocs } from '@/lib/forum/model'
import { queryAll } from './platform'

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

async function delta(type: string, moderated: boolean) {
  const updated = queryAll(type, { where: [['$updatedAt', '>=', since]], orderBy: [['$updatedAt', 'asc']] })
  const mod = moderated
    ? queryAll(type, { where: [['$moderatedAt', '>=', since]], orderBy: [['$moderatedAt', 'asc']] })
    : Promise.resolve({ docs: [], truncated: false })
  const [a, b] = await Promise.all([updated, mod])
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
      set({
        status: 'live',
        threads: mergeDocs(state.threads, threads.docs),
        posts: mergeDocs(state.posts, posts.docs),
        reactions: mergeDocs(state.reactions, reactions.docs),
        profiles: mergeDocs(state.profiles, profiles.docs),
        truncated: threads.truncated || posts.truncated || reactions.truncated || profiles.truncated,
        updatedAt: Date.now(),
      })
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
