import NewThreadClient from '@/components/NewThreadClient'
import { loadSnapshot } from '@/lib/services/snapshot-server'

export default function NewThreadPage() {
  const snap = loadSnapshot()
  return <NewThreadClient snapshot={snap} />
}
