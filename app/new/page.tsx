import NewThreadClient from '@/components/NewThreadClient'
import { loadSnapshot } from '@/lib/services/snapshot-server'

// Title stays in the route layout; no canonical (signed-in surface).

export default function NewThreadPage() {
  const snap = loadSnapshot()
  return <NewThreadClient snapshot={snap} />
}
