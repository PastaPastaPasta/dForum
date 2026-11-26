import type { Metadata } from 'next'
import HomeClient from '@/components/HomeClient'
import { loadSnapshot } from '@/lib/services/snapshot-server'

export const metadata: Metadata = {
  alternates: { canonical: '/' },
}

export default function HomePage() {
  const snap = loadSnapshot()
  return <HomeClient snapshot={snap} />
}
