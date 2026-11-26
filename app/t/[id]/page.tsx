import type { Metadata } from 'next'
import ThreadClient from '@/components/ThreadClient'
import { loadSnapshot } from '@/lib/services/snapshot-service'

export const dynamicParams = false

export function generateStaticParams() {
  const snap = loadSnapshot()
  if (snap.threads.length === 0) {
    throw new Error('[dForum] Snapshot has no threads — run `node scripts/snapshot.mjs` before building (the static index is generated from the platform).')
  }
  return snap.threads.map((t) => ({ id: t.id }))
}

export function generateMetadata({ params }: { params: { id: string } }): Metadata {
  const snap = loadSnapshot()
  const thread = snap.threads.find((t) => t.id === params.id)
  return {
    title: thread?.title ?? 'Thread',
    description: thread ? `Thread in dForum — ${thread.title}` : 'Thread on dForum',
  }
}

export default function ThreadRoute({ params }: { params: { id: string } }) {
  return <ThreadClient threadId={params.id} />
}
