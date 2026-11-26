'use client'

import { Suspense } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Users, Lock } from 'lucide-react'
import { Navbar } from '@/components/Navbar'
import { Footer } from '@/components/Footer'
import { Avatar } from '@/components/Avatar'
import { query } from '@/lib/services/document-service'
import { loadSnapshot, type SnapshotThread } from '@/lib/services/snapshot-service'
import { useSession } from '@/lib/session'
import { useLive } from '@/components/LiveFeed'
import { formatRelativeTime } from '@/lib/utils'

interface LiveThread {
  id: string
  title: string
  tags: string[]
  sticky: boolean
  lockedAt: number | null
  ownerId: string | null
  createdAt: number
}

export default function ForumPage() {
  return (
    <Suspense fallback={<main className="flex-1" />}>
      <ForumInner />
    </Suspense>
  )
}

function ForumInner() {
  const params = useSearchParams()
  const slug = params.get('slug') ?? ''
  const snap = loadSnapshot()
  const { session } = useSession()
  const forum = snap.forums.find((f) => f.slug === slug)

  const { live } = useLive(() => (slug ? loadLiveForum(slug) : Promise.resolve(null)))
  const liveThreads: LiveThread[] = live?.threads ?? snap.threads.filter((t) => t.forumSlug === slug).map(snapshotThreadToLive)
  const forumTitle = forum?.title ?? live?.title ?? slug
  const forumDesc = forum?.description ?? live?.description ?? ''

  return (
    <>
      <Navbar />
      <main className="flex-1">
        <section className="border-b border-[#22304e]">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 fade-up">
            <Link href="/" className="text-sm text-[#93a1bd] hover:text-white transition">← All forums</Link>
            <h1 className="mt-2 text-2xl sm:text-3xl font-bold tracking-tight">{forumTitle}</h1>
            <p className="mt-2 text-[#93a1bd] max-w-2xl">{forumDesc || 'Discussions in this forum.'}</p>
            <div className="mt-4 flex items-center gap-4 text-sm text-[#93a1bd]">
              <span>{liveThreads.length} threads</span>
              <span>·</span>
              <span className="text-emerald-400">{session ? 'Open' : 'Login to post'}</span>
            </div>
          </div>
        </section>

        <section className="max-w-5xl mx-auto px-4 sm:px-6 mt-6">
          {liveThreads.length === 0 ? (
            <EmptyForum />
          ) : (
            <div className="divide-y divide-[#22304e] rounded-xl border border-[#22304e] bg-[#111a2e] overflow-hidden">
              {liveThreads.map((t) => (
                <Link
                  key={t.id}
                  href={`/t?id=${t.id}`}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-[#18233c] transition"
                >
                  <Avatar name={t.ownerId ?? 'dForum'} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      {t.sticky && <span className="text-[10px] uppercase tracking-wider text-[#4db3ff] border border-[#4db3ff]/40 rounded px-1.5 py-0.5 shrink-0">pinned</span>}
                      {t.lockedAt != null && <Lock className="w-3 h-3 text-amber-400 shrink-0" />}
                      <p className="font-medium truncate">{t.title}</p>
                    </div>
                    <p className="text-xs text-[#93a1bd] mt-0.5">
                      {formatRelativeTime(t.createdAt)}
                      {t.tags?.length ? ` · ${t.tags.slice(0, 3).map((s) => `#${s}`).join(' ')}` : ''}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>
      </main>
      <Footer />
    </>
  )
}

function snapshotThreadToLive(t: SnapshotThread): LiveThread {
  return {
    id: t.id,
    title: t.title,
    tags: t.tags,
    sticky: t.sticky,
    lockedAt: t.lockedAt,
    ownerId: t.ownerId,
    createdAt: t.createdAt,
  }
}

function EmptyForum() {
  return (
    <div className="rounded-xl border border-dashed border-[#22304e] bg-[#111a2e]/50 p-8 text-center fade-up">
      <Users className="w-8 h-8 text-[#93a1bd] mx-auto" />
      <p className="mt-3 text-[#93a1bd]">No threads in this forum yet.</p>
      <p className="text-xs text-[#93a1bd] mt-1">Start the first one.</p>
    </div>
  )
}

async function loadLiveForum(slug: string): Promise<{
  title?: string
  description?: string
  threads: LiveThread[]
} | null> {
  try {
    const forums = await query('forum', { where: [['slug', '==', slug]], limit: 1 })
    const fdoc = forums[0]
    if (!fdoc) return null
    const threads = await query('thread', {
      where: [['forumId', '==', fdoc.id]],
      orderBy: [['$createdAt', 'desc']],
      limit: 50,
    })
    return {
      title: (fdoc.properties.title as string) ?? undefined,
      description: (fdoc.properties.description as string) ?? undefined,
      threads: threads.map((t) => ({
        id: t.id,
        title: (t.properties.title as string) ?? '',
        tags: Array.isArray(t.properties.tags) ? (t.properties.tags as string[]) : [],
        sticky: Boolean(t.properties.sticky),
        lockedAt: (t.properties.lockedAt as number | null) ?? null,
        ownerId: t.ownerId || null,
        createdAt: t.createdAt,
      })),
    }
  } catch {
    return null
  }
}
