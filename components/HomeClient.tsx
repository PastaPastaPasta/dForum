'use client'

import Link from 'next/link'
import { MessageSquare, TrendingUp, FolderOpen, Loader2, Pencil } from 'lucide-react'
import { Navbar } from '@/components/Navbar'
import { Footer } from '@/components/Footer'
import type { Snapshot, SnapshotThread } from '@/lib/services/snapshot-server'
import { useSession } from '@/lib/session'
import { query, queryRaw, get } from '@/lib/services/document-service'
import { earliestOwnerPost } from '@/lib/services/orphan'
import { useLive } from '@/components/LiveFeed'
import { useProfileNames } from '@/lib/use-profiles'
import { filterListable } from '@/lib/services/orphan'
import { ThreadRow } from '@/components/ThreadRow'
import { LiveUnavailable } from '@/components/LiveUnavailable'

export default function HomeClient({ snapshot }: { snapshot: Snapshot }) {
  const snap = snapshot
  const { session } = useSession()
  // Live fill — re-queries the platform after hydration
  // Errors propagate — useLive catches and flips the badge to "unavailable";
  // the snapshot stays visible and the stale note shows.
  const { live, loading, error } = useLive(() => loadLive(snap), 'home')
  // "+" means the shown window filled without running dry — a window that
  // ran dry (fewer threads exist than the window) shows no suffix.
  const threadsWindowFilled = (live?.threadsWindowFilled) ?? snap.threads.length >= HOME_TARGET
  const byStickyThenRecent = (a: SnapshotThread, b: SnapshotThread) =>
    a.sticky !== b.sticky ? (a.sticky ? -1 : 1) : b.createdAt - a.createdAt
  // First paint shows the snapshot (build-time listed surface). Once live
  // resolves, the live list wins outright — snapshot threads that are hidden
  // or orphaned since the snapshot must not be resurrected.
  const liveThreads = (live?.threads ?? []).filter((t) => t.modState == null)
  const threads = live != null ? liveThreads : snap.threads.filter((t) => t.modState == null)
  const listedThreads = threads.slice().sort(byStickyThenRecent)
  const categories = (live?.categories ?? snap.categories)
  const forumCategoryTitle = new Map(categories.map((c) => [c.id, c.title || c.slug || null]))
  const forums = (live?.forums ?? snap.forums)
    .filter((f) => !f.archived)
    .map((f) => ({ ...f, categoryLabel: forumCategoryTitle.get(f.categoryId ?? '') ?? null }))
    .sort((a, b) => a.sort - b.sort || a.title.localeCompare(b.title))

  const authorIds = listedThreads.slice(0, 12).map((t) => t.ownerId)
  const profiles = useProfileNames(authorIds)
  const nameOf = (id: string): string => snap.profiles[id] ?? profiles[id] ?? id.slice(0, 12)

  // Honest counts — every tile is derived from the same listed surface the
  // page shows. Hidden/orphaned threads are deliberately not public numbers,
  // so raw chain totals are never displayed. The threads tile is marked "+"
  // when the recent window filled: the honest claim is "at least this many".
  const listed = listedThreads.length
  const counts = {
    categories: categories.length,
    forums: forums.length,
    threads: listed,
    threadsWindowFull: threadsWindowFilled,
  }

  return (
    <>
      <Navbar />
      <main id="main" tabIndex={-1} className="flex-1">
        <Hero counts={counts} session={session} loading={loading} error={error} />

        {error && !loading && (
          <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-6">
            <LiveUnavailable />
          </div>
        )}

        <section id="latest-threads" className="max-w-6xl mx-auto px-4 sm:px-6 pt-6">
          <SectionHeader title="Latest threads" subtitle="Newest conversations across all forums" />
          <div className="grid grid-cols-1 gap-3">
            {listedThreads.slice(0, 12).map((t) => (
              <ThreadRow key={t.id} thread={t as Parameters<typeof ThreadRow>[0]['thread']} nameOf={nameOf} />
            ))}
            {listedThreads.length === 0 && (
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
                <p className="mt-3 text-xs text-[#93a1bd]">{f.categoryLabel ? `in ${f.categoryLabel}` : ''}</p>
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

function Hero({ counts, session, loading, error }: { counts: { categories: number; forums: number; threads: number; threadsWindowFull: boolean }; session: { identityId: string } | null; loading: boolean; error: boolean }) {
  return (
    <section className="border-b border-[#22304e] bg-gradient-to-b from-[#101b31] to-[#0b1220]">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10 sm:py-14">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div className="max-w-xl">
            {!error && (
              <p className="inline-flex items-center gap-2 rounded-full border border-[#22304e] bg-[#111a2e] px-3 py-1 text-xs text-[#4db3ff] fade-up">
                {loading ? (
                  <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
                ) : (
                  <span className="w-2 h-2 rounded-full bg-emerald-400 pulse-slow" />
                )}
                {loading ? 'Loading live data…' : 'Live on Dash Platform'}
              </p>
            )}
            <h1 className="mt-4 text-3xl sm:text-4xl font-bold leading-tight tracking-tight">
              A forum on<br />Dash Platform
            </h1>
            <p className="mt-4 text-[#93a1bd]">
              Centralized ownership, team-based moderation, every message on-chain. Login with Dash.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/search"
              className="btn-secondary px-4 py-2.5 font-medium"
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
        <dl className="mt-8 grid grid-cols-3 gap-2 sm:gap-3">
          <Stat icon={<FolderOpen className="w-4 h-4" />} value={counts.categories} label="Categories" />
          <Stat icon={<MessageSquare className="w-4 h-4" />} value={counts.forums} label="Forums" />
          <Stat icon={<TrendingUp className="w-4 h-4" />} value={counts.threads} label="Recent threads" suffix={counts.threadsWindowFull ? '+' : ''} />
        </dl>
      </div>
    </section>
  )
}

function Stat({ icon, value, label, suffix }: { icon: React.ReactNode; value: number; label: string; suffix?: string }) {
  return (
    <div className="rounded-xl border border-[#22304e] bg-[#111a2e] p-2.5 sm:p-3">
      <dt className="flex items-center gap-1.5 sm:gap-2 text-[#4db3ff]">
        {icon}
        <span className="text-[10px] sm:text-xs uppercase tracking-wider text-[#93a1bd]">{label}</span>
      </dt>
      <dd className="mt-1 text-lg sm:text-2xl font-bold tabular-nums">{value.toLocaleString('en-US')}{suffix}</dd>
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

const HOME_TARGET = 12
const HOME_HARD_CAP = 60
const HOME_LIMIT = 25

async function loadLive(snapshot: Snapshot): Promise<Snapshot> {
  const snap = snapshot
  const forumById = new Map(snap.forums.map((f) => [f.id, f.slug ?? null]))
  const forumDocs = await query('forum', { limit: 50 })
  const categoryDocs = await query('category', { limit: 50 })
  // Paginate through the thread index until HOME_TARGET listable threads are
  // found or the page budget is exhausted — so orphan spam cannot push real
  // threads out of the window.
  const listed: Snapshot['threads'] = []
  const seenIds = new Set<string>()
  let after: string | null = null
  let scanned = 0
  let page = 0
  let indexExhausted = false
  while (listed.length < HOME_TARGET && scanned < HOME_HARD_CAP && page < 4) {
    page += 1
    const { docs, rawCount, lastId } = await queryRaw('thread', {
      orderBy: [['$createdAt', 'desc']],
      limit: HOME_LIMIT,
      ...(after ? { startAfter: after } : {}),
    })
    if (rawCount === 0) { indexExhausted = true; break }
    scanned += rawCount
    const candidates = docs.filter((t) => {
      if (t.properties?.modState != null) return false
      if (seenIds.has(t.id)) return false
      seenIds.add(t.id)
      return true
    })
    const mapped = candidates.map((t) => ({
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
    const filtered = await filterListable(mapped, 4)
    for (const t of filtered) {
      if (listed.length >= HOME_TARGET) break
      listed.push(t)
    }
    if (lastId == null) { indexExhausted = true; break } // cannot continue — stop honestly
    after = lastId
  }
  // "+" is claimed only when the window filled because we stopped at the target,
  // not because the index was exhausted.
  const windowFilled = !indexExhausted && listed.length >= HOME_TARGET
  // Pinned snapshot threads can sit outside the recent live window — re-verify
  // each against the chain and merge the verified ones (never resurrect a
  // since-hidden thread). A failed check is treated as "not visible", which
  // is the honest answer: the thread simply does not appear.
  for (const snapThread of snap.threads) {
    if (!snapThread.sticky || snapThread.modState != null) continue
    if (seenIds.has(snapThread.id)) continue
    seenIds.add(snapThread.id)
    try {
      const full = await get('thread', snapThread.id)
      if (!full || (full.properties?.modState as number | null) != null) continue
      const ownerId = full.ownerId || null
      if (!ownerId) continue
      const opening = await earliestOwnerPost(full.id, ownerId, full.createdAt)
      if (!opening || opening.modState != null) continue
      const lockedAt = (full.properties?.lockedAt as number | null) ?? null
      if (lockedAt != null && opening.createdAt > lockedAt) continue
      listed.push({
        id: full.id,
        forumId: (full.properties.forumId as string) ?? null,
        forumSlug: forumById.get((full.properties.forumId as string) ?? '') ?? snapThread.forumSlug ?? null,
        title: (full.properties.title as string) ?? '',
        tags: Array.isArray(full.properties.tags) ? (full.properties.tags as string[]) : [],
        sticky: true,
        lockedAt,
        modState: (full.properties.modState as number | null) ?? null,
        ownerId: full.ownerId || null,
        createdAt: full.createdAt,
        updatedAt: full.updatedAt,
      })
    } catch {
      // Unverifiable — do not show it.
    }
  }
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
  const categories = categoryDocs.map((c) => ({
    id: c.id,
    slug: (c.properties.slug as string) ?? null,
    title: (c.properties.title as string) ?? '',
    description: (c.properties.description as string) ?? '',
    sort: Number(c.properties.sort ?? 0),
  }))
  return {
    ...snap,
    threads: listed,
    forums,
    categories,
    threadsWindowFilled: windowFilled,
  }
}
