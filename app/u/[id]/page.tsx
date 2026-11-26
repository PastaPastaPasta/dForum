import type { Metadata } from 'next'
import ProfileClient from '@/components/ProfileClient'
import { loadSnapshot } from '@/lib/services/snapshot-service'

export const dynamicParams = false

export function generateStaticParams() {
  const snap = loadSnapshot()
  const owners = new Set<string>()
  for (const t of snap.threads) if (t.ownerId) owners.add(t.ownerId)
  return [...owners].map((id) => ({ id }))
}

export function generateMetadata({ params }: { params: { id: string } }): Metadata {
  return {
    title: 'Member profile',
    description: 'Member profile on dForum',
  }
}

export default function ProfileRoute({ params }: { params: { id: string } }) {
  return <ProfileClient identityId={params.id} />
}
