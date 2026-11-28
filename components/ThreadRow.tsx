import Link from 'next/link'
import { Lock } from 'lucide-react'
import { Avatar } from '@/components/Avatar'
import { RelativeTime } from '@/components/RelativeTime'
import { isModerated, shortId } from '@/lib/utils'

export interface ThreadRowData {
  id: string
  title: string
  forumSlug: string | null
  tags: string[]
  sticky: boolean
  lockedAt: number | null
  modState: number | null
  ownerId: string | null
  createdAt: number
}

export function ThreadRow({ thread, nameOf, forumTitle }: { thread: ThreadRowData; nameOf?: (id: string) => string; forumTitle?: string | null }) {
  if (isModerated(thread.modState)) return null
  const authorName = thread.ownerId && nameOf ? nameOf(thread.ownerId) : null
  const forumName = forumTitle ?? thread.forumSlug
  const metaParts: (string | JSX.Element)[] = []
  if (authorName) metaParts.push(authorName)
  // Display names are not unique — pin the identity next to the name.
  if (thread.ownerId) metaParts.push(<span key="shortid" className="font-mono text-[10px] tracking-tight">{shortId(thread.ownerId, 6)}</span>)
  if (forumName) metaParts.push(forumName)
  metaParts.push(<RelativeTime key="time" time={thread.createdAt} />)
  // Tags are appended after the meta — never before the separator.
  const tags = thread.tags.slice(0, 3)
  return (
    <Link
      href={`/t/${encodeURIComponent(thread.id)}`}
      className="group flex items-center gap-3 rounded-xl border border-[#22304e] bg-[#111a2e] px-4 py-3 hover:border-[#008CE7] transition fade-up min-w-0 w-full max-w-full"
    >
      {thread.ownerId ? (
        <Avatar name={authorName ?? thread.ownerId} id={thread.ownerId} size="sm" />
      ) : (
        <span className="inline-flex items-center justify-center rounded-full border border-[#22304e] text-[#93a1bd] shrink-0 w-6 h-6 text-xs" aria-hidden="true">?</span>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {thread.sticky && <span className="text-[11px] uppercase tracking-wider text-[#4db3ff] border border-[#4db3ff]/40 rounded px-1.5 py-0.5 shrink-0">pinned</span>}
          {thread.lockedAt != null && <Lock className="w-3 h-3 text-amber-400 shrink-0" aria-label="Locked" role="img" />}
          <p className="font-medium truncate group-hover:text-[#4db3ff] transition">{thread.title}</p>
        </div>
        <p className="text-xs text-[#93a1bd] mt-0.5 truncate">
          {metaParts.map((part, i) => (
            <span key={i}>
              {i > 0 && ' · '}{part}
            </span>
          ))}
          {tags.map((tag) => <span key={tag}>{` · #${tag}`}</span>)}
        </p>
      </div>
    </Link>
  )
}
