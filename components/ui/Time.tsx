'use client'

import { useEffect, useState } from 'react'

const dateFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
const fullFmt = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' })

export function relative(ms: number, now = Date.now()): string {
  const s = Math.round((now - ms) / 1000)
  if (s < 45) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} h ago`
  const d = Math.round(h / 24)
  if (d < 7) return d === 1 ? 'yesterday' : `${d} days ago`
  return dateFmt.format(ms)
}

/** Absolute date in static HTML (no hydration mismatch); relative once mounted. */
export function Time({ at, className }: { at: number; className?: string }) {
  const [now, setNow] = useState<number | null>(null)
  useEffect(() => {
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(t)
  }, [])
  if (!at) return null
  return (
    <time dateTime={new Date(at).toISOString()} title={now ? fullFmt.format(at) : undefined} className={className}>
      {now ? relative(at, now) : dateFmt.format(at)}
    </time>
  )
}
