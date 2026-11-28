'use client'

import { useSession } from '@/lib/session'

/** Explains why a logged-in member can't write yet: the forum key is still loading, or this
 * browser no longer has it. Renders nothing once the key is ready. */
export function KeyNotice({ className = '' }: { className?: string }) {
  const { session, keyState, signOut } = useSession()
  if (!session || keyState === 'ready' || keyState === 'none') return null
  if (keyState === 'loading') return <p role="status" className={`text-sm text-ink-2 ${className}`}>Preparing your forum key…</p>
  return (
    <div role="alert" className={`panel flex flex-wrap items-center justify-between gap-3 px-4 py-3 ${className}`}>
      <p className="text-sm">This browser no longer has your forum key, so you can&apos;t post. Log in again to get a new one.</p>
      <button type="button" className="btn btn-primary" onClick={() => {
        const next = location.pathname + location.search
        void signOut().then(() => location.assign(`/login/?next=${encodeURIComponent(next)}`))
      }}>Log in again</button>
    </div>
  )
}
