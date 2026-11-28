'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import type { ThreadFile } from '@/lib/forum/types'
import { isHidden, isRetracted, str } from '@/lib/forum/model'
import { useLive } from '@/lib/live/overlay'
import { useWatches } from '@/lib/watch'

export function Watched({ snapshotAt }: { snapshotAt: number }) {
  const watches = useWatches()
  const live = useLive(snapshotAt)
  // Posts in the static copy of each thread; 0 when the thread is newer than the snapshot.
  const [counts, setCounts] = useState<Record<string, number>>({})
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
  const fresh = (id: string) => live.posts.filter((p) => str(p, 'threadId') === id && p.createdAt > snapshotAt && !isHidden(p) && !isRetracted(p)).length
  const list = ids.map((id) => ({ id, ...watches[id], total: counts[id] === undefined ? watches[id].seen : counts[id] + fresh(id) })).sort((a, b) => (b.total - b.seen) - (a.total - a.seen) || b.at - a.at)
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Watched threads</h1>
      <p className="text-sm text-ink-2">Your watch list is kept in this browser only, so it stays private.</p>
      {list.length === 0 ? (
        <p className="panel px-4 py-6 text-center text-ink-2">You aren&apos;t watching any threads. Use Watch on a thread to follow new replies.</p>
      ) : (
        <ul className="panel divide-y divide-rule">
          {list.map((w) => {
            const unread = Math.max(0, w.total - w.seen)
            return (
              <li key={w.id} className="flex items-center gap-3 px-4 py-3">
                <Link href={`/t/${w.id}/`} className={`min-w-0 flex-1 truncate ${unread ? 'font-semibold' : ''} hover:text-dash`}>{w.title}</Link>
                {unread > 0 && <span className="rounded-full bg-dash px-2 text-xs font-semibold text-dash-ink tabnum">{unread} new</span>}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
