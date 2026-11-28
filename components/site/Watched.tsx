'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import type { ThreadFile } from '@/lib/forum/types'
import { newPosts } from '@/lib/forum/live-merge'
import { useLive } from '@/lib/live/overlay'
import { unwatch, useWatches } from '@/lib/watch'
import { POSTS_PER_PAGE } from '@/lib/forum/types'

export function Watched({ snapshotAt }: { snapshotAt: number }) {
  const watches = useWatches()
  const live = useLive(snapshotAt)
  // Posts in the static copy of each thread; 0 when the thread is newer than the snapshot.
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [announce, setAnnounce] = useState('')
  const heading = useRef<HTMLHeadingElement>(null)
  const ids = Object.keys(watches)
  useEffect(() => {
    let alive = true
    for (const id of ids) {
      fetch(`/data/v2/thread/${id}.json`).then((r) => (r.ok ? (r.json() as Promise<ThreadFile>) : r.status === 404 ? { posts: [] } as unknown as ThreadFile : null))
        .then((t) => { if (alive && t) setCounts((c) => ({ ...c, [id]: t.posts.length })) }).catch(() => undefined)
    }
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids.join()])
  // New replies the forum would show (listable threads only), per thread.
  const freshCounts = new Map<string, number>()
  for (const { thread } of newPosts(live, { snapshotAt })) freshCounts.set(thread.id, (freshCounts.get(thread.id) ?? 0) + 1)
  const fresh = (id: string) => freshCounts.get(id) ?? 0
  // The page holding the first new reply, capped at the last page the static index built (newer
  // replies show on that last page live).
  const firstNewPage = (id: string, seen: number, unread: number) => {
    if (!unread) return 1
    const built = Math.max(1, Math.ceil((counts[id] ?? 0) / POSTS_PER_PAGE))
    return Math.min(Math.floor(seen / POSTS_PER_PAGE) + 1, built)
  }
  const list = ids.map((id) => ({ id, ...watches[id], total: counts[id] === undefined ? watches[id].seen : counts[id] + fresh(id) })).sort((a, b) => (b.total - b.seen) - (a.total - a.seen) || b.at - a.at)
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 ref={heading} tabIndex={-1} className="text-2xl font-semibold tracking-tight">Watched threads</h1>
      <p role="status" className="sr-only">{announce}</p>
      <p className="text-sm text-ink-2">Your watch list is kept in this browser only, so it stays private.</p>
      {list.length === 0 ? (
        <p className="panel px-4 py-6 text-center text-ink-2">You aren&apos;t watching any threads. Use Watch on a thread to follow new replies.</p>
      ) : (
        <ul className="panel divide-y divide-rule">
          {list.map((w) => {
            const unread = Math.max(0, w.total - w.seen)
            return (
              <li key={w.id} className="flex items-center gap-3 px-4 py-2">
                {/* Unread threads open on the page holding the first new reply. */}
                <Link href={firstNewPage(w.id, w.seen, unread) > 1 ? `/t/${w.id}/page/${firstNewPage(w.id, w.seen, unread)}/` : `/t/${w.id}/`}
                  className={`tap-y min-w-0 flex-1 truncate ${unread ? 'font-semibold' : ''} hover:text-dash`}>{w.title}</Link>
                {unread > 0 && <span className="rounded-full bg-dash px-2 text-xs font-semibold text-dash-ink tabnum">{unread} new</span>}
                <button type="button" className="btn-ghost text-sm" aria-label={`Stop watching ${w.title}`} onClick={(e) => {
                  // Keep keyboard focus in the list: the next row's Unwatch, else the heading.
                  const row = e.currentTarget.closest('li')
                  const next = (row?.nextElementSibling ?? row?.previousElementSibling)?.querySelector('button')
                  unwatch(w.id)
                  setAnnounce(`Stopped watching ${w.title}`)
                  requestAnimationFrame(() => (next ?? heading.current)?.focus())
                }}>Unwatch</button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
