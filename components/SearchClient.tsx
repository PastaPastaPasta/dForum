'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Search, Loader2 } from 'lucide-react'
import { Navbar } from '@/components/Navbar'
import { Footer } from '@/components/Footer'
import type { Snapshot } from '@/lib/services/snapshot-server'
import { query } from '@/lib/services/document-service'
import { isModerated, shortId } from '@/lib/utils'
import { useProfileNames } from '@/lib/use-profiles'
import { filterListableWithFailures } from '@/lib/services/orphan'
import { ThreadRow } from '@/components/ThreadRow'
import { LiveUnavailable } from '@/components/LiveUnavailable'
import { LOGIN_AVAILABLE } from '@/lib/host'

interface SearchResult {
  id: string
  title: string
  tags: string[]
  forumSlug: string | null
  sticky: boolean
  lockedAt: number | null
  modState: number | null
  ownerId: string | null
  createdAt: number
}

const MAX_LIST = 25
// Verdicts expire — a cached "listable" must not survive a moderator hide
// longer than this. Failed checks are never cached.
const ORPHAN_CACHE_TTL_MS = 10 * 60 * 1000

type Verdict = { ok: boolean; at: number }
/** Orphan verdicts are cached module-wide — a successful live verdict must
 * not be re-queried on every keystroke. Only checks that succeeded are
 * cached; a failed check is an unknown, not a verdict, and is retried. */
const orphanCache = new Map<string, Verdict>()

function isFresh(v: Verdict | undefined): boolean {
  return v !== undefined && Date.now() - v.at < ORPHAN_CACHE_TTL_MS
}

async function cachedFilter(threads: SearchResult[]): Promise<SearchResult[]> {
  const fresh = threads.filter((t) => !isFresh(orphanCache.get(t.id)))
  if (fresh.length) {
    const { listed, failed } = await filterListableWithFailures(fresh, 4)
    const listedIds = new Set(listed.map((t) => t.id))
    for (const t of fresh) {
      if (failed.has(t.id)) continue // unknown verdict — do not cache
      orphanCache.set(t.id, { ok: listedIds.has(t.id), at: Date.now() })
    }
  }
  return threads.filter((t) => {
    const v = orphanCache.get(t.id)
    return !isFresh(v) ? true : v!.ok
  })
}

export default function SearchClient({ snapshot }: { snapshot: Snapshot }) {
  const snap = snapshot
  // ?q=… — deep links from the sitemap and navbar search set the query.
  // Read in an effect: during prerender the URL is unknown.
  const [q, setQ] = useState('')
  const [ready, setReady] = useState(false)
  const [liveThreads, setLiveThreads] = useState<SearchResult[] | null>(null)
  // The oldest thread in the RAW live window — the honest boundary for
  // "snapshot rows newer than live were hidden or deleted". Computed before
  // the orphan filter so a filtered-out thread does not move the boundary.
  const [oldestRawLive, setOldestRawLive] = useState<number>(Infinity)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [reload, setReload] = useState(0)
  const retry = () => setReload((n) => n + 1)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    setQ(params.get('q') ?? '')
    setReady(true)
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setFailed(false)
    query('thread', { orderBy: [['$createdAt', 'desc']], limit: MAX_LIST })
      .then(async (docs) => {
        if (cancelled) return
        const forumById = new Map(snap.forums.map((f) => [f.id, f.slug ?? null]))
        const mapped: SearchResult[] = docs.map((t) => ({
          id: t.id,
          title: (t.properties.title as string) ?? '',
          tags: Array.isArray(t.properties.tags) ? (t.properties.tags as string[]) : [],
          forumSlug: forumById.get((t.properties.forumId as string) ?? '') ?? null,
          sticky: Boolean(t.properties.sticky),
          lockedAt: (t.properties.lockedAt as number | null) ?? null,
          modState: (t.properties.modState as number | null) ?? null,
          ownerId: t.ownerId || null,
          createdAt: t.createdAt,
        }))
        // Same orphan cache the per-keystroke filter uses — one verdict
        // per thread, not two.
        const listed = await cachedFilter(mapped)
        if (cancelled) return
        setOldestRawLive(mapped.length ? Math.min(...mapped.map((t) => t.createdAt)) : Infinity)
        setLiveThreads(listed)
        setLoading(false)
      })
      .catch(() => {
        if (!cancelled) {
          setFailed(true)
          setLoading(false)
        }
      })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reload])

  // Merge live + snapshot (dedupe by id) — the snapshot is the first paint
  // and the live set refines it. Live rows win; a snapshot row whose id is
  // missing from the live window was hidden or deleted → dropped. Orphan
  // rules are applied to the displayed set, not the raw stream.
  const allThreads: SearchResult[] = useMemo(() => {
    const snapList: SearchResult[] = snap.threads.map((t) => ({
      id: t.id,
      title: t.title,
      tags: t.tags,
      forumSlug: t.forumSlug,
      sticky: t.sticky,
      lockedAt: t.lockedAt,
      modState: t.modState,
      ownerId: t.ownerId,
      createdAt: t.createdAt,
    }))
    if (!liveThreads) return snapList.filter((t) => !isModerated(t.modState))
    const liveIds = new Set(liveThreads.map((t) => t.id))
    const oldestLive = oldestRawLive
    const merged = new Map(snapList.map((t) => [t.id, t]))
    for (const t of liveThreads) merged.set(t.id, t)
    return [...merged.values()]
      .filter((t) => {
        if (isModerated(t.modState)) return false
        // Snapshot-only rows: keep only threads older than the whole live
        // window — anything newer but missing from live was hidden/deleted.
        if (!liveIds.has(t.id)) return t.createdAt < oldestLive
        return true
      })
  }, [liveThreads, oldestRawLive, snap])

  // Keep the URL in sync with the query (no history spam).
  useEffect(() => {
    if (!ready) return
    const url = new URL(window.location.href)
    if (q.trim()) url.searchParams.set('q', q.trim())
    else url.searchParams.delete('q')
    window.history.replaceState(null, '', url)
  }, [q, ready])

  const forumTitleBySlug = new Map(snap.forums.map((f) => [f.slug, f.title]))
  const forumTitleOf = (t: SearchResult): string | null => (t.forumSlug ? forumTitleBySlug.get(t.forumSlug) ?? null : null)

  const needle = q.trim().toLowerCase()
  const matched = useMemo(() => {
    if (!needle) return allThreads
    return allThreads.filter(
      (t) =>
        t.title.toLowerCase().includes(needle) ||
        t.tags.some((tag) => tag.toLowerCase().includes(needle)) ||
        forumTitleOf(t)?.toLowerCase().includes(needle) ||
        t.id.toLowerCase().includes(needle),
    )
  }, [allThreads, needle, forumTitleBySlug])

  // Orphan rule — applied to the displayed set, never the raw stream.
  const [orphanFiltered, setOrphanFiltered] = useState<SearchResult[] | null>(null)
  useEffect(() => {
    let cancelled = false
    setOrphanFiltered(null)
    const timer = setTimeout(() => {
      if (matched.length === 0) { setOrphanFiltered([]); return }
      cachedFilter(matched.slice(0, MAX_LIST))
        .then((r) => { if (!cancelled) setOrphanFiltered(r) })
        .catch(() => { if (!cancelled) setOrphanFiltered(matched.slice(0, MAX_LIST)) })
    }, 150)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [matched])
  const results = orphanFiltered ?? matched.filter((t) => {
    const v = orphanCache.get(t.id)
    return !isFresh(v) || v!.ok
  }).slice(0, MAX_LIST)

  const authorIds = results.map((t) => t.ownerId)
  const profiles = useProfileNames(authorIds)
  const nameOf = (id: string): string => profiles[id] ?? snap.profiles[id] ?? shortId(id, 12)

  return (
    <>
      <Navbar />
      <main id="main" tabIndex={-1} className="flex-1">
        <section className="border-b border-[#22304e]">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Search dForum</h1>
            <p className="mt-1 text-sm text-[#93a1bd]">Search threads by title, tag, or forum title — the latest {MAX_LIST} threads, plus the last snapshot{snap.generatedAt ? ` (${new Date(snap.generatedAt).toUTCString()})` : ''}</p>

            <form role="search" aria-label="Search threads" onSubmit={(e) => e.preventDefault()} className="relative mt-5">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#93a1bd]" aria-hidden="true" />
              <input
                aria-label="Search threads"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search by title, tag, or forum…"
                className="w-full rounded-xl border border-input bg-[#111a2e] pl-10 pr-20 py-3 text-base sm:text-sm placeholder:text-[#93a1bd] focus:border-[#008CE7]"
              />
              {loading && (
                <span className="absolute right-3 top-1/2 -translate-y-1/2 inline-flex items-center gap-1.5 text-xs text-[#93a1bd]" aria-hidden="true">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Refreshing…
                </span>
              )}
            </form>
            {failed && <LiveUnavailable className="mt-2" onRetry={retry}  snapshotDate={snap.generatedAt} />}
          </div>
        </section>

        <section className="max-w-3xl mx-auto px-4 sm:px-6 mt-6">
          {results.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[#22304e] p-8 text-center fade-up">
              {failed ? (
                <p className="text-[#93a1bd]">No threads to show right now.</p>
              ) : loading ? (
                <p className="text-[#93a1bd]">Loading threads…</p>
              ) : allThreads.length === 0 ? (
                <>
                  {LOGIN_AVAILABLE ? (
                    <p className="text-[#93a1bd]">No threads yet — <Link href="/new" className="text-[#4db3ff] hover:underline">start the first one</Link>.</p>
                  ) : (
                    <p className="text-[#93a1bd]">No threads yet — this deployment is read-only.</p>
                  )}
                </>
              ) : q.trim() ? (
                <p className="text-[#93a1bd]">No threads match “{q.trim()}”.</p>
              ) : (
                <p className="text-[#93a1bd]">Type to search threads.</p>
              )}
            </div>
          ) : (
            <div className="grid gap-3">
              {results.map((t) => (
                <ThreadRow key={t.id} thread={t} nameOf={nameOf} forumTitle={forumTitleOf(t)} />
              ))}
            </div>
          )}
          <p className="mt-3 text-xs text-[#93a1bd]" role="status">
            {failed
              ? 'Live read failed — showing the snapshot.'
              : loading
                ? `${results.length} ${results.length === 1 ? 'thread' : 'threads'} · refreshing…`
                : q.trim()
                  ? `Showing ${results.length} of ${matched.length} matches`
                  : `${results.length} ${results.length === 1 ? 'thread' : 'threads'}`}
          </p>
        </section>
      </main>
      <Footer />
    </>
  )
}
