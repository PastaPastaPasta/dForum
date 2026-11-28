'use client'

import Link from 'next/link'
import { useState } from 'react'
import { Flag, Link2, MessageSquareQuote, Pencil, Trash2, EyeOff, History } from 'lucide-react'
import type { MemberView, RawDoc, ReactionCounts } from '@/lib/forum/types'
import { archiveAuthor, effectiveAt, isEdited, isHidden, isRetracted, num, postBody } from '@/lib/forum/model'
import { REPORT_REASONS } from '@/lib/forum/actions'
import { Avatar } from '@/components/ui/Avatar'
import { Markdown } from '@/components/ui/Markdown'
import { Time } from '@/components/ui/Time'
import { Composer } from './Composer'
import { Reactions } from './Reactions'

export interface PostActions {
  canWrite: boolean
  busy: string | null
  onQuote(post: RawDoc, name: string): void
  onEdit(post: RawDoc, body: string): Promise<boolean>
  onRetract(post: RawDoc): void
  onReact(post: RawDoc, kind: number): void
  onReport(post: RawDoc, reason: number, note: string): Promise<boolean>
}

const joinedFmt = new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })

export function PostCard({ post, n, threadId, name, member, role, archive, sourceUrl, reactions, mine, me, actions }: {
  post: RawDoc
  n: number
  threadId: string
  name: string
  member?: MemberView
  role?: string
  archive?: string
  sourceUrl?: string
  reactions: ReactionCounts
  mine: number
  me: string | null
  actions: PostActions
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [reporting, setReporting] = useState(false)
  const [reason, setReason] = useState<number>(1)
  const [note, setNote] = useState('')
  const [reported, setReported] = useState(false)
  const imported = archiveAuthor(post, archive)
  const displayName = imported ?? name
  const hidden = isHidden(post)
  const retracted = isRetracted(post)
  const own = me === post.ownerId && !imported
  const busy = actions.busy === post.id
  const at = effectiveAt(post, archive)
  const origPostId = imported && num(post, 'origId') ? Math.floor((num(post, 'origId') as number) / 100) : undefined

  return (
    <article id={`post-${post.id}`} aria-labelledby={`post-${post.id}-author`}
      className={`panel scroll-mt-20 overflow-hidden md:grid md:grid-cols-[11rem_1fr] ${imported ? 'border-l-4 border-l-archive/70' : ''}`}>
      <aside className={`flex items-center gap-3 border-b border-rule px-4 py-3 md:flex-col md:items-center md:border-b-0 md:border-r md:py-5 md:text-center ${imported ? 'bg-archive-wash/60' : 'bg-sunk/40'}`}>
        <Avatar seed={post.ownerId + (imported ?? '')} name={displayName} src={member?.avatarUrl} size={56} archive={!!imported} />
        <div className="min-w-0 md:w-full">
          {imported ? (
            <p id={`post-${post.id}-author`} className="truncate font-semibold text-archive">{imported}</p>
          ) : (
            <Link id={`post-${post.id}-author`} href={`/u/${post.ownerId}/`} className="block truncate font-semibold hover:text-dash">{displayName}</Link>
          )}
          {imported ? (
            <p className="text-xs text-ink-2">Imported member</p>
          ) : (
            <>
              {(role || member?.title) && <p className="mt-0.5 text-xs font-semibold text-dash">{role ?? member?.title}</p>}
              {member && (
                <dl className="mt-1 hidden text-xs text-ink-2 md:block">
                  <div><dt className="inline">Joined </dt><dd className="inline">{joinedFmt.format(member.joinedAt)}</dd></div>
                  <div><dt className="inline">Messages </dt><dd className="inline tabnum">{member.posts.toLocaleString('en-US')}</dd></div>
                </dl>
              )}
            </>
          )}
        </div>
      </aside>
      <div className="flex min-w-0 flex-col">
        <header className="flex items-center gap-2 px-4 pt-3 text-sm text-ink-2 md:px-5">
          <Link href={`/t/${threadId}/#post-${post.id}`} className="hover:text-dash"><Time at={at} /></Link>
          {isEdited(post) && !retracted && !imported && <span className="flex items-center gap-1" title={`Edited ${new Date(post.updatedAt).toUTCString()}`}><History className="h-3.5 w-3.5" />edited</span>}
          <a href={`#post-${post.id}`} className="ml-auto tabnum hover:text-dash" aria-label={`Permalink to post ${n}`}>#{n}</a>
        </header>
        {imported && (
          <p className="mx-4 mt-2 rounded-md bg-archive-wash px-3 py-1.5 text-sm text-archive md:mx-5">
            Imported from the archive. Originally posted by {imported}
            {sourceUrl && origPostId ? <> (<a className="underline" href={`${sourceUrl.replace(/\/?$/, '/')}posts/${origPostId}/`} rel="nofollow noopener">source</a>)</> : null}.
          </p>
        )}
        <div className="flex-1 px-4 py-3 md:px-5">
          {hidden ? (
            <p className="flex items-center gap-2 text-ink-2"><EyeOff className="h-4 w-4" />This post was hidden by a moderator.</p>
          ) : retracted ? (
            <p className="flex items-center gap-2 text-ink-2"><Trash2 className="h-4 w-4" />Deleted by its author.</p>
          ) : editing ? (
            <Composer value={draft} onChange={setDraft} busy={busy} submitLabel="Save changes" label="Edit post" autoFocus
              onCancel={() => setEditing(false)}
              onSubmit={async () => { if (await actions.onEdit(post, draft)) setEditing(false) }} />
          ) : (
            <Markdown source={postBody(post)} />
          )}
          {member?.signature && !hidden && !retracted && !editing && (
            <div className="mt-4 border-t border-rule pt-2 text-sm text-ink-2"><Markdown source={member.signature} className="post-body !font-sans !text-sm" /></div>
          )}
        </div>
        {!hidden && !retracted && !editing && (
          <footer className="flex flex-wrap items-center gap-1 border-t border-rule px-2 py-1.5 md:px-3">
            <Reactions counts={reactions} mine={mine} canReact={actions.canWrite && !own} busy={busy} onReact={(k) => actions.onReact(post, k)} />
            <div className="ml-auto flex flex-wrap items-center">
              <button type="button" className="btn-ghost text-sm" onClick={() => void navigator.clipboard?.writeText(`${location.origin}/t/${threadId}/#post-${post.id}`)}>
                <Link2 className="h-4 w-4" /><span className="hidden sm:inline">Copy link</span>
              </button>
              {actions.canWrite && (
                <button type="button" className="btn-ghost text-sm" onClick={() => actions.onQuote(post, displayName)}>
                  <MessageSquareQuote className="h-4 w-4" />Quote
                </button>
              )}
              {own && actions.canWrite && (
                <>
                  <button type="button" className="btn-ghost text-sm" disabled={busy} onClick={() => { setDraft(postBody(post)); setEditing(true) }}><Pencil className="h-4 w-4" />Edit</button>
                  <button type="button" className="btn-ghost text-sm" disabled={busy}
                    onClick={() => { if (confirm('Delete this post? Its text is replaced on chain; the record of the post remains.')) actions.onRetract(post) }}>
                    <Trash2 className="h-4 w-4" />Delete
                  </button>
                </>
              )}
              {actions.canWrite && !own && (
                <button type="button" className="btn-ghost text-sm" aria-expanded={reporting} disabled={reported} onClick={() => setReporting((r) => !r)}>
                  <Flag className="h-4 w-4" />{reported ? 'Reported' : 'Report'}
                </button>
              )}
            </div>
          </footer>
        )}
        {reporting && (
          <form className="space-y-2 border-t border-rule bg-sunk/40 px-4 py-3 text-sm md:px-5" onSubmit={async (e) => {
            e.preventDefault()
            if (await actions.onReport(post, reason, note)) { setReporting(false); setReported(true) }
          }}>
            <p className="font-medium">Report this post to the moderators</p>
            <p className="text-ink-2">Reports are stored on Dash Platform and are public, including who filed them.</p>
            <select className="field" value={reason} onChange={(e) => setReason(Number(e.target.value))} aria-label="Reason">
              {REPORT_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
            <input className="field" maxLength={280} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add details (optional)" aria-label="Details" />
            <div className="flex gap-2">
              <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Sending…' : 'Send report'}</button>
              <button type="button" className="btn btn-quiet" onClick={() => setReporting(false)}>Cancel</button>
            </div>
          </form>
        )}
      </div>
    </article>
  )
}
