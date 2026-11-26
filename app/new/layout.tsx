import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Start a thread',
  description: 'Start a new thread on dForum. Not indexed.',
  robots: { index: false },
}

export default function NewLayout({ children }: { children: React.ReactNode }) {
  return children
}
