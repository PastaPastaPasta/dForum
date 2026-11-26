import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Moderator console',
  description: 'dForum moderation console — moderator-only. Not indexed.',
  robots: { index: false, follow: false },
}

export default function ModerationLayout({ children }: { children: React.ReactNode }) {
  return children
}
