import type { Metadata } from 'next'
import ForumClient from '@/components/ForumClient'
import { loadSnapshot } from '@/lib/services/snapshot-server'

export const dynamicParams = false

export function generateStaticParams() {
  const snap = loadSnapshot()
  // Empty snapshot → one placeholder param, never zero: Next's export build
  // throws on an empty param list. The placeholder renders the normal client
  // component, which shows the live-fallback ("not found / loading") state —
  // the SPA fallback covers the gap and the last good deploy keeps serving.
  if (snap.forums.length === 0) return [{ slug: '__stub__' }]
  return snap.forums.map((f) => ({ slug: f.slug ?? '' })).filter((p) => p.slug)
}

export function generateMetadata({ params }: { params: { slug: string } }): Metadata {
  const snap = loadSnapshot()
  const forum = snap.forums.find((f) => f.slug === params.slug)
  return {
    title: forum?.title ?? 'Forum',
    description: forum?.description ?? 'Forum on dForum',
  }
}

export default function ForumRoute({ params }: { params: { slug: string } }) {
  const snap = loadSnapshot()
  return <ForumClient slug={params.slug} snapshot={snap} />
}
