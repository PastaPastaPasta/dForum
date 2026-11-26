'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { MessageSquare, Pencil, UserPlus, AlertTriangle, Loader2, RefreshCw } from 'lucide-react'
import { Navbar } from '@/components/Navbar'
import { Footer } from '@/components/Footer'
import { Avatar } from '@/components/Avatar'
import { RelativeTime } from '@/components/RelativeTime'
import { useSession } from '@/lib/session'
import { query, queryRaw, count } from '@/lib/services/document-service'
import { useProfileNames } from '@/lib/use-profiles'
import type { Snapshot } from '@/lib/services/snapshot-server'
import { shortId, isModerated, safeHttpUrl } from '@/lib/utils'
import { LiveUnavailable } from '@/components/LiveUnavailable'
import { filterListable } from '@/lib/services/orphan'
import { ThreadRow } from '@/components/ThreadRow'

interface ProfileData {
  displayName: string
  bio: string
  website: string
  signature: string | null
  customTitle: string | null
  createdAt: number
  modState: number | null
}

interface OwnedThread {
  id: string
  title: string
  tags: string[]
  forumSlug: string | null
  sticky: boolean
  lockedAt: number | null
  modState: number | null
  ownerId: string | null
  createdAt: number
}

type LoadStatus = 'loading' | 'ok' | 'missing' | 'error'

const THREAD_WINDOW = 20

export default function ProfileClient({ identityId, snapshot }: { identityId: string; snapshot: Snapshot | null }) {
  const { session } = useSession()

  const snap = snapshot
  const forumById = new Map((snap?.forums ?? []).map((f) => [f.id, f.slug ?? null]))
  const snapProfileName = (snap?.profiles ?? {})[identityId] ?? null
  const snapThreads: OwnedThread[] = (snap?.threads ?? [])
    .filter((t) => t.ownerId === identityId)
    .map((t) => ({
      id: t.id,
      title: t.title,
      tags: t.tags,
      forumSlug: t.forumSlug,
      sticky: t.sticky,
      lockedAt: t.lockedAt ?? null,
      modState: t.modState,
      ownerId: t.ownerId ?? null,
      createdAt: t.createdAt,
    }))

  const [profile, setProfile] = useState<ProfileData | null>(null)
  const [threads, setThreads] = useState<OwnedThread[]>(snapThreads)
  const [postCount, setPostCount] = useState(0)
  const [postCountCapped, setPostCountCapped] = useState(false)
  const [status, setStatus] = useState<LoadStatus>('loading')
  const [modState, setModState] = useState<number | null>(null)
  const [staleNote, setStaleNote] = useState(false)
  // Pagination state for the owned-thread window.
  const [moreThreads, setMoreThreads] = useState<OwnedThread[]>([])
  const [moreCursor, setMoreCursor] = useState<string | null>(null)
  const [moreLoading, setMoreLoading] = useState(false)
  const [moreError, setMoreError] = useState(false)

  useEffect(() => {
    if (!identityId) {
      setStatus('missing')
      return
    }
    let cancelled = false

    // Every read is tracked individually — a failure must surface honestly,
    // never masquerade as "no profile" or "0 posts".
    const profileQ = query('profile', { where: [['$ownerId', '==', identityId]], limit: 1 })
      .then((d) => ({ ok: true as const, docs: d }))
      .catch(() => ({ ok: false as const, docs: null }))
    const threadsQ = queryRaw('thread', { where: [['$ownerId', '==', identityId]], orderBy: [['$createdAt', 'desc']], limit: THREAD_WINDOW })
      .then(({ docs, rawCount, lastId }) => ({ ok: true as const, docs, rawCount, lastId }))
      .catch(() => ({ ok: false as const, docs: null, rawCount: 0, lastId: null }))
    // Visible posts only — raw counts include moderated/hidden posts and the
    // orphaned threads they were posted in, which is not an honest number.
    const postsQ = query('post', { where: [['$ownerId', '==', identityId]], orderBy: [['$createdAt', 'desc']], limit: 100 })
      .then((d) => ({ ok: true as const, docs: d }))
      .catch(() => ({ ok: false as const, docs: null }))

    Promise.all([profileQ, threadsQ, postsQ])
      .then(async ([profileRes, threadsRes, postsRes]) => {
        if (cancelled) return
        const anyFailed = !profileRes.ok || !threadsRes.ok || !postsRes.ok
        const docs = threadsRes.ok ? (threadsRes.docs ?? []) : []
        let listedIds = new Set<string>()
        if (docs.length) {
          const listed = await filterListable(
            docs.map((t) => ({
              id: t.id,
              ownerId: t.ownerId || null,
              lockedAt: (t.properties.lockedAt as number | null) ?? null,
              createdAt: t.createdAt,
            })),
            4,
          ).catch(() => docs.map((t) => ({ id: t.id, ownerId: t.ownerId || null, lockedAt: null, createdAt: t.createdAt })))
          listedIds = new Set(listed.map((t) => t.id))
        }
        if (cancelled) return
        if (profileRes.ok) {
          const profileDoc = profileRes.docs[0] ?? null
          if (profileDoc) {
            const p = profileDoc.properties
            setProfile({
              displayName: (p.displayName as string) || shortId(identityId, 16),
              bio: (p.bio as string) || '',
              website: (p.website as string) || '',
              signature: (p.signature as string) || null,
              customTitle: (p.customTitle as string | null) ?? null,
              createdAt: profileDoc.createdAt,
              modState: (p.modState as number | null) ?? null,
            })
            setModState((p.modState as number | null) ?? null)
          } else {
            setProfile(null)
          }
        }
        if (threadsRes.ok) {
          setThreads(
            docs
              .filter((t) => listedIds.has(t.id))
              .map((t) => ({
                id: t.id,
                title: (t.properties.title as string) ?? '',
                tags: Array.isArray(t.properties.tags) ? (t.properties.tags as string[]) : [],
                forumSlug: forumById.get((t.properties.forumId as string) ?? '') ?? null,
                sticky: Boolean(t.properties.sticky),
                lockedAt: (t.properties.lockedAt as number | null) ?? null,
                modState: (t.properties.modState as number | null) ?? null,
                ownerId: t.ownerId ?? null,
                createdAt: t.createdAt,
              })),
          )
          setMoreCursor(threadsRes.rawCount === THREAD_WINDOW && threadsRes.lastId ? threadsRes.lastId : null)
        }
        if (postsRes.ok) {
          // Only the modState filter — orphan status is deliberately NOT
          // applied here (it would make a single count of two different
          // surfaces); the threads list below carries that filter.
          const visible = postsRes.docs.filter((p) => p.properties?.modState == null)
          setPostCount(visible.length)
          setPostCountCapped(postsRes.docs.length >= 100)
        }
        if (anyFailed) {
          if (snapThreads.length === 0 && !snap?.profiles?.[identityId]) {
            setStatus('error')
            setStaleNote(false)
          } else {
            // Snapshot first-render keeps its data honest: show it with a stale note.
            setStaleNote(true)
            setStatus('ok')
          }
        } else {
          setStatus('ok')
        }
      })
      .catch(() => {
        if (cancelled) return
        if (snapThreads.length === 0 && !snap?.profiles?.[identityId]) {
          setStatus('error')
          setStaleNote(false)
        } else {
          setStaleNote(true)
          setStatus('ok')
        }
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identityId])

  async function loadMoreThreads() {
    if (moreLoading || !moreCursor) return
    setMoreLoading(true)
    setMoreError(false)
    try {
      const { docs, rawCount, lastId } = await queryRaw('thread', {
        where: [['$ownerId', '==', identityId]],
        orderBy: [['$createdAt', 'desc']],
        limit: THREAD_WINDOW,
        startAfter: moreCursor,
      })
      const listed = await filterListable(
        docs.map((t) => ({
          id: t.id,
          ownerId: t.ownerId || null,
          lockedAt: (t.properties.lockedAt as number | null) ?? null,
          createdAt: t.createdAt,
        })),
        4,
      )
      const listedIds = new Set(listed.map((t) => t.id))
      setMoreThreads((prev) => [
        ...prev,
        ...docs
          .filter((t) => listedIds.has(t.id))
          .map((t) => ({
            id: t.id,
            title: (t.properties.title as string) ?? '',
            tags: Array.isArray(t.properties.tags) ? (t.properties.tags as string[]) : [],
            forumSlug: forumById.get((t.properties.forumId as string) ?? '') ?? null,
            sticky: Boolean(t.properties.sticky),
            lockedAt: (t.properties.lockedAt as number | null) ?? null,
            modState: (t.properties.modState as number | null) ?? null,
            ownerId: t.ownerId ?? null,
            createdAt: t.createdAt,
          })),
      ])
      setMoreCursor(rawCount === THREAD_WINDOW && lastId ? lastId : null)
    } catch {
      setMoreError(true)
    } finally {
      setMoreLoading(false)
    }
  }

  const isHidden = isModerated(modState)
  const isSelf = session?.identityId === identityId
  const isEmptySelf = isSelf && status === 'ok' && !staleNote && !profile && threads.length === 0 && postCount === 0
  const displayName = profile?.displayName || snapProfileName || null
  const headingName = isHidden ? 'Hidden profile' : displayName ?? 'Unnamed identity'
  const visibleThreads = [...threads, ...moreThreads].filter((t) => !isModerated(t.modState))
  const authorIds = visibleThreads.map((t) => t.ownerId)
  const profiles = useProfileNames(authorIds)
  const nameOf = (id: string): string => snap?.profiles?.[id] ?? profiles[id] ?? shortId(id, 16)

  // Everything except the error state renders without waiting for the session —
  // the navbar shows signed-in state on its own.

  if (status === 'error' && !snapThreads.length) {
    return (
      <>
        <Navbar />
        <main id="main" tabIndex={-1} className="flex-1 flex items-center justify-center px-6">
          <div className="text-center fade-up">
            <AlertTriangle className="w-8 h-8 text-amber-400 mx-auto" aria-hidden="true" />
            <p className="text-sm uppercase tracking-widest text-[#93a1bd] mt-3">Connection error</p>
            <h1 className="text-2xl font-bold mt-2">Couldn&apos;t reach Dash Platform</h1>
            <button onClick={() => window.location.reload()} className="mt-6 btn-primary px-4 py-2">Retry</button>
          </div>
        </main>
        <Footer />
      </>
    )
  }

  // A profile with no profile doc, no threads and no posts is a missing
  // identity — anything else renders (an empty profile is not "not found").
  const isMissing = status === 'ok' && !staleNote && !profile && threads.length === 0 && postCount === 0
  if ((status === 'missing' || isMissing) && !isSelf) {
    return (
      <>
        <Navbar />
        <main id="main" tabIndex={-1} className="flex-1 flex items-center justify-center px-6">
          <div className="text-center fade-up">
            <p className="text-sm uppercase tracking-widest text-[#93a1bd]">Not found</p>
            <h1 className="text-2xl font-bold mt-2">Profile not found</h1>
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
        <section className="border-b border-[#22304e]">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 fade-up">
            <div className="flex flex-col sm:flex-row sm:items-center gap-5">
              <Avatar name={headingName} id={identityId || null} size="lg" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">{headingName}</h1>
                  {isHidden && <span className="text-[11px] uppercase tracking-wider text-amber-400 border border-amber-400/40 rounded px-2 py-0.5">hidden</span>}
                  {isSelf && (
                    <Link href="/settings" className="ml-1 btn-secondary px-3 py-1.5 text-xs">
                      <Pencil className="w-3.5 h-3.5" /> Edit profile
                    </Link>
                  )}
                </div>
                <p className="mt-1 text-xs font-mono text-[#93a1bd] break-all">{identityId}</p>

                {isHidden ? (
                  <div className="mt-3 rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-sm text-amber-400">
                    This profile was hidden by a moderator.
                  </div>
                ) : (
                  <>
                    {profile?.customTitle && <p className="mt-2 text-sm text-[#4db3ff] font-medium">{profile.customTitle}</p>}
                    {profile?.bio && <p className="mt-3 text-[#93a1bd] max-w-xl whitespace-pre-wrap">{profile.bio}</p>}
                    {safeHttpUrl(profile?.website) && (
                      <a href={safeHttpUrl(profile?.website)!} target="_blank" rel="ugc nofollow noopener noreferrer" className="mt-2 inline-block text-sm text-[#4db3ff] hover:underline break-all">
                        {profile?.website}
                      </a>
                    )}
                    {profile?.signature && <p className="mt-3 text-xs text-[#93a1bd] italic max-w-xl">{profile.signature}</p>}
                  </>
                )}
                <div className="mt-4 flex gap-4 text-sm text-[#93a1bd]">
                  {status === 'loading' ? (
                    <>
                      <span><Loader2 className="w-3.5 h-3.5 animate-spin inline" aria-hidden="true" /> …</span>
                      <span><Loader2 className="w-3.5 h-3.5 animate-spin inline" aria-hidden="true" /> …</span>
                    </>
                  ) : (
                    <>
                      <span>{staleNote ? '—' : `${visibleThreads.length}${moreCursor != null ? '+' : ''} thread${visibleThreads.length === 1 ? '' : 's'}`}</span>
                      <span>{staleNote ? '—' : postCountCapped ? `${postCount}+ posts` : `${postCount} post${postCount === 1 ? '' : 's'}`}</span>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>

        {staleNote && (
          <div className="max-w-3xl mx-auto px-4 sm:px-6 pt-4">
            <LiveUnavailable />
          </div>
        )}

        {isEmptySelf && (
          <section className="max-w-3xl mx-auto px-4 sm:px-6 pt-6">
            <div className="rounded-xl border border-dashed border-[#22304e] bg-[#111a2e] p-6 text-center">
              <UserPlus className="w-6 h-6 text-[#93a1bd] mx-auto" aria-hidden="true" />
              <p className="mt-2 text-[#93a1bd]">You haven&apos;t set up a profile yet.</p>
              <Link href="/settings" className="mt-3 inline-flex items-center gap-2 btn-primary px-4 py-2 text-sm font-medium">Set up your profile</Link>
            </div>
          </section>
        )}

        {isHidden ? (
          <section className="max-w-3xl mx-auto px-4 sm:px-6 py-6">
            <p className="text-sm text-amber-400 rounded-xl border border-amber-400/40 bg-amber-400/10 px-4 py-3">This profile is hidden; its thread list isn&apos;t shown here.</p>
          </section>
        ) : (
        <section className="max-w-3xl mx-auto px-4 sm:px-6 py-6">
          <h2 className="text-lg font-bold tracking-tight">Threads by this user</h2>
          <div className="mt-3 space-y-3">
            {status === 'loading' && visibleThreads.length === 0 ? (
              <>
                <span className="sr-only" role="status">Loading threads…</span>
                {[0, 1].map((i) => <div key={i} aria-hidden="true" className="h-16 rounded-xl border border-[#22304e] bg-[#111a2e] animate-pulse" />)}
              </>
            ) : visibleThreads.length === 0 ? (
              <div className="rounded-xl border border-dashed border-[#22304e] p-8 text-center">
                <UserPlus className="w-6 h-6 text-[#93a1bd] mx-auto" aria-hidden="true" />
                <p className="mt-2 text-[#93a1bd]">No threads yet.</p>
              </div>
            ) : (
              visibleThreads.map((t) => (
                <ThreadRow key={t.id} thread={{ ...t, forumSlug: t.forumSlug ?? null }} nameOf={nameOf} />
              ))
            )}
          </div>
          {moreCursor != null && status === 'ok' && !staleNote && (
            <div className="mt-4">
              {moreError ? (
                <p className="text-sm text-red-400">Couldn&apos;t load more threads. <button onClick={() => loadMoreThreads()} className="text-[#4db3ff] hover:underline">Retry</button></p>
              ) : (
                <button
                  onClick={() => loadMoreThreads()}
                  disabled={moreLoading}
                  className="btn-secondary px-3 py-2 text-sm disabled:opacity-50"
                >
                  {moreLoading ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="w-4 h-4" aria-hidden="true" />}
                  {moreLoading ? 'Loading…' : 'Load older threads'}
                </button>
              )}
            </div>
          )}
        </section>
        )}
      </main>
      <Footer />
    </>
  )
}
