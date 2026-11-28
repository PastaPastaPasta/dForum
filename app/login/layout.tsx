import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Log in with Dash',
  description: 'Log in with your Dash wallet to post, reply and react.',
  robots: { index: false },
}

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children
}
