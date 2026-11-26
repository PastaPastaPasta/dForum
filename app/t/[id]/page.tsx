import type { Metadata } from 'next'
import ThreadClient from '@/components/ThreadClient'
import { loadSnapshot, getStaticPosts } from '@/lib/services/snapshot-server'

export const dynamicParams = false

export function generateStaticParams() {
  const snap = loadSnapshot()
  // Empty snapshot → one placeholder param, never zero: Next's export build
  // throws on an empty param list. The placeholder renders the normal client
  // component, which shows the live-fallback ("not found / loading") state —
  // the SPA fallback covers the gap and the last good deploy keeps serving.
  if (snap.threads.length === 0) return [{ id: '__stub__' }]
  // A hidden/orphan thread is deliberately never prerendered.
  return snap.threads.map((t) => ({ id: t.id }))
}

export function generateMetadata({ params }: { params: { id: string } }): Metadata {
  const snap = loadSnapshot()
  const thread = snap.threads.find((t) => t.id === params.id)
  return {
    title: thread?.title ?? 'Thread',
    description: thread ? `Thread in dForum — ${thread.title}` : 'Thread on dForum',
    alternates: { canonical: `/t/${params.id}/` },
  }
}

export default function ThreadRoute({ params }: { params: { id: string } }) {
  const snap = loadSnapshot()
  const thread = snap.threads.find((t) => t.id === params.id) ?? null
  const initialPosts = getStaticPosts(params.id)
  // The client component takes the forum's title (not the slug) for its
  // back link — the snapshot carries the forum list so the title is frozen
  // into the prerendered HTML.
  const forum = thread?.forumId ? snap.forums.find((f) => f.id === thread.forumId) : null
  return (
    <ThreadClient
      key={params.id}
      threadId={params.id}
      snapshotThread={thread}
      snapshotForumTitle={forum?.title ?? null}
      initialPosts={initialPosts}
    />
  )
}
