import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Settings',
  description: 'Your dForum profile and session settings. Not indexed.',
  robots: { index: false },
}

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return children
}
