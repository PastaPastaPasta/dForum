'use client'

/**
 * Batch-resolve profile display names for a set of identity ids.
 * Results are cached module-wide (names rarely change) and fall back to the
 * truncated id until loaded. Profiles hidden by a moderator resolve to
 * "Hidden profile" — never their name. A failed read is not cached: the next
 * render retries it.
 */
import { useEffect, useMemo, useState } from 'react'
import { query } from '@/lib/services/document-service'
import { shortId } from '@/lib/utils'

const cache = new Map<string, string>()

export function useProfileNames(ids: (string | null | undefined)[]): Record<string, string> {
  const key = ids.filter((x): x is string => Boolean(x)).join('|')
  const unique = useMemo(() => [...new Set(key.split('|').filter(Boolean))], [key])
  const [names, setNames] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {}
    for (const id of unique) if (cache.has(id)) init[id] = cache.get(id)!
    return init
  })
  useEffect(() => {
    let cancelled = false
    const missing = unique.filter((id) => !cache.has(id))
    if (missing.length === 0) return
    Promise.all(missing.map(async (id) => {
      try {
        const d = await query('profile', { where: [['$ownerId', '==', id]], limit: 1 })
        const doc = d[0]
        if (doc?.properties?.modState != null) {
          cache.set(id, 'Hidden profile')
          return [id, 'Hidden profile'] as const
        }
        const name = doc?.properties?.displayName
        const resolved = typeof name === 'string' && name.trim() ? name.trim() : shortId(id, 12)
        cache.set(id, resolved)
        return [id, resolved] as const
      } catch {
        // Not cached and not merged — the caller's own id-slice fallback
        // renders meanwhile; a later ids-change re-runs the effect.
        return null
      }
    })).then((entries) => {
      if (cancelled) return
      const concrete = entries.filter((e): e is [string, string] => e != null)
      if (concrete.length === 0) return
      setNames((prev) => ({ ...prev, ...Object.fromEntries(concrete) }))
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unique])
  // Merge the module cache at render time — an id another component already
  // resolved must not render as a truncated id just because this hook's first
  // render pre-dated the cache entry.
  const merged: Record<string, string> = {}
  for (const id of unique) {
    const v = names[id] ?? cache.get(id)
    if (v != null) merged[id] = v
  }
  return merged
}
