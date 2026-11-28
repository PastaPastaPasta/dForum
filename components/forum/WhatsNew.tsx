'use client'

import type { SiteFile, ThreadSummary } from '@/lib/forum/types'
import { archiveAuthor, effectiveAt, sortThreadSummaries, str, threadForumId, isLocked, threadTags } from '@/lib/forum/model'
import { deltaChanges, newPosts, newThreads, toLiveContext, type LiveContextProps } from '@/lib/forum/live-merge'
import { useLive } from '@/lib/live/overlay'
import { useNames } from '@/lib/live/names'
import { ThreadList } from './ThreadList'

export function WhatsNew({ threads, ctx, names, forumTitles }: {
  threads: ThreadSummary[]
  ctx: LiveContextProps
  names: Record<string, string>
  forumTitles: Record<string, string>
}) {
  const live = useLive(ctx.snapshotAt)
  const lc = toLiveContext(ctx)
  const archive = ctx.archive
  const changes = deltaChanges(live, ctx.archive)
  const byId = new Map<string, ThreadSummary>()
  for (const t of threads) {
    if (changes.threadGone(t.id)) continue
    const doc = changes.thread(t.id)
    byId.set(t.id, doc ? { ...t, title: str(doc, 'title') ?? t.title, forumId: threadForumId(doc), locked: isLocked(doc), tags: threadTags(doc) } : { ...t })
  }
  for (const t of newThreads(live, lc)) {
    if (byId.has(t.id)) continue
    byId.set(t.id, {
      id: t.id, forumId: threadForumId(t), title: str(t, 'title') ?? '', tags: threadTags(t), ownerId: t.ownerId, archiveAuthor: archiveAuthor(t, archive),
      createdAt: effectiveAt(t, archive), sticky: false, locked: isLocked(t), replies: -1, reactions: 0, lastPostAt: effectiveAt(t, archive), lastPostAuthorId: t.ownerId, lastPostArchiveAuthor: archiveAuthor(t, archive),
    })
  }
  for (const { post: p, thread } of newPosts(live, lc)) {
    const s = byId.get(thread.id)
    if (!s) continue
    s.replies += 1
    if (effectiveAt(p, archive) >= s.lastPostAt) { s.lastPostAt = effectiveAt(p, archive); s.lastPostAuthorId = p.ownerId; s.lastPostArchiveAuthor = archiveAuthor(p, archive); s.lastPostId = p.id }
  }
  // New threads start at -1: their opening post arrives among the new posts.
  const list = sortThreadSummaries([...byId.values()].map((t) => ({ ...t, sticky: false, replies: Math.max(0, t.replies) }))).slice(0, 50)
  const nameOf = useNames(names, list.flatMap((t) => [t.ownerId, t.lastPostAuthorId]), live.profiles)
  return <ThreadList threads={list} nameOf={nameOf} showForum forumTitle={(id) => forumTitles[id]} emptyText="Nothing has been posted yet." />
}
