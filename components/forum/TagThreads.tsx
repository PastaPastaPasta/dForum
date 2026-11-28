'use client'

import type { ThreadSummary } from '@/lib/forum/types'
import { useNames } from '@/lib/live/names'
import { ThreadList } from './ThreadList'

export function TagThreads({ threads, names, forumTitles }: { threads: ThreadSummary[]; names: Record<string, string>; forumTitles: Record<string, string> }) {
  const nameOf = useNames(names, threads.flatMap((t) => [t.ownerId, t.lastPostAuthorId]))
  return <ThreadList threads={threads} nameOf={nameOf} showForum forumTitle={(id) => forumTitles[id]} />
}
