'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { Search as SearchIcon } from 'lucide-react'
import { str, threadForumId } from '@/lib/forum/model'
import { newThreads, toLiveContext, type LiveContextProps } from '@/lib/forum/live-merge'
import { useLive } from '@/lib/live/overlay'

interface Sub { url: string; title: string; excerpt: string }
interface Hit { url: string; title: string; excerpt: string; forum?: string; subs: Sub[] }
type Pagefind = {
  search(q: string, o?: { filters?: Record<string, string> }): Promise<{ results: Array<{ data(): Promise<{ url: string; excerpt: string; meta: Record<string, string>; filters: Record<string, string[]>; sub_results?: Sub[] }> }> }>
  filters(): Promise<Record<string, Record<string, number>>>
}

let pagefind: Promise<Pagefind> | null = null
const markOnly = (html: string) => html.replace(/<(?!\/?mark>)[^>]*>/g, '')
const postUrl = (url: string) => url.replace('#h-', '#post-')

const loadPagefind = () => (pagefind ??= import(/* webpackIgnore: true */ '/pagefind/pagefind.js' as string).then((m: Pagefind & { options?(o: object): Promise<void> }) => m))

export function Search({ ctx, forumTitles }: { ctx: LiveContextProps; forumTitles: Record<string, string> }) {
  const snapshotAt = ctx.snapshotAt
  const [q, setQ] = useState('')
  const [forum, setForum] = useState('')
  const [forums, setForums] = useState<string[]>([])
  const [hits, setHits] = useState<Hit[] | null>(null)
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle')
  const live = useLive(snapshotAt)
  const seq = useRef(0)

  useEffect(() => {
    const params = new URLSearchParams(location.search)
    setQ(params.get('q') ?? '')
    setForum(params.get('forum') ?? '')
    loadPagefind().then((pf) => pf.filters()).then((f) => setForums(Object.keys(f.forum ?? {}).sort())).catch(() => undefined)
  }, [])

  useEffect(() => {
    const query = q.trim()
    const url = new URL(location.href)
    if (query) url.searchParams.set('q', query); else url.searchParams.delete('q')
    if (forum) url.searchParams.set('forum', forum); else url.searchParams.delete('forum')
    history.replaceState(null, '', url)
    if (!query) { setHits(null); return }
    const n = ++seq.current
    setState('loading')
    const t = setTimeout(async () => {
      try {
        const pf = await loadPagefind()
        const res = await pf.search(query, forum ? { filters: { forum } } : undefined)
        const data = await Promise.all(res.results.slice(0, 30).map((r) => r.data()))
        if (n !== seq.current) return
        setHits(data.map((d) => ({
          url: d.url, title: d.meta.title ?? d.url, excerpt: d.excerpt, forum: d.filters.forum?.[0],
          subs: (d.sub_results ?? []).filter((r) => r.url.includes('#h-')).slice(0, 3),
        })))
        setState('idle')
      } catch {
        if (n === seq.current) setState('error')
      }
    }, 200)
    return () => clearTimeout(t)
  }, [q, forum])

  const needle = q.trim().toLowerCase()
  const fresh = needle ? newThreads(live, toLiveContext(ctx)).filter((t) => (str(t, 'title') ?? '').toLowerCase().includes(needle)) : []

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <h1 className="text-2xl font-semibold tracking-tight">Search</h1>
      <form role="search" onSubmit={(e) => e.preventDefault()} className="flex flex-col gap-2 sm:flex-row">
        <label className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-field bg-sheet px-3 focus-within:border-dash">
          <SearchIcon aria-hidden className="h-4 w-4 text-ink-2" />
          <input autoFocus type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search threads and posts" aria-label="Search terms" className="h-10 min-w-0 flex-1 bg-transparent outline-none" />
        </label>
        <select className="field sm:w-auto" value={forum} onChange={(e) => setForum(e.target.value)} aria-label="Forum">
          <option value="">All forums</option>
          {forums.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
      </form>
      {fresh.length > 0 && (
        <section aria-label="New threads" className="space-y-2">
          <h2 className="text-sm font-semibold text-ink-2">New since the last index update</h2>
          <ul className="panel divide-y divide-rule">
            {fresh.map((t) => (
              <li key={t.id} className="px-4 py-3"><Link prefetch={false} href={`/t/${t.id}/`} className="font-medium hover:text-dash">{str(t, 'title')}</Link><p className="text-sm text-ink-2">{forumTitles[threadForumId(t)]}</p></li>
            ))}
          </ul>
        </section>
      )}
      {state === 'error' && <p role="alert" className="text-danger">The search index couldn&apos;t load. Try again after reloading the page.</p>}
      {hits && (
        <section aria-live="polite" className="space-y-2">
          <p className="text-sm text-ink-2">{state === 'loading' ? 'Searching…' : `${hits.length === 30 ? 'Top 30' : hits.length} result${hits.length === 1 ? '' : 's'}`}</p>
          {hits.length > 0 ? (
            <ul className="panel divide-y divide-rule">
              {hits.map((h) => (
                <li key={h.url} className="px-4 py-3">
                  <a href={h.url} className="font-medium hover:text-dash">{h.title}</a>
                  {h.forum && <p className="text-xs text-ink-2">{h.forum}</p>}
                  {/* Pagefind excerpts are escaped text with <mark> highlights only. */}
                  {h.subs.length === 0 && <p className="mt-1 text-sm text-ink-2 [&_mark]:bg-dash/20 [&_mark]:text-ink" dangerouslySetInnerHTML={{ __html: markOnly(h.excerpt) }} />}
                  {h.subs.length > 0 && (
                    <ul className="mt-1.5 space-y-1.5 border-l-2 border-rule pl-3">
                      {h.subs.map((r) => (
                        <li key={r.url} className="text-sm">
                          <a href={postUrl(r.url)} className="font-medium text-ink-2 hover:text-dash">{r.title}</a>
                          <p className="text-ink-2 [&_mark]:bg-dash/20 [&_mark]:text-ink" dangerouslySetInnerHTML={{ __html: markOnly(r.excerpt) }} />
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          ) : state !== 'loading' && <p className="panel px-4 py-6 text-center text-ink-2">No matches. Try fewer or different words.</p>}
        </section>
      )}
      {!hits && <p className="text-sm text-ink-2">Searches every thread and post in the static index, including the imported archive. Threads posted since the last index update are matched by title.</p>}
    </div>
  )
}
