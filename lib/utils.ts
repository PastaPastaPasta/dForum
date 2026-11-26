/** Formatting + small utilities shared by the pages. */

export function formatRelativeTime(dateInput: number | string | Date | null | undefined): string {
  if (!dateInput) return ''
  const date = typeof dateInput === 'number'
    ? new Date(dateInput)
    : new Date(dateInput)
  if (Number.isNaN(date.getTime())) return ''
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo ago`
  return `${Math.floor(months / 12)}y ago`
}

export function formatDate(dateInput: number | string | Date | null | undefined): string {
  if (!dateInput) return ''
  const date = typeof dateInput === 'number' ? new Date(dateInput) : new Date(dateInput)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

export function shortId(id: string | null | undefined, head = 10): string {
  if (!id) return ''
  return id.length <= head ? id : `${id.slice(0, head)}…`
}

export function initials(name: string): string {
  const clean = name.replace(/[^a-zA-Z0-9 ]/g, '').trim()
  if (!clean) return '?'
  const parts = clean.split(/\s+/)
  const first = parts[0]?.[0] ?? '?'
  const second = parts.length > 1 ? parts[parts.length - 1][0] : ''
  return (first + second).toUpperCase()
}

/** Truncate to maxLen without cutting mid-word where possible. */
export function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text
  const cut = text.slice(0, maxLen)
  const lastSpace = cut.lastIndexOf(' ')
  return `${lastSpace > maxLen * 0.5 ? cut.slice(0, lastSpace) : cut}…`
}

export function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

export function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ')
}

/** Returns the URL unchanged when it is a safe http(s) link, otherwise null. */
export function safeHttpUrl(url: string | null | undefined): string | null {
  if (!url) return null
  const trimmed = url.trim()
  if (!trimmed) return null
  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return trimmed
  } catch {
    return null
  }
  return null
}

/** A moderated (hidden) document — body and listings must suppress it. */
export function isModerated(modState: number | null | undefined): boolean {
  return modState !== null && modState !== undefined
}
