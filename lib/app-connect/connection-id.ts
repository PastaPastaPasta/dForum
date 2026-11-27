/**
 * The connection id: 16 random bytes per (browser install, network), kept
 * across logouts so a re-login supersedes the earlier grant (the wallet
 * disables the old keys for the same (identity, appId, CONNECTION_ID))
 * instead of accreting a fresh grant on every sign-in.
 */

const STORAGE_KEY = 'dforum:app-connect:connection-id'

export function getConnectionId(): string | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw && /^[0-9a-f]{32}$/.test(raw)) return raw
  } catch {
    return null
  }
  return null
}

export function ensureConnectionId(): string {
  if (typeof window === 'undefined') return ''
  const existing = getConnectionId()
  if (existing) return existing
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  const id = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  try {
    window.localStorage.setItem(STORAGE_KEY, id)
  } catch {
    // A read-only storage (indexedDB blocked, private mode) — the flow still
    // works: a fresh id per start is a new grant, not a security hole.
  }
  return id
}
