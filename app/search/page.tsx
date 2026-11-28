import type { Metadata } from 'next'
import { liveContext, site } from '@/lib/server/site-data'
import { Search } from '@/components/site/Search'

export const metadata: Metadata = { title: 'Search', alternates: { canonical: '/search/' } }

export default function SearchPage() {
  const s = site()
  return <Search ctx={liveContext()} forumTitles={Object.fromEntries(s.forums.map((f) => [f.id, f.title]))} />
}
