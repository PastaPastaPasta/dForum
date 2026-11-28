'use client'

import Link from 'next/link'
import { MessagesSquare, Archive } from 'lucide-react'
import type { CategoryView, ForumView, LastPost } from '@/lib/forum/types'
import { childForums, forumDescendants } from '@/lib/forum/model'
import { forumActivity } from '@/lib/forum/live-merge'
import { useLive } from '@/lib/live/overlay'
import { useNames } from '@/lib/live/names'
import { Time } from '@/components/ui/Time'
import { Avatar } from '@/components/ui/Avatar'
import { AuthorLink } from './AuthorLink'

const fmt = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })

export function ForumIndex({ categories, forums, names, snapshotAt, archiveOwnerId }: {
  categories: CategoryView[]
  forums: ForumView[]
  names: Record<string, string>
  snapshotAt: number
  archiveOwnerId?: string
}) {
  const live = useLive(snapshotAt)
  const activity = forumActivity(live, snapshotAt, archiveOwnerId)
  const liveIds = [...activity.values()].map((a) => a.last?.authorId).filter((x): x is string => !!x)
  const nameOf = useNames(names, liveIds, live.profiles)

  const withLive = (f: ForumView): ForumView => {
    let threads = f.threadCount
    let posts = f.postCount
    let last = f.lastPost
    for (const g of [f, ...forumDescendants(forums, f.id)]) {
      const a = activity.get(g.id)
      if (!a) continue
      threads += a.threads
      posts += a.posts
      if (a.last && (!last || a.last.at > last.at)) last = { ...a.last, threadTitle: a.last.threadTitle || last?.threadTitle || '' }
    }
    return { ...f, threadCount: threads, postCount: posts, lastPost: last }
  }

  if (!categories.length) {
    return (
      <div className="panel p-8 text-center">
        <h2 className="text-lg font-semibold">No forums yet</h2>
        <p className="mt-1 text-ink-2">The forum owner hasn&apos;t created any categories. Check back after the next index update.</p>
      </div>
    )
  }
  return (
    <div className="space-y-6">
      {categories.map((c) => {
        const top = childForums(forums.filter((f) => f.categoryId === c.id))
        if (!top.length) return null
        return (
          <section key={c.id} aria-labelledby={`cat-${c.id}`} className="panel overflow-hidden">
            <header className="border-b border-rule bg-sunk/60 px-4 py-3">
              <h2 id={`cat-${c.id}`} className="font-semibold">{c.title}</h2>
              {c.description && <p className="mt-0.5 text-sm text-ink-2">{c.description}</p>}
            </header>
            <ul className="divide-y divide-rule">
              {top.map((f) => (
                <ForumRow key={f.id} forum={withLive(f)} subs={childForums(forums, f.id)} nameOf={nameOf} />
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}

function ForumRow({ forum, subs, nameOf }: { forum: ForumView; subs: ForumView[]; nameOf: (id: string) => string }) {
  const Icon = forum.archived ? Archive : MessagesSquare
  return (
    <li className="grid grid-cols-[2.25rem_1fr] gap-x-3 gap-y-2 px-4 py-3.5 md:grid-cols-[2.25rem_1fr_8.5rem_15rem] md:items-center">
      <span className={`mt-0.5 flex h-9 w-9 items-center justify-center rounded-md ${forum.archived ? 'bg-archive-wash text-archive' : 'bg-dash/10 text-dash'}`}>
        <Icon aria-hidden className="h-5 w-5" />
      </span>
      <div className="min-w-0">
        <Link href={`/f/${forum.slug}/`} className="font-semibold hover:text-dash">{forum.title}</Link>
        {forum.description && <p className="mt-0.5 text-sm text-ink-2 line-clamp-2">{forum.description}</p>}
        {subs.length > 0 && (
          <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm">
            {subs.map((s) => <Link key={s.id} href={`/f/${s.slug}/`} className="text-ink-2 hover:text-dash">{s.title}</Link>)}
          </p>
        )}
      </div>
      <dl className="col-start-2 flex gap-4 text-sm md:col-start-auto md:block md:space-y-0.5 md:text-right">
        <div className="flex gap-1 md:justify-end"><dt className="text-ink-2">Threads</dt><dd className="font-medium tabnum">{fmt.format(forum.threadCount)}</dd></div>
        <div className="flex gap-1 md:justify-end"><dt className="text-ink-2">Messages</dt><dd className="font-medium tabnum">{fmt.format(forum.postCount)}</dd></div>
      </dl>
      <div className="col-start-2 min-w-0 md:col-start-auto">
        {forum.lastPost ? <LastPostCell last={forum.lastPost} nameOf={nameOf} /> : <span className="text-sm text-ink-2">No threads yet</span>}
      </div>
    </li>
  )
}

export function LastPostCell({ last, nameOf }: { last: LastPost; nameOf: (id: string) => string }) {
  const name = last.archiveAuthor ?? nameOf(last.authorId)
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <Avatar seed={last.authorId + (last.archiveAuthor ?? '')} name={name} size={32} archive={!!last.archiveAuthor} />
      <div className="min-w-0 text-sm">
        <Link href={`/t/${last.threadId}/${last.postId !== last.threadId ? `#post-${last.postId}` : ''}`} className="block truncate font-medium hover:text-dash">
          {last.threadTitle || 'New reply'}
        </Link>
        <p className="truncate text-ink-2"><Time at={last.at} />, <AuthorLink id={last.authorId} name={name} archiveAuthor={last.archiveAuthor} className="text-ink-2" /></p>
      </div>
    </div>
  )
}
