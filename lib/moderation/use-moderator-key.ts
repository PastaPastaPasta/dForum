'use client'

/**
 * Holds the moderator's CRITICAL key for one console session. The key is entered in this tab,
 * checked against the identity and the on-chain roster, and wiped (signer freed, WIF dropped) on
 * tab hide, page hide, 10 minutes idle, explicit lock, or unmount. Nothing is persisted.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { getRoster, prepareModerator, validateCriticalKey, type ModerationIdentity, type Roster } from '@/lib/services/moderation-service'
import { hostIsLocal } from '@/lib/host'
import { redactWif } from '@/lib/redact'

const IDLE_MS = 10 * 60_000

export function useModeratorKey() {
  const [moderator, setModerator] = useState<ModerationIdentity | null>(null)
  const [roster, setRoster] = useState<Roster | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const ref = useRef<ModerationIdentity | null>(null)
  const idle = useRef<ReturnType<typeof setTimeout> | null>(null)

  const wipe = useCallback((reason?: string) => {
    const m = ref.current
    ref.current = null
    setModerator(null)
    if (m) {
      try { m.signer.free() } catch { /* already freed */ }
      if (reason) setNotice(`Key cleared ${reason}. Enter it again to continue.`)
    }
  }, [])

  const touch = useCallback(() => {
    if (idle.current) clearTimeout(idle.current)
    if (ref.current) idle.current = setTimeout(() => wipe('after 10 minutes without activity'), IDLE_MS)
  }, [wipe])

  useEffect(() => {
    const hidden = () => { if (document.visibilityState === 'hidden') wipe('when the tab was hidden') }
    const gone = () => wipe('when the page closed')
    document.addEventListener('visibilitychange', hidden)
    window.addEventListener('pagehide', gone)
    window.addEventListener('pointerdown', touch)
    window.addEventListener('keydown', touch)
    return () => {
      document.removeEventListener('visibilitychange', hidden)
      window.removeEventListener('pagehide', gone)
      window.removeEventListener('pointerdown', touch)
      window.removeEventListener('keydown', touch)
      if (idle.current) clearTimeout(idle.current)
      wipe()
    }
  }, [wipe, touch])

  const unlock = useCallback(async (identityId: string, wif: string) => {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const r = await getRoster(true)
      if (!r) throw new Error('Could not read the forum contract. Try again.')
      setRoster(r)
      const isOwner = r.ownerId === identityId
      if (!isOwner && !r.appointed.includes(identityId)) throw new Error('This identity is not on the contract’s moderator roster.')
      if (isOwner && !hostIsLocal(location.hostname)) {
        throw new Error('The owner key controls the whole contract. Use it only from a local build; moderate with an appointed moderator identity here.')
      }
      const check = await validateCriticalKey(identityId, wif.trim())
      if (!check.ok) throw new Error(check.reason ?? 'That key does not match the identity.')
      const m = await prepareModerator(identityId, wif.trim())
      ref.current = m
      setModerator(m)
      touch()
    } catch (e) {
      setError(redactWif(e instanceof Error ? e.message : String(e)))
    } finally {
      setBusy(false)
    }
  }, [touch])

  return { moderator, roster, error, notice, busy, unlock, lock: () => wipe('by you'), touch }
}
