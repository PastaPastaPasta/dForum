import type { Metadata } from 'next'
import SearchClient from '@/components/SearchClient'
import { loadSnapshot } from '@/lib/services/snapshot-server'

export const metadata: Metadata = {
  title: 'Search',
  description: 'Search dForum threads by title, tag or forum.',
  alternates: { canonical: '/search/' },
}

export default function SearchPage() {
  const snap = loadSnapshot()
  return <SearchClient snapshot={snap} />
}
