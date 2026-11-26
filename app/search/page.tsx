'use client'

import { useEffect, useMemo, useState } from 'react'
import { Search, Lock } from 'lucide-react'
import { Navbar } from '@/components/Navbar'
import { Footer } from '@/components/Footer'
import { loadSnapshot } from '@/lib/services/snapshot-service'
import { query } from '@/lib/services/document-service'
import { isModerated } from '@/lib/utils'
import { ThreadRow } from '@/components/ThreadRow'

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

export default function SearchPage() {
  const snap = loadSnapshot()
  const [q, setQ] = useState('')
  const [liveThreads, setLiveThreads] = useState<SearchResult[] | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    query('thread', { orderBy: [['$createdAt', 'desc']], limit: 100 })
      .then((docs) => {
        if (cancelled) return
        const forumById = new Map(snap.forums.map((f) => [f.id, f.slug ?? null]))
        setLiveThreads(
          docs
            .map((t) => ({
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
            .filter((t) => !isModerated(t.modState)),
        )
        setLoading(false)
      })
      .catch(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const allThreads: SearchResult[] = useMemo(() => {
    if (liveThreads) return liveThreads.filter((t) => !isModerated(t.modState))
    return snap.threads.map((t) => ({
      id: t.id,
      title: t.title,
      tags: t.tags,
      forumSlug: t.forumSlug,
      sticky: t.sticky,
      lockedAt: t.lockedAt,
      modState: t.modState,
      ownerId: t.ownerId,
      createdAt: t.createdAt,
    })).filter((t) => !isModerated(t.modState))
  }, [liveThreads, snap])

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return allThreads
    return allThreads.filter(
      (t) =>
        t.title.toLowerCase().includes(needle) ||
        t.tags.some((tag) => tag.toLowerCase().includes(needle)) ||
        t.forumSlug?.toLowerCase().includes(needle) ||
        t.id.toLowerCase().includes(needle),
    )
  }, [allThreads, q])

  return (
    <>
      <Navbar />
      <main className="flex-1">
        <section className="border-b border-[#22304e]">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
            <h1 className="text-2xl font-bold tracking-tight">Search dForum</h1>
            <p className="mt-1 text-sm text-[#93a1bd]">Threads and tags across all forums (latest 100)</p>

            <div className="relative mt-5">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#93a1bd]" />
              <input
                aria-label="Search threads"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search by title, tag, or forum…"
                className="w-full rounded-xl border border-[#22304e] bg-[#111a2e] pl-10 pr-4 py-3 text-sm placeholder:text-[#93a1bd]/60 focus:border-[#008CE7] focus:outline-none"
              />
              {loading && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[#93a1bd]">loading…</span>}
            </div>
          </div>
        </section>

        <section className="max-w-3xl mx-auto px-4 sm:px-6 mt-6">
          {results.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[#22304e] p-8 text-center fade-up">
              <p className="text-[#93a1bd]">{q.trim() ? 'No threads match your search.' : 'Type to search threads.'}</p>
            </div>
          ) : (
            <div className="grid gap-3">
              {results.map((t) => (
                <ThreadRow key={t.id} thread={t} />
              ))}
            </div>
          )}
          {results.length > 0 && (
            <p className="mt-3 text-xs text-[#93a1bd]">
              {results.length} {results.length === 1 ? 'thread' : 'threads'}
            </p>
          )}
        </section>
      </main>
      <Footer />
    </>
  )
}
