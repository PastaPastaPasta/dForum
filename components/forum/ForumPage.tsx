'use client'

import Link from 'next/link'
import { PenSquare, Archive } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ForumView, ThreadFile, ThreadSummary } from '@/lib/forum/types'
import { THREADS_PER_PAGE } from '@/lib/forum/types'
import { sortThreadSummaries, summarizeThread, threadPosts } from '@/lib/forum/model'
import { forumActivity, mergeForumThreads, movedInThreads, toLiveContext, type LiveContextProps } from '@/lib/forum/live-merge'
import { useLive } from '@/lib/live/overlay'
import { useNames } from '@/lib/live/names'
import { useSession } from '@/lib/session'
import { LOGIN_AVAILABLE } from '@/lib/host'
import { useMarkSeen } from '@/lib/seen'
import { Breadcrumbs } from '@/components/ui/Breadcrumbs'
import { Pagination } from '@/components/ui/Pagination'
import { ThreadList } from './ThreadList'
import { LastPostCell } from './ForumIndex'

export function ForumPage({ forum, crumbs, subforums, threads, page, pages, names, ctx }: {
  forum: ForumView
  crumbs: Array<{ href: string; label: string }>
  subforums: ForumView[]
  threads: ThreadSummary[]
  page: number
  pages: number
  names: Record<string, string>
  ctx: LiveContextProps
}) {
  const { session } = useSession()
  const live = useLive(ctx.snapshotAt)
  const lc = toLiveContext(ctx)
  // Threads moved here since the snapshot: summarised from their static files and listed live.
  const movedIn = page === 1 ? movedInThreads(live, forum.id, lc).filter((t) => !threads.some((s) => s.id === t.id)) : []
  const movedKey = movedIn.map((t) => t.id).join()
  const [movedFiles, setMovedFiles] = useState<Record<string, ThreadFile>>({})
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    const missing = (movedKey ? movedKey.split(',') : []).filter((id) => !movedFiles[id])
    if (!missing.length) return
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined
    // One retry per round, backing off, for network errors and server-side failures (5xx, 429).
    void Promise.all(missing.map((id) => fetch(`/data/v2/thread/${id}.json`)
      .then(async (r) => {
        if (r.ok) { const f = (await r.json()) as ThreadFile; if (alive) setMovedFiles((m) => ({ ...m, [id]: f })); return true }
        return r.status === 404 // gone from the index: nothing to retry
      })
      .catch(() => false)))
      .then((done) => {
        if (alive && done.some((ok) => !ok) && retry < 6) timer = setTimeout(() => setRetry((n) => n + 1), 5_000 * 2 ** retry)
      })
    return () => { alive = false; clearTimeout(timer) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [movedKey, retry])
  const movedSummaries = movedIn.flatMap((t) => {
    const f = movedFiles[t.id]
    // The file may be newer than this page's snapshot (a deploy mid-session): later posts are counted
    // by the live delta, so keep only what the snapshot covers.
    const posts = f?.posts.filter((p) => p.createdAt <= ctx.snapshotAt)
    // Only threads the snapshot had in another forum: one that was here already (pinned, say) is on
    // its static page.
    // (A file newer than this page's snapshot may already show the move: then it was moderated after
    // the page's snapshot, and still belongs here.)
    if (!f || !posts || (f.forumId === forum.id && !((f.thread.moderatedAt ?? 0) > ctx.snapshotAt))) return []
    return [summarizeThread(t, threadPosts(t, posts, ctx.archive), f.reactions, ctx.archive)]
  })
  const merged = mergeForumThreads([...threads, ...movedSummaries], forum.id, live, lc, page === 1)
  // New threads and bumped ones surface on page 1; later pages keep their static order.
  // Moved-in threads are kept on page 1 even past the cut: no static page of this forum lists them.
  const movedIds = new Set(movedSummaries.map((s) => s.id))
  const sorted = page === 1 ? sortThreadSummaries(merged) : merged
  const cut = Math.max(THREADS_PER_PAGE, threads.length)
  const shown = page === 1 ? [...sorted.slice(0, cut), ...sorted.slice(cut).filter((s) => movedIds.has(s.id))] : merged
  const ids = shown.flatMap((t) => [t.ownerId, t.lastPostAuthorId])
  const nameOf = useNames(names, ids, live.profiles)
  const activity = forumActivity(live, lc)
  // Includes live posts in sub-forums, which the index counts toward this forum's "New posts".
  const latest = Math.max(forum.lastPost?.at ?? 0, ...shown.map((t) => t.lastPostAt),
    ...[forum.id, ...subforums.map((s) => s.id)].map((id) => activity.get(id)?.last?.at ?? 0))
  useMarkSeen('forums', page === 1 ? forum.id : undefined, latest || undefined)
  return (
    <div className="space-y-5">
      <Breadcrumbs items={crumbs} />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{forum.title}</h1>
          {forum.description && <p className="mt-1 max-w-read text-ink-2">{forum.description}</p>}
        </div>
        {forum.archived ? (
          <p className="flex items-center gap-1.5 rounded-md bg-archive-wash px-3 py-1.5 text-sm text-archive"><Archive aria-hidden className="h-4 w-4" />Archived: read only</p>
        ) : (session || LOGIN_AVAILABLE) && (
          <Link prefetch={false} href={session ? `/new/?forum=${forum.slug}` : `/login/?next=${encodeURIComponent(`/new/?forum=${forum.slug}`)}`} className="btn btn-primary">
            <PenSquare aria-hidden className="h-4 w-4" />{session ? 'Post thread' : 'Log in to post'}
          </Link>
        )}
      </div>
      {subforums.length > 0 && (
        <section aria-label="Sub-forums" className="panel divide-y divide-rule">
          {subforums.map((s) => (
            <div key={s.id} className="grid gap-2 px-4 py-3 sm:grid-cols-[1fr_14rem] sm:items-center">
              <div>
                <Link href={`/f/${s.slug}/`} className="font-semibold hover:text-dash">{s.title}</Link>
                {s.description && <p className="text-sm text-ink-2">{s.description}</p>}
                <p className="text-sm text-ink-2 tabnum">{s.threadCount.toLocaleString('en-US')} threads, {s.postCount.toLocaleString('en-US')} messages</p>
              </div>
              {s.lastPost && <LastPostCell last={s.lastPost} nameOf={nameOf} />}
            </div>
          ))}
        </section>
      )}
      <Pagination page={page} pages={pages} href={(n) => (n === 1 ? `/f/${forum.slug}/` : `/f/${forum.slug}/page/${n}/`)} label="Thread pages, top" />
      <ThreadList threads={shown} nameOf={nameOf} emptyText={forum.archived ? 'This archived forum has no threads.' : 'No threads yet. Start the first one.'} label={`Threads in ${forum.title}`} />
      <Pagination page={page} pages={pages} href={(n) => (n === 1 ? `/f/${forum.slug}/` : `/f/${forum.slug}/page/${n}/`)} label="Thread pages, bottom" />
    </div>
  )
}
