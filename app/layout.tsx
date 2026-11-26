import type { Metadata, Viewport } from 'next'
import { SessionProvider } from '@/lib/session'
import './globals.css'

const SITE_URL = (process.env.SITE_URL || 'https://forum.dashhq.org').replace(/\/+$/, '')

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'dForum — a forum on Dash Platform',
    template: '%s · dForum',
  },
  description: 'A decentralized forum on Dash Platform — centralized team moderation, all data on-chain, login with Dash.',
  applicationName: 'dForum',
  openGraph: {
    title: 'dForum — a forum on Dash Platform',
    description: 'A decentralized forum on Dash Platform.',
    type: 'website',
    siteName: 'dForum',
  },
  twitter: { card: 'summary_large_image' },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0b1220',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <meta
          httpEquiv="Content-Security-Policy"
          content="default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; connect-src 'self' https: wss:; worker-src 'self' blob:; child-src 'self' blob:; frame-src 'none'; base-uri 'self'; form-action 'self'"
        />
      </head>
      <body className="bg-[#0b1220] text-[#e8edf7] antialiased">
        <SessionProvider>
          <a
            href="#main"
            className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:bg-[#0070c0] focus:px-4 focus:py-2 focus:text-white"
          >
            Skip to content
          </a>
          <div className="min-h-screen flex flex-col">{children}</div>
        </SessionProvider>
      </body>
    </html>
  )
}
