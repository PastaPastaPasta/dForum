'use client'

import Link from 'next/link'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { ExternalLink, EyeOff, Lock, Pin, ShieldCheck, Trash2, ArrowRightLeft, Eye, Unlock, Flag, Gavel, ScrollText, Search } from 'lucide-react'
import type { RawDoc } from '@/lib/forum/types'
import { excerpt, isHidden, memberLabel, num, postBody, str, threadForumId } from '@/lib/forum/model'
import { REPORT_REASONS } from '@/lib/forum/actions'
import { getDoc, queryAll, queryPage } from '@/lib/live/platform'
import { refreshLive } from '@/lib/live/overlay'
import { useNames } from '@/lib/live/names'
import { useModeratorKey } from '@/lib/moderation/use-moderator-key'
import {
  type ModerationIdentity, banUser, changeDocumentFields, clearWarnings, deleteDocument, moderationStatus, suspendUser, unbanUser, unsuspendUser, warnUser,
} from '@/lib/services/moderation-service'
import { writeFailureMessage } from '@/lib/services/write-errors'
import { useSession } from '@/lib/session'
import { LOGIN_AVAILABLE, canonicalHost, hostIsCanonical } from '@/lib/host'
import { useFrameBuster } from '@/lib/use-frame-buster'
import { redactWif } from '@/lib/redact'
import { Time } from '@/components/ui/Time'

type Tab = 'reports' | 'content' | 'members' | 'log'
type ForumOption = { id: string; title: string }

export default function ModerationPage() {
  const frame = useFrameBuster()
  const [host, setHost] = useState('')
  useEffect(() => setHost(location.hostname), [])
  if (frame === 'unknown' || !host) return <p role="status" className="py-16 text-center text-ink-2">Loading…</p>
  if (frame === 'framed') return <Gate title="Open this page in its own tab" body="The moderation console holds a signing key, so it never runs inside a frame." />
  if (!LOGIN_AVAILABLE || !hostIsCanonical(host)) {
    return <Gate title="Moderation is not available here" body={`Moderators log in on ${canonicalHost()}. Other copies of this site are read only.`} />
  }
  return <Console />
}

function Gate({ title, body }: { title: string; body: string }) {
  return (
    <div className="panel mx-auto max-w-md p-8 text-center">
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="mt-2 text-ink-2">{body}</p>
    </div>
  )
}

function Console() {
  const { session } = useSession()
  const key = useModeratorKey()
  const [identityId, setIdentityId] = useState('')
  const [wif, setWif] = useState('')
  const [tab, setTab] = useState<Tab>('reports')
  const [memberPrefill, setMemberPrefill] = useState<string | null>(null)
  useEffect(() => {
    const q = new URLSearchParams(location.search)
    if (q.get('ref')) setTab('content')
    else if (q.get('member')) setTab('members')
  }, [])
  const [forums, setForums] = useState<ForumOption[]>([])
  const [flash, setFlash] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => { if (session && !identityId) setIdentityId(session.identityId) }, [session, identityId])
  useEffect(() => {
    queryAll('forum', { orderBy: [['slug', 'asc']] }).then((r) => setForums(r.docs.filter((f) => f.p.archived !== true).map((f) => ({ id: f.id, title: str(f, 'title') ?? f.id })))).catch(() => undefined)
  }, [])

  const act = useCallback(async (label: string, fn: () => Promise<unknown>, confirmText?: string) => {
    if (confirmText && !confirm(confirmText)) return false
    setBusy(label)
    setFlash(null)
    key.touch()
    try {
      await fn()
      setFlash({ ok: true, text: `${label}: done. Visitors see it now; search and the cached pages catch up within the hour.` })
      void refreshLive()
      return true
    } catch (e) {
      setFlash({ ok: false, text: `${label} failed: ${redactWif(writeFailureMessage(e).message)}` })
      return false
    } finally {
      setBusy(null)
    }
  }, [key])

  if (!key.moderator) {
    return (
      <div className="mx-auto max-w-lg space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">Moderation</h1>
        <form className="panel space-y-3 p-5" onSubmit={(e) => { e.preventDefault(); const w = wif; setWif(''); void key.unlock(identityId.trim(), w) }}>
          <p className="text-sm text-ink-2">Moderation actions are signed with your identity&apos;s CRITICAL key. It stays in this tab and is cleared when you lock the console, hide the tab, or stay idle for 10 minutes.</p>
          <label className="block text-sm font-medium">Moderator identity
            <input className="field mt-1 font-mono text-sm" value={identityId} onChange={(e) => setIdentityId(e.target.value)} required autoComplete="off" />
          </label>
          <label className="block text-sm font-medium">CRITICAL key (WIF)
            <input className="field mt-1 font-mono text-sm" type="password" value={wif} onChange={(e) => setWif(e.target.value)} required autoComplete="off" spellCheck={false} />
          </label>
          <button className="btn btn-primary" disabled={key.busy}>{key.busy ? 'Checking…' : 'Unlock console'}</button>
          {key.error && <p role="alert" className="text-sm text-danger">{key.error}</p>}
          {key.notice && <p role="status" className="text-sm text-ink-2">{key.notice}</p>}
        </form>
      </div>
    )
  }

  const props = {
    act, busy, forums, moderatorId: key.moderator.identityId, memberPrefill,
    openMember: (id: string) => { setMemberPrefill(id); setTab('members') },
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Moderation</h1>
        <span className="flex items-center gap-1.5 rounded-md bg-live/10 px-2 py-1 text-sm text-live"><ShieldCheck className="h-4 w-4" />Signing as {memberLabel(key.moderator.identityId)}</span>
        <button type="button" className="btn btn-quiet ml-auto" onClick={key.lock}><Lock className="h-4 w-4" />Lock console</button>
      </div>
      <div role="tablist" className="flex gap-1 overflow-x-auto overflow-y-hidden border-b border-rule [scrollbar-width:none]" aria-label="Moderation sections">
        {TABS.map(([t, label, Icon]) => (
          <button key={t} id={`tab-${t}`} type="button" role="tab" aria-selected={tab === t} aria-controls={`panel-${t}`} tabIndex={tab === t ? 0 : -1}
            onClick={() => setTab(t)}
            onKeyDown={(e) => {
              const i = TABS.findIndex(([x]) => x === t)
              const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
              if (!step) return
              e.preventDefault()
              const next = TABS[(i + step + TABS.length) % TABS.length][0]
              setTab(next)
              document.getElementById(`tab-${next}`)?.focus()
            }}
            className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium ${tab === t ? 'border-dash text-ink' : 'border-transparent text-ink-2 hover:text-ink'}`}>
            <Icon aria-hidden className="h-4 w-4" />{label}
          </button>
        ))}
      </div>
      {flash && <p role={flash.ok ? 'status' : 'alert'} className={`rounded-md px-3 py-2 text-sm ${flash.ok ? 'bg-live/10 text-live' : 'bg-danger/10 text-danger'}`}>{flash.text}</p>}
      <ModeratorContext.Provider value={key.moderator}>
        <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
          {tab === 'reports' && <Reports {...props} />}
          {tab === 'content' && <Content {...props} />}
          {tab === 'members' && <Members {...props} />}
          {tab === 'log' && <AuditLog />}
        </div>
      </ModeratorContext.Provider>
    </div>
  )
}

const TABS = [['reports', 'Reports', Flag], ['content', 'Content', Search], ['members', 'Members', Gavel], ['log', 'Audit log', ScrollText]] as const

interface PanelProps {
  act: (label: string, fn: () => Promise<unknown>, confirmText?: string) => Promise<boolean>
  busy: string | null
  forums: ForumOption[]
  moderatorId: string
  /** Opens the Members tab looking up this identity. */
  openMember: (id: string) => void
  memberPrefill: string | null
}

const ModeratorContext = createContext<ModerationIdentity | null>(null)
const useModerator = () => useContext(ModeratorContext)

function Reports({ act, busy }: PanelProps) {
  const [reports, setReports] = useState<RawDoc[] | null>(null)
  const [posts, setPosts] = useState<Record<string, RawDoc>>({})
  const [showDone, setShowDone] = useState(false)
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [failed, setFailed] = useState(false)
  const [truncated, setTruncated] = useState(false)
  // Outcomes this console just wrote. A node can answer the reload before it has the change, so
  // these stay applied until the chain reports a status of its own.
  const [done, setDone] = useState<Record<string, { status: number; hidPost?: string }>>({})
  const load = useCallback(async () => {
    setFailed(false)
    const r = await queryAll('report', { where: [['$createdAt', '>', 0]], orderBy: [['$createdAt', 'desc']] }, 200).catch(() => null)
    if (!r) { setFailed(true); return }
    setReports(r.docs)
    setTruncated(r.truncated)
    const ids = [...new Set(r.docs.map((d) => str(d, 'postId')).filter((x): x is string => !!x))]
    const found: Record<string, RawDoc> = {}
    for (let i = 0; i < ids.length; i += 100) {
      const page = await queryPage('post', { where: [['$id', 'in', ids.slice(i, i + 100)]], orderBy: [['$id', 'asc']] }).catch(() => ({ docs: [] as RawDoc[] }))
      for (const p of page.docs) found[p.id] = p
    }
    setPosts(found)
  }, [])
  useEffect(() => { void load() }, [load])
  const names = useNames({}, (reports ?? []).flatMap((r) => [r.ownerId, posts[str(r, 'postId') ?? '']?.ownerId ?? '']).filter(Boolean))
  const m = useModerator()
  if (failed) return <p role="alert" className="text-danger">Couldn&apos;t load reports. <button type="button" className="link" onClick={() => void load()}>Try again</button></p>
  if (!reports) return <p role="status" className="text-ink-2">Loading reports…</p>
  const statusOf = (r: RawDoc) => num(r, 'status') ?? done[r.id]?.status
  const hiddenLocally = new Set(Object.values(done).map((d) => d.hidPost).filter(Boolean))
  const open = reports.filter((r) => statusOf(r) === undefined)
  const list = showDone ? reports : open
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-3 text-sm">
        <p className="text-ink-2">{open.length} open of {reports.length} {truncated ? 'most recent ' : ''}reports</p>
        <label className="ml-auto flex items-center gap-2"><input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />Show resolved</label>
        <button type="button" className="btn btn-quiet" onClick={() => void load()}>Refresh</button>
      </div>
      {list.length === 0 && <p className="panel px-4 py-6 text-center text-ink-2">No open reports.</p>}
      <ul className="space-y-3">
        {list.map((r) => {
          const post = posts[str(r, 'postId') ?? '']
          const reason = REPORT_REASONS.find((x) => x.value === num(r, 'reason'))?.label ?? 'Other'
          const status = statusOf(r)
          return (
            <li key={r.id} className="panel space-y-2 p-4">
              <p className="text-sm"><span className="font-semibold">{reason}</span> reported by <Link className="link" href={`/u/${r.ownerId}/`}>{names(r.ownerId)}</Link> <span className="text-ink-2"><Time at={r.createdAt} /></span>
                {status !== undefined && <span className="ml-2 rounded bg-sunk px-1.5 text-xs">{status === 2 ? 'Actioned' : 'Dismissed'}{str(r, 'resolution') ? `: ${str(r, 'resolution')}` : ''}</span>}</p>
              {str(r, 'note') && <p className="text-sm text-ink-2">&ldquo;{str(r, 'note')}&rdquo;</p>}
              {post ? (
                <blockquote className="rounded-md border border-rule bg-sunk/50 px-3 py-2 text-sm">
                  <p className="mb-1 text-xs text-ink-2">Post by <Link className="link" href={`/u/${post.ownerId}/`}>{names(post.ownerId)}</Link>{(isHidden(post) || hiddenLocally.has(post.id)) && ' (hidden)'} · <Link className="link" href={`/t/${str(post, 'threadId')}/#post-${post.id}`}>open</Link></p>
                  {excerpt(postBody(post), 400)}
                </blockquote>
              ) : <p className="text-sm text-ink-2">The reported post was removed.</p>}
              {status === undefined && m && (
                <div className="flex flex-wrap items-center gap-2">
                  <label className="flex items-center gap-2 text-sm">Note
                    <input className="field max-w-xs text-sm" placeholder="Optional, saved with the report" maxLength={200} value={notes[r.id] ?? ''} onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })} />
                  </label>
                  {post && !isHidden(post) && !hiddenLocally.has(post.id) && (
                    <button type="button" className="btn btn-danger" disabled={!!busy} onClick={() => void act('Hide post and resolve', async () => {
                      await changeDocumentFields(m, 'post', post.id, { modState: 1 }, notes[r.id] ?? '')
                      await changeDocumentFields(m, 'report', r.id, { status: 2, ...(notes[r.id] ? { resolution: notes[r.id] } : {}) })
                    }).then((ok) => { if (ok) { setDone((d) => ({ ...d, [r.id]: { status: 2, hidPost: post.id } })); void load() } })}><EyeOff aria-hidden className="h-4 w-4" />Hide post</button>
                  )}
                  <button type="button" className="btn btn-quiet" disabled={!!busy} onClick={() => void act('Dismiss report', () =>
                    changeDocumentFields(m, 'report', r.id, { status: 3, ...(notes[r.id] ? { resolution: notes[r.id] } : {}) })).then((ok) => { if (ok) { setDone((d) => ({ ...d, [r.id]: { status: 3 } })); void load() } })}>Dismiss</button>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function parseRef(input: string): { type: 'thread' | 'post'; id: string } | null {
  const s = input.trim()
  const post = s.match(/#post-([1-9A-HJ-NP-Za-km-z]{32,44})/)
  if (post) return { type: 'post', id: post[1] }
  const thread = s.match(/\/t\/([1-9A-HJ-NP-Za-km-z]{32,44})/)
  if (thread) return { type: 'thread', id: thread[1] }
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s)) return { type: 'thread', id: s }
  return null
}

function Content({ act, busy, forums, moderatorId, openMember }: PanelProps) {
  const m = useModerator()
  const [ref, setRef] = useState('')
  const [doc, setDoc] = useState<{ type: 'thread' | 'post'; doc: RawDoc } | null>(null)
  const [thread, setThread] = useState<RawDoc | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [moveTo, setMoveTo] = useState('')
  const [recent, setRecent] = useState<RawDoc[]>([])
  const names = useNames({}, [doc?.doc.ownerId ?? '', ...recent.map((p) => p.ownerId)].filter(Boolean))

  const [looking, setLooking] = useState(false)
  const requestId = useRef(0)
  const lookup = useCallback(async (input: string) => {
    const mine = ++requestId.current
    setError(null)
    setDoc(null)
    setThread(null)
    setMoveTo('')
    setReason('')
    const r = parseRef(input)
    if (!r) { setError('Paste a thread link, a post link (with #post-…), or a thread id.'); return }
    setLooking(true)
    // Only the latest lookup may touch state: an older, slower one must not overwrite it.
    const current = () => mine === requestId.current
    try {
      let d = await getDoc(r.type, r.id)
      let type = r.type
      if (!d && r.type === 'thread') { d = await getDoc('post', r.id); type = 'post' }
      if (!current()) return
      if (!d) { setError('No thread or post with that id.'); setDoc(null); return }
      const parent = type === 'thread' ? d : await getDoc('thread', str(d, 'threadId') ?? '')
      if (!current()) return
      setThread(parent)
      setDoc({ type, doc: d })
    } catch {
      if (current()) setError('Could not reach Dash Platform. Try again.')
    } finally {
      if (current()) setLooking(false)
    }
  }, [])
  useEffect(() => {
    const pre = new URLSearchParams(location.search).get('ref')
    if (pre) { setRef(pre); void lookup(pre) }
  }, [lookup])
  useEffect(() => {
    queryPage('post', { where: [['$updatedAt', '>', 0]], orderBy: [['$updatedAt', 'desc']], limit: 25 }).then((r) => setRecent(r.docs)).catch(() => undefined)
  }, [])

  const reload = () => doc && lookup(doc.type === 'thread' ? doc.doc.id : `#post-${doc.doc.id}`)
  const own = doc?.doc.ownerId === moderatorId
  const fields = (type: 'thread' | 'post', id: string, f: Record<string, unknown>, label: string, confirmText?: string) =>
    m && act(label, () => changeDocumentFields(m, type, id, f, reason), confirmText).then((ok) => { if (ok) void reload() })

  return (
    <section className="space-y-4">
      <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); void lookup(ref) }}>
        <input className="field max-w-xl flex-1 font-mono text-sm" placeholder="Thread or post link" value={ref} onChange={(e) => setRef(e.target.value)} aria-label="Thread or post link" />
        <button className="btn btn-primary" disabled={looking}>{looking ? 'Finding…' : 'Find'}</button>
      </form>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {looking && <p role="status" className="text-sm text-ink-2">Loading from Dash Platform…</p>}
      {doc && (
        <div className="panel space-y-3 p-4">
          <p className="text-sm text-ink-2">{doc.type === 'thread' ? 'Thread' : 'Post'} by <Link className="link" href={`/u/${doc.doc.ownerId}/`}>{names(doc.doc.ownerId)}</Link>, <Time at={doc.doc.createdAt} />
            {isHidden(doc.doc) && <span className="ml-2 rounded bg-danger/10 px-1.5 text-xs text-danger">hidden</span>}</p>
          <p className="font-medium" data-testid="moderation-target">{doc.type === 'thread' ? str(doc.doc, 'title') : excerpt(postBody(doc.doc), 500)}</p>
          <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {thread && <Link className="link" href={`/t/${thread.id}/`}>Open thread <ExternalLink aria-hidden className="inline h-3.5 w-3.5" /></Link>}
            {!own && <button type="button" className="link" onClick={() => openMember(doc.doc.ownerId)}>Ban, suspend or warn the author</button>}
          </p>
          {own ? <p className="text-sm text-ink-2">You can&apos;t moderate your own content (the network refuses it).</p> : m && (
            <>
              <label className="block text-sm font-medium">Reason (optional, kept in the public moderation record)
                <input className="field mt-1 text-sm" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
              </label>
              <div className="flex flex-wrap gap-2">
                {isHidden(doc.doc)
                  ? <button type="button" className="btn btn-quiet" disabled={!!busy} onClick={() => void fields(doc.type, doc.doc.id, { modState: null }, 'Unhide')}><Eye className="h-4 w-4" />Unhide</button>
                  : <button type="button" className="btn btn-danger" disabled={!!busy} onClick={() => void fields(doc.type, doc.doc.id, { modState: 1 }, 'Hide', `Hide this ${doc.type}? It disappears from listings and the static index; you can unhide it later.`)}><EyeOff className="h-4 w-4" />Hide</button>}
                {doc.type === 'thread' && (
                  <>
                    <button type="button" className="btn btn-quiet" disabled={!!busy} onClick={() => void fields('thread', doc.doc.id, { sticky: doc.doc.p.sticky === true ? null : true }, doc.doc.p.sticky === true ? 'Unpin' : 'Pin')}><Pin className="h-4 w-4" />{doc.doc.p.sticky === true ? 'Unpin' : 'Pin'}</button>
                    <button type="button" className="btn btn-quiet" disabled={!!busy} onClick={() => void fields('thread', doc.doc.id, { locked: doc.doc.p.locked === true ? null : true }, doc.doc.p.locked === true ? 'Unlock' : 'Lock')}>
                      {doc.doc.p.locked === true ? <><Unlock className="h-4 w-4" />Unlock</> : <><Lock className="h-4 w-4" />Lock</>}
                    </button>
                    <span className="flex items-center gap-1">
                      <select className="field w-auto text-sm" value={moveTo} onChange={(e) => setMoveTo(e.target.value)} aria-label="Move to forum">
                        <option value="">Move to…</option>
                        {forums.filter((f) => f.id !== threadForumId(doc.doc)).map((f) => <option key={f.id} value={f.id}>{f.title}</option>)}
                      </select>
                      <button type="button" className="btn btn-quiet" disabled={!!busy || !moveTo} onClick={() => void fields('thread', doc.doc.id, { movedToForumId: moveTo === str(doc.doc, 'forumId') ? null : moveTo }, 'Move thread')}><ArrowRightLeft className="h-4 w-4" />Move</button>
                    </span>
                  </>
                )}
                <button type="button" className="btn btn-quiet text-danger" disabled={!!busy} onClick={() => m && void act('Delete', async () => {
                  if (!isHidden(doc.doc)) await changeDocumentFields(m, doc.type, doc.doc.id, { modState: 1 }, reason)
                  await deleteDocument(m, doc.type, doc.doc.id, reason)
                }, `Delete this ${doc.type} for good? It is hidden first, then removed; only a record of the removal remains. Use Hide unless the content must not exist at all.`).then((ok) => { if (ok) void setDoc(null) })}><Trash2 className="h-4 w-4" />Delete</button>
              </div>
            </>
          )}
        </div>
      )}
      <div>
        <h2 className="mb-2 font-semibold">Latest posts</h2>
        <ul className="panel divide-y divide-rule">
          {recent.map((p) => (
            <li key={p.id} className="flex items-start gap-3 px-4 py-2.5 text-sm">
              <div className="min-w-0 flex-1">
                <p className="text-ink-2"><Link className="link" href={`/u/${p.ownerId}/`}>{names(p.ownerId)}</Link>, <Time at={p.createdAt} />{isHidden(p) && ' (hidden)'}</p>
                <p className="line-clamp-2">{excerpt(postBody(p), 240)}</p>
              </div>
              <button type="button" className="btn btn-quiet" disabled={looking} onClick={() => { setRef(`#post-${p.id}`); void lookup(`#post-${p.id}`) }}>Review</button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

function Members({ act, busy, moderatorId, memberPrefill }: PanelProps) {
  const m = useModerator()
  const [target, setTarget] = useState('')
  const [status, setStatus] = useState<Awaited<ReturnType<typeof moderationStatus>> | null>(null)
  const [reason, setReason] = useState('')
  const [days, setDays] = useState(7)
  const [error, setError] = useState<string | null>(null)
  const valid = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(target.trim())
  const statusRequest = useRef(0)
  const load = useCallback(async (id?: string) => {
    const mine = ++statusRequest.current
    setError(null)
    setStatus(null)
    try {
      const s = await moderationStatus((id ?? target).trim())
      if (mine === statusRequest.current) setStatus(s)
    } catch (e) {
      if (mine === statusRequest.current) setError(e instanceof Error ? e.message : 'Could not read the status.')
    }
  }, [target])
  // Arriving from a post's "Moderate" action with ?member= looks the author up right away.
  useEffect(() => {
    const pre = memberPrefill ?? new URLSearchParams(location.search).get('member')
    if (pre && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(pre)) { setTarget(pre); void load(pre) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const run = (label: string, fn: () => Promise<unknown>, c?: string) => act(label, fn, c).then((ok) => { if (ok) void load() })
  const id = target.trim()
  return (
    <section className="space-y-4">
      <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); if (valid) void load() }}>
        <input className="field max-w-xl flex-1 font-mono text-sm" placeholder="Member identity id" value={target} onChange={(e) => { statusRequest.current++; setTarget(e.target.value); setStatus(null) }} aria-label="Member identity id" />
        <button className="btn btn-primary" disabled={!valid}>Look up</button>
      </form>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {status && m && (
        <div className="panel space-y-3 p-4">
          <p className="text-sm"><Link className="link font-medium" href={`/u/${id}/`}>{memberLabel(id)}</Link>:{' '}
            {status.banned ? <span className="text-danger">banned{status.banReason?.text ? ` (${status.banReason.text})` : ''}</span> : 'not banned'},{' '}
            {status.suspendedUntil ? <>suspended until {new Date(Number(status.suspendedUntil)).toUTCString()}</> : 'not suspended'},{' '}
            {(status.warnings?.length ?? 0)} warning{status.warnings?.length === 1 ? '' : 's'}</p>
          {id === moderatorId ? <p className="text-sm text-ink-2">That&apos;s you.</p> : (
            <>
              <label className="block text-sm font-medium">Reason (required for ban, suspend and warn; public)
                <input className="field mt-1 text-sm" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
              </label>
              <div className="flex flex-wrap items-center gap-2">
                {status.banned
                  ? <button type="button" className="btn btn-quiet" disabled={!!busy} onClick={() => void run('Unban', () => unbanUser(m, id))}>Unban</button>
                  : <button type="button" className="btn btn-danger" disabled={!!busy || !reason.trim()} onClick={() => void run('Ban', () => banUser(m, id, reason.trim()), 'Ban this identity? It can no longer write to this forum until unbanned.')}>Ban</button>}
                {status.suspendedUntil
                  ? <button type="button" className="btn btn-quiet" disabled={!!busy} onClick={() => void run('Lift suspension', () => unsuspendUser(m, id))}>Lift suspension</button>
                  : <span className="flex items-center gap-1"><label className="flex items-center gap-1 text-sm"><input type="number" min={1} max={365} className="field w-20 text-sm" value={days} onChange={(e) => setDays(Number(e.target.value))} /> days</label>
                    <button type="button" className="btn btn-quiet" disabled={!!busy || !reason.trim()} onClick={() => void run('Suspend', () => suspendUser(m, id, BigInt(Date.now() + days * 86_400_000), reason.trim()))}>Suspend {days} days</button></span>}
                <button type="button" className="btn btn-quiet" disabled={!!busy || !reason.trim()} onClick={() => void run('Warn', () => warnUser(m, id, reason.trim()))}>Warn</button>
                {(status.warnings?.length ?? 0) > 0 && <button type="button" className="btn btn-quiet" disabled={!!busy} onClick={() => void run('Clear warnings', () => clearWarnings(m, id))}>Clear warnings</button>}
              </div>
              <p className="text-xs text-ink-2">Banned and suspended members can&apos;t post, reply, react or edit here; Dash Platform enforces it. Warnings are a public note and block nothing.</p>
            </>
          )}
        </div>
      )}
    </section>
  )
}

function AuditLog() {
  const [items, setItems] = useState<Array<{ type: string; doc: RawDoc }> | null>(null)
  useEffect(() => {
    Promise.all(['thread', 'post', 'profile', 'report'].map((type) =>
      queryPage(type, { where: [['$moderatedAt', '>', 0]], orderBy: [['$moderatedAt', 'desc']], limit: 50 }).then((r) => r.docs.map((doc) => ({ type, doc }))).catch(() => [])))
      .then((lists) => setItems(lists.flat().sort((a, b) => (b.doc.moderatedAt ?? 0) - (a.doc.moderatedAt ?? 0))))
  }, [])
  const names = useNames({}, (items ?? []).flatMap((i) => [i.doc.ownerId, i.doc.moderatedBy ?? '']).filter(Boolean))
  const rows = useMemo(() => items ?? [], [items])
  if (!items) return <p role="status" className="text-ink-2">Loading the moderation record…</p>
  return (
    <section className="space-y-2">
      <p className="text-sm text-ink-2">The latest moderation actions, newest first. Each row shows the item&apos;s current state. Deletions are kept in a separate record and are not listed.</p>
      {rows.length === 0 ? <p className="panel px-4 py-6 text-center text-ink-2">No moderation actions yet.</p> : (
        <ul className="panel divide-y divide-rule text-sm">
          {rows.map(({ type, doc }) => (
            <li key={`${type}-${doc.id}`} className="flex flex-wrap items-baseline gap-x-2 px-4 py-2">
              <span className="font-medium">{doc.moderatedBy ? names(doc.moderatedBy) : 'A moderator'}</span>
              <span className="text-ink-2">{type} by {names(doc.ownerId)}:</span>
              <span>{[isHidden(doc) && 'hidden', doc.p.sticky === true && 'pinned', doc.p.locked === true && 'locked', str(doc, 'movedToForumId') && 'moved',
                num(doc, 'status') === 2 && 'report actioned', num(doc, 'status') === 3 && 'report dismissed'].filter(Boolean).join(', ') || 'restored'}</span>
              <span className="ml-auto text-ink-2">{doc.moderatedAt ? <Time at={doc.moderatedAt} /> : null}</span>
              {type === 'thread' && <Link className="link" href={`/t/${doc.id}/`}>{str(doc, 'title') ?? 'View thread'}</Link>}
              {type === 'post' && <Link className="link" href={`/t/${str(doc, 'threadId')}/#post-${doc.id}`}>View post</Link>}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

