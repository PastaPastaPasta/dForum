'use client'

import Link from 'next/link'
import { Lock, Pin, MessageSquare, Heart } from 'lucide-react'
import type { ThreadSummary } from '@/lib/forum/types'
import { POSTS_PER_PAGE } from '@/lib/forum/types'
import { Time } from '@/components/ui/Time'
import { Avatar } from '@/components/ui/Avatar'
import { AuthorLink } from './AuthorLink'

const fmt = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })

export function ThreadList({ threads, nameOf, showForum, forumTitle, emptyText = 'No threads yet.' }: {
  threads: ThreadSummary[]
  nameOf: (id: string) => string
  showForum?: boolean
  forumTitle?: (id: string) => string | undefined
  emptyText?: string
}) {
  if (!threads.length) return <p className="panel px-4 py-8 text-center text-ink-2">{emptyText}</p>
  return (
    <ul className="panel divide-y divide-rule overflow-hidden">
      {threads.map((t) => {
        const author = t.archiveAuthor ?? nameOf(t.ownerId)
        const lastName = t.lastPostArchiveAuthor ?? nameOf(t.lastPostAuthorId)
        const pages = Math.ceil((t.replies + 1) / POSTS_PER_PAGE)
        return (
          <li key={t.id} className={`grid grid-cols-[2.5rem_1fr] gap-x-3 gap-y-1.5 px-4 py-3 md:grid-cols-[2.5rem_1fr_7rem_12rem] md:items-center ${t.sticky ? 'bg-dash/[0.04]' : ''}`}>
            <Avatar seed={t.ownerId + (t.archiveAuthor ?? '')} name={author} size={40} archive={!!t.archiveAuthor} />
            <div className="min-w-0">
              <div className="flex items-start gap-1.5">
                {t.sticky && <Pin aria-label="Pinned" className="mt-1 h-3.5 w-3.5 shrink-0 text-dash" />}
                {t.locked && <Lock aria-label="Locked" className="mt-1 h-3.5 w-3.5 shrink-0 text-ink-2" />}
                <Link href={`/t/${t.id}/`} className="font-semibold leading-snug hover:text-dash">{t.title}</Link>
              </div>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-sm text-ink-2">
                <AuthorLink id={t.ownerId} name={author} archiveAuthor={t.archiveAuthor} className="text-ink-2" />
                <Time at={t.createdAt} />
                {showForum && forumTitle?.(t.forumId) && <span>in {forumTitle(t.forumId)}</span>}
                {pages > 1 && (
                  <span className="flex gap-1">
                    {[...new Set([1, 2, pages - 1, pages])].filter((n) => n >= 1 && n <= pages).map((n, i, arr) => (
                      <span key={n} className="flex gap-1">
                        {i > 0 && n - arr[i - 1] > 1 && <span aria-hidden>…</span>}
                        <Link href={n === 1 ? `/t/${t.id}/` : `/t/${t.id}/page/${n}/`} className="rounded border border-rule px-1.5 text-xs leading-5 hover:border-dash hover:text-dash" aria-label={`Page ${n}`}>{n}</Link>
                      </span>
                    ))}
                  </span>
                )}
                {t.tags.map((tag) => <Link key={tag} href={`/tags/${tag}/`} className="rounded bg-sunk px-1.5 text-xs leading-5 hover:text-dash">{tag}</Link>)}
              </p>
            </div>
            <dl className="col-start-2 flex gap-4 text-sm text-ink-2 md:col-start-auto md:flex-col md:gap-0.5 md:text-right">
              <div className="flex items-center gap-1 md:justify-end"><dt><MessageSquare aria-label="Replies" className="h-3.5 w-3.5" /></dt><dd className="tabnum text-ink">{fmt.format(t.replies)}</dd></div>
              <div className="flex items-center gap-1 md:justify-end"><dt><Heart aria-label="Reactions" className="h-3.5 w-3.5" /></dt><dd className="tabnum">{fmt.format(t.reactions)}</dd></div>
            </dl>
            <div className="col-start-2 text-sm md:col-start-auto md:text-right">
              <Link href={`/t/${t.id}/${pages > 1 ? `page/${pages}/` : ''}${t.lastPostId ? `#post-${t.lastPostId}` : ''}`} className="text-ink-2 hover:text-dash">
                <Time at={t.lastPostAt} />
              </Link>
              <p className="truncate"><AuthorLink id={t.lastPostAuthorId} name={lastName} archiveAuthor={t.lastPostArchiveAuthor} className="text-ink-2" /></p>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
