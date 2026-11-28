'use client'

import type { SiteFile, ThreadSummary } from '@/lib/forum/types'
import { archiveAuthor, effectiveAt, sortThreadSummaries, str, threadForumId, threadLockedAt, threadTags } from '@/lib/forum/model'
import { newThreads } from '@/lib/forum/live-merge'
import { useLive } from '@/lib/live/overlay'
import { useNames } from '@/lib/live/names'
import { ThreadList } from './ThreadList'

export function WhatsNew({ threads, snapshotAt, archive, names, forumTitles }: {
  threads: ThreadSummary[]
  snapshotAt: number
  archive?: string
  names: Record<string, string>
  forumTitles: Record<string, string>
}) {
  const live = useLive(snapshotAt)
  const byId = new Map(threads.map((t) => [t.id, { ...t }]))
  for (const t of newThreads(live, snapshotAt)) {
    byId.set(t.id, {
      id: t.id, forumId: threadForumId(t), title: str(t, 'title') ?? '', tags: threadTags(t), ownerId: t.ownerId, archiveAuthor: archiveAuthor(t, archive),
      createdAt: effectiveAt(t, archive), sticky: false, locked: threadLockedAt(t) !== undefined, replies: 0, reactions: 0, lastPostAt: effectiveAt(t, archive), lastPostAuthorId: t.ownerId,
    })
  }
  for (const p of live.posts) {
    const s = byId.get(str(p, 'threadId') ?? '')
    if (!s || p.createdAt <= snapshotAt || p.ownerId === s.ownerId && p.createdAt === s.createdAt) continue
    if (effectiveAt(p, archive) > s.lastPostAt) { s.lastPostAt = effectiveAt(p, archive); s.lastPostAuthorId = p.ownerId; s.lastPostArchiveAuthor = archiveAuthor(p, archive); s.lastPostId = p.id }
  }
  const list = sortThreadSummaries([...byId.values()].map((t) => ({ ...t, sticky: false }))).slice(0, 50)
  const nameOf = useNames(names, list.flatMap((t) => [t.ownerId, t.lastPostAuthorId]), live.profiles)
  return <ThreadList threads={list} nameOf={nameOf} showForum forumTitle={(id) => forumTitles[id]} emptyText="Nothing has been posted yet." />
}
