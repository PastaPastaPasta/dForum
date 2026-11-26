import Link from 'next/link'
import { Lock } from 'lucide-react'
import { Avatar } from '@/components/Avatar'
import { RelativeTime } from '@/components/RelativeTime'
import { isModerated } from '@/lib/utils'

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

export function ThreadRow({ thread, nameOf }: { thread: ThreadRowData; nameOf?: (id: string) => string }) {
  if (isModerated(thread.modState)) return null
  const authorName = thread.ownerId && nameOf ? nameOf(thread.ownerId) : null
  return (
    <Link
      href={`/t/${encodeURIComponent(thread.id)}`}
      className="group flex items-center gap-3 rounded-xl border border-[#22304e] bg-[#111a2e] px-4 py-3 hover:border-[#008CE7] transition fade-up"
    >
      {thread.ownerId ? (
        <Avatar name={authorName ?? thread.ownerId} id={thread.ownerId} size="sm" />
      ) : (
        <Avatar name="dForum" size="sm" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {thread.sticky && <span className="text-[10px] uppercase tracking-wider text-[#4db3ff] border border-[#4db3ff]/40 rounded px-1.5 py-0.5 shrink-0">pinned</span>}
          {thread.lockedAt != null && <Lock className="w-3 h-3 text-amber-400 shrink-0" aria-label="Locked" role="img" />}
          <p className="font-medium truncate group-hover:text-[#4db3ff] transition">{thread.title}</p>
        </div>
        <p className="text-xs text-[#93a1bd] mt-0.5 truncate">
          {authorName ?? 'dForum'} · {thread.forumSlug ?? 'dForum'} · <RelativeTime time={thread.createdAt} />
          {thread.tags.slice(0, 3).map((tag) => ` · #${tag}`).join('')}
        </p>
      </div>
    </Link>
  )
}
