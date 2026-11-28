'use client'

/**
 * Unread tracking, kept in this browser only. A thread is unread when it has activity after both
 * the visitor's first visit and the last time they viewed it; a forum when its last post is newer
 * than both the first visit and the last time they opened the forum.
 */
import { useEffect, useSyncExternalStore } from 'react'

const KEY = 'dforum:seen'
const MAX = 800

interface Seen { since: number; threads: Record<string, number>; forums: Record<string, number> }

const listeners = new Set<() => void>()
let cache: Seen | null = null
const EMPTY: Seen = { since: Number.MAX_SAFE_INTEGER, threads: {}, forums: {} }

function load(): Seen {
  if (cache) return cache
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Seen | null
    if (raw && typeof raw.since === 'number') {
      cache = raw
    } else {
      // Remember the first visit right away, so activity after it shows as unread on the next load.
      cache = { since: Date.now(), threads: {}, forums: {} }
      localStorage.setItem(KEY, JSON.stringify(cache))
    }
  } catch {
    cache = { since: Date.now(), threads: {}, forums: {} }
  }
  return cache
}

function save(next: Seen) {
  const ids = Object.entries(next.threads).sort((a, b) => b[1] - a[1]).slice(0, MAX)
  cache = { ...next, threads: Object.fromEntries(ids) }
  try { localStorage.setItem(KEY, JSON.stringify(cache)) } catch { /* storage blocked */ }
  listeners.forEach((l) => l())
}

export function useSeen(): Seen {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb) }, load, () => EMPTY)
}

export function isUnread(seen: Seen, lastActivity: number, lastViewed: number | undefined): boolean {
  return lastActivity > Math.max(seen.since, lastViewed ?? 0)
}

/** Marks a thread (up to its latest activity) or a forum as viewed now. */
export function useMarkSeen(kind: 'threads' | 'forums', id: string | undefined, at: number | undefined) {
  useEffect(() => {
    if (!id || !at) return
    const cur = load()
    if ((cur[kind][id] ?? 0) >= at) return
    save({ ...cur, [kind]: { ...cur[kind], [id]: at } })
  }, [kind, id, at])
}
