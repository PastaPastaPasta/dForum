'use client'

/**
 * 404 page and SPA fallback. Threads, forums and members newer than the static index have no
 * prerendered page; GitHub Pages serves 404.html for them, and this renders them live.
 */
import Link from 'next/link'
import { useEffect, useState } from 'react'
import type { CategoryView, ForumView } from '@/lib/forum/types'
import { ThreadPage } from '@/components/thread/ThreadPage'
import { ProfilePage } from '@/components/forum/ProfilePage'

type Route = { kind: 'thread' | 'profile'; id: string } | { kind: 'none' } | null

const ID = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/

export function LiveFallback({ snapshotAt, archive, sourceUrl, forums }: {
  snapshotAt: number
  archive?: string
  sourceUrl?: string
  forums: ForumView[]
  categories: CategoryView[]
}) {
  const [route, setRoute] = useState<Route>(null)
  useEffect(() => {
    const parts = location.pathname.split('/').filter(Boolean)
    if (parts[0] === 't' && ID.test(parts[1] ?? '')) setRoute({ kind: 'thread', id: parts[1] })
    else if (parts[0] === 'u' && ID.test(parts[1] ?? '')) setRoute({ kind: 'profile', id: parts[1] })
    else setRoute({ kind: 'none' })
  }, [])

  if (route === null) return <p role="status" className="py-16 text-center text-ink-2">Loading…</p>
  if (route.kind === 'thread') {
    return (
      <ThreadPage threadId={route.id} thread={null} crumbs={[{ href: '/', label: 'Forums' }]} forumArchived={false} posts={[]} firstNumber={1}
        page={1} pages={1} postIndex={[]} reactions={{}} members={{}} roles={{}} snapshotAt={snapshotAt} archive={archive} sourceUrl={sourceUrl} />
    )
  }
  if (route.kind === 'profile') {
    return <ProfilePage id={route.id} file={null} snapshotAt={snapshotAt} forumTitles={Object.fromEntries(forums.map((f) => [f.id, f.title]))} />
  }
  return (
    <div className="panel mx-auto max-w-md p-8 text-center">
      <h1 className="text-xl font-semibold">Page not found</h1>
      <p className="mt-2 text-ink-2">The link may be broken, or the page was removed.</p>
      <div className="mt-4 flex justify-center gap-2">
        <Link href="/" className="btn btn-primary">Go to the forums</Link>
        <Link href="/search/" className="btn btn-quiet">Search</Link>
      </div>
    </div>
  )
}
