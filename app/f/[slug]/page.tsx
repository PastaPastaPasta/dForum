import type { Metadata } from 'next'
import ForumClient from '@/components/ForumClient'
import { loadSnapshot } from '@/lib/services/snapshot-service'

export const dynamicParams = false

export function generateStaticParams() {
  const snap = loadSnapshot()
  const forumParams = snap.forums.map((f) => ({ slug: f.slug ?? '' })).filter((p) => p.slug)
  if (forumParams.length === 0) {
    throw new Error('[dForum] Snapshot has no forums — run `node scripts/snapshot.mjs` before building (the static index is generated from the platform).')
  }
  return forumParams
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
  return <ForumClient slug={params.slug} />
}
