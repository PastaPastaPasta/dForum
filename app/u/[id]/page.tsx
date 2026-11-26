import type { Metadata } from 'next'
import ProfileClient from '@/components/ProfileClient'
import { loadSnapshot } from '@/lib/services/snapshot-server'

export const dynamicParams = false

export function generateStaticParams() {
  const snap = loadSnapshot()
  // Empty snapshot → one placeholder param, never zero: Next's export build
  // throws on an empty param list. The placeholder renders the normal client
  // component, which shows the live-fallback ("not found / loading") state.
  const owners = new Set<string>()
  for (const t of snap.threads) if (t.ownerId) owners.add(t.ownerId)
  if (owners.size === 0) return [{ id: '__stub__' }]
  return [...owners].map((id) => ({ id }))
}

export function generateMetadata({ params }: { params: { id: string } }): Metadata {
  const snap = loadSnapshot()
  const name = snap.profiles[params.id]
  const threadCount = snap.threads.filter((t) => t.ownerId === params.id).length
  return {
    title: name ? `${name} — member profile` : 'Member profile',
    description: name
      ? `${name}'s threads on dForum — ${threadCount} listed thread${threadCount === 1 ? '' : 's'} on the static index.`
      : 'Member profile on dForum',
  }
}

export default function ProfileRoute({ params }: { params: { id: string } }) {
  const snap = loadSnapshot()
  return <ProfileClient identityId={params.id} snapshot={snap} />
}
