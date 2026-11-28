'use client'

/** Watched threads live in this browser only: an on-chain watch list would be public. */
import { useCallback, useSyncExternalStore } from 'react'

export interface Watch { title: string; seen: number; at: number }
type Watches = Record<string, Watch>

const KEY = 'dforum:watched'
const listeners = new Set<() => void>()
let cache: Watches | null = null

function load(): Watches {
  if (cache) return cache
  try { cache = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Watches } catch { cache = {} }
  return cache
}
function save(next: Watches) {
  cache = next
  try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* storage blocked */ }
  listeners.forEach((l) => l())
}

const EMPTY: Watches = {}

export function unwatch(threadId: string) {
  const next = { ...load() }
  delete next[threadId]
  save(next)
}
export function useWatches(): Watches {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb) }, load, () => EMPTY)
}

export function useWatch(threadId: string, title: string, postCount: number) {
  const all = useWatches()
  const watching = !!all[threadId]
  const toggle = useCallback(() => {
    const next = { ...load() }
    if (next[threadId]) delete next[threadId]
    else next[threadId] = { title, seen: postCount, at: Date.now() }
    save(next)
  }, [threadId, title, postCount])
  const markSeen = useCallback(() => {
    const cur = load()[threadId]
    if (cur && cur.seen !== postCount) save({ ...load(), [threadId]: { ...cur, seen: Math.max(cur.seen, postCount), title } })
  }, [threadId, postCount, title])
  return { watching, toggle, markSeen }
}
