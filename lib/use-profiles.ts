'use client'

/**
 * Display names for identities, resolved live: forum profile display name, then the identity's
 * Dash username (DPNS), else nothing (callers fall back to memberLabel). Results are cached for
 * the page's lifetime; a failed read is retried when the id set changes.
 */
import { useEffect, useMemo, useState } from 'react'
import { isHidden, str } from '@/lib/forum/model'
import { getSdk } from '@/lib/services/evo-sdk-service'
import { queryPage } from '@/lib/live/platform'

const cache = new Map<string, string>()
const listeners = new Set<() => void>()

async function resolve(ids: string[]): Promise<void> {
  const found = new Map<string, string>()
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100)
    const { docs } = await queryPage('profile', { where: [['$ownerId', 'in', chunk]], orderBy: [['$ownerId', 'asc']], limit: 100 })
    for (const d of docs) found.set(d.ownerId, isHidden(d) ? 'Hidden profile' : str(d, 'displayName') ?? '')
  }
  const sdk = await getSdk()
  const rest = ids.filter((id) => !found.get(id)).slice(0, 30)
  await Promise.all(rest.map(async (id) => {
    try {
      const name = await sdk.dpns.username(id)
      if (typeof name === 'string' && name) found.set(id, name.replace(/\.dash$/, ''))
    } catch { /* no username */ }
  }))
  for (const id of ids) cache.set(id, found.get(id) ?? '')
  listeners.forEach((l) => l())
}

export function useProfileNames(ids: (string | null | undefined)[]): Record<string, string> {
  const key = ids.filter((x): x is string => Boolean(x)).join('|')
  const unique = useMemo(() => [...new Set(key.split('|').filter(Boolean))], [key])
  const [, bump] = useState(0)
  useEffect(() => {
    const l = () => bump((n) => n + 1)
    listeners.add(l)
    const missing = unique.filter((id) => !cache.has(id))
    if (missing.length) void resolve(missing).catch(() => undefined)
    return () => { listeners.delete(l) }
  }, [unique])
  const out: Record<string, string> = {}
  for (const id of unique) {
    const v = cache.get(id)
    if (v) out[id] = v
  }
  return out
}
