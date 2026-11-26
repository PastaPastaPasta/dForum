'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Shield, Ban, Undo2, Clock, AlertTriangle, Trash2, Bell, BellOff, Loader2, ShieldCheck,
  Eye, EyeOff, Pin, Lock, Unlock, KeyRound, Search, RefreshCw, ShieldAlert, ExternalLink,
} from 'lucide-react'
import { Navbar } from '@/components/Navbar'
import { Footer } from '@/components/Footer'
import { query, get } from '@/lib/services/document-service'
import {
  prepareModerator, validateCriticalKey, getRoster, moderationStatus,
  banUser, unbanUser, suspendUser, unsuspendUser, warnUser, clearWarnings,
  changeDocumentFields, deleteDocument, type ModerationIdentity, type Roster,
} from '@/lib/services/moderation-service'
import { earliestOwnerPost } from '@/lib/services/orphan'
import { CONTRACT_ID, NETWORK } from '@/lib/constants'
import { shortId, formatDate, formatRelativeTime } from '@/lib/utils'
import { hostIsLocal, hostIsCanonical, canonicalHost } from '@/lib/host'
import { useFrameBuster } from '@/lib/use-frame-buster'

// The CRITICAL key lives only in this tab's memory — never in storage, never
// written anywhere except the platform's request. “Dropped from app state”,
// not a guarantee about memory: JS strings can't be zeroed, and the WASM
// signer is freed on wipe (free()) and on navigation.
const CRITICAL_ID_STORAGE = 'dforum:moderator:identityId'
const DOC_PAGE_SIZE = 12
const IDLE_WIPE_MS = 10 * 60 * 1000

interface StatusData {
  banned?: boolean
  banReason?: { text: string } | null
  suspendedUntil?: bigint | null
  suspensionReason?: { text: string } | null
  warnings?: Array<{ reason?: { text: string } | null; createdAtEpoch?: number }>
}

interface ModeratableDoc {
  id: string
  type: 'thread' | 'post'
  title: string
  ownerId: string
  createdAt: number
  sticky?: boolean | null
  lockedAt?: number | null
  modState?: number | null
}

export default function ModerationPage() {
  const [identityId, setIdentityId] = useState('')
  const [wif, setWif] = useState('')
  const [admin, setAdmin] = useState<ModerationIdentity | null>(null)
  const [validating, setValidating] = useState(false)
  const [validation, setValidation] = useState<{ ok: boolean; reason?: string } | null>(null)

  const [host, setHost] = useState('')
  const [roster, setRoster] = useState<Roster | null>(null)
  const [rosterError, setRosterError] = useState(false)
  const [targetId, setTargetId] = useState('')
  const [status, setStatus] = useState<StatusData | null>(null)
  const [statusLoading, setStatusLoading] = useState(false)
  const [banReason, setBanReason] = useState('')
  const [warnReason, setWarnReason] = useState('')
  const [suspendHours, setSuspendHours] = useState('24')
  const [suspendReason, setSuspendReason] = useState('')
  const [actionBusy, setActionBusy] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionSuccess, setActionSuccess] = useState<string | null>(null)
  const [statusForId, setStatusForId] = useState<string | null>(null)

  const [docs, setDocs] = useState<ModeratableDoc[]>([])
  const [docsLoading, setDocsLoading] = useState(true)
  const [docsError, setDocsError] = useState(false)
  const [docActionBusy, setDocActionBusy] = useState<string | null>(null)
  const [threadsAfter, setThreadsAfter] = useState<string | null>(null)
  const [postsAfter, setPostsAfter] = useState<string | null>(null)
  const [threadsMore, setThreadsMore] = useState(true)
  const [postsMore, setPostsMore] = useState(true)
  const [lookupId, setLookupId] = useState('')
  const [lookupBusy, setLookupBusy] = useState(false)
  const [lookupDoc, setLookupDoc] = useState<ModeratableDoc | null>(null)
  const [lookupError, setLookupError] = useState<string | null>(null)

  const [wipedNotice, setWipedNotice] = useState<string | null>(null)
  const signerRef = useRef<{ free(): void } | null>(null)
  const wipeGenRef = useRef(0)
  const mountedRef = useRef(true)
  const pathnameRef = useRef<string>('')
  const frameState = useFrameBuster()

  // Internal wipe: bump the wipe generation, free the signer, zero all state.
  // Never shows a notice (used by unmount cleanup where no one is watching).
  const internalWipe = useCallback(() => {
    wipeGenRef.current += 1
    try { signerRef.current?.free() } catch { /* already freed */ }
    signerRef.current = null
    setWif('')
    setAdmin(null)
    setValidation(null)
    setValidating(false)
    setStatus(null)
    setStatusForId(null)
    setActionSuccess(null)
  }, [])

  // User-facing wipe — also explains why the key was cleared.
  const wipe = useCallback((reason: string) => {
    internalWipe()
    if (mountedRef.current) setWipedNotice(reason)
  }, [internalWipe])

  useEffect(() => {
    mountedRef.current = true
    // Read the host after hydration — during prerender there is no window.
    setHost(typeof window !== 'undefined' ? window.location.hostname : '')
    try {
      const storedId = sessionStorage.getItem(CRITICAL_ID_STORAGE)
      if (storedId) setIdentityId(storedId)
    } catch { /* ignore */ }
    const onPageHide = () => wipe('cleared when the tab closed')
    const onBeforeUnload = () => wipe('cleared before the tab closed')
    // The console is a CRITICAL-key surface: the tab being hidden wipes the
    // key rather than letting it linger.
    const onVisibility = () => { if (document.visibilityState === 'hidden') wipe('cleared when the tab was hidden') }
    window.addEventListener('pagehide', onPageHide)
    window.addEventListener('beforeunload', onBeforeUnload)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      mountedRef.current = false
      window.removeEventListener('pagehide', onPageHide)
      window.removeEventListener('beforeunload', onBeforeUnload)
      document.removeEventListener('visibilitychange', onVisibility)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Idle auto-wipe: drop the key after 10 minutes without interaction.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const reset = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => wipe('cleared after 10 minutes of inactivity'), IDLE_WIPE_MS)
    }
    reset()
    const onActivity = () => reset()
    window.addEventListener('pointerdown', onActivity)
    window.addEventListener('keydown', onActivity)
    return () => {
      if (timer) clearTimeout(timer)
      window.removeEventListener('pointerdown', onActivity)
      window.removeEventListener('keydown', onActivity)
    }
  }, [wipe])

  // Free the signer on unmount and invalidate in-flight actions.
  useEffect(() => {
    return () => {
      wipeGenRef.current += 1
      try { signerRef.current?.free() } catch { /* freed */ }
      signerRef.current = null
    }
  }, [])

  const bailIfWiped = useCallback((gen: number) => gen !== wipeGenRef.current || !mountedRef.current, [])

  const loadDocs = useCallback(async (append = false) => {
    setDocsLoading(true)
    setDocsError(false)
    try {
      const [threads, posts] = await Promise.all([
        query('thread', {
          orderBy: [['$createdAt', 'desc']],
          limit: DOC_PAGE_SIZE,
          ...(append && threadsAfter ? { startAfter: threadsAfter } : {}),
        } as never),
        query('post', {
          orderBy: [['$createdAt', 'desc']],
          limit: DOC_PAGE_SIZE,
          ...(append && postsAfter ? { startAfter: postsAfter } : {}),
        } as never),
      ])
      const mapped: ModeratableDoc[] = [
        ...threads.map((t) => ({
          id: t.id,
          type: 'thread' as const,
          title: (t.properties.title as string) ?? '(untitled)',
          ownerId: t.ownerId || '',
          createdAt: t.createdAt,
          sticky: Boolean(t.properties.sticky),
          lockedAt: (t.properties.lockedAt as number | null) ?? null,
          modState: (t.properties.modState as number | null) ?? null,
        })),
        ...posts.map((p) => ({
          id: p.id,
          type: 'post' as const,
          title: ((p.properties.body as string) ?? '').slice(0, 90) || '(empty)',
          ownerId: p.ownerId || '',
          createdAt: p.createdAt,
          modState: (p.properties.modState as number | null) ?? null,
        })),
      ]
      setThreadsAfter(threads[threads.length - 1]?.id ?? null)
      setThreadsMore(threads.length === DOC_PAGE_SIZE)
      setPostsAfter(posts[posts.length - 1]?.id ?? null)
      setPostsMore(posts.length === DOC_PAGE_SIZE)
      setDocs((prev) => (append ? [...prev, ...mapped] : mapped))
    } catch {
      setDocsError(true)
      if (!append) setDocs([])
    } finally {
      setDocsLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadsAfter, postsAfter])

  useEffect(() => {
    getRoster()
      .then((r) => { if (mountedRef.current) { setRoster(r); setRosterError(false) } })
      .catch(() => { if (mountedRef.current) { setRoster(null); setRosterError(true) } })
    loadDocs()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function retryRoster() {
    setRosterError(false)
    try {
      const r = await getRoster()
      if (mountedRef.current) setRoster(r)
    } catch {
      if (mountedRef.current) { setRoster(null); setRosterError(true) }
    }
  }

  const identityTrim = identityId.trim()
  const isOwner = Boolean(roster?.ownerId && identityTrim && roster.ownerId === identityTrim)
  const isAppointed = Boolean(roster?.appointed.includes(identityTrim))
  const isModerator = isOwner || isAppointed

  const hostIsCanon = hostIsCanonical(host)
  const localhost = hostIsLocal(host)

  async function handleValidate() {
    if (!hostIsCanon) return // hard refusal on non-canonical hosts (H1)
    if (!identityId.trim() || !wif.trim()) return
    const gen = wipeGenRef.current
    const identity = identityId.trim()
    const key = wif.trim()
    setValidating(true)
    setValidation(null)
    try {
      sessionStorage.setItem(CRITICAL_ID_STORAGE, identity)
      const result = await validateCriticalKey(identity, key)
      if (bailIfWiped(gen)) return // wiped mid-validation — bail
      setValidation(result)
      if (!result.ok) {
        setAdmin(null)
        return
      }
      // Roster check — fail closed: a fresh, forced fetch; missing or errored
      // reads refuse rather than trust the cached roster.
      const freshRoster = await getRoster(true).catch(() => null)
      if (bailIfWiped(gen)) return
      if (!freshRoster || !freshRoster.ownerId) {
        setValidation({ ok: false, reason: 'Could not read the contract roster — refusing to sign. Retry in a moment.' })
        setAdmin(null)
        return
      }
      setRoster(freshRoster)
      const ownerNow = freshRoster.ownerId === identity
      const memberNow = freshRoster.appointed.includes(identity)
      if (ownerNow && !localhost) {
        setValidation({ ok: false, reason: 'The owner key is refused on non-localhost hosts — the owner keeps a full contract-authority key offline. Use an appointed moderator identity, or run this console on localhost.' })
        setAdmin(null)
        return
      }
      if (!ownerNow && !memberNow) {
        setValidation({ ok: false, reason: 'This identity is not the owner or an appointed moderator of the contract.' })
        setAdmin(null)
        return
      }
      // Free the previous signer before installing a new one — a re-validate
      // must not leak a live WASM handle.
      try { signerRef.current?.free() } catch { /* already freed */ }
      signerRef.current = null
      const prepared = await prepareModerator(identity, key)
      if (bailIfWiped(gen)) {
        try { prepared.signer.free() } catch { /* freed */ }
        return // wiped mid-prepare — drop the signer we just built
      }
      // The WIF never leaves this memory path — drop it immediately.
      setWif('')
      signerRef.current = prepared.signer
      setAdmin(prepared)
      setValidation({ ok: true })
    } catch (e) {
      if (bailIfWiped(gen)) return
      setValidation({ ok: false, reason: e instanceof Error ? e.message : 'Validation failed' })
      setAdmin(null)
    } finally {
      if (!bailIfWiped(gen)) setValidating(false)
    }
  }

  async function handleClearAdmin() {
    internalWipe()
    setWipedNotice(null)
    sessionStorage.removeItem(CRITICAL_ID_STORAGE)
    setIdentityId('')
    setTargetId('')
  }

  async function refreshStatus() {
    if (!targetId.trim()) return
    const gen = wipeGenRef.current
    setStatusLoading(true)
    setActionError(null)
    try {
      const s = await moderationStatus(targetId.trim())
      if (bailIfWiped(gen)) return
      setStatus(s as unknown as StatusData)
      setStatusForId(targetId.trim())
    } catch (e) {
      if (bailIfWiped(gen)) return
      setStatus(null)
      setActionError(e instanceof Error ? e.message : 'Could not fetch status')
    } finally {
      setStatusLoading(false)
    }
  }

  async function act(busyKey: string, fn: () => Promise<void>, confirm?: string, success?: string) {
    if (confirm && !window.confirm(confirm)) return
    const gen = wipeGenRef.current
    setActionBusy(busyKey)
    setActionError(null)
    setActionSuccess(null)
    try {
      await fn()
      if (bailIfWiped(gen)) return
      await refreshStatus()
      if (bailIfWiped(gen)) return
      if (success) setActionSuccess(success)
    } catch (e) {
      if (bailIfWiped(gen)) return
      setActionError(e instanceof Error ? e.message : 'Action failed')
    } finally {
      setActionBusy(null)
    }
  }

  /** Read the post so we can see whether it is its thread's opening post. */
  async function openingPostOf(postId: string): Promise<{ threadId: string; opening: { id: string } | null } | null> {
    const post = await get('post', postId)
    if (!post) return null
    const threadId = (post.properties as Record<string, unknown>).threadId as string | undefined
    if (!threadId) return null
    const thread = await get('thread', threadId)
    if (!thread || !thread.ownerId) return null
    const opening = await earliestOwnerPost(threadId, thread.ownerId, thread.createdAt)
    return { threadId, opening: opening ? { id: opening.id } : null }
  }

  async function toggleSticky(doc: ModeratableDoc) {
    if (!admin) return
    const gen = wipeGenRef.current
    if (!window.confirm(`${doc.sticky ? 'Unpin' : 'Pin'} this thread?`)) return
    setDocActionBusy(`${doc.id}:sticky`)
    setActionError(null)
    try {
      await changeDocumentFields(admin, 'thread', doc.id, { sticky: doc.sticky ? null : true }, 'sticky toggle')
      if (bailIfWiped(gen)) return
      setDocs((prev) => prev.map((d) => (d.id === doc.id ? { ...d, sticky: doc.sticky ? null : true } : d)))
      setLookupDoc((prev) => (prev && prev.id === doc.id ? { ...prev, sticky: doc.sticky ? null : true } : prev))
    } catch (e) {
      if (bailIfWiped(gen)) return
      setActionError(e instanceof Error ? e.message : 'Sticky toggle failed')
    } finally {
      setDocActionBusy(null)
    }
  }

  async function toggleLock(doc: ModeratableDoc) {
    if (!admin) return
    const gen = wipeGenRef.current
    const locked = doc.lockedAt != null
    if (!window.confirm(locked ? 'Unlock this thread? Replies can be posted again.' : 'Lock this thread? No new posts will be shown from now on.')) return
    setDocActionBusy(`${doc.id}:lock`)
    setActionError(null)
    try {
      const lockedAt = locked ? null : Date.now()
      await changeDocumentFields(admin, 'thread', doc.id, { lockedAt }, locked ? 'thread unlock' : 'thread lock')
      if (bailIfWiped(gen)) return
      setDocs((prev) => prev.map((d) => (d.id === doc.id ? { ...d, lockedAt } : d)))
      setLookupDoc((prev) => (prev && prev.id === doc.id ? { ...prev, lockedAt } : prev))
    } catch (e) {
      if (bailIfWiped(gen)) return
      setActionError(e instanceof Error ? e.message : 'Lock toggle failed')
    } finally {
      setDocActionBusy(null)
    }
  }

  async function toggleHide(doc: ModeratableDoc) {
    if (!admin) return
    const gen = wipeGenRef.current
    const hiding = doc.modState == null
    const label = doc.type === 'post' ? 'post' : 'thread'
    if (!window.confirm(hiding ? `Hide this ${label}? It will be hidden from everyone.` : `Unhide this ${label}? It will be shown again.`)) return
    setDocActionBusy(`${doc.id}:hide`)
    setActionError(null)
    try {
      const hidden = doc.modState != null
      // Hide opening posts with modState AND hide the thread too — a deletable
      // opening post would be re-hidden by the author and the thread would
      // reappear with a different opening post.
      if (hiding && doc.type === 'post') {
        const info = await openingPostOf(doc.id).catch(() => null)
        if (bailIfWiped(gen)) return
        if (info && info.opening?.id === doc.id) {
          await changeDocumentFields(admin, 'thread', info.threadId, { modState: 1 }, 'thread hidden (opening post hidden)')
          if (bailIfWiped(gen)) return
          setDocs((prev) => prev.map((d) => (d.id === info.threadId ? { ...d, modState: 1 } : d)))
          setLookupDoc((prev) => (prev && prev.id === info.threadId ? { ...prev, modState: 1 } : prev))
        }
      }
      await changeDocumentFields(admin, doc.type, doc.id, { modState: hidden ? null : 1 }, hidden ? `${label} unhide` : `${label} hide`)
      if (bailIfWiped(gen)) return
      setDocs((prev) => prev.map((d) => (d.id === doc.id ? { ...d, modState: hidden ? null : 1 } : d)))
      setLookupDoc((prev) => (prev && prev.id === doc.id ? { ...prev, modState: hidden ? null : 1 } : prev))
    } catch (e) {
      if (bailIfWiped(gen)) return
      setActionError(e instanceof Error ? e.message : 'Hide toggle failed')
    } finally {
      setDocActionBusy(null)
    }
  }

  async function deleteDoc(doc: ModeratableDoc) {
    if (!admin) return
    const gen = wipeGenRef.current
    // A moderator can keep hiding an opening post; deleting it would let the
    // author's next reply become the opening post and the thread would
    // re-list. Refuse, and say how to hide instead.
    if (doc.type === 'post') {
      const info = await openingPostOf(doc.id).catch(() => null)
      if (bailIfWiped(gen)) return
      if (info && info.opening?.id === doc.id) {
        setActionError('This is the thread\'s opening post — hide it instead of deleting it (a deleted opening post would let the thread reappear with a new opening post).')
        return
      }
    }
    if (!window.confirm(`Delete this ${doc.type}? This removes it from view — the record is kept on-chain. This cannot be undone in the UI.`)) return
    setDocActionBusy(`${doc.id}:delete`)
    setActionError(null)
    try {
      await deleteDocument(admin, doc.type, doc.id, 'moderator delete')
      if (bailIfWiped(gen)) return
      setDocs((prev) => prev.filter((d) => d.id !== doc.id))
      setLookupDoc((prev) => (prev && prev.id === doc.id ? null : prev))
      setActionSuccess('Document deleted.')
    } catch (e) {
      if (bailIfWiped(gen)) return
      setActionError(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setDocActionBusy(null)
    }
  }

  async function lookupDocument() {
    if (!lookupId.trim()) return
    const gen = wipeGenRef.current
    setLookupBusy(true)
    setLookupError(null)
    setLookupDoc(null)
    try {
      const thread = await get('thread', lookupId.trim())
      if (bailIfWiped(gen)) return
      if (thread) {
        setLookupDoc({
          id: thread.id,
          type: 'thread',
          title: (thread.properties.title as string) ?? '(untitled)',
          ownerId: thread.ownerId || '',
          createdAt: thread.createdAt,
          sticky: Boolean(thread.properties.sticky),
          lockedAt: (thread.properties.lockedAt as number | null) ?? null,
          modState: (thread.properties.modState as number | null) ?? null,
        })
        return
      }
      const post = await get('post', lookupId.trim())
      if (bailIfWiped(gen)) return
      if (post) {
        setLookupDoc({
          id: post.id,
          type: 'post',
          title: ((post.properties.body as string) ?? '').slice(0, 90) || '(empty)',
          ownerId: post.ownerId || '',
          createdAt: post.createdAt,
          modState: (post.properties.modState as number | null) ?? null,
        })
        return
      }
      setLookupError('No thread or post with that ID on the contract.')
    } catch (e) {
      if (bailIfWiped(gen)) return
      setLookupError(e instanceof Error ? e.message : 'Could not fetch the document')
    } finally {
      setLookupBusy(false)
    }
  }

  const canOperate = Boolean(admin) && isModerator
  const targetStale = Boolean(targetId.trim()) && statusForId !== targetId.trim()
  // Actions act on the target — they must not run until a fresh status read
  // for THIS target has landed (the status may be for a different identity).
  const staleBlocker = targetStale

  // Suspend hours: integer, 1–8760 (one year).
  const suspendHoursNum = Number(suspendHours)
  const suspendHoursValid = Number.isInteger(suspendHoursNum) && suspendHoursNum >= 1 && suspendHoursNum <= 8760
  const adminIdentityId = identityTrim
  // Consensus forbids moderating documents (or identities) the moderator owns.
  const ownsDoc = (doc: ModeratableDoc) => Boolean(admin && adminIdentityId && doc.ownerId === adminIdentityId)
  const isSelfTarget = Boolean(admin && adminIdentityId && targetId.trim() === adminIdentityId)

  const allDocs = [...docs, ...(lookupDoc ? [lookupDoc] : [])]
  const ownerMismatchBanner = !canOperate && hostIsCanon

  return (
    <>
      <Navbar />
      <main id="main" tabIndex={-1} className="flex-1">
        <section className="border-b border-[#22304e]">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
            <div className="flex items-center gap-3">
              <span className="flex items-center justify-center w-11 h-11 rounded-xl bg-[#0070c0]/15 text-[#4db3ff]"><Shield className="w-5 h-5" /></span>
              <div>
                <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Moderator console</h1>
                <p className="text-sm text-[#93a1bd]">
                  Centralized, team-based moderation · <span className="font-mono">{NETWORK}</span> · {roster?.mode ? `${roster.mode} mode` : 'mode loading…'} · {shortId(CONTRACT_ID, 16)}
                </p>
                {roster?.mode === 'network' && (
                  <p className="mt-1 text-xs text-amber-400">Network (elected) mode is a testnet-only configuration — never a production default.</p>
                )}
              </div>
            </div>
          </div>
        </section>

        {frameState === 'framed' ? (
          <FramedNotice what="the moderation console" />
        ) : !hostIsCanon && host ? (
          <NonCanonicalRefuse />
        ) : (
          <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 space-y-8">
            <section className="rounded-2xl border border-[#22304e] bg-[#111a2e] p-5 fade-up">
              <div className="flex items-center gap-2 flex-wrap">
                <KeyRound className="w-4 h-4 text-[#4db3ff]" />
                <h2 className="font-semibold">Admin key (CRITICAL)</h2>
                {admin && (
                  <span className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-300">
                    <ShieldCheck className="w-3.5 h-3.5" /> Valid CRITICAL key
                  </span>
                )}
              </div>
              <p className="mt-2 text-sm text-[#93a1bd]">
                Moderation is signed with a <strong>CRITICAL</strong> authentication key — the session key you log in with is HIGH and
                cannot moderate. Paste your own CRITICAL key WIF (from your moderator identity). It is kept in
                this tab&apos;s memory only — never stored, never written to any other origin. The{' '}
                <strong>owner</strong> identity holds full contract authority (roster + moderation config) and is refused on non-localhost
                hosts: keep it offline for contract updates. Use an appointed moderator identity here.
              </p>
              <div className="mt-4 grid sm:grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-xs text-[#93a1bd]">Moderator identity ID</span>
                  <input
                    value={identityId}
                    onChange={(e) => {
                      wipeGenRef.current += 1
                      try { signerRef.current?.free() } catch { /* freed */ }
                      signerRef.current = null
                      setIdentityId(e.target.value)
                      setValidation(null)
                      setAdmin(null)
                    }}
                    placeholder="6Dft…"
                    className="mt-1 w-full rounded-lg border border-[#22304e] bg-[#0b1220] px-3 py-2 text-sm font-mono focus:border-[#008CE7]"
                  />
                </label>
                <label className="block">
                  <span className="text-xs text-[#93a1bd]">CRITICAL key WIF</span>
                  <input
                    type="password"
                    value={wif}
                    onChange={(e) => {
                      wipeGenRef.current += 1
                      try { signerRef.current?.free() } catch { /* freed */ }
                      signerRef.current = null
                      setWif(e.target.value)
                      setValidation(null)
                      setAdmin(null)
                    }}
                    placeholder="L…"
                    className="mt-1 w-full rounded-lg border border-[#22304e] bg-[#0b1220] px-3 py-2 text-sm font-mono focus:border-[#008CE7]"
                    autoComplete="one-time-code"
                    data-lpignore="true"
                    data-1p-ignore="true"
                    spellCheck={false}
                  />
                </label>
              </div>
              {!localhost && host && (
                <p className="mt-3 text-xs text-[#93a1bd]">
                  The owner key is refused on this host — it is kept offline for contract updates. Appointed moderators sign on this host.
                </p>
              )}
              <div className="mt-3 flex items-center gap-3 flex-wrap">
                <button
                  onClick={handleValidate}
                  disabled={validating || !identityId.trim() || !wif.trim() || !hostIsCanon || !host}
                  className="btn-primary px-4 py-2 text-sm font-semibold"
                >
                  {validating ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
                  Validate &amp; sign in as admin
                </button>
                {(identityId || wif) && (
                  <button onClick={handleClearAdmin} className="inline-flex items-center gap-2 rounded-lg border border-[#22304e] px-4 py-2 text-sm text-[#93a1bd] hover:text-white hover:border-[#008CE7] transition">
                    Clear admin
                  </button>
                )}
              </div>
              {validation && !validation.ok && (
                <p role="alert" className="mt-3 text-sm text-red-400">✗ {validation.reason}</p>
              )}
              {validation?.ok && isModerator && (
                <p role="status" className="mt-3 text-sm text-emerald-400">✓ Signed in as a contract moderator ({isOwner ? 'owner' : 'appointed'}).</p>
              )}
              {validation?.ok && !isModerator && (
                <p role="status" className="mt-3 text-sm text-amber-400">Key valid but <strong>this identity is not the owner or an appointed moderator</strong> of the contract. Actions are disabled — the roster gate blocks them, and the chain would refuse them anyway.</p>
              )}
            </section>

            {wipedNotice && (
              <div role="status" className="rounded-xl border border-amber-400/40 bg-amber-400/5 px-4 py-3 text-sm text-amber-300 flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 shrink-0" />
                <span>Key cleared — {wipedNotice}. Re-enter your CRITICAL key to continue.</span>
                <button onClick={() => setWipedNotice(null)} className="ml-auto rounded-lg px-2 py-1 text-xs text-[#93a1bd] hover:text-white hover:bg-[#18233c] transition">Dismiss</button>
              </div>
            )}

            {actionError && (
              <div role="alert" className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{actionError}</span>
                <button onClick={() => setActionError(null)} className="ml-auto rounded-lg px-2 py-1 text-xs text-[#93a1bd] hover:text-white hover:bg-[#18233c] transition">Dismiss</button>
              </div>
            )}
            {actionSuccess && (
              <div role="status" className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300 flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 shrink-0" />
                <span>{actionSuccess}</span>
              </div>
            )}

            <div className="grid lg:grid-cols-2 gap-6">
              <section className="rounded-2xl border border-[#22304e] bg-[#111a2e] p-5">
                <h2 className="font-semibold flex items-center gap-2"><Shield className="w-4 h-4 text-[#4db3ff]" /> Team roster</h2>
                {roster ? (
                  <div className="mt-3 space-y-2">
                    <RosterRow label="Owner (always moderates)" id={roster.ownerId} highlight={isOwner} />
                    {roster.appointed.map((id) => (
                      <RosterRow key={id} label="Appointed moderator" id={id} highlight={id === identityTrim} />
                    ))}
                    {roster.appointed.length === 0 && <p className="text-xs text-[#93a1bd]">No appointed moderators — owner only.</p>}
                    <p className="text-[12px] text-[#93a1bd] pt-1">Appointed moderators are set by the owner in the contract&apos;s moderation config (owner-managed; the change applies to new moderation actions).</p>
                  </div>
                ) : rosterError ? (
                  <div className="mt-3">
                    <p className="text-sm text-red-400">Couldn&apos;t load the roster. Check your connection and retry.</p>
                    <button onClick={retryRoster} className="mt-2 text-xs text-[#4db3ff] hover:underline">Retry</button>
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-[#93a1bd] flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading roster…</p>
                )}
              </section>

              <section className="rounded-2xl border border-[#22304e] bg-[#111a2e] p-5 flex flex-col">
                <h2 className="font-semibold flex items-center gap-2"><Search className="w-4 h-4 text-[#4db3ff]" /> Identity status &amp; actions</h2>
                <div className="mt-3">
                  <label htmlFor="target-id" className="text-xs text-[#93a1bd]">Identity ID to look up</label>
                  <div className="mt-1 flex gap-2">
                    <input
                      id="target-id"
                      value={targetId}
                      onChange={(e) => { setTargetId(e.target.value); setStatus(null); setStatusForId(null); setActionSuccess(null) }}
                      placeholder="identity ID to look up"
                      className="flex-1 rounded-lg border border-[#22304e] bg-[#0b1220] px-3 py-2 text-sm font-mono focus:border-[#008CE7]"
                      onKeyDown={(e) => e.key === 'Enter' && refreshStatus()}
                    />
                    <button
                      onClick={refreshStatus}
                      disabled={statusLoading || !targetId.trim()}
                      className="inline-flex items-center gap-2 rounded-lg border border-[#22304e] px-3 py-2 text-sm text-[#93a1bd] hover:text-white hover:border-[#008CE7] transition disabled:opacity-50"
                      aria-label="Refresh status"
                    >
                      {statusLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {status && (
                  <>
                    <div className="mt-3 flex flex-wrap gap-2 text-xs">
                      <StatusPill tone={status.banned ? 'red' : 'neutral'} icon={<Ban className="w-3 h-3" />} label={status.banned ? 'Banned' : 'Not banned'} />
                      <StatusPill tone={status.suspendedUntil ? 'amber' : 'neutral'} icon={<Clock className="w-3 h-3" />} label={status.suspendedUntil ? `Suspended until ${formatDate(Number(status.suspendedUntil))}` : 'Not suspended'} />
                      <StatusPill tone={status.warnings?.length ? 'amber' : 'neutral'} icon={<Bell className="w-3 h-3" />} label={`${status.warnings?.length ?? 0} warning${status.warnings?.length === 1 ? '' : 's'}`} />
                    </div>
                    {status.banReason?.text && <p className="mt-2 text-xs text-[#93a1bd]">Ban reason: {status.banReason.text}</p>}

                    <div className="mt-4 grid sm:grid-cols-2 gap-2">
                      <TextInput label="Ban reason (required)" value={banReason} onChange={setBanReason} />
                      <TextInput label="Suspend hours" value={suspendHours} onChange={setSuspendHours} type="number" />
                      <TextInput label="Warning reason (required)" value={warnReason} onChange={setWarnReason} />
                      <TextInput label="Suspend reason (required)" value={suspendReason} onChange={setSuspendReason} />
                    </div>

                    {!canOperate && (
                      <p className="mt-3 text-xs text-amber-400 border border-amber-400/30 rounded-lg px-3 py-2">Admin key required — validate it above to enable moderation actions.</p>
                    )}
                    {staleBlocker && (
                      <p className="mt-3 text-xs text-amber-400 border border-amber-400/30 rounded-lg px-3 py-2">Status is stale — the identity changed since this status was loaded. Refresh to see the current state (and act).</p>
                    )}
                    {!suspendHoursValid && suspendHours.trim() && (
                      <p className="mt-3 text-xs text-amber-400">Suspend duration must be a whole number of hours between 1 and 8760.</p>
                    )}

                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <ActionButton
                        disabled={!canOperate || actionBusy != null || !banReason.trim() || isSelfTarget || staleBlocker}
                        busy={actionBusy === 'ban'}
                        icon={<Ban className="w-3.5 h-3.5" />}
                        label="Ban"
                        tone="red"
                        describedBy="ban-reason"
                        onClick={() => act('ban', () => banUser(admin!, targetId.trim(), banReason.trim()), `Ban ${shortId(targetId.trim(), 12)}? They cannot create content until unbanned.`, 'Ban applied.')}
                      />
                      <ActionButton
                        disabled={!canOperate || actionBusy != null || isSelfTarget || staleBlocker}
                        busy={actionBusy === 'unban'}
                        icon={<Undo2 className="w-3.5 h-3.5" />}
                        label="Unban"
                        tone="neutral"
                        onClick={() => act('unban', () => unbanUser(admin!, targetId.trim()), `Unban ${shortId(targetId.trim(), 12)}? They can create content again.`, 'Unban applied.')}
                      />
                      <ActionButton
                        disabled={!canOperate || actionBusy != null || !suspendReason.trim() || !suspendHoursValid || isSelfTarget || staleBlocker}
                        busy={actionBusy === 'suspend'}
                        icon={<Clock className="w-3.5 h-3.5" />}
                        label="Suspend"
                        tone="amber"
                        describedBy="suspend-reason"
                        onClick={() => act('suspend', () => suspendUser(admin!, targetId.trim(), BigInt(Date.now() + Number(suspendHours) * 3600 * 1000), suspendReason.trim()), `Suspend ${shortId(targetId.trim(), 12)} for ${suspendHours}h?`, 'Suspend applied.')}
                      />
                      <ActionButton
                        disabled={!canOperate || actionBusy != null || isSelfTarget || staleBlocker}
                        busy={actionBusy === 'unsuspend'}
                        icon={<Unlock className="w-3.5 h-3.5" />}
                        label="Unsuspend"
                        tone="neutral"
                        onClick={() => act('unsuspend', () => unsuspendUser(admin!, targetId.trim()), `Unsuspend ${shortId(targetId.trim(), 12)}? They can create content again.`, 'Unsuspend applied.')}
                      />
                      <ActionButton
                        disabled={!canOperate || actionBusy != null || !warnReason.trim() || isSelfTarget || staleBlocker}
                        busy={actionBusy === 'warn'}
                        icon={<Bell className="w-3.5 h-3.5" />}
                        label="Warn"
                        tone="amber"
                        describedBy="warn-reason"
                        onClick={() => act('warn', () => warnUser(admin!, targetId.trim(), warnReason.trim()), `Warn ${shortId(targetId.trim(), 12)}?`, 'Warning issued.')}
                      />
                      <ActionButton
                        disabled={!canOperate || actionBusy != null || isSelfTarget || staleBlocker}
                        busy={actionBusy === 'clearWarnings'}
                        icon={<BellOff className="w-3.5 h-3.5" />}
                        label="Clear warnings"
                        tone="neutral"
                        onClick={() => act('clearWarnings', () => clearWarnings(admin!, targetId.trim()), `Clear all warnings for ${shortId(targetId.trim(), 12)}?`, 'Warnings cleared.')}
                      />
                    </div>
                  </>
                )}
                {isSelfTarget && (
                  <p className="mt-4 text-xs text-amber-400">The chain refuses to moderate your own identity — pick another identity to moderate.</p>
                )}
                {!status && !statusLoading && !isSelfTarget && (
                  <p className="mt-4 text-sm text-[#93a1bd]">Enter an identity ID and press the refresh button to read its status.</p>
                )}
              </section>
            </div>

            <section className="rounded-2xl border border-[#22304e] bg-[#111a2e] p-5">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="font-semibold flex items-center gap-2"><Pin className="w-4 h-4 text-[#4db3ff]" /> Moderate documents</h2>
                <span className="text-xs text-[#93a1bd]">Recent threads &amp; posts · change fields and deletion are signed by the admin key</span>
                {docsLoading && <Loader2 className="w-4 h-4 animate-spin text-[#93a1bd]" />}
                {docsError && !docsLoading && (
                  <button onClick={() => loadDocs()} className="ml-2 text-xs text-[#4db3ff] hover:underline inline-flex items-center gap-1">
                    <RefreshCw className="w-3 h-3" /> Retry
                  </button>
                )}
              </div>
              <div className="mt-3 flex gap-2">
                <input
                  value={lookupId}
                  onChange={(e) => setLookupId(e.target.value)}
                  placeholder="Look up a thread or post ID (e.g. an older report)…"
                  className="flex-1 rounded-lg border border-[#22304e] bg-[#0b1220] px-3 py-2 text-sm font-mono focus:border-[#008CE7]"
                  onKeyDown={(e) => e.key === 'Enter' && lookupDocument()}
                />
                <button
                  onClick={lookupDocument}
                  disabled={lookupBusy || !lookupId.trim()}
                  className="inline-flex items-center gap-2 rounded-lg border border-[#22304e] px-3 py-2 text-sm text-[#93a1bd] hover:text-white hover:border-[#008CE7] transition disabled:opacity-50"
                >
                  {lookupBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                  Find
                </button>
              </div>
              {lookupError && <p role="alert" className="mt-2 text-sm text-red-400">{lookupError}</p>}
              {lookupDoc && !docsError && (
                <DocumentCard doc={lookupDoc} canOperate={canOperate} busy={docActionBusy} ownsDoc={ownsDoc} actions={{ toggleSticky, toggleLock, toggleHide, deleteDoc }} highlight />
              )}
              {docsError && !docsLoading && !lookupDoc && (
                <p role="alert" className="mt-3 text-sm text-red-400">Couldn&apos;t load recent documents. Check your connection and retry.</p>
              )}
              {!canOperate && !docsLoading && (
                <p className="mt-3 text-xs text-amber-400 border border-amber-400/30 rounded-lg px-3 py-2">Admin key required.</p>
              )}
              <div className="mt-4 space-y-2">
                {docs.length === 0 && !docsLoading && !lookupDoc && (
                  <p className="text-sm text-[#93a1bd]">No documents yet.</p>
                )}
                {docs.map((doc) => (
                  <DocumentCard key={`${doc.type}:${doc.id}`} doc={doc} canOperate={canOperate} busy={docActionBusy} ownsDoc={ownsDoc} actions={{ toggleSticky, toggleLock, toggleHide, deleteDoc }} />
                ))}
              </div>
              {(threadsMore || postsMore) && !docsLoading && (threadsAfter || postsAfter) && (
                <button onClick={() => loadDocs(true)} className="mt-3 inline-flex items-center gap-2 rounded-lg border border-[#22304e] px-3 py-2 text-sm text-[#93a1bd] hover:text-white hover:border-[#008CE7] transition">
                  <RefreshCw className="w-3.5 h-3.5" /> Load more
                </button>
              )}
            </section>

            <footer className="text-xs text-[#93a1bd] flex items-center gap-2 flex-wrap">
              <span>dForum moderation · {NETWORK}</span>
              <span>·</span>
              <Link href="/" className="text-[#4db3ff] hover:underline">back to the forum</Link>
            </footer>
          </div>
        )}
      </main>
      <Footer />
    </>
  )
}

function DocumentCard({ doc, canOperate, busy, ownsDoc, actions, highlight }: {
  doc: ModeratableDoc
  canOperate: boolean
  busy: string | null
  ownsDoc: (doc: ModeratableDoc) => boolean
  actions: {
    toggleSticky: (doc: ModeratableDoc) => void
    toggleLock: (doc: ModeratableDoc) => void
    toggleHide: (doc: ModeratableDoc) => void
    deleteDoc: (doc: ModeratableDoc) => void
  }
  highlight?: boolean
}) {
  const owns = ownsDoc(doc)
  const isPost = doc.type === 'post'
  return (
    <div className={`flex items-center gap-2 sm:gap-3 rounded-xl border px-3 sm:px-4 py-3 flex-wrap ${highlight ? 'border-[#4db3ff]/50 bg-[#4db3ff]/5' : 'border-[#22304e] bg-[#0b1220]'}`}>
      <span className={`text-[12px] uppercase tracking-wider rounded px-1.5 py-0.5 border shrink-0 ${isPost ? 'text-emerald-400 border-emerald-400/30' : 'text-[#4db3ff] border-[#4db3ff]/40'}`}>{doc.type}</span>
      <div className="min-w-0 flex-1 basis-40">
        <p className="text-sm truncate">
          {isPost ? (
            doc.title
          ) : (
            <Link href={`/t/${encodeURIComponent(doc.id)}`} className="text-white hover:underline">{doc.title}</Link>
          )}
          {doc.modState != null && <span className="ml-2 text-[12px] uppercase tracking-wider text-amber-400">hidden</span>}
        </p>
        <p className="text-xs text-[#93a1bd]">
          {shortId(doc.ownerId, 12)} · {formatRelativeTime(doc.createdAt)}
          {owns && <span className="block text-[12px] text-amber-400">own document — the chain refuses self-moderation; these actions are disabled</span>}
        </p>
      </div>
      {!isPost ? (
        <>
          <SmallButton active={doc.sticky} icon={<Pin className="w-3.5 h-3.5" />} label={doc.sticky ? 'Unpin' : 'Pin'} disabled={!canOperate || busy != null || owns} busy={busy === `${doc.id}:sticky`} onClick={() => actions.toggleSticky(doc)} />
          <SmallButton active={doc.lockedAt != null} icon={doc.lockedAt != null ? <Unlock className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />} label={doc.lockedAt != null ? 'Unlock' : 'Lock'} disabled={!canOperate || busy != null || owns} busy={busy === `${doc.id}:lock`} onClick={() => actions.toggleLock(doc)} />
          <SmallButton active={doc.modState != null} icon={doc.modState != null ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />} label={doc.modState != null ? 'Unhide' : 'Hide'} disabled={!canOperate || busy != null || owns} busy={busy === `${doc.id}:hide`} onClick={() => actions.toggleHide(doc)} />
        </>
      ) : (
        <SmallButton active={doc.modState != null} icon={doc.modState != null ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />} label={doc.modState != null ? 'Unhide' : 'Hide'} disabled={!canOperate || busy != null || owns} busy={busy === `${doc.id}:hide`} onClick={() => actions.toggleHide(doc)} />
      )}
      <SmallButton icon={<Trash2 className="w-3.5 h-3.5" />} label="Delete" danger disabled={!canOperate || busy != null || owns} busy={busy === `${doc.id}:delete`} onClick={() => actions.deleteDoc(doc)} />
    </div>
  )
}

function RosterRow({ label, id, highlight }: { label: string; id: string | null; highlight?: boolean }) {
  if (!id) return null
  return (
    <div className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 ${highlight ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-[#22304e] bg-[#0b1220]'}`}>
      <span className="text-xs text-[#93a1bd]">{label}</span>
      <span className="text-xs font-mono text-white truncate" title={id}>{highlight ? `${shortId(id, 14)} (you)` : shortId(id, 18)}</span>
    </div>
  )
}

function StatusPill({ tone, icon, label }: { tone: 'red' | 'amber' | 'neutral'; icon: React.ReactNode; label: string }) {
  const tones = {
    red: 'border-red-500/40 bg-red-500/10 text-red-300',
    amber: 'border-amber-400/40 bg-amber-400/10 text-amber-300',
    neutral: 'border-[#22304e] bg-[#0b1220] text-[#93a1bd]',
  }
  return <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 ${tones[tone]}`}>{icon}{label}</span>
}

function ActionButton({ disabled, busy, icon, label, tone, describedBy, onClick }: { disabled: boolean; busy: boolean; icon: React.ReactNode; label: string; tone: 'red' | 'amber' | 'neutral'; describedBy?: string; onClick: () => void }) {
  const tones = {
    red: 'border-red-500/40 text-red-300 hover:bg-red-500/10',
    amber: 'border-amber-400/40 text-amber-300 hover:bg-amber-400/10',
    neutral: 'border-[#22304e] text-[#93a1bd] hover:text-white hover:border-[#008CE7]',
  }
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-describedby={disabled ? describedBy : undefined}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm transition disabled:opacity-40 disabled:cursor-not-allowed ${tones[tone]}`}
    >
      {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : icon}
      {label}
    </button>
  )
}

function SmallButton({ icon, label, active, danger, disabled, busy, onClick }: { icon: React.ReactNode; label: string; active?: boolean | null; danger?: boolean; disabled?: boolean; busy?: boolean; onClick: () => void }) {
  const cls = danger
    ? 'border-red-500/40 text-red-300 hover:bg-red-500/10'
    : active
      ? 'border-[#4db3ff]/60 bg-[#4db3ff]/10 text-[#4db3ff]'
      : 'border-[#22304e] text-[#93a1bd] hover:text-white hover:border-[#008CE7]'
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={active ? `${label} (currently on — click to toggle off)` : label}
      className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition disabled:opacity-40 disabled:cursor-not-allowed ${cls}`}
    >
      {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : icon}
      {label}
    </button>
  )
}

function TextInput({ label, value, onChange, type = 'text', id }: { label: string; value: string; onChange: (v: string) => void; type?: string; id?: string }) {
  return (
    <label className="block">
      <span className="text-xs text-[#93a1bd]">{label}</span>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-lg border border-[#22304e] bg-[#0b1220] px-3 py-2 text-xs focus:border-[#008CE7]"
      />
    </label>
  )
}

function FramedNotice({ what }: { what: string }) {
  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-16">
      <div className="text-center fade-up max-w-md mx-auto">
        <ExternalLink className="w-8 h-8 text-[#4db3ff] mx-auto" aria-hidden="true" />
        <p className="text-sm uppercase tracking-widest text-[#93a1bd] mt-3">In a frame</p>
        <h1 className="text-2xl font-bold mt-2">Open {what} in its own tab</h1>
        <p className="text-sm text-[#93a1bd] mt-2">
          This surface holds key material — it only runs on its own top-level page.
        </p>
        <a href={`https://${canonicalHost()}/moderation`} className="mt-6 inline-flex items-center gap-2 btn-primary px-4 py-2">
          Open in a new tab <ExternalLink className="w-4 h-4" />
        </a>
      </div>
    </div>
  )
}

function NonCanonicalRefuse() {
  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-16">
      <div className="text-center fade-up max-w-md mx-auto">
        <ShieldAlert className="w-8 h-8 text-red-400 mx-auto" aria-hidden="true" />
        <p className="text-sm uppercase tracking-widest text-[#93a1bd] mt-3">Not available here</p>
        <h1 className="text-2xl font-bold mt-2">The moderation console is not available on this host</h1>
        <p className="text-sm text-[#93a1bd] mt-2">
          This console holds a CRITICAL key — it runs only on <code>{canonicalHost()}</code> (and localhost).
          On any other origin — including a shared Pages origin — it refuses to load so the key cannot leak.
        </p>
        <a href={`https://${canonicalHost()}/moderation`} className="mt-6 inline-flex items-center gap-2 btn-primary px-4 py-2">
          Open on the canonical host <ExternalLink className="w-4 h-4" />
        </a>
      </div>
    </div>
  )
}
