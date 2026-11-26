import HomeClient from '@/components/HomeClient'
import { loadSnapshot } from '@/lib/services/snapshot-server'

export default function HomePage() {
  const snap = loadSnapshot()
  return <HomeClient snapshot={snap} />
}
