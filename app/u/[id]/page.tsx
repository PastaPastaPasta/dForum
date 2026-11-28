import type { Metadata } from 'next'
import { members, site, userFile } from '@/lib/server/site-data'
import { rolesFor } from '@/lib/server/thread-route'
import { ProfilePage } from '@/components/forum/ProfilePage'

export const dynamicParams = false
export function generateStaticParams() {
  const m = members()
  return m.length ? m.map((x) => ({ id: x.id })) : [{ id: '__none__' }]
}
export function generateMetadata({ params }: { params: { id: string } }): Metadata {
  const m = userFile(params.id)?.member
  return { title: m?.name || 'Member', robots: m?.hidden ? { index: false } : undefined, alternates: { canonical: `/u/${params.id}/` } }
}
export default function Page({ params }: { params: { id: string } }) {
  const s = site()
  return <ProfilePage id={params.id} file={userFile(params.id)} role={rolesFor()[params.id]} snapshotAt={s.snapshotAt}
    forumTitles={Object.fromEntries(s.forums.map((f) => [f.id, f.title]))} />
}
