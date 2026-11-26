'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Users, MessageSquare, MessagesSquare, Heart, TrendingUp, Lock } from 'lucide-react'
import { Navbar } from '@/components/Navbar'
import { Footer } from '@/components/Footer'
import { Avatar } from '@/components/Avatar'
import { loadSnapshot, type Snapshot } from '@/lib/services/snapshot-service'
import { useSession } from '@/lib/session'
import { formatRelativeTime, truncate } from '@/lib/utils'
import { query } from '@/lib/services/document-service'
import { useLive } from '@/components/LiveFeed'

export default function HomePage() {
  const snap = loadSnapshot()
  const { session } = useSession()
  // Live fill — re-queries the platform after hydration
  const { live } = useLive(() => loadLiveThreads())
  const threads = live?.threads ?? snap.threads
  const liveCounts = live?.counts ?? null

  const counts = {
    categories: liveCounts?.categories ?? snap.counts.categories,
    forums: liveCounts?.forums ?? snap.counts.forums,
    threads: liveCounts?.threads ?? snap.counts.threads,
    posts: liveCounts?.posts ?? snap.counts.posts,
    reactions: liveCounts?.reactions ?? snap.counts.reactions,
  }

  return (
    <>
      <Navbar />
      <main className="flex-1">
        <Hero counts={counts} />

        <section className="max-w-6xl mx-auto px-4 sm:px-6 pt-6">
          <SectionHeader title="Latest threads" subtitle="Newest conversations across all forums" />
          <div className="grid gap-3">
            {threads.slice(0, 12).map((t) => (
              <ThreadCard key={t.id} thread={t} />
            ))}
            {threads.length === 0 && (
              <p className="text-sm text-[#93a1bd] py-8 text-center">No threads yet. Be the first to start one.</p>
            )}
          </div>
        </section>

        <section className="max-w-6xl mx-auto px-4 sm:px-6 mt-12">
          <SectionHeader title="Forums" subtitle="Browse by space" />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {snap.forums.map((f) => (
              <Link
                key={f.id}
                href={`/f?slug=${encodeURIComponent(f.slug ?? f.id)}`}
                className="group rounded-xl border border-[#22304e] bg-[#111a2e] p-4 hover:border-[#008CE7] transition fade-up"
              >
                <p className="font-semibold group-hover:text-[#4db3ff] transition">{f.title}</p>
                <p className="mt-1 text-sm text-[#93a1bd] line-clamp-2">{f.description || 'No description.'}</p>
                <p className="mt-3 text-xs text-[#93a1bd]">{f.categorySlug ? `in ${f.categorySlug}` : ''}</p>
              </Link>
            ))}
            {snap.forums.length === 0 && (
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

function Hero({ counts }: { counts: Snapshot['counts'] }) {
  return (
    <section className="border-b border-[#22304e] bg-gradient-to-b from-[#101b31] to-[#0b1220]">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10 sm:py-14">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div className="max-w-xl">
            <p className="inline-flex items-center gap-2 rounded-full border border-[#22304e] bg-[#111a2e] px-3 py-1 text-xs text-[#4db3ff] fade-up">
              <span className="w-2 h-2 rounded-full bg-emerald-400 pulse-slow" />
              Live on Dash Platform
            </p>
            <h1 className="mt-4 text-3xl sm:text-4xl font-bold leading-tight tracking-tight">
              A decentralized forum<br />on Dash Platform
            </h1>
            <p className="mt-4 text-[#93a1bd]">
              Centralized ownership, team-based moderation, every message on-chain. Login with Dash — no accounts, no servers.
            </p>
          </div>
          <Link
            href="/search"
            className="hidden sm:inline-flex items-center gap-2 rounded-lg bg-[#008CE7] hover:bg-[#006bb3] transition px-4 py-2.5 font-medium"
          >
            Explore threads
          </Link>
        </div>
        <dl className="mt-8 grid grid-cols-2 sm:grid-cols-5 gap-3">
          <Stat icon={<MessagesSquare className="w-4 h-4" />} value={counts.categories} label="Categories" />
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
      <div className="flex items-center gap-2 text-[#4db3ff]">
        {icon}
        <span className="text-xs uppercase tracking-wider text-[#93a1bd]">{label}</span>
      </div>
      <p className="mt-1 text-2xl font-bold">{value}</p>
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

function ThreadCard({ thread }: { thread: { id: string; title: string; forumSlug: string | null; tags: string[]; sticky: boolean; lockedAt: number | null; ownerId: string | null; createdAt: number } }) {
  return (
    <Link
      href={`/t?id=${thread.id}`}
      className="group flex items-start gap-3 rounded-xl border border-[#22304e] bg-[#111a2e] px-4 py-3 hover:border-[#008CE7] transition fade-up"
    >
      <Avatar name={thread.ownerId ?? 'dForum'} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {thread.sticky && <span className="text-[10px] uppercase tracking-wider text-[#4db3ff] border border-[#4db3ff]/40 rounded px-1.5 py-0.5 shrink-0">pinned</span>}
          {thread.lockedAt != null && (
            <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-amber-400 border border-amber-400/40 rounded px-1.5 py-0.5 shrink-0">
              <Lock className="w-3 h-3" /> locked
            </span>
          )}
          <p className="font-medium truncate group-hover:text-[#4db3ff] transition">{thread.title}</p>
        </div>
        <div className="mt-1 flex items-center gap-2 text-xs text-[#93a1bd] flex-wrap">
          <span>{thread.forumSlug ?? 'dForum'}</span>
          <span>·</span>
          <span>{formatRelativeTime(thread.createdAt)}</span>
          {thread.tags.slice(0, 3).map((tag) => (
            <span key={tag} className="rounded bg-[#18233c] text-[#93a1bd] px-1.5 py-0.5">#{tag}</span>
          ))}
        </div>
      </div>
    </Link>
  )
}

function NewThreadCta() {
  return (
    <div className="rounded-xl border border-dashed border-[#22304e] bg-[#111a2e]/50 p-6 text-center">
      <p className="text-[#93a1bd] text-sm">Start the next great conversation on Dash Platform.</p>
      <Link
        href="/new"
        className="mt-3 inline-flex items-center gap-2 rounded-lg bg-[#008CE7] hover:bg-[#006bb3] transition px-4 py-2 font-medium"
      >
        Start a new thread
      </Link>
    </div>
  )
}

async function loadLiveThreads(): Promise<Snapshot | null> {
  try {
    const snap = loadSnapshot()
    const threads = await query('thread', { orderBy: [['$createdAt', 'desc']], limit: 12 })
    const forumById = new Map(snap.forums.map((f) => [f.id, f.slug ?? null]))
    return { ...snap, threads: threads.map((t) => ({
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
    })) }
  } catch {
    return null
  }
}
