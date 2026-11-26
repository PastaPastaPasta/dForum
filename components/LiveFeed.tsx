'use client'

/**
 * Live-fill wrapper: renders `static` first (from the build-time snapshot) and
 * re-queries the platform after hydration. On failure leaves the static data
 * and reports it via `error` so the caller can show a retry state.
 * Pass `key` (e.g. the thread id) so the loader re-runs when the target changes.
 */
import { useEffect, useState } from 'react'

export function useLive<T>(loader: () => Promise<T>, key?: unknown): { live: T | null; loading: boolean; error: boolean } {
  const [live, setLive] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    // Drop stale content when the target changes — the snapshot fill stays
    // honest meanwhile instead of showing the previous target's data.
    setLive(null)
    setLoading(true)
    setError(false)
    // Defer the platform fetch until the browser is idle — every anonymous
    // visitor would otherwise pull the ~30 MB SDK chunk right after paint
    // just to fill the shell. rIC keeps the same behavior for real users
    // without gating first paint.
    const ric = typeof window !== 'undefined' && 'requestIdleCallback' in window
      ? (cb: () => void) => window.requestIdleCallback(cb, { timeout: 4000 })
      : (cb: () => void) => setTimeout(cb, 200)
    const handle = ric(() => {
      loader()
        .then((value) => {
          if (!cancelled) {
            setLive(value)
            setLoading(false)
          }
        })
        .catch(() => {
          if (!cancelled) {
            setError(true)
            setLoading(false)
          }
        })
    })
    return () => {
      cancelled = true
      if (typeof handle === 'number') {
        if (typeof window !== 'undefined' && 'cancelIdleCallback' in window) window.cancelIdleCallback(handle)
        else clearTimeout(handle)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return { live, loading, error }
}
