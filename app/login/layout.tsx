import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Login with Dash',
  description: 'Sign in to dForum with your Dash identity. Not indexed.',
  robots: { index: false },
}

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children
}
