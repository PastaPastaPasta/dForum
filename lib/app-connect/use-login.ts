'use client'

/**
 * App Connect v2 (dashpay://connect) — dForum's sign-in hook.
 *
 * Flow: prepare (one fresh ephemeral key + request) → waiting (QR) →
 * confirm (one or more verified identities) → accepted (session created),
 * with `timeout`, `too-many` (candidate spam) and `error` states. Nothing
 * is signed by this hook: the wallet registers and publishes, the app
 * verifies the answer on chain and stores the grant as a tab session.
 *
 * Deliberately simple: no identity hint (no renewal), no callback, no
 * persisted request — a reload restarts the sign-in.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as secp256k1 from '@noble/secp256k1'
import {
  clearSensitiveBytes,
  getYapprPublicKey,
  appConnectRequestHash,
  appConnectCandidateKey,
  appConnectPollDelayMs,
  listAppConnectCandidates,
  verifyAppConnectCandidate,
  APP_CONNECT_MAX_REQUEST_AGE_MS,
  type AppConnectGrant,
  type AppConnectCandidate,
} from 'platform-auth'
import { NETWORK } from '@/lib/constants'
import type { PlatformAuthController } from 'platform-auth'
import { APP_CONNECT_MIN_PROTOCOL_VERSION } from './config'
import { appConnectChainStatus, createAppConnectIdentityPort, createAppConnectResponsePort } from './port'
import { buildDForumAppConnectRequest, buildDForumAppConnectUris } from './request'
import { ensureConnectionId } from './connection-id'
import { encodeWifForNetwork } from '@/lib/auth/decoder'
import type { YapprKeyExchangeNetworkName } from 'platform-auth'

export type AppConnectLoginPhase =
  | 'preparing'
  | 'waiting'
  | 'confirm'
  | 'accepted'
  | 'timeout'
  | 'too-many'
  | 'error'

export interface AppConnectCandidateView {
  identityId: string
  grant: AppConnectGrant
}

export interface AppConnectLoginState {
  phase: AppConnectLoginPhase
  /** The carrier URIs, primary first — rendered as the QR + a copyable link. */
  uris: Array<{ carrier: 'dashpay' | 'dash-key'; uri: string }> | null
  candidates: AppConnectCandidateView[]
  /** Seconds until the request would be refused (it stays open for the wallet to answer). */
  remainingSeconds: number | null
  error: string | null
  /** Accept the chosen identity: stores the session key, signs in, wipes the grant. */
  accept: (identityId: string) => Promise<boolean>
  /** Start fresh: wipes the request and generates a new one. */
  retry: () => void
  /** Stop polling and wipe everything (unmount / close). */
  cancel: () => void
}

const RETRY_WINDOW_MS = 15_000
const MAX_VERIFY_ATTEMPTS = 3

interface ActiveRequest {
  privateKey: Uint8Array
  request: ReturnType<typeof buildDForumAppConnectRequest>
  hash: Uint8Array
  uris: Array<{ carrier: 'dashpay' | 'dash-key'; uri: string }>
  createdAt: number
}

interface CandidateProgress {
  firstSeen: number
  attempts: number
  done: boolean
}

function wakeableDelay(ms: number, signal: AbortSignal, wakeRef: { current: (() => void) | null }): Promise<void> {
  return new Promise((resolve) => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      resolve()
    }
    const onAbort = () => finish()
    const timer = setTimeout(finish, ms)
    signal.addEventListener('abort', onAbort, { once: true })
    wakeRef.current = finish
  })
}

function wipeGrant(grant: AppConnectGrant): void {
  for (const key of [...grant.authKeys, ...grant.encryptionKeys]) clearSensitiveBytes(key.privateKey)
}

function networkName(): YapprKeyExchangeNetworkName {
  return NETWORK === 'mainnet' ? 'mainnet' : 'testnet'
}

export function useAppConnectLogin(controller: PlatformAuthController): AppConnectLoginState {
  const [phase, setPhase] = useState<AppConnectLoginPhase>('preparing')
  const [uris, setUris] = useState<Array<{ carrier: 'dashpay' | 'dash-key'; uri: string }> | null>(null)
  const [candidates, setCandidates] = useState<AppConnectCandidateView[]>([])
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const activeRef = useRef<ActiveRequest | null>(null)
  const generationRef = useRef(0)
  const abortRef = useRef<AbortController | null>(null)
  const wakeRef = useRef<(() => void) | null>(null)
  const progressRef = useRef<Map<string, CandidateProgress>>(new Map())
  const verifiedRef = useRef<AppConnectCandidateView[]>([])
  const disposedRef = useRef(false)

  const identityPort = useMemo(() => createAppConnectIdentityPort(), [])
  const responsePort = useMemo(() => createAppConnectResponsePort(), [])

  const stopPolling = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    wakeRef.current = null
  }, [])

  const resetVerified = useCallback(() => {
    for (const candidate of verifiedRef.current) wipeGrant(candidate.grant)
    verifiedRef.current = []
    setCandidates([])
  }, [])

  const wipeActive = useCallback(() => {
    if (activeRef.current) {
      clearSensitiveBytes(activeRef.current.privateKey)
      activeRef.current = null
    }
  }, [])

  const wipeAll = useCallback(() => {
    stopPolling()
    resetVerified()
    wipeActive()
  }, [stopPolling, resetVerified, wipeActive])

  const start = useCallback(async () => {
    if (disposedRef.current) return
    const generation = ++generationRef.current
    const current = () => !disposedRef.current && generationRef.current === generation
    stopPolling()
    resetVerified()
    wipeActive()
    setPhase('preparing')
    setError(null)
    setUris(null)
    setRemainingSeconds(null)

    try {
      // The protocol check: bound keys only exist from protocol 14; a wallet
      // cannot answer a request the chain would refuse.
      try {
        const { protocolVersion } = await appConnectChainStatus()
        if (!current()) return
        if (protocolVersion < APP_CONNECT_MIN_PROTOCOL_VERSION) {
          setError(`dForum requires Platform protocol ${APP_CONNECT_MIN_PROTOCOL_VERSION} — this network runs ${protocolVersion}.`)
          setPhase('error')
          return
        }
      } catch (err) {
        if (!current()) return
        setError(err instanceof Error ? err.message : 'Could not reach the platform')
        setPhase('error')
        return
      }

      const connectionIdHex = ensureConnectionId()
      const connectionId = new Uint8Array(16)
      for (let i = 0; i < 16; i++) connectionId[i] = parseInt(connectionIdHex.slice(i * 2, i * 2 + 2), 16)

      const privateKey = secp256k1.utils.randomSecretKey()
      const publicKey = getYapprPublicKey(privateKey)
      const request = buildDForumAppConnectRequest({
        appEphemeralPubKey: publicKey,
        connectionId,
        createdAt: Date.now(),
      })
      const hash = appConnectRequestHash(request)
      const carrierUris = buildDForumAppConnectUris(request, networkName())

      if (!current()) {
        clearSensitiveBytes(privateKey)
        return
      }

      activeRef.current = { privateKey, request, hash, uris: [...carrierUris], createdAt: request.createdAt }
      setUris(carrierUris)
      setPhase('waiting')

      const abort = new AbortController()
      abortRef.current = abort
      void pollLoop(abort.signal, generation, current)
    } catch (err) {
      if (!current()) return
      clearSensitiveBytes(activeRef.current?.privateKey ?? new Uint8Array(32))
      activeRef.current = null
      setError(err instanceof Error ? err.message : 'Could not prepare the sign-in request')
      setPhase('error')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stopPolling, resetVerified, wipeActive])

  async function pollLoop(signal: AbortSignal, generation: number, current: () => boolean): Promise<void> {
    for (;;) {
      if (signal.aborted || !current()) return
      try {
        await pollOnce(signal, current)
      } catch {
        // A failed read is retried on the next tick; it says nothing about the request.
      }
      const active = activeRef.current
      if (!active || signal.aborted || !current()) return
      const delay = appConnectPollDelayMs(Date.now() - active.createdAt)
      if (delay === null) {
        if (verifiedRef.current.length === 0) setPhase('timeout')
        return
      }
      await wakeableDelay(delay, signal, wakeRef)
      wakeRef.current = null
    }
  }

  async function pollOnce(signal: AbortSignal, current: () => boolean): Promise<void> {
    const active = activeRef.current
    if (!active) return
    const { candidates: list, truncated } = await listAppConnectCandidates(responsePort, active.hash, {})
    if (signal.aborted || !current()) return
    if (truncated) {
      setError('Too many responses to this request — start again.')
      setPhase('too-many')
      wipeActive()
      return
    }
    const pending = list.filter((candidate) => needsVerification(candidate))
    if (pending.length === 0) return

    let now = Date.now()
    try {
      now = (await appConnectChainStatus()).blockTimeMs || now
    } catch {
      // The wall clock stands in for the block time.
    }

    let verifiedNow = false
    for (const candidate of pending) {
      if (signal.aborted || !current()) return
      const progress = progressRef.current.get(appConnectCandidateKey(candidate)) as CandidateProgress
      progress.attempts += 1
      const result = await verifyAppConnectCandidate({
        request: active.request,
        appEphemeralPrivateKey: active.privateKey,
        candidate,
        identity: identityPort,
        now,
      })
      if (signal.aborted || !current()) {
        if (result.ok) wipeGrant(result.grant)
        return
      }
      if (result.ok) {
        progress.done = true
        verifiedNow = true
        // An identity that republished replaces its earlier answer; wipe that one's keys.
        for (const replaced of verifiedRef.current.filter((v) => v.identityId === result.grant.identityId)) {
          wipeGrant(replaced.grant)
        }
        verifiedRef.current = [
          ...verifiedRef.current.filter((v) => v.identityId !== result.grant.identityId),
          { identityId: result.grant.identityId, grant: result.grant },
        ]
      } else if (!result.retryable || progress.attempts >= MAX_VERIFY_ATTEMPTS || Date.now() - progress.firstSeen > RETRY_WINDOW_MS) {
        progress.done = true
      }
    }
    if (verifiedNow) setCandidates([...verifiedRef.current])
    if (verifiedRef.current.length > 0 && verifiedNow) setPhase('confirm')
  }

  function needsVerification(candidate: AppConnectCandidate): boolean {
    const key = appConnectCandidateKey(candidate)
    const progress = progressRef.current.get(key)
    if (!progress) {
      progressRef.current.set(key, { firstSeen: Date.now(), attempts: 0, done: false })
      return true
    }
    return !progress.done
  }

  const accept = useCallback(async (identityId: string) => {
    const chosen = verifiedRef.current.find((candidate) => candidate.identityId === identityId) ?? null
    if (!chosen) return false
    // Stop polling while this is in flight — a fresh answer must not re-verify
    // (and re-wipe) the grants this accept is about to wipe.
    stopPolling()
    // Wipe every other grant right away — only the chosen identity's keys
    // should survive the sign-in.
    for (const other of verifiedRef.current.filter((v) => v !== chosen)) wipeGrant(other.grant)
    const grant = chosen.grant
    try {
      const authKey = grant.authKeys.find((key) => key.bindingIndex === 0) ?? grant.authKeys[0]
      if (!authKey) {
        wipeGrant(grant)
        resetVerified()
        setError('No contract-bound key was granted — nothing to sign with.')
        setPhase('error')
        return false
      }
      // A grant whose private key came back zeroed can never sign — refuse
      // before asking the vendored controller to store it (it does not check).
      if (authKey.privateKey.every((b) => b === 0)) {
        wipeGrant(grant)
        resetVerified()
        setError('The granted key came back empty — start again.')
        setPhase('error')
        return false
      }
      const authKeyWif = encodeWifForNetwork(authKey.privateKey, NETWORK, true)
      wipeGrant(grant)
      await controller.loginWithAuthKey(identityId, authKeyWif, { skipUsernameCheck: true })
      setPhase('accepted')
      wipeActive()
      return true
    } catch (err) {
      try { wipeGrant(grant) } catch { /* already wiped */ }
      // Everything was wiped — drop the verified list so a new answer can't
      // be listed against grants that no longer exist.
      resetVerified()
      setError(err instanceof Error ? err.message : 'Signing you in failed')
      setPhase('error')
      return false
    }
  }, [controller, stopPolling, wipeActive, resetVerified])

  const retry = useCallback(() => {
    wipeAll()
    void start()
  }, [start, wipeAll])

  const cancel = useCallback(() => {
    wipeAll()
    setPhase('preparing')
    setUris(null)
    setError(null)
    setRemainingSeconds(null)
  }, [wipeAll])

  // Re-poll immediately on focus (the wallet may have answered just now).
  useEffect(() => {
    const onFocus = () => wakeRef.current?.()
    const onVisibility = () => {
      if (document.visibilityState === 'visible') wakeRef.current?.()
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  // Request-age ticker — the wallet refuses stale requests (10 min).
  useEffect(() => {
    if (phase !== 'waiting' && phase !== 'confirm') return
    const timer = setInterval(() => {
      const active = activeRef.current
      if (!active) return
      const remainingMs = APP_CONNECT_MAX_REQUEST_AGE_MS - (Date.now() - active.createdAt)
      setRemainingSeconds(remainingMs > 0 ? Math.max(0, Math.ceil(remainingMs / 1000)) : 0)
    }, 1000)
    return () => clearInterval(timer)
  }, [phase])

  // Start once on mount; wipe on unmount.
  useEffect(() => {
    disposedRef.current = false
    void start()
    return () => {
      disposedRef.current = true
      generationRef.current += 1
      wipeAll()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return {
    phase,
    uris,
    candidates,
    remainingSeconds,
    error,
    accept,
    retry,
    cancel,
  }
}
