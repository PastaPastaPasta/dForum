'use client'

/**
 * Live-fill wrapper: renders `static` first (from the build-time snapshot) and
 * re-queries the platform after hydration. On failure leaves the static data.
 */
import { useEffect, useState } from 'react'

export function useLive<T>(loader: () => Promise<T>): { live: T | null; loading: boolean } {
  const [live, setLive] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    loader()
      .then((value) => {
        if (!cancelled) {
          setLive(value)
          setLoading(false)
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { live, loading }
}
