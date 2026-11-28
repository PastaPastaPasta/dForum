'use client'

import { useMemo } from 'react'
import type { RawDoc } from '@/lib/forum/types'
import { isHidden, shortId, str } from '@/lib/forum/model'
import { useProfileNames } from '@/lib/use-profiles'

/** Display names: snapshot names, then live profile edits, then a live lookup for anyone new. */
export function useNames(initial: Record<string, string>, ids: string[], liveProfiles: RawDoc[] = []): (id: string) => string {
  const unknown = useMemo(() => ids.filter((id) => !initial[id]), [ids, initial])
  const fetched = useProfileNames(unknown)
  return useMemo(() => {
    const live = new Map<string, string>()
    for (const p of liveProfiles) live.set(p.ownerId, isHidden(p) ? 'Hidden profile' : str(p, 'displayName') ?? '')
    return (id: string) => live.get(id) || initial[id] || fetched[id] || shortId(id)
  }, [initial, fetched, liveProfiles])
}
