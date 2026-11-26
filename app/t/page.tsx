'use client'

import { Suspense, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { MessageSquare, Send, Lock, ThumbsUp } from 'lucide-react'
import { Navbar } from '@/components/Navbar'
import { Footer } from '@/components/Footer'
import { Avatar } from '@/components/Avatar'
import { get, query, createDocument } from '@/lib/services/document-service'
import { loadSnapshot } from '@/lib/services/snapshot-service'
import { formatRelativeTime, formatDate, shortId } from '@/lib/utils'
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

export default function ThreadPage() {
  return (
    <Suspense fallback={<main className="flex-1" />}>
      <ThreadInner />
    </Suspense>
  )
}

function ThreadInner() {
  const params = useSearchParams()
  const slug = params.get('id') ?? ''
  const snap = loadSnapshot()
  const { session } = useSession()
  const [replyBody, setReplyBody] = useState('')
  const [posting, setPosting] = useState(false)
  const [postError, setPostError] = useState<string | null>(null)
  const [createdPosts, setCreatedPosts] = useState<LivePost[]>([])

  const snapThread = snap.threads.find((t) => t.id === slug)
  const { live, loading: liveLoading } = useLive(() => (slug ? loadThread(slug) : Promise.resolve(null)))

  const snapPosts = snap.posts.filter((p) => p.threadId === slug)

  const liveThread = live?.thread ?? null
  const thread: LiveThread | null = liveThread
    ? { ...liveThread, forumSlug: liveThread.forumSlug ?? snapThread?.forumSlug ?? null }
    : snapThread
      ? snapshotThread(snapThread)
      : null

  const posts: LivePost[] = live?.posts ?? [
    ...snapPosts.map(snapshotPost),
    ...createdPosts,
  ]

  const locked = thread?.lockedAt != null

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

  if (!thread && !liveLoading) {
    return (
      <>
        <Navbar />
        <main className="flex-1 flex items-center justify-center px-6">
          <div className="text-center fade-up">
            <p className="text-sm uppercase tracking-widest text-[#93a1bd]">Not found</p>
            <h1 className="text-2xl font-bold mt-2">Thread not found</h1>
            <Link href="/" className="mt-6 inline-block rounded-lg bg-[#008CE7] px-4 py-2 font-medium text-white hover:bg-[#006bb3] transition">Back to home</Link>
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
          <Link href={thread?.forumSlug ? `/f?slug=${encodeURIComponent(thread.forumSlug)}` : '/'} className="text-sm text-[#93a1bd] hover:text-white transition">
            ← {thread?.forumSlug ?? 'dForum'}
          </Link>
          <h1 className="mt-3 text-2xl sm:text-3xl font-bold tracking-tight">{thread?.title ?? '…'}</h1>
          <div className="mt-3 flex items-center gap-3 text-sm text-[#93a1bd] flex-wrap">
            <span className="inline-flex items-center gap-1.5"><MessageSquare className="w-4 h-4" />{posts.length} posts</span>
            {locked && <span className="inline-flex items-center gap-1 text-amber-400"><Lock className="w-3.5 h-3.5" /> locked</span>}
            {thread?.tags.map((tag) => (
              <span key={tag} className="rounded bg-[#18233c] px-2 py-0.5">#{tag}</span>
            ))}
          </div>

          <div className="mt-6 space-y-4">
            {posts.map((p) => (
              <PostCard key={p.id || p.body.slice(0, 32)} post={p} mine={session?.identityId} />
            ))}
            {posts.length === 0 && liveLoading && (
              <div className="rounded-xl border border-dashed border-[#22304e] p-6 text-center text-sm text-[#93a1bd]">Loading posts…</div>
            )}
          </div>

          {session && !locked ? (
            <div className="mt-8 rounded-xl border border-[#22304e] bg-[#111a2e] p-4">
              <label className="text-sm font-medium text-[#93a1bd]">Reply</label>
              <textarea
                value={replyBody}
                onChange={(e) => setReplyBody(e.target.value)}
                rows={4}
                maxLength={4000}
                placeholder="Write your reply…"
                className="mt-2 w-full rounded-lg border border-[#22304e] bg-[#0b1220] p-3 text-sm placeholder:text-[#93a1bd]/60 focus:border-[#008CE7] focus:outline-none resize-y"
              />
              {postError && <p className="mt-2 text-sm text-red-400">{postError}</p>}
              <div className="mt-2 flex justify-end">
                <button
                  onClick={handlePost}
                  disabled={posting || !replyBody.trim()}
                  className="inline-flex items-center gap-2 rounded-lg bg-[#008CE7] hover:bg-[#006bb3] transition px-4 py-2 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Send className="w-4 h-4" />
                  {posting ? 'Posting…' : 'Post reply'}
                </button>
              </div>
            </div>
          ) : session && locked ? (
            <div className="mt-8 rounded-xl border border-amber-400/40 bg-amber-400/5 p-4 text-center text-sm text-amber-400">
              This thread is locked by moderators. No new replies.
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

function PostCard({ post, mine }: { post: LivePost; mine?: string | null }) {
  const isAuthor = mine === post.authorId && mine != null
  return (
    <div className="rounded-xl border border-[#22304e] bg-[#111a2e] p-4 fade-up">
      <div className="flex items-center gap-3">
        <Avatar name={post.authorId || 'dForum'} />
        <div className="flex-1 min-w-0">
          <p className="font-medium truncate">{post.authorId ? shortId(post.authorId, 16) : 'dForum'}</p>
          <p className="text-xs text-[#93a1bd]">{formatRelativeTime(post.createdAt)} · {formatDate(post.createdAt)}</p>
        </div>
        {isAuthor && <span className="text-[10px] uppercase tracking-wider text-[#4db3ff] border border-[#4db3ff]/40 rounded px-2 py-0.5">you</span>}
      </div>
      <div className="prose-dash mt-3 text-[15px] leading-relaxed whitespace-pre-wrap break-words">{post.body}</div>
      <div className="mt-3 flex items-center gap-4 text-xs text-[#93a1bd]">
        <span className="inline-flex items-center gap-1"><ThumbsUp className="w-3.5 h-3.5" /> 0</span>
        <span className="inline-flex items-center gap-1"><MessageSquare className="w-3.5 h-3.5" /> 0</span>
        {post.modState === 1 && <span className="text-red-400">removed by moderator</span>}
        {post.modState === 2 && <span className="text-amber-400">hidden by moderator</span>}
      </div>
    </div>
  )
}

async function loadThread(id: string): Promise<{ thread: LiveThread; posts: LivePost[] } | null> {
  try {
    const thread = await get('thread', id)
    if (!thread) return null
    const posts = await query('post', { where: [['threadId', '==', thread.id]], orderBy: [['$createdAt', 'asc']], limit: 100 })
    return {
      thread: {
        id: thread.id,
        title: (thread.properties.title as string) ?? '',
        forumId: (thread.properties.forumId as string) ?? '',
        forumSlug: null,
        tags: Array.isArray(thread.properties.tags) ? (thread.properties.tags as string[]) : [],
        sticky: Boolean(thread.properties.sticky),
        lockedAt: (thread.properties.lockedAt as number | null) ?? null,
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
    return null
  }
}
