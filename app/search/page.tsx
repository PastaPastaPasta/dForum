import type { Metadata } from 'next'
import { site } from '@/lib/server/site-data'
import { Search } from '@/components/site/Search'

export const metadata: Metadata = { title: 'Search', alternates: { canonical: '/search/' } }

export default function SearchPage() {
  const s = site()
  return <Search snapshotAt={s.snapshotAt} forumTitles={Object.fromEntries(s.forums.map((f) => [f.id, f.title]))} />
}
