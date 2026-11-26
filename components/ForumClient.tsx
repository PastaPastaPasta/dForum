'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Users, Pencil, AlertTriangle, Loader2, RefreshCw } from 'lucide-react'
import { Navbar } from '@/components/Navbar'
import { Footer } from '@/components/Footer'
import { query, queryRaw } from '@/lib/services/document-service'
import { getRoster } from '@/lib/services/moderation-service'
import { filterListable } from '@/lib/services/orphan'
import type { Snapshot, SnapshotThread } from '@/lib/services/snapshot-server'
import { useSession } from '@/lib/session'
import { useLive } from '@/components/LiveFeed'
import { useProfileNames } from '@/lib/use-profiles'
import { isModerated } from '@/lib/utils'
import { ThreadRow } from '@/components/ThreadRow'
import { LiveUnavailable } from '@/components/LiveUnavailable'

interface LiveThread {
  id: string
  title: string
  tags: string[]
  sticky: boolean
  lockedAt: number | null
  modState: number | null
  ownerId: string | null
  createdAt: number
}

interface LiveForum {
  id: string | null
  title?: string
  description?: string
  threads: LiveThread[]
  /** Exclusive $id cursor of the last doc in the recent-page — null when the recent window is complete. */
  cursor: string | null
}

/** Sticky-first, newest-first ordering — mirrors the forum contract's
 * byForumSticky index intent. */
function byStickyThenRecent(a: LiveThread, b: LiveThread): number {
  if (a.sticky !== b.sticky) return a.sticky ? -1 : 1
  return b.createdAt - a.createdAt
}

type LoadResult =
  | { status: 'ok'; forum: LiveForum }
  | { status: 'missing' }
  | { status: 'error' }

export default function ForumClient({ slug, snapshot }: { slug: string; snapshot: Snapshot | null }) {
  const snap = snapshot
  const { session } = useSession()
  const forum = snap?.forums.find((f) => f.slug === slug) ?? null

  const { live, loading: liveLoading } = useLive<LoadResult>(() => loadLiveForum(slug), slug)
  const [moreThreads, setMoreThreads] = useState<LiveThread[]>([])
  const [moreCursor, setMoreCursor] = useState<string | null>(null)
  const [moreLoading, setMoreLoading] = useState(false)
  const [moreError, setMoreError] = useState(false)

  // Arm load-more once the live window comes back: anything past the recent
  // page is unreachable without a button.
  useEffect(() => {
    if (live?.status !== 'ok') return
    setMoreCursor(live.forum.cursor)
  }, [live])

  async function loadMore() {
    const forumId = live?.status === 'ok' ? live.forum.id : forum?.id ?? null
    if (!forumId || !moreCursor || moreLoading) return
    setMoreLoading(true)
    setMoreError(false)
    try {
      const { docs, rawCount, lastId } = await queryRaw('thread', {
        where: [['forumId', '==', forumId]],
        orderBy: [['$createdAt', 'desc']],
        limit: 25,
        startAfter: moreCursor,
      })
      const initial = live?.status === 'ok' ? live.forum.threads : []
      const seenIds = new Set([...initial, ...moreThreads].map((t) => t.id))
      const mapped = docs.map(docToThread).filter((t) => !seenIds.has(t.id))
      const listed = await filterListable(mapped, 4)
      setMoreThreads((prev) => [...prev, ...listed])
      setMoreCursor(rawCount === 25 && lastId ? lastId : null)
    } catch {
      setMoreError(true)
    } finally {
      setMoreLoading(false)
    }
  }

  const snapThreads = (snap?.threads ?? []).filter((t) => t.forumSlug === slug).map(snapshotThreadToLive)
  // Dedupe the merged list — the live list and the snapshot fallback are
  // different surfaces; a thread can appear in both after a connection flip.
  const seenIds = new Set<string>()
  const rawThreads: LiveThread[] = []
  for (const t of (live?.status === 'ok' ? [...live.forum.threads, ...moreThreads] : [...snapThreads, ...moreThreads]) as LiveThread[]) {
    if (seenIds.has(t.id)) continue
    seenIds.add(t.id)
    rawThreads.push(t)
  }
  const listed = rawThreads.filter((t) => !isModerated(t.modState)).sort(byStickyThenRecent)
  const forumTitle = forum?.title ?? (live?.status === 'ok' ? live.forum.title : null) ?? slug
  const forumDesc = forum?.description ?? (live?.status === 'ok' ? live.forum.description : null) ?? ''
  const status = live?.status ?? null
  const showStaleNote = status === 'error' && forum != null && !liveLoading
  const showHardError = status === 'error' && !forum && !liveLoading

  const authorIds = listed.map((t) => t.ownerId)
  const profiles = useProfileNames(authorIds)
  const snapProfiles = snapshot?.profiles ?? {}
  const nameOf = (id: string): string => snapProfiles[id] ?? profiles[id] ?? id.slice(0, 12)

  // Live results are already orphan-filtered (see loadLiveForum); the
  // snapshot fallback is orphan-filtered by the snapshot itself.
  
  if (showHardError) {
    return (
      <>
        <Navbar />
        <main id="main" tabIndex={-1} className="flex-1 flex items-center justify-center px-6">
          <div className="text-center fade-up">
            <AlertTriangle className="w-8 h-8 text-amber-400 mx-auto" aria-hidden="true" />
            <p className="text-sm uppercase tracking-widest text-[#93a1bd] mt-3">Connection error</p>
            <h1 className="text-2xl font-bold mt-2">Couldn&apos;t reach Dash Platform</h1>
            <p className="text-sm text-[#93a1bd] mt-2">The live read failed and the snapshot had no forum to show.</p>
            <button onClick={() => window.location.reload()} className="mt-6 btn-primary px-4 py-2">Retry</button>
          </div>
        </main>
        <Footer />
      </>
    )
  }

  if (status === 'missing' && !liveLoading) {
    return (
      <>
        <Navbar />
        <main id="main" tabIndex={-1} className="flex-1 flex items-center justify-center px-6">
          <div className="text-center fade-up">
            <p className="text-sm uppercase tracking-widest text-[#93a1bd]">Not found</p>
            <h1 className="text-2xl font-bold mt-2">Forum not found</h1>
            <Link href="/" className="mt-6 btn-primary px-4 py-2">Back to home</Link>
          </div>
        </main>
        <Footer />
      </>
    )
  }

  return (
    <>
      <Navbar />
      <main id="main" tabIndex={-1} className="flex-1">
        <section className="border-b border-[#22304e]">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 fade-up">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <Link href="/" className="text-sm text-[#93a1bd] hover:text-white transition">← All forums</Link>
              {session ? (
                <Link href={`/new?forum=${encodeURIComponent(forum?.id ?? slug)}`} className="btn-primary px-3 py-2 text-sm font-medium">
                  <Pencil className="w-4 h-4" aria-hidden="true" /> New thread
                </Link>
              ) : null}
            </div>
            <h1 className="mt-2 text-2xl sm:text-3xl font-bold tracking-tight">{forumTitle}</h1>
            <p className="mt-2 text-[#93a1bd] max-w-2xl">{forumDesc || 'Discussions in this forum.'}</p>
            {showStaleNote && <LiveUnavailable className="mt-4" />}
            <div className="mt-4 flex items-center gap-4 text-sm text-[#93a1bd]">
              <span>{listed.length}{moreCursor != null ? '+' : ''} thread{listed.length === 1 ? '' : 's'}</span>
              {!session && <Link href="/login" className="text-[#4db3ff] hover:underline">Login to post</Link>}
            </div>
          </div>
        </section>

        <section className="max-w-6xl mx-auto px-4 sm:px-6 mt-6">
          {listed.length === 0 && liveLoading ? (
            <>
              <span className="sr-only" role="status">Loading threads…</span>
              <LoadingSkeleton />
            </>
          ) : listed.length === 0 ? (
            <EmptyForum forum={forum} slug={slug} session={session} />
          ) : (
            <div className="space-y-3">
              {listed.map((t) => (
                <ThreadRow key={t.id} thread={{ ...t, forumSlug: forum?.slug ?? slug }} nameOf={nameOf} />
              ))}
            </div>
          )}
          {moreCursor != null && (
            <div className="mt-4">
              {moreError && <p className="text-sm text-red-400">Couldn&apos;t load older threads. {moreCursor && <button onClick={() => loadMore()} className="text-[#4db3ff] hover:underline">Retry</button>}</p>}
              {!moreError && (
                <button
                  onClick={() => loadMore()}
                  disabled={moreLoading}
                  className="btn-secondary inline-flex items-center gap-2 rounded-lg border border-[#22304e] px-3 py-2 text-sm text-[#93a1bd] hover:text-white hover:border-[#008CE7] transition disabled:opacity-50"
                >
                  {moreLoading ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="w-4 h-4" aria-hidden="true" />}
                  {moreLoading ? 'Loading…' : 'Load older threads'}
                </button>
              )}
            </div>
          )}
        </section>
      </main>
      <Footer />
    </>
  )
}

function EmptyForum({ forum, slug, session }: { forum: { id: string } | null; slug: string; session: { identityId: string } | null }) {
  return (
    <div className="rounded-xl border border-dashed border-[#22304e] bg-[#111a2e]/50 p-8 text-center fade-up">
      <Users className="w-8 h-8 text-[#93a1bd] mx-auto" aria-hidden="true" />
      <p className="mt-3 text-[#93a1bd]">No threads in this forum yet.</p>
      {session ? (
        <Link href={`/new?forum=${encodeURIComponent(forum?.id ?? slug)}`} className="mt-3 btn-primary inline-flex items-center gap-2 px-4 py-2 text-sm font-medium">
          <Pencil className="w-4 h-4" aria-hidden="true" /> Start the first one
        </Link>
      ) : (
        <Link href="/login" className="mt-3 inline-flex items-center gap-2 text-sm text-[#4db3ff] hover:underline">Login to start the first one</Link>
      )}
    </div>
  )
}

function LoadingSkeleton() {
  return (
    <div className="space-y-3" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-16 rounded-xl border border-[#22304e] bg-[#111a2e] animate-pulse" />
      ))}
    </div>
  )
}

function snapshotThreadToLive(t: SnapshotThread): LiveThread {
  return {
    id: t.id,
    title: t.title,
    tags: t.tags,
    sticky: t.sticky,
    lockedAt: t.lockedAt,
    modState: t.modState,
    ownerId: t.ownerId,
    createdAt: t.createdAt,
  }
}

async function loadLiveForum(slug: string): Promise<LoadResult> {
  try {
    const forums = await query('forum', { where: [['slug', '==', slug]], limit: 1 })
    const fdoc = forums[0]
    if (!fdoc) return { status: 'missing' }
    // The pinned query only exists in moderated contracts — the `none`
    // contract has no sticky property at all. If the roster cannot be read,
    // fail safe: skip the pinned query (recent-first still renders).
    let stickyQueryable = false
    try {
      const roster = await getRoster()
      stickyQueryable = roster?.mode === 'team' || roster?.mode === 'network'
    } catch {
      stickyQueryable = false
    }
    const [recent, pinned] = await Promise.all([
      query('thread', {
        where: [['forumId', '==', fdoc.id]],
        orderBy: [['$createdAt', 'desc']],
        limit: 25,
      }),
      // byForumSticky serves forumId+sticky equality only — no $createdAt
      // orderBy (it is not in the index; the chain rejects it). Sort
      // client-side after merging.
      stickyQueryable
        ? query('thread', {
            where: [['forumId', '==', fdoc.id], ['sticky', '==', true]],
            limit: 10,
          })
        : Promise.resolve([]),
    ])
    const byId = new Map<string, LiveThread>()
    for (const t of recent) byId.set(t.id, docToThread(t))
    for (const t of pinned) byId.set(t.id, docToThread(t)) // pinned wins so a pinned thread can't silently drop off the page
    // Orphan rule — drop threads with no visible opening post (bounded to
    // the threads we'd list; one ascending query per thread).
    const threads = await filterListable([...byId.values()], 4)
    return {
      status: 'ok',
      forum: {
        id: fdoc.id,
        title: (fdoc.properties.title as string) ?? undefined,
        description: (fdoc.properties.description as string) ?? undefined,
        threads,
        cursor: recent.length === 25 ? recent[recent.length - 1].id : null,
      },
    }
  } catch {
    return { status: 'error' }
  }
}

function docToThread(t: { id: string; title?: string; ownerId?: string | null; createdAt?: number; properties?: Record<string, unknown> }): LiveThread {
  const p = t.properties ?? {}
  return {
    id: t.id,
    title: (p.title as string) ?? '',
    tags: Array.isArray(p.tags) ? (p.tags as string[]) : [],
    sticky: Boolean(p.sticky),
    lockedAt: (p.lockedAt as number | null) ?? null,
    modState: (p.modState as number | null) ?? null,
    ownerId: t.ownerId ?? null,
    createdAt: t.createdAt ?? 0,
  }
}
