'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Users, Lock, Pencil, AlertTriangle, Loader2 } from 'lucide-react'
import { Navbar } from '@/components/Navbar'
import { Footer } from '@/components/Footer'
import { query } from '@/lib/services/document-service'
import { loadSnapshot, type SnapshotThread } from '@/lib/services/snapshot-service'
import { useSession } from '@/lib/session'
import { useLive } from '@/components/LiveFeed'
import { useProfileNames } from '@/lib/use-profiles'
import { formatRelativeTime, isModerated } from '@/lib/utils'
import { ThreadRow } from '@/components/ThreadRow'

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
  title?: string
  description?: string
  threads: LiveThread[]
}

type LoadResult =
  | { status: 'ok'; forum: LiveForum }
  | { status: 'missing' }
  | { status: 'error' }

export default function ForumClient({ slug }: { slug: string }) {
  return <ForumInner slug={slug} />
}

function ForumInner({ slug }: { slug: string }) {
  const snap = loadSnapshot()
  const { session } = useSession()
  const forum = snap.forums.find((f) => f.slug === slug)

  const { live, loading: liveLoading } = useLive<LoadResult>(() => loadLiveForum(slug), slug)
  const snapThreads = snap.threads.filter((t) => t.forumSlug === slug).map(snapshotThreadToLive)
  const liveThreads = (live?.status === 'ok' ? live.forum.threads : snapThreads).filter((t) => !isModerated(t.modState))
  const knownForum = Boolean(forum) || Boolean(live?.status === 'ok' && live.forum.title)
  const forumTitle = forum?.title ?? (live?.status === 'ok' ? live.forum.title : null) ?? slug
  const forumDesc = forum?.description ?? (live?.status === 'ok' ? live.forum.description : null) ?? ''
  const status = live?.status ?? null
  const threadsKnown = live?.status === 'ok' || snap.threads.length > 0

  const authorIds = liveThreads.map((t) => t.ownerId)
  const profiles = useProfileNames(authorIds)

  if (status === 'error' && !forum && !liveLoading) {
    return (
      <>
        <Navbar />
        <main className="flex-1 flex items-center justify-center px-6">
          <div className="text-center fade-up">
            <AlertTriangle className="w-8 h-8 text-amber-400 mx-auto" aria-hidden="true" />
            <p className="text-sm uppercase tracking-widest text-[#93a1bd] mt-3">Connection error</p>
            <h1 className="text-2xl font-bold mt-2">Couldn&apos;t reach Dash Platform</h1>
            <p className="text-sm text-[#93a1bd] mt-2">The live read failed. The snapshot may still be stale — retry in a moment.</p>
            <button onClick={() => window.location.reload()} className="mt-6 btn-primary px-4 py-2">Retry</button>
          </div>
        </main>
        <Footer />
      </>
    )
  }

  if (status === 'missing' && !forum && !liveLoading) {
    return (
      <>
        <Navbar />
        <main className="flex-1 flex items-center justify-center px-6">
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
      <main className="flex-1">
        <section className="border-b border-[#22304e]">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 fade-up">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <Link href="/" className="text-sm text-[#93a1bd] hover:text-white transition">← All forums</Link>
              {session ? (
                <Link href={`/new?forum=${encodeURIComponent(forum?.id ?? '')}`} className="btn-primary px-3 py-2 text-sm font-medium">
                  <Pencil className="w-4 h-4" aria-hidden="true" /> New thread
                </Link>
              ) : null}
            </div>
            <h1 className="mt-2 text-2xl sm:text-3xl font-bold tracking-tight">{forumTitle}</h1>
            <p className="mt-2 text-[#93a1bd] max-w-2xl">{forumDesc || 'Discussions in this forum.'}</p>
            <div className="mt-4 flex items-center gap-4 text-sm text-[#93a1bd]">
              <span>{liveThreads.length} thread{liveThreads.length === 1 ? '' : 's'}</span>
              <span>·</span>
              <span className={session ? 'text-emerald-400' : 'text-amber-400'}>
                {session ? 'Open' : <Link href="/login" className="hover:underline">Login to post</Link>}
              </span>
            </div>
          </div>
        </section>

        <section className="max-w-6xl mx-auto px-4 sm:px-6 mt-6">
          {liveThreads.length === 0 && liveLoading ? (
            <LoadingSkeleton />
          ) : liveThreads.length === 0 ? (
            <EmptyForum slug={slug} session={session} />
          ) : (
            <div className="space-y-3">
              {liveThreads.map((t) => (
                <ThreadRow key={t.id} thread={{ ...t, forumSlug: forum?.slug ?? slug }} nameOf={(id) => profiles[id] ?? id.slice(0, 12)} />
              ))}
            </div>
          )}
        </section>
      </main>
      <Footer />
    </>
  )
}

function EmptyForum({ slug, session }: { slug: string; session: { identityId: string } | null }) {
  return (
    <div className="rounded-xl border border-dashed border-[#22304e] bg-[#111a2e]/50 p-8 text-center fade-up">
      <Users className="w-8 h-8 text-[#93a1bd] mx-auto" aria-hidden="true" />
      <p className="mt-3 text-[#93a1bd]">No threads in this forum yet.</p>
      {session ? (
        <Link href={`/new?forum=${encodeURIComponent(slug)}`} className="mt-3 btn-primary inline-flex items-center gap-2 px-4 py-2 text-sm font-medium">
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
    const threads = await query('thread', {
      where: [['forumId', '==', fdoc.id]],
      orderBy: [['$createdAt', 'desc']],
      limit: 50,
    })
    return {
      status: 'ok',
      forum: {
        title: (fdoc.properties.title as string) ?? undefined,
        description: (fdoc.properties.description as string) ?? undefined,
        threads: threads.map((t) => ({
          id: t.id,
          title: (t.properties.title as string) ?? '',
          tags: Array.isArray(t.properties.tags) ? (t.properties.tags as string[]) : [],
          sticky: Boolean(t.properties.sticky),
          lockedAt: (t.properties.lockedAt as number | null) ?? null,
          modState: (t.properties.modState as number | null) ?? null,
          ownerId: t.ownerId || null,
          createdAt: t.createdAt,
        })),
      },
    }
  } catch {
    return { status: 'error' }
  }
}
