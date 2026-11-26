'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import {
  Shield, Ban, Undo2, Clock, AlertTriangle, Trash2, Bell, BellOff, Loader2, ShieldCheck,
  Eye, EyeOff, Pin, Lock, Unlock, KeyRound, Search, RefreshCw,
} from 'lucide-react'
import { Navbar } from '@/components/Navbar'
import { Footer } from '@/components/Footer'
import { query } from '@/lib/services/document-service'
import {
  prepareModerator, validateCriticalKey, getRoster, moderationStatus,
  banUser, unbanUser, suspendUser, unsuspendUser, warnUser, clearWarnings,
  changeDocumentFields, deleteDocument, type ModerationIdentity,
} from '@/lib/services/moderation-service'
import { CONTRACT_ID, NETWORK } from '@/lib/constants'
import { shortId, formatDate, formatRelativeTime } from '@/lib/utils'

const CRITICAL_KEY_STORAGE = 'dforum:moderator:wif'
const CRITICAL_ID_STORAGE = 'dforum:moderator:identityId'

interface Roster {
  ownerId: string | null
  appointed: string[]
}

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
  sticky?: boolean
  lockedAt?: number | null
  modState?: number | null
}

export default function ModerationPage() {
  const [identityId, setIdentityId] = useState('')
  const [wif, setWif] = useState('')
  const [admin, setAdmin] = useState<ModerationIdentity | null>(null)
  const [validating, setValidating] = useState(false)
  const [validation, setValidation] = useState<{ ok: boolean; reason?: string } | null>(null)

  const [roster, setRoster] = useState<Roster | null>(null)
  const [targetId, setTargetId] = useState('')
  const [status, setStatus] = useState<StatusData | null>(null)
  const [statusLoading, setStatusLoading] = useState(false)
  const [banReason, setBanReason] = useState('')
  const [warnReason, setWarnReason] = useState('')
  const [suspendHours, setSuspendHours] = useState('24')
  const [suspendReason, setSuspendReason] = useState('')
  const [actionBusy, setActionBusy] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const [docs, setDocs] = useState<ModeratableDoc[]>([])
  const [docsLoading, setDocsLoading] = useState(true)
  const [docActionBusy, setDocActionBusy] = useState<string | null>(null)

  useEffect(() => {
    try {
      const storedId = sessionStorage.getItem(CRITICAL_ID_STORAGE)
      const storedWif = sessionStorage.getItem(CRITICAL_KEY_STORAGE)
      if (storedId) setIdentityId(storedId)
      if (storedWif) setWif(storedWif)
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    getRoster().then(setRoster).catch(() => setRoster(null))
    Promise.all([
      query('thread', { orderBy: [['$createdAt', 'desc']], limit: 12 }).catch(() => []),
      query('post', { orderBy: [['$createdAt', 'desc']], limit: 12 }).catch(() => []),
    ])
      .then(([threads, posts]) => {
        const mapped: ModeratableDoc[] = [
          ...threads.map((t) => ({
            id: t.id,
            type: 'thread' as const,
            title: (t.properties.title as string) ?? '(untitled)',
            ownerId: t.ownerId || '',
            createdAt: t.createdAt,
            sticky: Boolean(t.properties.sticky),
            lockedAt: (t.properties.lockedAt as number | null) ?? null,
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
        setDocs(mapped)
      })
      .catch(() => setDocs([]))
      .finally(() => setDocsLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const isOwner = Boolean(roster?.ownerId && identityId && roster.ownerId === identityId)
  const isAppointed = Boolean(roster?.appointed.includes(identityId))
  const isModerator = isOwner || isAppointed

  async function handleValidate() {
    if (!identityId.trim() || !wif.trim()) return
    setValidating(true)
    setValidation(null)
    try {
      sessionStorage.setItem(CRITICAL_ID_STORAGE, identityId.trim())
      sessionStorage.setItem(CRITICAL_KEY_STORAGE, wif.trim())
      const result = await validateCriticalKey(identityId.trim(), wif.trim())
      setValidation(result)
      if (result.ok) {
        const prepared = await prepareModerator(identityId.trim(), wif.trim())
        setAdmin(prepared)
      } else {
        setAdmin(null)
      }
    } catch (e) {
      setValidation({ ok: false, reason: e instanceof Error ? e.message : 'Validation failed' })
      setAdmin(null)
    } finally {
      setValidating(false)
    }
  }

  async function handleClearAdmin() {
    sessionStorage.removeItem(CRITICAL_ID_STORAGE)
    sessionStorage.removeItem(CRITICAL_KEY_STORAGE)
    setIdentityId('')
    setWif('')
    setAdmin(null)
    setValidation(null)
    setStatus(null)
    setTargetId('')
  }

  async function refreshStatus() {
    if (!targetId.trim()) return
    setStatusLoading(true)
    setActionError(null)
    try {
      const s = await moderationStatus(targetId.trim())
      setStatus(s as unknown as StatusData)
    } catch (e) {
      setStatus(null)
      setActionError(e instanceof Error ? e.message : 'Could not fetch status')
    } finally {
      setStatusLoading(false)
    }
  }

  async function act(busyKey: string, fn: () => Promise<void>) {
    setActionBusy(busyKey)
    setActionError(null)
    try {
      await fn()
      await refreshStatus()
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Action failed')
    } finally {
      setActionBusy(null)
    }
  }

  async function toggleSticky(doc: ModeratableDoc) {
    if (!admin) return
    setDocActionBusy(`${doc.id}:sticky`)
    setActionError(null)
    try {
      await changeDocumentFields(admin, 'thread', doc.id, { sticky: !doc.sticky }, 'sticky toggle')
      setDocs((prev) => prev.map((d) => (d.id === doc.id ? { ...d, sticky: !d.sticky } : d)))
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Sticky toggle failed')
    } finally {
      setDocActionBusy(null)
    }
  }

  async function toggleLock(doc: ModeratableDoc) {
    if (!admin) return
    setDocActionBusy(`${doc.id}:lock`)
    setActionError(null)
    try {
      const locked = doc.lockedAt != null
      await changeDocumentFields(admin, 'thread', doc.id, { lockedAt: locked ? null : Date.now() }, locked ? 'thread unlock' : 'thread lock')
      setDocs((prev) => prev.map((d) => (d.id === doc.id ? { ...d, lockedAt: locked ? null : Date.now() } : d)))
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Lock toggle failed')
    } finally {
      setDocActionBusy(null)
    }
  }

  async function toggleHide(doc: ModeratableDoc) {
    if (!admin) return
    setDocActionBusy(`${doc.id}:hide`)
    setActionError(null)
    try {
      const hidden = doc.modState === 2
      await changeDocumentFields(admin, 'post', doc.id, { modState: hidden ? null : 2 }, hidden ? 'post unhide' : 'post hide')
      setDocs((prev) => prev.map((d) => (d.id === doc.id ? { ...d, modState: hidden ? null : 2 } : d)))
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Hide toggle failed')
    } finally {
      setDocActionBusy(null)
    }
  }

  async function deleteDoc(doc: ModeratableDoc) {
    if (!admin) return
    if (!window.confirm(`Delete this ${doc.type}? This cannot be undone in the UI.`)) return
    setDocActionBusy(`${doc.id}:delete`)
    setActionError(null)
    try {
      await deleteDocument(admin, doc.type, doc.id, 'moderator delete')
      setDocs((prev) => prev.filter((d) => d.id !== doc.id))
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setDocActionBusy(null)
    }
  }

  const canOperate = Boolean(admin)
  const adminIdentityId = identityId.trim()
  // Consensus forbids moderating documents (or identities) the moderator owns.
  const ownsDoc = (doc: ModeratableDoc) => Boolean(admin && adminIdentityId && doc.ownerId === adminIdentityId)
  const isSelfTarget = Boolean(admin && adminIdentityId && targetId.trim() === adminIdentityId)

  return (
    <>
      <Navbar />
      <main className="flex-1">
        <section className="border-b border-[#22304e]">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
            <div className="flex items-center gap-3">
              <span className="flex items-center justify-center w-11 h-11 rounded-xl bg-[#008CE7]/15 text-[#4db3ff]"><Shield className="w-5 h-5" /></span>
              <div>
                <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Moderator console</h1>
                <p className="text-sm text-[#93a1bd]">
                  Centralized, team-based moderation · <span className="font-mono">{NETWORK}</span> · team mode · {shortId(CONTRACT_ID, 16)}
                </p>
              </div>
            </div>
          </div>
        </section>

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
              cannot moderate. Paste your own CRITICAL key WIF (from your admin identity). It is kept in
              this tab&apos;s sessionStorage only and never sent anywhere.
            </p>
            <div className="mt-4 grid sm:grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs text-[#93a1bd]">Moderator identity ID</span>
                <input
                  value={identityId}
                  onChange={(e) => { setIdentityId(e.target.value); setValidation(null); setAdmin(null) }}
                  placeholder="6Dft…"
                  className="mt-1 w-full rounded-lg border border-[#22304e] bg-[#0b1220] px-3 py-2 text-sm font-mono focus:border-[#008CE7] focus:outline-none"
                />
              </label>
              <label className="block">
                <span className="text-xs text-[#93a1bd]">CRITICAL key WIF</span>
                <input
                  type="password"
                  value={wif}
                  onChange={(e) => { setWif(e.target.value); setValidation(null); setAdmin(null) }}
                  placeholder="L…"
                  className="mt-1 w-full rounded-lg border border-[#22304e] bg-[#0b1220] px-3 py-2 text-sm font-mono focus:border-[#008CE7] focus:outline-none"
                  autoComplete="off"
                />
              </label>
            </div>
            <div className="mt-3 flex items-center gap-3 flex-wrap">
              <button
                onClick={handleValidate}
                disabled={validating || !identityId.trim() || !wif.trim()}
                className="inline-flex items-center gap-2 rounded-lg bg-[#008CE7] hover:bg-[#006bb3] transition px-4 py-2 text-sm font-semibold disabled:opacity-50"
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
              <p className="mt-3 text-sm text-red-400">✗ {validation.reason}</p>
            )}
            {validation?.ok && isModerator && (
              <p className="mt-3 text-sm text-emerald-400">✓ Signed in as a contract moderator ({isOwner ? 'owner' : 'appointed'}).</p>
            )}
            {validation?.ok && !isModerator && (
              <p className="mt-3 text-sm text-amber-400">Key valid but <strong>this identity is not the owner or an appointed moderator</strong> of the contract. Actions will fail on-chain.</p>
            )}
          </section>

          {actionError && (
            <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{actionError}</span>
              <button onClick={() => setActionError(null)} className="ml-auto text-xs text-[#93a1bd] hover:text-white">dismiss</button>
            </div>
          )}

          <div className="grid lg:grid-cols-2 gap-6">
            <section className="rounded-2xl border border-[#22304e] bg-[#111a2e] p-5">
              <h2 className="font-semibold flex items-center gap-2"><Shield className="w-4 h-4 text-[#4db3ff]" /> Team roster</h2>
              {roster ? (
                <div className="mt-3 space-y-2">
                  <RosterRow label="Owner (always moderates)" id={roster.ownerId} highlight={isOwner} />
                  {roster.appointed.map((id) => (
                    <RosterRow key={id} label="Appointed moderator" id={id} highlight={id === identityId} />
                  ))}
                  {roster.appointed.length === 0 && <p className="text-xs text-[#93a1bd]">No appointed moderators — owner only.</p>}
                  <p className="text-[11px] text-[#93a1bd] pt-1">Appointed moderators are set by the owner in the contract&apos;s moderation config (owner-managed; the change applies to new moderation actions).</p>
                </div>
              ) : (
                <p className="mt-3 text-sm text-[#93a1bd] flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading roster…</p>
              )}
            </section>

            <section className="rounded-2xl border border-[#22304e] bg-[#111a2e] p-5 flex flex-col">
              <h2 className="font-semibold flex items-center gap-2"><Search className="w-4 h-4 text-[#4db3ff]" /> Identity status &amp; actions</h2>
              <div className="mt-3 flex gap-2">
                <input
                  value={targetId}
                  onChange={(e) => setTargetId(e.target.value)}
                  placeholder="identity ID to look up"
                  className="flex-1 rounded-lg border border-[#22304e] bg-[#0b1220] px-3 py-2 text-sm font-mono focus:border-[#008CE7] focus:outline-none"
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

              {status && (
                <>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs">
                    <StatusPill tone={status.banned ? 'red' : 'neutral'} icon={<Ban className="w-3 h-3" />} label={status.banned ? 'Banned' : 'Not banned'} />
                    <StatusPill tone={status.suspendedUntil ? 'amber' : 'neutral'} icon={<Clock className="w-3 h-3" />} label={status.suspendedUntil ? `Suspended until ${formatDate(Number(status.suspendedUntil))}` : 'Not suspended'} />
                    <StatusPill tone={status.warnings?.length ? 'amber' : 'neutral'} icon={<Bell className="w-3 h-3" />} label={`${status.warnings?.length ?? 0} warning${status.warnings?.length === 1 ? '' : 's'}`} />
                  </div>
                  {status.banReason?.text && <p className="mt-2 text-xs text-[#93a1bd]">Ban reason: {status.banReason.text}</p>}

                  <div className="mt-4 grid sm:grid-cols-2 gap-2">
                    <TextInput label="Ban reason" value={banReason} onChange={setBanReason} />
                    <TextInput label="Warning reason" value={warnReason} onChange={setWarnReason} />
                    <TextInput label="Suspend hours" value={suspendHours} onChange={setSuspendHours} />
                    <TextInput label="Suspend reason" value={suspendReason} onChange={setSuspendReason} />
                  </div>

                  {!canOperate && (
                    <p className="mt-3 text-xs text-amber-400 border border-amber-400/30 rounded-lg px-3 py-2">Admin key required — validate it above to enable moderation actions.</p>
                  )}

                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <ActionButton
                      disabled={!canOperate || actionBusy != null || !banReason.trim() || isSelfTarget}
                      busy={actionBusy === 'ban'}
                      icon={<Ban className="w-3.5 h-3.5" />}
                      label="Ban"
                      tone="red"
                      onClick={() => act('ban', () => banUser(admin!, targetId.trim(), banReason.trim()))}
                    />
                    <ActionButton
                      disabled={!canOperate || actionBusy != null || isSelfTarget}
                      busy={actionBusy === 'unban'}
                      icon={<Undo2 className="w-3.5 h-3.5" />}
                      label="Unban"
                      tone="neutral"
                      onClick={() => act('unban', () => unbanUser(admin!, targetId.trim()))}
                    />
                    <ActionButton
                      disabled={!canOperate || actionBusy != null || !suspendReason.trim() || !Number(suspendHours) || isSelfTarget}
                      busy={actionBusy === 'suspend'}
                      icon={<Clock className="w-3.5 h-3.5" />}
                      label="Suspend"
                      tone="amber"
                      onClick={() => act('suspend', () => suspendUser(admin!, targetId.trim(), BigInt(Date.now() + Number(suspendHours) * 3600 * 1000), suspendReason.trim()))}
                    />
                    <ActionButton
                      disabled={!canOperate || actionBusy != null || isSelfTarget}
                      busy={actionBusy === 'unsuspend'}
                      icon={<Unlock className="w-3.5 h-3.5" />}
                      label="Unsuspend"
                      tone="neutral"
                      onClick={() => act('unsuspend', () => unsuspendUser(admin!, targetId.trim()))}
                    />
                    <ActionButton
                      disabled={!canOperate || actionBusy != null || !warnReason.trim() || isSelfTarget}
                      busy={actionBusy === 'warn'}
                      icon={<Bell className="w-3.5 h-3.5" />}
                      label="Warn"
                      tone="amber"
                      onClick={() => act('warn', () => warnUser(admin!, targetId.trim(), warnReason.trim()))}
                    />
                    <ActionButton
                      disabled={!canOperate || actionBusy != null || isSelfTarget}
                      busy={actionBusy === 'clearWarnings'}
                      icon={<BellOff className="w-3.5 h-3.5" />}
                      label="Clear warnings"
                      tone="neutral"
                      onClick={() => act('clearWarnings', () => clearWarnings(admin!, targetId.trim()))}
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
            </div>
            {!canOperate && (
              <p className="mt-3 text-xs text-amber-400 border border-amber-400/30 rounded-lg px-3 py-2">Admin key required.</p>
            )}
            <div className="mt-4 space-y-2">
              {docs.length === 0 && !docsLoading && (
                <p className="text-sm text-[#93a1bd]">No documents yet.</p>
              )}
              {docs.map((doc) => (
                <div key={doc.id} className="flex items-center gap-3 rounded-xl border border-[#22304e] bg-[#0b1220] px-4 py-3">
                  <span className={`text-[10px] uppercase tracking-wider rounded px-1.5 py-0.5 border shrink-0 ${doc.type === 'thread' ? 'text-[#4db3ff] border-[#4db3ff]/40' : 'text-emerald-400 border-emerald-400/30'}`}>{doc.type}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm truncate">{doc.title}</p>
                    <p className="text-xs text-[#93a1bd]">
                      {shortId(doc.ownerId, 12)} · {formatRelativeTime(doc.createdAt)}
                      {ownsDoc(doc) && <span className="block text-[10px] text-amber-400">own document — the chain refuses self-moderation; these actions are disabled</span>}
                    </p>
                  </div>
                  {doc.type === 'thread' ? (
                    <>
                      <SmallButton icon={<Pin className="w-3.5 h-3.5" />} label={doc.sticky ? 'Unpin' : 'Pin'} active={doc.sticky} disabled={!canOperate || docActionBusy != null || ownsDoc(doc)} busy={docActionBusy === `${doc.id}:sticky`} onClick={() => toggleSticky(doc)} />
                      <SmallButton icon={doc.lockedAt != null ? <Unlock className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />} label={doc.lockedAt != null ? 'Unlock' : 'Lock'} disabled={!canOperate || docActionBusy != null || ownsDoc(doc)} busy={docActionBusy === `${doc.id}:lock`} onClick={() => toggleLock(doc)} />
                    </>
                  ) : (
                    <SmallButton icon={doc.modState === 2 ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />} label={doc.modState === 2 ? 'Unhide' : 'Hide'} active={doc.modState === 2} disabled={!canOperate || docActionBusy != null || ownsDoc(doc)} busy={docActionBusy === `${doc.id}:hide`} onClick={() => toggleHide(doc)} />
                  )}
                  <SmallButton icon={<Trash2 className="w-3.5 h-3.5" />} label="Delete" danger disabled={!canOperate || docActionBusy != null || ownsDoc(doc)} busy={docActionBusy === `${doc.id}:delete`} onClick={() => deleteDoc(doc)} />
                </div>
              ))}
            </div>
          </section>

          <footer className="text-xs text-[#93a1bd] flex items-center gap-2 flex-wrap">
            <span>dForum moderation · {NETWORK}</span>
            <span>·</span>
            <Link href="/" className="text-[#4db3ff] hover:underline">back to the forum</Link>
          </footer>
        </div>
      </main>
      <Footer />
    </>
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

function ActionButton({ disabled, busy, icon, label, tone, onClick }: { disabled: boolean; busy: boolean; icon: React.ReactNode; label: string; tone: 'red' | 'amber' | 'neutral'; onClick: () => void }) {
  const tones = {
    red: 'border-red-500/40 text-red-300 hover:bg-red-500/10',
    amber: 'border-amber-400/40 text-amber-300 hover:bg-amber-400/10',
    neutral: 'border-[#22304e] text-[#93a1bd] hover:text-white hover:border-[#008CE7]',
  }
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm transition disabled:opacity-40 disabled:cursor-not-allowed ${tones[tone]}`}
    >
      {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : icon}
      {label}
    </button>
  )
}

function SmallButton({ icon, label, active, danger, disabled, busy, onClick }: { icon: React.ReactNode; label: string; active?: boolean; danger?: boolean; disabled?: boolean; busy?: boolean; onClick: () => void }) {
  const cls = danger
    ? 'border-red-500/40 text-red-300 hover:bg-red-500/10'
    : active
      ? 'border-[#4db3ff]/60 bg-[#4db3ff]/10 text-[#4db3ff]'
      : 'border-[#22304e] text-[#93a1bd] hover:text-white hover:border-[#008CE7]'
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition disabled:opacity-40 disabled:cursor-not-allowed ${cls}`}
    >
      {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : icon}
      {label}
    </button>
  )
}

function TextInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="text-xs text-[#93a1bd]">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-lg border border-[#22304e] bg-[#0b1220] px-3 py-2 text-xs focus:border-[#008CE7] focus:outline-none"
      />
    </label>
  )
}
