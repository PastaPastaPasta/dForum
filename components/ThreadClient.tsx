'use client'

import { useState } from 'react'
import Link from 'next/link'
import { MessageSquare, Send, Lock, AlertTriangle, Loader2 } from 'lucide-react'
import { Navbar } from '@/components/Navbar'
import { Footer } from '@/components/Footer'
import { Avatar } from '@/components/Avatar'
import { get, query, createDocument } from '@/lib/services/document-service'
import { loadSnapshot } from '@/lib/services/snapshot-service'
import { formatRelativeTime, formatDate, shortId, isModerated, safeHttpUrl } from '@/lib/utils'
import { useProfileNames } from '@/lib/use-profiles'
import { useSession } from '@/lib/session'
import { useLive } from '@/components/LiveFeed'
import type { SnapshotThread, SnapshotPost } from '@/lib/services/snapshot-service'

interface LiveThread {
  id: string
  title: string
  forumId: string
  forumSlug: string | null
  tags: string[]
  sticky: boolean
  lockedAt: number | null
  ownerId: string | null
}

interface LivePost {
  id: string
  body: string
  authorId: string
  createdAt: number
  updatedAt: number
  modState: number | null
  replyToId: string | null
}

type LoadResult =
  | { status: 'ok'; thread: LiveThread; posts: LivePost[] }
  | { status: 'missing' }
  | { status: 'error' }

/** Settled orphan rule (data-model.md): a post is the opening post of its
 * thread when it is the earliest post whose author equals the thread owner,
 * ordered by ($createdAt, $id). Posts of other authors created before it are
 * dropped from the listing. */
function openingPost(posts: LivePost[], ownerId: string | null): LivePost | null {
  const ownerPosts = posts.filter((p) => p.authorId === ownerId)
  if (ownerPosts.length === 0) return null
  return ownerPosts.reduce((a, b) => (isBefore(b, a) ? b : a))
}

function isBefore(a: LivePost, b: LivePost): boolean {
  return a.createdAt < b.createdAt || (a.createdAt === b.createdAt && a.id < b.id)
}

export default function ThreadClient({ threadId }: { threadId: string }) {
  return <ThreadInner threadId={threadId} />
}

function ThreadInner({ threadId }: { threadId: string }) {
  const snap = loadSnapshot()
  const { session } = useSession()
  const [replyBody, setReplyBody] = useState('')
  const [posting, setPosting] = useState(false)
  const [postError, setPostError] = useState<string | null>(null)
  const [createdPosts, setCreatedPosts] = useState<LivePost[]>([])

  const snapThread = snap.threads.find((t) => t.id === threadId)
  const { live, loading: liveLoading } = useLive<LoadResult>(() => loadThread(threadId), threadId)

  const snapPosts = snap.posts.filter((p) => p.threadId === threadId)

  const isLiveOk = live?.status === 'ok'
  const thread: LiveThread | null = isLiveOk
    ? { ...live!.thread, forumSlug: live!.thread.forumSlug ?? snapThread?.forumSlug ?? null }
    : snapThread
      ? snapshotThread(snapThread)
      : null

  const livePosts = isLiveOk ? live!.posts : snapPosts.map(snapshotPost)
  const seen = new Set(livePosts.map((p) => p.id))
  const created = createdPosts.filter((p) => !seen.has(p.id))
  const posts: LivePost[] = [...livePosts, ...created]

  // Orphan rule: drop posts created before the opening post (non-owner
  // posts created in the gap between thread creation and the owner's first
  // reply). The thread is still rendered — just with an honest chronology.
  const opening = thread?.ownerId ? openingPost(posts, thread.ownerId) : null
  const visible = opening ? posts.filter((p) => !isBefore(p, opening)) : posts

  const lockedAt = thread?.lockedAt ?? null
  const locked = lockedAt != null
  const visiblePosts = lockedAt ? visible.filter((p) => p.createdAt <= lockedAt) : visible

  // Resolve author display names for every visible post.
  const authorIds = visiblePosts.map((p) => p.authorId)
  const profiles = useProfileNames(authorIds)

  const profileName = (id: string): string => profiles[id] ?? shortId(id, 12)

  async function handlePost() {
    if (!session || !thread || !replyBody.trim()) return
    if (!session.authKeyWif) {
      setPostError('Your session has no signable key. Try logging in again.')
      return
    }
    setPosting(true)
    setPostError(null)
    const body = replyBody.trim().slice(0, 4000)
    try {
      const created = await createDocument('post', session.identityId, session.authKeyWif, {
        threadId: thread.id,
        forumId: thread.forumId,
        body,
      })
      setReplyBody('')
      setCreatedPosts((prev) => [
        ...prev,
        {
          id: created.id,
          body: (created.properties.body as string) ?? body,
          authorId: session.identityId,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          modState: null,
          replyToId: null,
        },
      ])
    } catch (e) {
      setPostError(e instanceof Error ? e.message : 'Failed to post — try again in a moment')
    } finally {
      setPosting(false)
    }
  }

  const status = live?.status ?? null
  const missing = status === 'missing' && !snapThread && !liveLoading
  const errorState = status === 'error' && !snapThread && !liveLoading

  if (errorState) {
    return (
      <>
        <Navbar />
        <main className="flex-1 flex items-center justify-center px-6">
          <div className="text-center fade-up">
            <AlertTriangle className="w-8 h-8 text-amber-400 mx-auto" aria-hidden="true" />
            <p className="text-sm uppercase tracking-widest text-[#93a1bd] mt-3">Connection error</p>
            <h1 className="text-2xl font-bold mt-2">Couldn&apos;t reach Dash Platform</h1>
            <p className="text-sm text-[#93a1bd] mt-2">The live read failed. The snapshot may still be stale — retry in a moment.</p>
            <button onClick={() => window.location.reload()} className="mt-6 btn-primary px-4 py-2">Retry</button>
          </div>
        </main>
        <Footer />
      </>
    )
  }

  if (missing || (!thread && !liveLoading)) {
    return (
      <>
        <Navbar />
        <main className="flex-1 flex items-center justify-center px-6">
          <div className="text-center fade-up">
            <p className="text-sm uppercase tracking-widest text-[#93a1bd]">Not found</p>
            <h1 className="text-2xl font-bold mt-2">Thread not found</h1>
            <Link href="/" className="mt-6 btn-primary px-4 py-2">Back to home</Link>
          </div>
        </main>
        <Footer />
      </>
    )
  }

  return (
    <>
      <Navbar />
      <main className="flex-1">
        <article className="max-w-3xl mx-auto px-4 sm:px-6 py-6">
          <Link href={thread?.forumSlug ? `/f/${encodeURIComponent(thread.forumSlug)}` : '/'} className="text-sm text-[#93a1bd] hover:text-white transition">
            ← {thread?.forumSlug ?? 'dForum'}
          </Link>
          <h1 className="mt-3 text-2xl sm:text-3xl font-bold tracking-tight">{thread?.title ?? '…'}</h1>
          <div className="mt-3 flex items-center gap-3 text-sm text-[#93a1bd] flex-wrap">
            <span className="inline-flex items-center gap-1.5"><MessageSquare className="w-4 h-4" />{visiblePosts.length} post{visiblePosts.length === 1 ? '' : 's'}</span>
            {locked && <span className="inline-flex items-center gap-1 text-amber-400"><Lock className="w-3.5 h-3.5" aria-hidden="true" /> locked</span>}
            {thread?.tags.map((tag) => (
              <span key={tag} className="rounded bg-[#18233c] px-2 py-0.5">#{tag}</span>
            ))}
          </div>

          <div className="mt-6 space-y-4">
            {visiblePosts.map((p) => (
              <PostCard key={p.id || p.body.slice(0, 32)} post={p} mine={session?.identityId} nameOf={profileName} />
            ))}
            {visiblePosts.length === 0 && liveLoading && (
              <div className="rounded-xl border border-dashed border-[#22304e] p-6 text-center text-sm text-[#93a1bd]">Loading posts…</div>
            )}
          </div>

          {locked ? (
            <div className="mt-8 rounded-xl border border-amber-400/40 bg-amber-400/5 p-4 text-center text-sm text-amber-400">
              This thread is locked by moderators. No new replies.
            </div>
          ) : session ? (
            <div className="mt-8 rounded-xl border border-[#22304e] bg-[#111a2e] p-4">
              <label htmlFor="reply" className="text-sm font-medium text-[#93a1bd]">Reply</label>
              <textarea
                id="reply"
                value={replyBody}
                onChange={(e) => setReplyBody(e.target.value)}
                rows={4}
                maxLength={4000}
                placeholder="Write your reply…"
                className="mt-2 w-full rounded-lg border border-[#22304e] bg-[#0b1220] p-3 text-sm placeholder:text-[#93a1bd] resize-y"
              />
              <div className="mt-1 flex items-center justify-between text-xs text-[#93a1bd]">
                <span aria-live="polite" role="status">{postError ? <span className="text-red-400">{postError}</span> : ''}</span>
                <span>{replyBody.length}/4000</span>
              </div>
              <div className="mt-2 flex justify-end">
                <button
                  onClick={handlePost}
                  disabled={posting || !replyBody.trim()}
                  className="btn-primary inline-flex items-center gap-2 px-4 py-2 font-medium"
                >
                  {posting ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Send className="w-4 h-4" aria-hidden="true" />}
                  {posting ? 'Posting…' : 'Post reply'}
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-8 rounded-xl border border-dashed border-[#22304e] p-6 text-center text-sm text-[#93a1bd]">
              <Link href="/login" className="text-[#4db3ff] hover:underline">Login with Dash</Link> to join the conversation.
            </div>
          )}
        </article>
      </main>
      <Footer />
    </>
  )
}

function snapshotThread(t: SnapshotThread): LiveThread {
  return {
    id: t.id,
    title: t.title,
    forumId: t.forumId ?? '',
    forumSlug: t.forumSlug,
    tags: t.tags,
    sticky: t.sticky,
    lockedAt: t.lockedAt,
    ownerId: t.ownerId ?? null,
  }
}

function snapshotPost(p: SnapshotPost): LivePost {
  return {
    id: p.id,
    body: p.body,
    authorId: p.ownerId ?? '',
    createdAt: p.createdAt,
    updatedAt: p.createdAt,
    modState: p.modState,
    replyToId: null,
  }
}

function PostCard({ post, mine, nameOf }: { post: LivePost; mine?: string | null; nameOf: (id: string) => string }) {
  const isAuthor = mine === post.authorId && mine != null
  const hidden = isModerated(post.modState)
  const edited = post.updatedAt > post.createdAt && post.updatedAt > 0 && post.createdAt > 0
  const authorName = nameOf(post.authorId)
  return (
    <div className="rounded-xl border border-[#22304e] bg-[#111a2e] p-4 fade-up">
      <div className="flex items-center gap-3">
        <Link href={`/u/${encodeURIComponent(post.authorId)}`} className="shrink-0 rounded-full ring-2 ring-transparent hover:ring-[#4db3ff]/60 transition" title={`Open ${authorName}'s profile`}>
          <Avatar name={authorName} id={post.authorId || null} />
        </Link>
        <div className="flex-1 min-w-0">
          <p className="font-medium truncate">
            <Link href={`/u/${encodeURIComponent(post.authorId)}`} className="hover:text-[#4db3ff] hover:underline transition">{authorName}</Link>
          </p>
          <p className="text-xs text-[#93a1bd]">
            {formatRelativeTime(post.createdAt)} · {formatDate(post.createdAt)}
            {edited && ' · edited'}
          </p>
        </div>
        {isAuthor && <span className="text-[10px] uppercase tracking-wider text-[#4db3ff] border border-[#4db3ff]/40 rounded px-2 py-0.5">you</span>}
      </div>
      {hidden ? (
        <div className="mt-3 rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-sm text-amber-400">
          This post was hidden by a moderator.
        </div>
      ) : (
        <div className="mt-3 text-[15px] leading-relaxed whitespace-pre-wrap break-words">{post.body}</div>
      )}
    </div>
  )
}

async function loadThread(id: string): Promise<LoadResult> {
  try {
    const thread = await get('thread', id)
    if (!thread) return { status: 'missing' }
    const posts = await query('post', { where: [['threadId', '==', thread.id]], orderBy: [['$createdAt', 'asc']], limit: 100 })
    return {
      status: 'ok',
      thread: {
        id: thread.id,
        title: (thread.properties.title as string) ?? '',
        forumId: (thread.properties.forumId as string) ?? '',
        forumSlug: null,
        tags: Array.isArray(thread.properties.tags) ? (thread.properties.tags as string[]) : [],
        sticky: Boolean(thread.properties.sticky),
        lockedAt: (thread.properties.lockedAt as number | null) ?? null,
        ownerId: thread.ownerId ?? null,
      },
      posts: posts.map((p) => ({
        id: p.id,
        body: (p.properties.body as string) ?? '',
        authorId: p.ownerId || '',
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        modState: (p.properties.modState as number | null) ?? null,
        replyToId: (p.properties.replyToId as string | null) ?? null,
      })),
    }
  } catch {
    return { status: 'error' }
  }
}
