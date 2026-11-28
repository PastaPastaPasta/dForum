'use client'

import type { ThreadSummary } from '@/lib/forum/types'
import type { ArchiveRef } from '@/lib/forum/model'
import { deltaChanges } from '@/lib/forum/live-merge'
import { useLive } from '@/lib/live/overlay'
import { useNames } from '@/lib/live/names'
import { ThreadList } from './ThreadList'

export function TagThreads({ threads, names, forumTitles, snapshotAt, archive }: {
  threads: ThreadSummary[]
  names: Record<string, string>
  forumTitles: Record<string, string>
  snapshotAt: number
  archive?: ArchiveRef
}) {
  const live = useLive(snapshotAt)
  // Threads moderators hid since the index was built drop out here too.
  const changes = deltaChanges(live, archive)
  const shown = threads.filter((t) => !changes.threadGone(t.id))
  const nameOf = useNames(names, shown.flatMap((t) => [t.ownerId, t.lastPostAuthorId]), live.profiles)
  return <ThreadList threads={shown} nameOf={nameOf} showForum forumTitle={(id) => forumTitles[id]} />
}
