'use client'

/**
 * Batch-resolve profile display names for a set of identity ids.
 * Results are cached module-wide (names rarely change) and fall back to the
 * truncated id until loaded. Profiles hidden by a moderator resolve to
 * "Hidden profile" — never their name. A failed read is not cached and is
 * retried only when the set of ids changes (the effect key) — an unchanged
 * id set keeps the shortened id on screen rather than looping fetches.
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

    const resolveName = (doc: { properties?: Record<string, unknown> } | undefined, id: string): [string, string] => {
      if (doc?.properties?.modState != null) return [id, 'Hidden profile'] as const
      const name = doc?.properties?.displayName
      const resolved = typeof name === 'string' && name.trim() ? name.trim() : shortId(id, 12)
      return [id, resolved] as const
    }

    // One batched read per 100 ids (byOwner unique index, `in` accepts up to
    // 100) instead of one query per id — a full thread page fans out to ~100
    // requests otherwise. On failure the batch is dropped and we fall back to
    // the per-id path, so a broken `in` never hides names entirely.
    const perId = async (id: string) => {
      try {
        const d = await query('profile', { where: [['$ownerId', '==', id]], limit: 1 })
        return resolveName(d[0], id)
      } catch {
        return null
      }
    }
    const batch = async (): Promise<[string, string][]> => {
      const out: [string, string][] = []
      for (let i = 0; i < missing.length; i += 100) {
        const chunk = missing.slice(i, i + 100)
        try {
          const docs = await query('profile', { where: [['$ownerId', 'in', chunk]], limit: 100 })
          const byOwner = new Map(docs.map((d) => [d.ownerId, d]))
          for (const id of chunk) {
            const doc = byOwner.get(id)
            out.push(resolveName(doc, id))
          }
        } catch {
          // Fallback for this chunk only.
          const fallback = await Promise.all(chunk.map(perId))
          for (const entry of fallback) if (entry) out.push([entry[0], entry[1]])
        }
      }
      return out
    }

    batch().then((entries) => {
      if (cancelled) return
      const concrete = entries.filter((e): e is [string, string] => e != null)
      if (concrete.length === 0) return
      for (const [id, name] of concrete) cache.set(id, name)
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
