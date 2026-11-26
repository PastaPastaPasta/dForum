import SearchClient from '@/components/SearchClient'
import { loadSnapshot } from '@/lib/services/snapshot-server'

export default function SearchPage() {
  const snap = loadSnapshot()
  return <SearchClient snapshot={snap} />
}
