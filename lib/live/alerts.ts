'use client'

/**
 * Alerts for the signed-in member, read live: reactions to their posts (reaction.byRecipient)
 * and replies in threads they started (post.byThread). "Seen" is per browser.
 */
import { useEffect, useState } from 'react'
import type { RawDoc } from '@/lib/forum/types'
import { num, str } from '@/lib/forum/model'
import { queryPage } from './platform'

export interface Alert {
  kind: 'reaction' | 'reply'
  at: number
  actorId: string
  threadId: string
  threadTitle?: string
  postId: string
  reaction?: number
}

const seenKey = (id: string) => `dforum:alerts-seen:${id}`

export function alertsSeenAt(id: string): number {
  try { return Number(localStorage.getItem(seenKey(id)) ?? 0) || 0 } catch { return 0 }
}

export function markAlertsSeen(id: string, at = Date.now()) {
  try { localStorage.setItem(seenKey(id), String(at)) } catch { /* storage blocked */ }
  listeners.forEach((l) => l())
}

const listeners = new Set<() => void>()

export async function fetchAlerts(identityId: string): Promise<Alert[]> {
  const since = Date.now() - 60 * 24 * 3600_000
  const [reactions, threads] = await Promise.all([
    queryPage('reaction', { where: [['postOwnerId', '==', identityId], ['$createdAt', '>', since]], orderBy: [['$createdAt', 'desc']], limit: 50 }),
    queryPage('thread', { where: [['$ownerId', '==', identityId]], orderBy: [['$createdAt', 'desc']], limit: 15 }),
  ])
  const alerts: Alert[] = []
  for (const r of reactions.docs) {
    if (r.ownerId === identityId || (num(r, 'kind') ?? 0) === 0) continue
    alerts.push({ kind: 'reaction', at: r.updatedAt, actorId: r.ownerId, threadId: str(r, 'threadId') ?? '', postId: str(r, 'postId') ?? '', reaction: num(r, 'kind') })
  }
  const titles = new Map(threads.docs.map((t: RawDoc) => [t.id, str(t, 'title')]))
  const replies = await Promise.all(threads.docs.map((t) =>
    queryPage('post', { where: [['threadId', '==', t.id], ['$createdAt', '>', since]], orderBy: [['$createdAt', 'desc']], limit: 20 })
      .then((r) => r.docs).catch(() => [] as RawDoc[])))
  for (const p of replies.flat()) {
    if (p.ownerId === identityId) continue
    const threadId = str(p, 'threadId') ?? ''
    alerts.push({ kind: 'reply', at: p.createdAt, actorId: p.ownerId, threadId, threadTitle: titles.get(threadId), postId: p.id })
  }
  for (const a of alerts) if (!a.threadTitle) a.threadTitle = titles.get(a.threadId)
  return alerts.sort((a, b) => b.at - a.at)
}

export function useUnreadAlerts(identityId: string | null): number {
  const [count, setCount] = useState(0)
  useEffect(() => {
    if (!identityId) { setCount(0); return }
    let alive = true
    let cached: Alert[] = []
    const recount = () => alive && setCount(cached.filter((a) => a.at > alertsSeenAt(identityId)).length)
    const load = () => fetchAlerts(identityId).then((a) => { cached = a; recount() }).catch(() => undefined)
    const first = setTimeout(load, 2500)
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void load() }, 120_000)
    listeners.add(recount)
    return () => { alive = false; clearTimeout(first); clearInterval(timer); listeners.delete(recount) }
  }, [identityId])
  return count
}
