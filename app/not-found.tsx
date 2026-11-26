'use client'

/**
 * 404 + live SPA fallback.
 *
 * Static export builds only the routes the snapshot knows about; threads,
 * forums and profiles created after the hourly snapshot have no
 * pre-built HTML. For those paths this page renders the same client
 * components live, so shared links to new content still work. Any other
 * URL gets the plain not-found page.
 *
 * The pre-hydrated HTML should be a neutral skeleton — a "Page not found"
 * flash before the client component mounts is worse than a loading state.
 */
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Navbar } from '@/components/Navbar'
import { Footer } from '@/components/Footer'
import ThreadClient from '@/components/ThreadClient'
import ForumClient from '@/components/ForumClient'
import ProfileClient from '@/components/ProfileClient'

export default function NotFound() {
  const [mode, setMode] = useState<{ kind: 'thread' | 'forum' | 'profile'; value: string } | null>(null)
  const [ready, setReady] = useState(false)
  const pathname = usePathname()

  useEffect(() => {
    setReady(true)
    const basePath = process.env.NEXT_PUBLIC_BASE_PATH || ''
    const fullPath = typeof window !== 'undefined' ? window.location.pathname : pathname
    const stripped = basePath && fullPath.startsWith(basePath) ? fullPath.slice(basePath.length) : fullPath
    const parts = stripped.split('/').filter(Boolean)
    const decode = (seg: string): string | null => {
      try { return decodeURIComponent(seg) } catch { return null }
    }
    try {
      if (parts.length === 2 && parts[0] === 't') {
        const value = decode(parts[1])
        setMode(value ? { kind: 'thread', value } : null)
      } else if (parts.length === 2 && parts[0] === 'f') {
        const value = decode(parts[1])
        setMode(value ? { kind: 'forum', value } : null)
      } else if (parts.length === 2 && parts[0] === 'u') {
        const value = decode(parts[1])
        setMode(value ? { kind: 'profile', value } : null)
      } else {
        setMode(null)
      }
    } catch {
      setMode(null)
    }
  }, [pathname])

  // Set the title once we know what we're rendering instead of the default 404.
  useEffect(() => {
    if (!ready) return
    const prev = document.title
    if (mode) {
      document.title = mode.kind === 'profile' ? 'Member profile · dForum' : mode.kind === 'forum' ? 'Forum · dForum' : 'Thread · dForum'
    }
    return () => { document.title = prev }
  }, [ready, mode])

  if (!ready) {
    return (
      <>
        <Navbar />
        <main id="main" tabIndex={-1} className="flex-1 flex items-center justify-center px-6">
          <div className="w-full max-w-3xl space-y-3">
            <span className="sr-only" role="status">Loading…</span>
            <div aria-hidden="true" className="h-4 w-24 rounded bg-[#18233c] animate-pulse" />
            <div aria-hidden="true" className="h-8 w-3/4 rounded bg-[#18233c] animate-pulse" />
            <div aria-hidden="true" className="h-4 w-1/2 rounded bg-[#18233c] animate-pulse" />
          </div>
        </main>
        <Footer />
      </>
    )
  }

  if (mode) {
    // The SPA fallback renders the same client components with no prerendered
    // data — they fall back to live queries (and their not-found states).
    if (mode.kind === 'thread') return <ThreadClient threadId={mode.value} snapshotThread={null} initialPosts={[]} />
    if (mode.kind === 'forum') return <ForumClient slug={mode.value} snapshot={null} />
    return <ProfileClient identityId={mode.value} snapshot={null} />
  }

  return (
    <>
      <Navbar />
      <main id="main" tabIndex={-1} className="flex-1 flex items-center justify-center px-6">
        <div className="text-center fade-up">
          <p className="text-sm uppercase tracking-widest text-[#93a1bd]">404</p>
          <h1 className="text-3xl font-bold mt-2">Page not found</h1>
          <p className="text-[#93a1bd] mt-2">That page is gone — or never was.</p>
          <Link href="/" className="mt-6 btn-primary px-4 py-2">
            Back to home
          </Link>
        </div>
      </main>
      <Footer />
    </>
  )
}
