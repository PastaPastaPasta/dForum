import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { POSTS_PER_PAGE } from '@/lib/forum/types'
import { excerpt, postBody, str } from '@/lib/forum/model'
import { site, threadFile, threadIds, forumById, memberCards } from './site-data'
import { ThreadPage } from '@/components/thread/ThreadPage'

export function threadParams(withPages: boolean) {
  const out: Array<{ id: string; n?: string }> = []
  for (const id of threadIds()) {
    if (!withPages) { out.push({ id }); continue }
    const count = threadFile(id)?.posts.length ?? 0
    for (let n = 2; n <= Math.ceil(count / POSTS_PER_PAGE); n++) out.push({ id, n: String(n) })
  }
  return out.length ? out : [{ id: '__none__', ...(withPages ? { n: '2' } : {}) }]
}

export function threadMetadata(id: string, n = 1): Metadata {
  const tf = threadFile(id)
  if (!tf) return { title: 'Thread', robots: { index: false } }
  const title = str(tf.thread, 'title') ?? 'Thread'
  const first = tf.posts[0]
  return {
    title: n > 1 ? `${title} (page ${n})` : title,
    description: first ? excerpt(postBody(first), 200) : undefined,
    alternates: { canonical: n > 1 ? `/t/${id}/page/${n}/` : `/t/${id}/` },
    openGraph: { title, type: 'article' },
  }
}

export function forumCrumbs(forumId: string) {
  const s = site()
  const crumbs = [{ href: '/', label: 'Forums' }]
  const chain = []
  let f = forumById(forumId)
  while (f) { chain.unshift(f); f = f.parentForumId ? forumById(f.parentForumId) : undefined }
  for (const x of chain) crumbs.push({ href: `/f/${x.slug}/`, label: x.title })
  return { crumbs, archived: s.forums.find((x) => x.id === forumId)?.archived ?? false }
}

export function rolesFor(): Record<string, string> {
  const s = site()
  const roles: Record<string, string> = {}
  for (const m of s.moderators) roles[m] = 'Moderator'
  for (const t of s.team) if (t.memberId && (t.memberId === s.ownerId || s.moderators.includes(t.memberId))) roles[t.memberId] = t.role
  if (s.ownerId) roles[s.ownerId] = roles[s.ownerId] ?? 'Administrator'
  return roles
}

export function ThreadRoute({ id, n = 1 }: { id: string; n?: number }) {
  const s = site()
  const tf = threadFile(id)
  if (!tf) notFound()
  const pages = Math.max(1, Math.ceil(tf.posts.length / POSTS_PER_PAGE))
  if (n > pages) notFound()
  const posts = tf.posts.slice((n - 1) * POSTS_PER_PAGE, n * POSTS_PER_PAGE)
  const { crumbs, archived } = forumCrumbs(tf.forumId)
  const reactions = Object.fromEntries(posts.filter((p) => tf.reactions[p.id]).map((p) => [p.id, tf.reactions[p.id]]))
  const forumTitle = crumbs.at(-1)?.label ?? ''
  return (
    <div data-pagefind-body>
      <span hidden data-pagefind-filter="forum">{forumTitle}</span>
      <ThreadPage threadId={id} thread={tf.thread} crumbs={crumbs} forumArchived={archived} posts={posts} firstNumber={(n - 1) * POSTS_PER_PAGE + 1}
      page={n} pages={pages} postIndex={tf.posts.map((p) => p.id.slice(0, 12))} reactions={reactions}
      members={memberCards(posts.map((p) => p.ownerId).concat(tf.thread.ownerId))} roles={rolesFor()} snapshotAt={s.snapshotAt}
      archive={s.settings.archiveOwnerId} sourceUrl={s.settings.archiveSourceUrl} />
    </div>
  )
}
