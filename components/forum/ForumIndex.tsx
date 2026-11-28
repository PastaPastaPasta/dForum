'use client'

import Link from 'next/link'
import { Archive, ChevronDown, MessagesSquare } from 'lucide-react'
import type { CategoryView, ForumView, LastPost } from '@/lib/forum/types'
import { childForums, forumDescendants } from '@/lib/forum/model'
import { deltaChanges, forumActivity, toLiveContext, type LiveContextProps } from '@/lib/forum/live-merge'
import { useLive } from '@/lib/live/overlay'
import { useNames } from '@/lib/live/names'
import { isUnread, useSeen } from '@/lib/seen'
import { Time } from '@/components/ui/Time'
import { Avatar } from '@/components/ui/Avatar'
import { AuthorLink } from './AuthorLink'

const fmt = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })

export function ForumIndex({ categories, forums, names, ctx }: {
  categories: CategoryView[]
  forums: ForumView[]
  names: Record<string, string>
  ctx: LiveContextProps
}) {
  const live = useLive(ctx.snapshotAt)
  const activity = forumActivity(live, toLiveContext(ctx))
  const liveIds = [...activity.values()].map((a) => a.last?.authorId).filter((x): x is string => !!x)
  const nameOf = useNames(names, liveIds, live.profiles)
  const seen = useSeen()
  const unread = (f: ForumView) => !!f.lastPost && isUnread(seen, f.lastPost.at, seen.forums[f.id])

  const changes = deltaChanges(live)
  const withLive = (f: ForumView): ForumView => {
    let threads = f.threadCount
    let posts = f.postCount
    // A last post hidden since the snapshot drops out (the next index picks the one before it).
    let last = f.lastPost && !changes.postGone(f.lastPost.postId) && !changes.threadGone(f.lastPost.threadId) ? f.lastPost : undefined
    for (const g of [f, ...forumDescendants(forums, f.id)]) {
      const a = activity.get(g.id)
      if (!a) continue
      threads += a.threads
      posts += a.posts
      if (a.last && (!last || a.last.at > last.at)) last = a.last
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
        const heading = (
          <>
            <h2 id={`cat-${c.id}`} className="scroll-mt-20 font-semibold">{c.title}</h2>
            {c.description && <p className="mt-0.5 text-sm font-normal text-ink-2">{c.description}</p>}
          </>
        )
        const rows = (
          <ul className="divide-y divide-rule">
            {top.map((f) => (
              <ForumRow key={f.id} forum={withLive(f)} subs={childForums(forums, f.id)} nameOf={nameOf} unread={unread} />
            ))}
          </ul>
        )
        // Categories holding only archived forums start collapsed so live discussion leads.
        if (top.every((f) => f.archived)) {
          return (
            <details key={c.id} className="panel group overflow-hidden">
              <summary className="flex cursor-pointer list-none items-center gap-3 bg-archive-wash/60 px-4 py-3 group-open:border-b group-open:border-rule">
                <Archive aria-hidden className="h-5 w-5 shrink-0 text-archive" />
                <div className="min-w-0 flex-1">{heading}</div>
                <ChevronDown aria-hidden className="h-5 w-5 shrink-0 text-ink-2 transition-transform group-open:rotate-180" />
              </summary>
              {rows}
            </details>
          )
        }
        return (
          <section key={c.id} aria-labelledby={`cat-${c.id}`} className="panel overflow-hidden">
            <header className="border-b border-rule bg-sunk/60 px-4 py-3">{heading}</header>
            {rows}
          </section>
        )
      })}
    </div>
  )
}

function ForumRow({ forum, subs, nameOf, unread }: { forum: ForumView; subs: ForumView[]; nameOf: (id: string) => string; unread: (f: ForumView) => boolean }) {
  const Icon = forum.archived ? Archive : MessagesSquare
  const fresh = unread(forum)
  return (
    <li className="grid grid-cols-[2.25rem_1fr] gap-x-3 gap-y-2 px-4 py-3.5 md:grid-cols-[2.25rem_1fr_8.5rem_15rem] md:items-center">
      <span className={`relative mt-0.5 flex h-9 w-9 items-center justify-center rounded-md ${forum.archived ? 'bg-archive-wash text-archive' : fresh ? 'bg-dash text-dash-ink' : 'bg-dash/10 text-dash'}`}>
        <Icon aria-hidden className="h-5 w-5" />
      </span>
      <div className="min-w-0">
        <Link href={`/f/${forum.slug}/`} className={`hover:text-dash ${fresh ? 'font-bold' : 'font-semibold'}`}>{forum.title}</Link>
        {fresh && <span className="ml-2 align-middle text-xs font-semibold text-dash">New posts</span>}
        {forum.description && <p className="mt-0.5 text-sm text-ink-2 line-clamp-2">{forum.description}</p>}
        {subs.length > 0 && (
          <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm">
            {subs.map((s) => <Link key={s.id} href={`/f/${s.slug}/`} className={`tap hover:text-dash ${unread(s) ? 'font-semibold text-ink' : 'text-ink-2'}`}>{s.title}</Link>)}
          </p>
        )}
      </div>
      <dl className="col-start-2 flex gap-4 text-sm md:col-start-auto md:block md:space-y-0.5 md:text-right">
        <div className="flex gap-1 md:justify-end"><dt className="text-ink-2">Threads</dt><dd className="font-medium tabnum">{fmt.format(forum.threadCount)}</dd></div>
        <div className="flex gap-1 md:justify-end"><dt className="text-ink-2">Messages</dt><dd className="font-medium tabnum">{fmt.format(forum.postCount)}</dd></div>
      </dl>
      <div className="col-start-2 min-w-0 md:col-start-auto">
        {forum.lastPost ? <LastPostCell last={forum.lastPost} nameOf={nameOf} /> : <span className="text-sm text-ink-2">{forum.threadCount ? '' : 'No threads yet'}</span>}
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
        <Link prefetch={false} href={`/t/${last.threadId}/${last.postId !== last.threadId ? `#post-${last.postId}` : ''}`} className="block truncate font-medium hover:text-dash">
          {last.threadTitle || 'New reply'}
        </Link>
        <p className="truncate text-ink-2"><Time at={last.at} />, <AuthorLink id={last.authorId} name={name} archiveAuthor={last.archiveAuthor} className="text-ink-2" /></p>
      </div>
    </div>
  )
}
