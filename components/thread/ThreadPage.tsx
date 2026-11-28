'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Archive, Eye, EyeOff, Lock, Pin, Pencil } from 'lucide-react'
import type { MemberView, RawDoc, ReactionCounts } from '@/lib/forum/types'
import { POSTS_PER_PAGE } from '@/lib/forum/types'
import {
  archiveAuthor, byEffective, countReactions, effectiveAt, isHidden, mergeDocs, num, postBody, str, threadForumId, threadLockedAt, threadPosts, threadTags,
} from '@/lib/forum/model'
import { editPost, editThread, react, reply, report, retractPost } from '@/lib/forum/actions'
import { useLive } from '@/lib/live/overlay'
import { useNames } from '@/lib/live/names'
import { useWatch } from '@/lib/watch'
import { getDoc, queryAll } from '@/lib/live/platform'
import { useSession } from '@/lib/session'
import { LOGIN_AVAILABLE } from '@/lib/host'
import { writeFailureMessage } from '@/lib/services/write-errors'
import { Breadcrumbs } from '@/components/ui/Breadcrumbs'
import { Pagination } from '@/components/ui/Pagination'
import { Time } from '@/components/ui/Time'
import { Composer, type ComposerHandle } from './Composer'
import { PostCard, type PostActions } from './PostCard'

export interface ThreadPageProps {
  threadId: string
  thread: RawDoc | null
  crumbs: Array<{ href: string; label: string }>
  forumArchived: boolean
  posts: RawDoc[]
  firstNumber: number
  page: number
  pages: number
  postIndex: string[]
  reactions: Record<string, ReactionCounts>
  members: Record<string, MemberView>
  roles: Record<string, string>
  snapshotAt: number
  archive?: string
  sourceUrl?: string
  /** For threads newer than the snapshot: lets the page build its breadcrumbs. */
  forums?: Array<{ id: string; slug: string; title: string; parentForumId?: string; archived: boolean }>
}

const ID_PREFIX = 12

export function ThreadPage(props: ThreadPageProps) {
  const { threadId, page, pages, snapshotAt, archive } = props
  const router = useRouter()
  const { session, ready, signOut } = useSession()
  const live = useLive(snapshotAt)
  const composer = useRef<ComposerHandle>(null)
  const [draft, setDraft] = useState('')
  const [replyTo, setReplyTo] = useState<string | undefined>()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [fetched, setFetched] = useState<{ thread: RawDoc | null; posts: RawDoc[]; state: 'idle' | 'loading' | 'done' | 'missing' | 'error' }>(
    { thread: null, posts: [], state: props.thread ? 'done' : 'idle' })
  const [threadReactions, setThreadReactions] = useState<RawDoc[] | null>(null)
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const canWrite = ready && !!session?.authKeyWif && LOGIN_AVAILABLE

  // Threads newer than the snapshot have no static data: read them live.
  useEffect(() => {
    if (props.thread) return
    let alive = true
    setFetched((f) => ({ ...f, state: 'loading' }))
    Promise.all([getDoc('thread', threadId), queryAll('post', { where: [['threadId', '==', threadId]], orderBy: [['$createdAt', 'asc']] }, 20)])
      .then(([t, p]) => alive && setFetched({ thread: t, posts: p.docs, state: t ? 'done' : 'missing' }))
      .catch(() => alive && setFetched((f) => ({ ...f, state: 'error' })))
    return () => { alive = false }
  }, [props.thread, threadId])

  // Exact reaction state for this thread (counts and the member's own reaction).
  useEffect(() => {
    let alive = true
    const t = setTimeout(() => {
      queryAll('reaction', { where: [['threadId', '==', threadId]], orderBy: [['$createdAt', 'asc']] }, 20)
        .then((r) => alive && !r.truncated && setThreadReactions(r.docs)).catch(() => undefined)
    }, 600)
    return () => { alive = false; clearTimeout(t) }
  }, [threadId])

  const thread = useMemo(() => {
    const base = props.thread ?? fetched.thread
    if (!base) return null
    return mergeDocs([base], live.threads.filter((t) => t.id === threadId))[0]
  }, [props.thread, fetched.thread, live.threads, threadId])

  const livePosts = useMemo(() => live.posts.filter((p) => str(p, 'threadId') === threadId), [live.posts, threadId])
  const posts = useMemo(() => {
    if (!thread) return []
    if (!props.thread) return threadPosts(thread, mergeDocs(fetched.posts, livePosts), archive).posts
    const known = new Set(props.postIndex)
    const updated = mergeDocs(props.posts, livePosts.filter((p) => props.posts.some((q) => q.id === p.id)))
    const lockedAt = threadLockedAt(thread)
    const fresh = page === pages
      ? livePosts.filter((p) => !known.has(p.id.slice(0, ID_PREFIX)) && p.createdAt > snapshotAt && (lockedAt === undefined || p.createdAt <= lockedAt))
      : []
    return [...updated.sort(byEffective(archive)), ...fresh.sort(byEffective(archive))]
  }, [thread, props.thread, props.posts, props.postIndex, fetched.posts, livePosts, page, pages, snapshotAt, archive])
  const newElsewhere = page < pages ? livePosts.filter((p) => p.createdAt > snapshotAt && !props.postIndex.includes(p.id.slice(0, ID_PREFIX))).length : 0

  const reactionDocs = useMemo(() => mergeDocs(threadReactions ?? [], live.reactions.filter((r) => str(r, 'threadId') === threadId)), [threadReactions, live.reactions, threadId])
  const counts = useMemo(() => {
    if (threadReactions === null) {
      const delta = countReactions(live.reactions.filter((r) => str(r, 'threadId') === threadId && (num(r, 'kind') ?? 0) > 0 && r.createdAt > snapshotAt))
      const out: Record<string, ReactionCounts> = JSON.parse(JSON.stringify(props.reactions))
      for (const [pid, c] of Object.entries(delta)) for (const [k, v] of Object.entries(c)) (out[pid] ??= {})[Number(k)] = (out[pid][Number(k)] ?? 0) + v
      return out
    }
    return countReactions(reactionDocs.filter((r) => (num(r, 'kind') ?? 0) > 0))
  }, [threadReactions, reactionDocs, live.reactions, props.reactions, threadId, snapshotAt])
  const mine = useMemo(() => {
    const out: Record<string, number> = {}
    if (session) for (const r of reactionDocs) if (r.ownerId === session.identityId) out[str(r, 'postId') ?? ''] = num(r, 'kind') ?? 0
    return out
  }, [reactionDocs, session])

  const totalPosts = props.thread ? props.postIndex.length + (page === pages ? posts.length - props.posts.length : 0) : posts.length
  const watch = useWatch(threadId, str(thread ?? undefined, 'title') ?? '', totalPosts)
  const markSeen = watch.markSeen
  useEffect(() => { if (thread && page === pages) markSeen() }, [thread, page, pages, markSeen])
  const nameOf = useNames(
    Object.fromEntries(Object.values(props.members).filter((m) => m.name).map((m) => [m.id, m.name])),
    posts.map((p) => p.ownerId).concat(thread ? [thread.ownerId] : []),
    live.profiles,
  )

  // A permalink to a post on another page lands here: send it to the right page.
  useEffect(() => {
    const hash = decodeURIComponent(location.hash.replace(/^#post-/, ''))
    if (!hash || document.getElementById(`post-${hash}`)) return
    const i = props.postIndex.indexOf(hash.slice(0, ID_PREFIX))
    if (i < 0) return
    const target = Math.floor(i / POSTS_PER_PAGE) + 1
    if (target !== page) router.replace(`${target === 1 ? `/t/${threadId}/` : `/t/${threadId}/page/${target}/`}#post-${hash}`)
  }, [props.postIndex, page, threadId, router])

  const signer = () => {
    if (!session?.authKeyWif) throw new Error('Log in to write.')
    return { identityId: session.identityId, authKeyWif: session.authKeyWif }
  }
  const run = async (key: string, fn: () => Promise<unknown>): Promise<boolean> => {
    setBusy(key)
    setError(null)
    try {
      await fn()
      return true
    } catch (e) {
      const f = writeFailureMessage(e)
      setError(f.message)
      if (f.sessionLogout) void signOut()
      return false
    } finally {
      setBusy(null)
    }
  }

  const actions: PostActions = {
    canWrite,
    busy,
    onQuote(post, name) {
      const text = postBody(post).split('\n').filter((l) => !l.startsWith('>')).join('\n').trim().slice(0, 600)
      composer.current?.insert(`> **${name}** wrote:\n${text.split('\n').map((l) => `> ${l}`).join('\n')}\n\n`)
      setReplyTo(post.id)
      document.getElementById('reply')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    },
    onEdit: (post, body) => run(post.id, () => editPost(signer(), post.id, body)),
    onRetract: (post) => void run(post.id, () => retractPost(signer(), post.id)),
    onReact: (post, kind) => void run(post.id, async () => {
      const doc = await react(signer(), post, kind)
      setThreadReactions((rs) => (rs ? mergeDocs(rs, [doc]) : rs))
    }),
    onReport: (post, reason, note) => run(post.id, () => report(signer(), post, reason, note)),
  }

  if (!thread) {
    return (
      <div className="panel mx-auto max-w-read p-8 text-center">
        {fetched.state === 'missing' ? (
          <><h1 className="text-xl font-semibold">Thread not found</h1><p className="mt-2 text-ink-2">It may have been removed by a moderator.</p></>
        ) : fetched.state === 'error' ? (
          <><h1 className="text-xl font-semibold">Couldn&apos;t reach Dash Platform</h1><p className="mt-2 text-ink-2">This thread is newer than the static index and has to load live. Check your connection and reload.</p></>
        ) : (
          <p className="text-ink-2" role="status">Loading the thread from Dash Platform…</p>
        )}
      </div>
    )
  }

  let crumbs = props.crumbs
  let forumArchived = props.forumArchived
  if (!props.thread && props.forums) {
    const byId = new Map(props.forums.map((f) => [f.id, f]))
    const chain = []
    let f = byId.get(threadForumId(thread))
    forumArchived = f?.archived ?? false
    while (f && chain.length < 6) { chain.unshift(f); f = f.parentForumId ? byId.get(f.parentForumId) : undefined }
    crumbs = [{ href: '/', label: 'Forums' }, ...chain.map((x) => ({ href: `/f/${x.slug}/`, label: x.title }))]
  }
  const title = str(thread, 'title') ?? '(untitled)'
  const locked = threadLockedAt(thread) !== undefined
  const imported = archiveAuthor(thread, archive)
  const opener = imported ?? nameOf(thread.ownerId)
  const ownThread = session?.identityId === thread.ownerId && !imported
  const canReply = canWrite && !locked && !forumArchived && !isHidden(thread)
  const hrefFor = (n: number) => (n === 1 ? `/t/${threadId}/` : `/t/${threadId}/page/${n}/`)

  return (
    <div className="space-y-5">
      <Breadcrumbs items={crumbs} />
      <header className="space-y-2">
        {editingTitle ? (
          <form className="flex flex-wrap gap-2" onSubmit={(e) => {
            e.preventDefault()
            void run('title', () => editThread(signer(), threadId, { title: titleDraft, tags: threadTags(thread) })).then((ok) => ok && setEditingTitle(false))
          }}>
            <input className="field flex-1 text-lg font-semibold" value={titleDraft} minLength={3} maxLength={150} onChange={(e) => setTitleDraft(e.target.value)} aria-label="Thread title" autoFocus />
            <button className="btn btn-primary" disabled={busy === 'title' || titleDraft.trim().length < 3}>Save title</button>
            <button type="button" className="btn btn-quiet" onClick={() => setEditingTitle(false)}>Cancel</button>
          </form>
        ) : (
          <h1 className="flex items-start gap-2 text-2xl font-semibold leading-tight tracking-tight">
            {thread.p.sticky === true && <Pin aria-label="Pinned" className="mt-1.5 h-5 w-5 shrink-0 text-dash" />}
            {locked && <Lock aria-label="Locked" className="mt-1.5 h-5 w-5 shrink-0 text-ink-2" />}
            <span data-pagefind-meta="title">{title}</span>
            {ownThread && canWrite && (
              <button type="button" className="btn-ghost ml-1 mt-0.5" aria-label="Edit title" onClick={() => { setTitleDraft(title); setEditingTitle(true) }}>
                <Pencil className="h-4 w-4" />
              </button>
            )}
          </h1>
        )}
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-2">
          <button type="button" onClick={watch.toggle} aria-pressed={watch.watching} className="btn btn-quiet order-last ml-auto py-1 text-xs" data-pagefind-ignore>
            {watch.watching ? <><EyeOff className="h-3.5 w-3.5" />Unwatch</> : <><Eye className="h-3.5 w-3.5" />Watch</>}
          </button>
          <span>Started by {imported ? <span className="text-archive">{imported}</span> : <Link className="font-medium text-ink hover:text-dash" href={`/u/${thread.ownerId}/`}>{opener}</Link>}</span>
          <Time at={effectiveAt(thread, archive)} />
          {threadTags(thread).map((t) => <Link key={t} href={`/tags/${t}/`} className="rounded bg-sunk px-1.5 py-0.5 text-xs hover:text-dash">{t}</Link>)}
        </p>
        {imported && (
          <p className="flex items-center gap-2 rounded-md bg-archive-wash px-3 py-2 text-sm text-archive">
            <Archive className="h-4 w-4 shrink-0" />
            This thread was imported from the forum archive.
            {props.sourceUrl && num(thread, 'origId') ? <a className="underline" href={`${props.sourceUrl.replace(/\/?$/, '/')}threads/${num(thread, 'origId')}/`} rel="nofollow noopener">View the original</a> : null}
          </p>
        )}
        {isHidden(thread) && <p className="flex items-center gap-2 rounded-md bg-danger/10 px-3 py-2 text-sm text-danger"><EyeOff className="h-4 w-4" />Moderators hid this thread. It no longer appears in listings.</p>}
      </header>

      <Pagination page={page} pages={pages} href={hrefFor} label="Thread pages" />
      <div className="space-y-4">
        {posts.map((p, i) => (
          <PostCard key={p.id} post={p} n={props.firstNumber + i} threadId={threadId} name={nameOf(p.ownerId)} member={props.members[p.ownerId]}
            role={props.roles[p.ownerId]} archive={archive} sourceUrl={props.sourceUrl} reactions={counts[p.id] ?? {}} mine={mine[p.id] ?? 0}
            me={session?.identityId ?? null} actions={actions} />
        ))}
      </div>
      {newElsewhere > 0 && (
        <p className="rounded-md bg-dash/10 px-3 py-2 text-sm"><Link className="link font-medium" href={hrefFor(pages)}>{newElsewhere} new {newElsewhere === 1 ? 'reply' : 'replies'} on the last page</Link></p>
      )}
      <Pagination page={page} pages={pages} href={hrefFor} label="Thread pages" />

      <section id="reply" aria-label="Reply" className="scroll-mt-24" data-pagefind-ignore>
        {locked ? (
          <p className="panel flex items-center gap-2 px-4 py-3 text-ink-2"><Lock className="h-4 w-4" />This thread is locked. New replies are not shown.</p>
        ) : forumArchived ? (
          <p className="panel flex items-center gap-2 px-4 py-3 text-ink-2"><Archive className="h-4 w-4" />This forum is archived and read only.</p>
        ) : canReply ? (
          <Composer ref={composer} value={draft} onChange={setDraft} busy={busy === 'reply'} submitLabel="Post reply" label="Write a reply"
            placeholder="Write a reply…"
            onSubmit={() => void run('reply', async () => {
              await reply(signer(), thread, draft, replyTo)
              setDraft('')
              setReplyTo(undefined)
              if (page !== pages) router.push(hrefFor(pages) + '#reply')
            })} />
        ) : ready && LOGIN_AVAILABLE ? (
          <div className="panel flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <p className="text-ink-2">Log in with your Dash wallet to reply.</p>
            <Link href={`/login/?next=${encodeURIComponent(hrefFor(page))}`} className="btn btn-primary">Log in with Dash</Link>
          </div>
        ) : null}
      </section>
      {error && busy === null && (
        <div role="alert" className="fixed inset-x-4 bottom-4 z-50 mx-auto flex max-w-xl items-start gap-3 rounded-lg border border-danger/40 bg-sheet px-4 py-3 text-sm shadow-lg">
          <p className="flex-1 text-danger">{error}</p>
          <button type="button" className="btn-ghost" onClick={() => setError(null)} aria-label="Dismiss">Dismiss</button>
        </div>
      )}
    </div>
  )
}
