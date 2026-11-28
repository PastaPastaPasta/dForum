'use client'

import Link from 'next/link'
import { useEffect } from 'react'
import { redactWif } from '@/lib/redact'

// Minimal, deliberately Navbar-free: if the error is caused by the header
// materializing (e.g. a navbar component that throws), the boundary must
// still render something that can recover. A loop here would be unrecoverable.
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // The error surface is keyMaterial-adjacent — scrub before it lands in
    // any log sink.
    console.error(redactWif(error?.message ?? error))
  }, [error])
  return (
    <main id="main" tabIndex={-1} className="flex-1 flex items-center justify-center px-6">
      <div className="text-center ">
        <p className="text-sm uppercase tracking-widest text-ink-2">Something went wrong</p>
        <h1 className="text-2xl font-bold mt-2">This page hit an error</h1>
        <p className="text-ink-2 mt-2">Try again, or head back to the home page.</p>
        <div className="mt-6 flex items-center justify-center gap-3">
          <button onClick={reset} className="btn btn-primary px-4 py-2">Try again</button>
          <Link href="/" className="btn btn-quiet px-4 py-2">
            Back to home
          </Link>
        </div>
      </div>
    </main>
  )
}
