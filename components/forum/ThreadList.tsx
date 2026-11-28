'use client'

import Link from 'next/link'
import { Lock, Pin } from 'lucide-react'
import type { ThreadSummary } from '@/lib/forum/types'
import { POSTS_PER_PAGE } from '@/lib/forum/types'
import { isUnread, useSeen } from '@/lib/seen'
import { Time } from '@/components/ui/Time'
import { Avatar } from '@/components/ui/Avatar'
import { AuthorLink } from './AuthorLink'

const fmt = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })

export function ThreadList({ threads, nameOf, showForum, forumTitle, emptyText = 'No threads yet.', label = 'Threads' }: {
  threads: ThreadSummary[]
  nameOf: (id: string) => string
  showForum?: boolean
  forumTitle?: (id: string) => string | undefined
  emptyText?: React.ReactNode
  label?: string
}) {
  const seen = useSeen()
  if (!threads.length) return <div className="panel px-4 py-8 text-center text-ink-2">{emptyText}</div>
  return (
    <ul className="panel divide-y divide-rule overflow-hidden" aria-label={label}>
      {threads.map((t) => {
        const author = t.archiveAuthor ?? nameOf(t.ownerId)
        const lastName = t.lastPostArchiveAuthor ?? nameOf(t.lastPostAuthorId)
        const pages = Math.max(1, Math.ceil((t.posts ?? t.replies + 1) / POSTS_PER_PAGE))
        const lastHref = `/t/${t.id}/${pages > 1 ? `page/${pages}/` : ''}${t.lastPostId ? `#post-${t.lastPostId}` : ''}`
        const unread = isUnread(seen, t.lastPostAt, seen.threads[t.id])
        return (
          <li key={t.id} className={`grid grid-cols-[2.5rem_1fr] gap-x-3 gap-y-1.5 px-4 py-3 md:grid-cols-[2.5rem_1fr_8.5rem_12rem] md:items-center ${t.sticky ? 'bg-dash/[0.04]' : ''}`}>
            <Avatar seed={t.ownerId + (t.archiveAuthor ?? '')} name={author} size={40} archive={!!t.archiveAuthor} />
            <div className="min-w-0">
              <div className="flex flex-wrap items-baseline gap-x-2">
                {t.sticky && <span className="inline-flex items-center gap-1 text-xs font-semibold text-dash"><Pin aria-hidden className="h-3.5 w-3.5" />Pinned</span>}
                {t.locked && <span className="inline-flex items-center gap-1 text-xs font-semibold text-ink-2"><Lock aria-hidden className="h-3.5 w-3.5" />Locked</span>}
                <Link prefetch={false} href={`/t/${t.id}/`} className={`leading-snug hover:text-dash ${unread ? 'font-bold' : 'font-semibold'}`}>{t.title}</Link>
                {unread && <Link prefetch={false} href={lastHref} className="tap rounded bg-dash px-1.5 text-xs font-semibold leading-5 text-dash-ink">New</Link>}
              </div>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-2">
                <AuthorLink id={t.ownerId} name={author} archiveAuthor={t.archiveAuthor} className="text-ink-2" />
                <Time at={t.createdAt} />
                {showForum && forumTitle?.(t.forumId) && <span>in {forumTitle(t.forumId)}</span>}
                {pages > 1 && (
                  <span className="flex gap-1" aria-label="Thread pages">
                    {[...new Set([1, 2, pages - 1, pages])].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b).map((n, i, arr) => (
                      <span key={n} className="flex gap-1">
                        {i > 0 && n - arr[i - 1] > 1 && <span aria-hidden>…</span>}
                        <Link prefetch={false} href={n === 1 ? `/t/${t.id}/` : `/t/${t.id}/page/${n}/`} className="tap rounded border border-rule px-1.5 text-xs leading-5 hover:border-dash hover:text-dash" aria-label={`Page ${n}`}>{n}</Link>
                      </span>
                    ))}
                  </span>
                )}
                {t.tags.map((tag) => <Link prefetch={false} key={tag} href={`/tags/${tag}/`} className="tap rounded bg-sunk px-1.5 text-xs leading-5 hover:text-dash">{tag}</Link>)}
              </p>
            </div>
            <dl className="col-start-2 flex gap-4 text-sm md:col-start-auto md:grid md:grid-cols-[1fr_auto] md:gap-x-2 md:gap-y-0">
              <dt className="text-ink-2">Replies</dt><dd className="tabnum">{fmt.format(t.replies)}</dd>
              <dt className="text-ink-2">Reactions</dt><dd className="tabnum">{fmt.format(t.reactions)}</dd>
            </dl>
            <div className="col-start-2 text-sm md:col-start-auto md:text-right">
              <span className="text-ink-2 md:hidden">Last reply </span>
              <Link prefetch={false} href={lastHref} className="text-ink-2 hover:text-dash"><Time at={t.lastPostAt} /></Link>
              <p className="truncate"><AuthorLink id={t.lastPostAuthorId} name={lastName} archiveAuthor={t.lastPostArchiveAuthor} className="text-ink-2" /></p>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
