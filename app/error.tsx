'use client'

import Link from 'next/link'
import { useEffect } from 'react'

// Minimal, deliberately Navbar-free: if the error is caused by the header
// materializing (e.g. a navbar component that throws), the boundary must
// still render something that can recover. A loop here would be unrecoverable.
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error)
  }, [error])
  return (
    <main id="main" tabIndex={-1} className="flex-1 flex items-center justify-center px-6">
      <div className="text-center fade-up">
        <p className="text-sm uppercase tracking-widest text-[#93a1bd]">Something went wrong</p>
        <h1 className="text-2xl font-bold mt-2">This page hit an error</h1>
        <p className="text-[#93a1bd] mt-2">Try again, or head back to the home page.</p>
        <div className="mt-6 flex items-center justify-center gap-3">
          <button onClick={reset} className="btn-primary px-4 py-2">Try again</button>
          <Link href="/" className="rounded-lg border border-[#22304e] bg-[#111a2e] px-4 py-2 text-sm text-[#93a1bd] hover:border-[#008CE7] hover:text-white transition">
            Back to home
          </Link>
        </div>
      </div>
    </main>
  )
}
