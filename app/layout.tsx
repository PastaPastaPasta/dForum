import type { Metadata, Viewport } from 'next'
import { IBM_Plex_Mono, IBM_Plex_Sans, Source_Serif_4 } from 'next/font/google'
import { SessionProvider } from '@/lib/session'
import { OfflineBanner } from '@/components/site/OfflineBanner'
import { Header } from '@/components/site/Header'
import { Footer } from '@/components/site/Footer'
import { site } from '@/lib/server/site-data'
import './globals.css'

const sans = IBM_Plex_Sans({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-sans', display: 'swap' })
const serif = Source_Serif_4({ subsets: ['latin'], weight: ['400', '600'], style: ['normal', 'italic'], variable: '--font-serif', display: 'swap' })
const mono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400'], variable: '--font-mono', display: 'swap' })

const SITE_URL = (process.env.SITE_URL || 'https://forum.dashhq.org').replace(/\/+$/, '')

export function generateMetadata(): Metadata {
  const s = site().settings
  const title = s.name || 'dForum'
  const description = s.tagline || s.description || 'The Dash community forum, stored on Dash Platform.'
  return {
    metadataBase: new URL(SITE_URL),
    title: { default: title, template: `%s | ${title}` },
    description,
    applicationName: title,
    alternates: { types: { 'application/rss+xml': '/feed.xml' } },
    openGraph: { title, description, type: 'website', siteName: title },
    twitter: { card: 'summary' },
  }
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#131e32' },
  ],
}

// Applies the saved theme before first paint (hashed into the CSP by scripts/csp.mjs).
const THEME_INIT = `try{var t=localStorage.getItem('dforum:theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}`

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const s = site()
  return (
    <html lang="en" className={`${sans.variable} ${serif.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
      </head>
      <body className="min-h-screen font-sans antialiased">
        <SessionProvider>
          <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-dash focus:px-4 focus:py-2 focus:text-dash-ink">
            Skip to content
          </a>
          <div className="flex min-h-screen flex-col">
            <Header siteName={s.settings.name || 'dForum'} />
            <OfflineBanner />
            <main id="main" className="mx-auto w-full max-w-page flex-1 px-4 pt-6">{children}</main>
            <Footer siteName={s.settings.name || 'dForum'} snapshotAt={s.snapshotAt} archiveSourceName={s.settings.archiveSourceName} archiveSourceUrl={s.settings.archiveSourceUrl} />
          </div>
        </SessionProvider>
      </body>
    </html>
  )
}
