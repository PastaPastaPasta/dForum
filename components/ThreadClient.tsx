'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { MessageSquare, Send, Lock, AlertTriangle, Loader2, RefreshCw } from 'lucide-react'
import { Navbar } from '@/components/Navbar'
import { Footer } from '@/components/Footer'
import { Avatar } from '@/components/Avatar'
import { RelativeTime } from '@/components/RelativeTime'
import { get, query, queryRaw, createDocument } from '@/lib/services/document-service'
import { LOGIN_AVAILABLE } from '@/lib/host'
import { shortId, isModerated } from '@/lib/utils'
import { useProfileNames } from '@/lib/use-profiles'
import { useSession } from '@/lib/session'
import { useLive } from '@/components/LiveFeed'
import type { SnapshotThread, StaticPost } from '@/lib/services/snapshot-server'
import { LIMITS } from '@/lib/constants'
import { beforePost, earliestOwnerPost, type OpeningPost } from '@/lib/services/orphan'
import { redactWif } from '@/lib/redact'
import { LiveUnavailable } from '@/components/LiveUnavailable'

interface LiveThread {
  id: string
  title: string
  forumId: string
  forumSlug: string | null
  forumTitle: string | null
  tags: string[]
  sticky: boolean
  lockedAt: number | null
  modState: number | null
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
  | { status: 'ok'; thread: LiveThread; posts: LivePost[]; truncated: boolean; opening: OpeningPost | null | undefined }
  | { status: 'missing' }

const POST_LIMIT = 99

export default function ThreadClient({
  threadId,
  snapshotThread,
  snapshotForumTitle,
  initialPosts,
}: {
  threadId: string
  snapshotThread: SnapshotThread | null
  snapshotForumTitle?: string | null
  initialPosts: StaticPost[]
}) {
  const { session, ready } = useSession()
  const [replyBody, setReplyBody] = useState('')
  const [posting, setPosting] = useState(false)
  const [postError, setPostError] = useState<string | null>(null)
  const [createdPosts, setCreatedPosts] = useState<LivePost[]>([])
  const [morePosts, setMorePosts] = useState<LivePost[]>([])
  const [moreCursor, setMoreCursor] = useState<string | null>(null)
  const [moreLoading, setMoreLoading] = useState(false)
  const [moreError, setMoreError] = useState(false)
  const [posted, setPosted] = useState<string | null>(null)
  // Set when a previous write attempt failed — its write may have landed,
  // so the next attempt re-checks the chain before writing again.
  const [lastWriteFailed, setLastWriteFailed] = useState(false)

  const { live, loading: liveLoading, error: liveError, retry } = useLive<LoadResult>(() => loadThread(threadId), threadId)

  // Arm the load-more cursor once the live window comes back.
  useEffect(() => {
    if (live?.status !== 'ok') { setMoreCursor(null); return }
    if (!live.truncated) { setMoreCursor(null); return }
    const last = live.posts[live.posts.length - 1]
    setMoreCursor(last ? last.id : null)
  }, [live])

  const isLiveOk = live?.status === 'ok'
  const thread: LiveThread | null = isLiveOk
    ? {
        ...live!.thread,
        forumSlug: live!.thread.forumSlug ?? snapshotThread?.forumSlug ?? null,
        forumTitle: live!.thread.forumTitle ?? snapshotForumTitle ?? snapshotThread?.forumSlug ?? null,
      }
    : snapshotThread
      ? snapshotThreadToLive(snapshotThread)
      : null

  // The opening post — resolved by the live read (or found async below).
  // Undefined = unknown (fail open: the static index already filtered the
  // static posts, so showing them is honest); null = no owner post at all.
  const opening: OpeningPost | null | undefined = isLiveOk ? live!.opening : undefined

  const livePosts = isLiveOk ? live!.posts : []
  // Static posts ship in the HTML and stay visible while the live fill runs —
  // the prerender and first view must show the thread.
  const staticPosts: LivePost[] = !isLiveOk ? initialPosts.map(staticToLive) : []
  const basePosts = isLiveOk ? [...livePosts, ...morePosts] : staticPosts
  const seen = new Set([...basePosts].map((p) => p.id))
  const created = createdPosts.filter((p) => !seen.has(p.id))
  const posts: LivePost[] = [...basePosts, ...created]

  // The orphan rule — the opening post is the earliest owner post, regardless
  // of its moderation state. A hidden opening post means the thread is hidden;
  // a missing opening post means the thread is not listed at all.
  const openingKnown = opening !== undefined
  const hiddenOpening = opening?.modState != null
  // The listing rule: a thread whose opening post is after the lock is not
  // listable either.
  const lockExcluded = (thread?.lockedAt ?? null) != null && opening != null && opening.createdAt > (thread?.lockedAt ?? 0)
  const hidden =
    isModerated(thread?.modState) ||
    hiddenOpening ||
    (openingKnown && opening === null) ||
    lockExcluded

  const lockedAt = thread?.lockedAt ?? null
  const locked = lockedAt != null

  // Only posts at/after the opening post are shown — posts before it are
  // dropped regardless of who made them.
  const atOrAfterOpening = opening ? posts.filter((p) => !beforePost(p, opening)) : posts
  const visiblePosts = lockedAt != null
    ? atOrAfterOpening.filter((p) => p.createdAt <= lockedAt)
    : atOrAfterOpening
  // Hidden posts render as indicators, not content — they are not counted as
  // posts in the header.
  const shownPosts = visiblePosts.filter((p) => !isModerated(p.modState))

  // Resolve author display names for every visible post.
  const authorIds = visiblePosts.map((p) => p.authorId)
  const profiles = useProfileNames(authorIds)
  const profileName = (id: string): string => profiles[id] ?? shortId(id, 12)

  async function loadMore() {
    if (moreLoading || !moreCursor) return
    setMoreLoading(true)
    setMoreError(false)
    try {
      const { docs, rawCount, lastId } = await queryRaw('post', {
        where: [['threadId', '==', threadId]],
        orderBy: [['$createdAt', 'asc']],
        limit: POST_LIMIT,
        startAfter: moreCursor,
      })
      const mapped = docs.map((p) => ({
        id: p.id,
        body: (p.properties.body as string) ?? '',
        authorId: p.ownerId || '',
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        modState: (p.properties.modState as number | null) ?? null,
        replyToId: (p.properties.replyToId as string | null) ?? null,
      }))
      setMorePosts((prev) => [...prev, ...mapped.filter((m) => !prev.some((x) => x.id === m.id))])
      setMoreCursor(rawCount === POST_LIMIT && lastId ? lastId : null)
    } catch {
      setMoreError(true)
    } finally {
      setMoreLoading(false)
    }
  }

  async function handlePost() {
    if (posting) return // double-click / Enter during the platform write
    if (!session || !thread) return
    const body = replyBody.trim()
    if (!body) {
      setPostError('Write something first — a reply needs text.')
      return
    }
    if (!session.authKeyWif) {
      setPostError('Your session has no signable key. Try logging in again.')
      return
    }
    if (new TextEncoder().encode(body).length > LIMITS.bodyMaxBytes) {
      setPostError(`Body is too large — the platform limit is ${LIMITS.bodyMaxBytes} bytes.`)
      return
    }
    setPosting(true)
    setPostError(null)
    setPosted(null)
    try {
      // A write can fail or time out even though it landed on the chain —
      // only once a previous attempt failed (not on the first try: a genuine
      // repeat like "+1" must not be mistaken for a landed duplicate),
      // re-query for this owner's exact recent threadId-matching body and
      // adopt it. Queried via the byAuthor index ($ownerId + $createdAt) so
      // the chain can serve it; threadId is filtered in the client. Fails
      // open: on any query error, proceed with creation.
      if (lastWriteFailed) {
        let recent: Awaited<ReturnType<typeof query>>
        try {
          recent = await query('post', {
            where: [['$ownerId', '==', session.identityId], ['$createdAt', '>=', Date.now() - 120_000]],
            orderBy: [['$createdAt', 'desc']],
            limit: 5,
          })
        } catch {
          // Cannot verify — refuse to blind-write: the thread is safe, the
          // user can check the thread before replying again.
          setLastWriteFailed(true)
          setPostError('Could not verify your reply — check this thread before sending again.')
          setPosting(false)
          return
        }
        const found = recent.find((d) => (d.properties.threadId as string) === thread.id && ((d.properties.body as string) ?? '').trim() === body)
        if (found) {
          setReplyBody('')
          setPosted('Reply posted')
          setLastWriteFailed(false)
          setCreatedPosts((prev) => (prev.some((p) => p.id === found.id) ? prev : [...prev, {
            id: found.id,
            body: (found.properties.body as string) ?? body,
            authorId: session.identityId,
            createdAt: found.createdAt,
            updatedAt: found.updatedAt,
            modState: null,
            replyToId: null,
          }]))
          setPosting(false)
          return
        }
      }
      const created = await createDocument('post', session.identityId, session.authKeyWif, {
        threadId: thread.id,
        forumId: thread.forumId,
        body,
      })
      setReplyBody('')
      setPosted('Reply posted')
      setLastWriteFailed(false)
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
      setLastWriteFailed(true)
      setPostError(redactWif(e instanceof Error ? e.message : 'Failed to post — try again in a moment'))
      setPosted(null)
    } finally {
      setPosting(false)
    }
  }

  const status = live?.status ?? null
  const missing = status === 'missing' && !liveLoading && !liveError
  const showHardError = liveError && !snapshotThread && !liveLoading
  const showStaleNote = liveError && snapshotThread != null && !liveLoading

  if (missing) {
    return (
      <>
        <Navbar />
        <main id="main" tabIndex={-1} className="flex-1 flex items-center justify-center px-6">
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

  if (showHardError) {
    return (
      <>
        <Navbar />
        <main id="main" tabIndex={-1} className="flex-1 flex items-center justify-center px-6">
          <div className="text-center fade-up">
            <AlertTriangle className="w-8 h-8 text-amber-400 mx-auto" aria-hidden="true" />
            <p className="text-sm uppercase tracking-widest text-[#93a1bd] mt-3">Connection error</p>
            <h1 className="text-2xl font-bold mt-2">Couldn&apos;t reach Dash Platform</h1>
            <p className="text-sm text-[#93a1bd] mt-2">The live read failed. Retry in a moment.</p>
            <button onClick={retry} className="mt-6 btn-primary px-4 py-2">Retry</button>
          </div>
        </main>
        <Footer />
      </>
    )
  }

  if (!thread && !liveLoading && !liveError) {
    return (
      <>
        <Navbar />
        <main id="main" tabIndex={-1} className="flex-1 flex items-center justify-center px-6">
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
      <main id="main" tabIndex={-1} className="flex-1">
        <article className="max-w-3xl mx-auto px-4 sm:px-6 py-6">
          <Link href={thread?.forumSlug ? `/f/${encodeURIComponent(thread.forumSlug)}` : '/'} className="text-sm text-[#93a1bd] hover:text-white transition">
            ← {thread?.forumTitle ?? thread?.forumSlug ?? 'dForum'}
          </Link>
          {hidden ? (
            <div className="mt-6 rounded-xl border border-amber-400/40 bg-amber-400/10 p-6 text-center">
              {lockExcluded ? (
                <>
                  <p className="text-sm uppercase tracking-widest text-amber-400">Not listed</p>
                  <h1 className="mt-2 text-2xl font-bold">This thread isn&apos;t listed</h1>
                  <p className="mt-2 text-sm text-amber-400/80">The lock was applied before this thread&apos;s opening post — the forum won&apos;t list it.</p>
                </>
              ) : openingKnown && opening === null ? (
                <>
                  <p className="text-sm uppercase tracking-widest text-amber-400">Not listed</p>
                  <h1 className="mt-2 text-2xl font-bold">This thread isn&apos;t listed</h1>
                  <p className="mt-2 text-sm text-amber-400/80">It has no opening post — the text you followed points at a thread the forum won&apos;t list.</p>
                </>
              ) : (
                <>
                  <p className="text-sm uppercase tracking-widest text-amber-400">Hidden by a moderator</p>
                  <h1 className="mt-2 text-2xl font-bold">This thread is hidden</h1>
                  <p className="mt-2 text-sm text-amber-400/80">This thread was hidden by a moderator. Its contents are not rendered.</p>
                </>
              )}
            </div>
          ) : (
            <>
              <h1 className="mt-3 text-2xl sm:text-3xl font-bold tracking-tight break-words">{thread?.title ?? '…'}</h1>
              <div className="mt-3 flex items-center gap-3 text-sm text-[#93a1bd] flex-wrap">
                {(isLiveOk || staticPosts.length > 0) && (
                  <span className="inline-flex items-center gap-1.5"><MessageSquare className="w-4 h-4" aria-hidden="true" />{shownPosts.length}{moreCursor ? '+' : ''} post{shownPosts.length === 1 ? '' : 's'}</span>
                )}
                {liveLoading && staticPosts.length === 0 && <span className="inline-flex items-center gap-1.5"><Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> Loading posts…</span>}
                {locked && <span className="inline-flex items-center gap-1 text-amber-400"><Lock className="w-3.5 h-3.5" aria-hidden="true" /> locked</span>}
                {thread?.tags.map((tag) => (
                  <Link key={tag} href={`/search?q=${encodeURIComponent(tag)}`} className="rounded bg-[#18233c] px-2 py-0.5 hover:bg-[#22304e] hover:text-white transition">#{tag}</Link>
                ))}
              </div>

              {showStaleNote && <LiveUnavailable className="mt-4" onRetry={retry} />}

              <div className="mt-6 space-y-4">
                {visiblePosts.map((p) => (
                  <PostCard key={p.id || p.body.slice(0, 32)} post={p} mine={session?.identityId} nameOf={profileName} />
                ))}
                {visiblePosts.length === 0 && liveLoading && (
                  <div className="space-y-3">
                    <span className="sr-only" role="status">Loading posts…</span>
                    <div aria-hidden="true" className="space-y-3">
                      {[0, 1, 2].map((i) => (
                        <div key={i} className="h-20 rounded-xl border border-[#22304e] bg-[#111a2e] animate-pulse" />
                      ))}
                    </div>
                  </div>
                )}
                {visiblePosts.length === 0 && !liveLoading && (
                  <p className="text-sm text-[#93a1bd] rounded-xl border border-dashed border-[#22304e] p-6 text-center">
                    {isLiveOk ? 'No visible posts in this thread.' : 'Posts unavailable — the live read failed and the snapshot had none.'}
                  </p>
                )}
                {moreCursor != null && (
                  <p className="text-xs text-[#93a1bd]">Showing {shownPosts.length} of the visible posts — load more below. Later replies aren&apos;t loaded yet.</p>
                )}
                {isLiveOk && moreCursor && (
                  <div className="mt-2">
                    {moreError && (
                      <p className="text-sm text-red-400">Couldn&apos;t load more posts. <button onClick={() => loadMore()} className="text-[#4db3ff] hover:underline">Retry</button></p>
                    )}
                    {!moreError && (
                      <button
                        onClick={() => loadMore()}
                        disabled={moreLoading}
                        className="btn-secondary inline-flex items-center gap-2 px-3 py-2 text-sm disabled:opacity-50"
                      >
                        {moreLoading ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="w-4 h-4" aria-hidden="true" />}
                        {moreLoading ? 'Loading…' : 'Load more posts'}
                      </button>
                    )}
                  </div>
                )}
              </div>

              {locked ? (
                <div className="mt-8 rounded-xl border border-amber-400/40 bg-amber-400/5 p-4 text-center text-sm text-amber-400">
                  This thread is locked by moderators. No new replies.
                </div>
              ) : thread && thread.forumId ? (
                !ready ? (
                  <div className="mt-8 h-24 rounded-xl border border-[#22304e] bg-[#111a2e] animate-pulse" aria-hidden="true" />
                ) : session ? (
                  <div className="mt-8 rounded-xl border border-[#22304e] bg-[#111a2e] p-4">
                    <label htmlFor="reply" className="text-sm font-medium text-[#93a1bd]">Reply</label>
                    <textarea
                      id="reply"
                      value={replyBody}
                      onChange={(e) => setReplyBody(e.target.value)}
                      rows={4}
                      maxLength={LIMITS.body}
                      placeholder="Write your reply…"
                      className="mt-2 w-full rounded-lg border border-input bg-[#0b1220] p-3 text-base sm:text-sm placeholder:text-[#93a1bd] resize-y"
                    />
                    <div className="mt-1 flex items-center justify-between text-xs text-[#93a1bd] gap-2">
                      {postError ? (
                        <span role="alert" className="min-h-[1rem] text-red-400">{postError}</span>
                      ) : posted ? (
                        <span role="status" className="min-h-[1rem] text-emerald-400">{posted}</span>
                      ) : (
                        <span className="min-h-[1rem]" />
                      )}
                      <span>{replyBody.length}/{LIMITS.body} chars · {new TextEncoder().encode(replyBody).length}/{LIMITS.bodyMaxBytes} bytes</span>
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
                    {LOGIN_AVAILABLE ? (
                      <><Link href={`/login?next=${encodeURIComponent(`/t/${thread.id}`)}`} className="text-[#4db3ff] hover:underline">Login with Dash</Link> to join the conversation.</>
                    ) : (
                      'Read-only deployment — sign in on forum.dashhq.org'
                    )}
                  </div>
                )
              ) : null}
            </>
          )}
        </article>
      </main>
      <Footer />
    </>
  )

  function snapshotThreadToLive(t: SnapshotThread): LiveThread {
    return {
      id: t.id,
      title: t.title,
      forumId: t.forumId ?? '',
      forumSlug: t.forumSlug,
      forumTitle: snapshotForumTitle ?? t.forumSlug,
      tags: t.tags,
      sticky: t.sticky,
      lockedAt: t.lockedAt,
      modState: t.modState ?? null,
      ownerId: t.ownerId ?? null,
    }
  }

  function staticToLive(p: StaticPost): LivePost {
    return {
      id: p.id,
      body: p.body,
      authorId: p.authorId ?? '',
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      modState: p.modState ?? null,
      replyToId: p.replyToId,
    }
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
        <Link href={`/u/${encodeURIComponent(post.authorId)}`} tabIndex={-1} aria-hidden="true" className="shrink-0 rounded-full ring-2 ring-transparent hover:ring-[#4db3ff]/60 transition">
          <Avatar name={authorName} id={post.authorId || null} />
        </Link>
        <div className="flex-1 min-w-0">
          <p className="font-medium truncate">
            <Link href={`/u/${encodeURIComponent(post.authorId)}`} className="hover:text-[#4db3ff] hover:underline transition">{authorName}</Link>
          </p>
          <p className="text-xs text-[#93a1bd]">
            <RelativeTime time={post.createdAt} />
            {edited && ' · edited'}
          </p>
        </div>
        {isAuthor && <span className="text-[11px] uppercase tracking-wider text-[#4db3ff] border border-[#4db3ff]/40 rounded px-2 py-0.5">you</span>}
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
  // No blanket catch: a read failure must re-throw so useLive's bounded retry
  // fires and the caller can surface the banner. Only a genuinely-missing
  // thread resolves as 'missing' — a null doc is a verdict, not an error.
  {
    const thread = await get('thread', id)
    if (!thread) return { status: 'missing' }
    const ownerId = thread.ownerId ?? null
    const forumId = (thread.properties.forumId as string) ?? ''
    // Resolve the opening post first and start the posts slice AT it — pre-
    // opening spam must not fill the first page. A failed orphan read is not
    // a "this thread no longer exists" verdict: opening stays undefined
    // (fail open) and the live posts render without the orphan claim.
    let opening: OpeningPost | null | undefined
    if (ownerId) {
      try {
        opening = await earliestOwnerPost(thread.id, ownerId, thread.createdAt)
      } catch {
        opening = undefined
      }
    } else {
      opening = null
    }
    const [{ docs: posts, rawCount }, forumDoc] = await Promise.all([
      queryRaw('post', {
        where: [['threadId', '==', thread.id], ...(opening ? [['$createdAt', '>=', opening.createdAt]] as [string, string, unknown][] : [])],
        orderBy: [['$createdAt', 'asc']],
        limit: POST_LIMIT + 1,
      }),
      forumId ? get('forum', forumId).catch(() => null) : Promise.resolve(null),
    ])
    // The page holds at most POST_LIMIT+1 raw docs; if the raw page filled it,
    // the index ran ahead of what we keep.
    const truncated = rawCount > POST_LIMIT
    const visiblePosts = posts.slice(0, POST_LIMIT)
    return {
      status: 'ok',
      thread: {
        id: thread.id,
        title: (thread.properties.title as string) ?? '',
        forumId,
        forumSlug: (forumDoc?.properties.slug as string) ?? null,
        forumTitle: (forumDoc?.properties.title as string) ?? null,
        tags: Array.isArray(thread.properties.tags) ? (thread.properties.tags as string[]) : [],
        sticky: Boolean(thread.properties.sticky),
        lockedAt: (thread.properties.lockedAt as number | null) ?? null,
        modState: (thread.properties.modState as number | null) ?? null,
        ownerId: thread.ownerId ?? null,
      },
      posts: visiblePosts.map((p) => ({
        id: p.id,
        body: (p.properties.body as string) ?? '',
        authorId: p.ownerId || '',
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        modState: (p.properties.modState as number | null) ?? null,
        replyToId: (p.properties.replyToId as string | null) ?? null,
      })),
      opening,
      truncated,
    }
  }
}
