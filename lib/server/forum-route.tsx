import type { ForumView } from '@/lib/forum/types'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { THREADS_PER_PAGE } from '@/lib/forum/types'
import { childForums } from '@/lib/forum/model'
import { site, forumBySlug, forumFile, memberNames, liveContext } from './site-data'
import { ForumPage } from '@/components/forum/ForumPage'

export function forumParams(withPages: boolean) {
  const s = site()
  const out: Array<{ slug: string; n?: string }> = []
  for (const f of s.forums) {
    if (!withPages) { out.push({ slug: f.slug }); continue }
    const count = forumFile(f.id)?.threads.length ?? 0
    for (let n = 2; n <= Math.ceil(count / THREADS_PER_PAGE); n++) out.push({ slug: f.slug, n: String(n) })
  }
  return out.length ? out : [{ slug: '__none__', ...(withPages ? { n: '2' } : {}) }]
}

export function forumMetadata(slug: string, n = 1): Metadata {
  const f = forumBySlug(slug)
  if (!f) return { title: 'Forum not found', robots: { index: false } }
  return {
    title: n > 1 ? `${f.title} (page ${n})` : f.title,
    description: f.description || `Threads in ${f.title}`,
    alternates: { canonical: n > 1 ? `/f/${slug}/page/${n}/` : `/f/${slug}/`, types: { 'application/rss+xml': `/f/${slug}/feed.xml` } },
  }
}

export function ForumRoute({ slug, n = 1 }: { slug: string; n?: number }) {
  const s = site()
  const forum = forumBySlug(slug)
  if (!forum) notFound()
  const all = forumFile(forum.id)?.threads ?? []
  const pages = Math.max(1, Math.ceil(all.length / THREADS_PER_PAGE))
  if (n > pages) notFound()
  const threads = all.slice((n - 1) * THREADS_PER_PAGE, n * THREADS_PER_PAGE)
  const subforums = childForums(s.forums, forum.id)
  const crumbs = [{ href: '/', label: 'Forums' }]
  const chain: ForumView[] = []
  let parent = forum.parentForumId ? s.forums.find((f) => f.id === forum.parentForumId) : undefined
  while (parent) { chain.unshift(parent); parent = parent.parentForumId ? s.forums.find((f) => f.id === parent?.parentForumId) : undefined }
  const cat = s.categories.find((c) => c.id === (chain[0] ?? forum).categoryId)
  if (cat) crumbs.push({ href: `/#cat-${cat.id}`, label: cat.title })
  for (const p of chain) crumbs.push({ href: `/f/${p.slug}/`, label: p.title })
  const names = memberNames([...threads.flatMap((t) => [t.ownerId, t.lastPostAuthorId]), ...subforums.map((f) => f.lastPost?.authorId ?? '')])
  return (
    <ForumPage forum={forum} crumbs={crumbs} subforums={subforums} threads={threads} page={n} pages={pages} names={names}
      ctx={liveContext()} />
  )
}
