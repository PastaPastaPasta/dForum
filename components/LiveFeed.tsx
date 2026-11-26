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
    setLoading(true)
    setError(false)
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
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return { live, loading, error }
}
