'use client'

import Link from 'next/link'
import { MessageSquare, MessagesSquare, Heart, TrendingUp, FolderOpen, Loader2, Pencil } from 'lucide-react'
import { Navbar } from '@/components/Navbar'
import { Footer } from '@/components/Footer'
import { loadSnapshot, type Snapshot, type SnapshotThread } from '@/lib/services/snapshot-service'
import { useSession } from '@/lib/session'
import { query, count } from '@/lib/services/document-service'
import { useLive } from '@/components/LiveFeed'
import { ThreadRow } from '@/components/ThreadRow'

export default function HomePage() {
  const snap = loadSnapshot()
  const { session } = useSession()
  // Live fill — re-queries the platform after hydration
  const { live, loading } = useLive(() => loadLive(), 'home')
  const byStickyThenRecent = (a: SnapshotThread, b: SnapshotThread) =>
    a.sticky !== b.sticky ? (a.sticky ? -1 : 1) : b.createdAt - a.createdAt
  const threads = (live?.threads ?? snap.threads).filter((t) => t.modState == null).sort(byStickyThenRecent)
  const forumCategorySlug = new Map(snap.categories.map((c) => [c.id, c.slug ?? null]))
  const forums = (live?.forums ?? snap.forums)
    .filter((f) => !f.archived)
    .map((f) => ({ ...f, categorySlug: f.categorySlug ?? forumCategorySlug.get(f.categoryId ?? '') ?? null }))
    .sort((a, b) => a.sort - b.sort || a.title.localeCompare(b.title))

  const counts = {
    categories: live?.counts?.categories ?? snap.counts.categories,
    forums: live?.counts?.forums ?? snap.counts.forums,
    threads: live?.counts?.threads ?? snap.counts.threads,
    posts: live?.counts?.posts ?? snap.counts.posts,
    reactions: live?.counts?.reactions ?? snap.counts.reactions,
  }

  return (
    <>
      <Navbar />
      <main className="flex-1">
        <Hero counts={counts} session={session} loading={loading} />

        <section className="max-w-6xl mx-auto px-4 sm:px-6 pt-6">
          <SectionHeader title="Latest threads" subtitle="Newest conversations across all forums" />
          <div className="grid gap-3">
            {threads.slice(0, 12).map((t) => (
              <ThreadRow key={t.id} thread={t as Parameters<typeof ThreadRow>[0]['thread']} />
            ))}
            {threads.length === 0 && (
              <div className="text-sm text-[#93a1bd] py-8 text-center">
                {session ? (
                  <Link href="/new" className="text-[#4db3ff] hover:underline">Start the first thread</Link>
                ) : (
                  <>No threads yet. <Link href="/login" className="text-[#4db3ff] hover:underline">Login with Dash</Link> to be the first.</>
                )}
              </div>
            )}
          </div>
        </section>

        <section className="max-w-6xl mx-auto px-4 sm:px-6 mt-12">
          <SectionHeader title="Forums" subtitle="Browse by space" />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {forums.map((f) => (
              <Link
                key={f.id}
                href={`/f/${encodeURIComponent(f.slug ?? f.id)}`}
                className="group rounded-xl border border-[#22304e] bg-[#111a2e] p-4 hover:border-[#008CE7] transition fade-up"
              >
                <p className="font-semibold group-hover:text-[#4db3ff] transition">{f.title}</p>
                <p className="mt-1 text-sm text-[#93a1bd] line-clamp-2">{f.description || 'No description.'}</p>
                <p className="mt-3 text-xs text-[#93a1bd]">{f.categorySlug ? `in ${f.categorySlug}` : ''}</p>
              </Link>
            ))}
            {forums.length === 0 && (
              <p className="text-sm text-[#93a1bd] py-8 text-center sm:col-span-2 lg:col-span-3">No forums yet.</p>
            )}
          </div>
        </section>

        {session && (
          <section className="max-w-6xl mx-auto px-4 sm:px-6 mt-12">
            <NewThreadCta />
          </section>
        )}
      </main>
      <Footer />
    </>
  )
}

function Hero({ counts, session, loading }: { counts: Snapshot['counts']; session: { identityId: string } | null; loading: boolean }) {
  return (
    <section className="border-b border-[#22304e] bg-gradient-to-b from-[#101b31] to-[#0b1220]">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10 sm:py-14">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div className="max-w-xl">
            <p className="inline-flex items-center gap-2 rounded-full border border-[#22304e] bg-[#111a2e] px-3 py-1 text-xs text-[#4db3ff] fade-up">
              {loading ? (
                <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
              ) : (
                <span className="w-2 h-2 rounded-full bg-emerald-400 pulse-slow" />
              )}
              {loading ? 'Loading live data…' : 'Live on Dash Platform'}
            </p>
            <h1 className="mt-4 text-3xl sm:text-4xl font-bold leading-tight tracking-tight">
              A decentralized forum<br />on Dash Platform
            </h1>
            <p className="mt-4 text-[#93a1bd]">
              Centralized ownership, team-based moderation, every message on-chain. Login with Dash — no accounts, no servers.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/search"
              className="inline-flex items-center gap-2 rounded-lg border border-[#22304e] bg-[#111a2e] px-4 py-2.5 font-medium text-sm hover:border-[#008CE7] transition"
            >
              Explore threads
            </Link>
            {session && (
              <Link
                href="/new"
                className="inline-flex items-center gap-2 btn-primary px-4 py-2.5 font-medium"
              >
                <Pencil className="w-4 h-4" aria-hidden="true" /> New thread
              </Link>
            )}
          </div>
        </div>
        <dl className="mt-8 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <Stat icon={<FolderOpen className="w-4 h-4" />} value={counts.categories} label="Categories" />
          <Stat icon={<MessageSquare className="w-4 h-4" />} value={counts.forums} label="Forums" />
          <Stat icon={<TrendingUp className="w-4 h-4" />} value={counts.threads} label="Threads" />
          <Stat icon={<MessagesSquare className="w-4 h-4" />} value={counts.posts} label="Posts" />
          <Stat icon={<Heart className="w-4 h-4" />} value={counts.reactions} label="Reactions" />
        </dl>
      </div>
    </section>
  )
}

function Stat({ icon, value, label }: { icon: React.ReactNode; value: number; label: string }) {
  return (
    <div className="rounded-xl border border-[#22304e] bg-[#111a2e] p-3">
      <dt className="flex items-center gap-2 text-[#4db3ff]">
        {icon}
        <span className="text-xs uppercase tracking-wider text-[#93a1bd]">{label}</span>
      </dt>
      <dd className="mt-1 text-2xl font-bold tabular-nums">{value.toLocaleString()}</dd>
    </div>
  )
}

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-4">
      <h2 className="text-xl font-bold tracking-tight">{title}</h2>
      {subtitle && <p className="text-sm text-[#93a1bd] mt-0.5">{subtitle}</p>}
    </div>
  )
}

function NewThreadCta() {
  return (
    <div className="rounded-xl border border-dashed border-[#22304e] bg-[#111a2e]/50 p-6 text-center">
      <p className="text-[#93a1bd] text-sm">Start the next great conversation on Dash Platform.</p>
      <Link
        href="/new"
        className="mt-3 btn-primary px-4 py-2"
      >
        Start a new thread
      </Link>
    </div>
  )
}

async function loadLive(): Promise<(Snapshot & { forums: Snapshot['forums'] }) | null> {
  try {
    const snap = loadSnapshot()
    const forumById = new Map(snap.forums.map((f) => [f.id, f.slug ?? null]))
    const [threadDocs, forumDocs, threadCount, forumCount, postCount, reactionCount] = await Promise.all([
      query('thread', { orderBy: [['$createdAt', 'desc']], limit: 12 }),
      query('forum', { limit: 50 }),
      count('thread'),
      count('forum'),
      count('post'),
      count('reaction'),
    ])
    const sum = (m: Map<string, bigint>) => {
      let total = 0n
      for (const v of m.values()) total += v
      return Number(total)
    }
    const threads = threadDocs.map((t) => ({
      id: t.id,
      forumId: (t.properties.forumId as string) ?? null,
      forumSlug: forumById.get((t.properties.forumId as string) ?? '') ?? null,
      title: (t.properties.title as string) ?? '',
      tags: Array.isArray(t.properties.tags) ? (t.properties.tags as string[]) : [],
      sticky: Boolean(t.properties.sticky),
      lockedAt: (t.properties.lockedAt as number | null) ?? null,
      modState: (t.properties.modState as number | null) ?? null,
      ownerId: t.ownerId || null,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    }))
    const forums = forumDocs.map((f) => ({
      id: f.id,
      categoryId: (f.properties.categoryId as string) ?? null,
      categorySlug: null,
      slug: (f.properties.slug as string) ?? null,
      title: (f.properties.title as string) ?? '',
      description: (f.properties.description as string) ?? '',
      sort: Number(f.properties.sort ?? 0),
      archived: Boolean(f.properties.archived),
    }))
    return {
      ...snap,
      threads,
      forums,
      counts: {
        ...snap.counts,
        threads: sum(threadCount),
        forums: sum(forumCount),
        posts: sum(postCount),
        reactions: sum(reactionCount),
      },
    }
  } catch {
    return null
  }
}
