'use client'

import { useEffect, useState } from 'react'
import { formatDate, formatRelativeTime } from '@/lib/utils'

/**
 * Relative time that renders an absolute date on the server and in the
 * prerendered static HTML (no hydration mismatch), swapping to relative
 * time after mount.
 */
export function RelativeTime({ time, className, title }: { time: number | null | undefined; className?: string; title?: string }) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  if (!time) return null
  const iso = new Date(time).toISOString()
  return (
    <time dateTime={iso} className={className} title={title ?? iso}>
      {mounted ? formatRelativeTime(time) : formatDate(time)}
    </time>
  )
}
