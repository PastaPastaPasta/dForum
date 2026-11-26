'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { MessageSquare, Pencil, UserPlus, AlertTriangle, Loader2 } from 'lucide-react'
import { Navbar } from '@/components/Navbar'
import { Footer } from '@/components/Footer'
import { Avatar } from '@/components/Avatar'
import { RelativeTime } from '@/components/RelativeTime'
import { useSession } from '@/lib/session'
import { query, count } from '@/lib/services/document-service'
import type { Snapshot } from '@/lib/services/snapshot-server'
import { shortId, isModerated, safeHttpUrl } from '@/lib/utils'
import { LiveUnavailable } from '@/components/LiveUnavailable'

interface ProfileData {
  displayName: string
  bio: string
  website: string
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
  modState: number | null
  createdAt: number
}

type LoadStatus = 'loading' | 'ok' | 'missing' | 'error'

const THREAD_WINDOW = 20

export default function ProfileClient({ identityId, snapshot }: { identityId: string; snapshot: Snapshot | null }) {
  const { session } = useSession()
  const isSelf = session?.identityId === identityId

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
      modState: t.modState,
      createdAt: t.createdAt,
    }))

  const [profile, setProfile] = useState<ProfileData | null>(null)
  const [threads, setThreads] = useState<OwnedThread[]>(snapThreads)
  const [postCount, setPostCount] = useState(0)
  const [status, setStatus] = useState<LoadStatus>('loading')
  const [modState, setModState] = useState<number | null>(null)
  const [staleNote, setStaleNote] = useState(false)

  useEffect(() => {
    if (!identityId) {
      setStatus('missing')
      return
    }
    let cancelled = false
    // Re-fill from the snapshot on identity change (first paint) before the
    // live read resolves.
    setThreads((snap?.threads ?? []).filter((t) => t.ownerId === identityId).map((t) => ({
      id: t.id,
      title: t.title,
      tags: t.tags,
      forumSlug: t.forumSlug,
      sticky: t.sticky,
      modState: t.modState,
      createdAt: t.createdAt,
    })))

    Promise.all([
      query('profile', { where: [['$ownerId', '==', identityId]], limit: 1 }).then((d) => d[0] ?? null).catch(() => null),
      query('thread', { where: [['$ownerId', '==', identityId]], orderBy: [['$createdAt', 'desc']], limit: THREAD_WINDOW }),
      count('post', { where: [['$ownerId', '==', identityId]] }).catch(() => new Map<string, bigint>()),
    ])
      .then(([profileDoc, ownedThreads, postCounts]) => {
        if (cancelled) return
        if (profileDoc) {
          const p = profileDoc.properties
          setProfile({
            displayName: (p.displayName as string) || shortId(identityId, 16),
            bio: (p.bio as string) || '',
            website: (p.website as string) || '',
            customTitle: (p.customTitle as string | null) ?? null,
            createdAt: profileDoc.createdAt,
            modState: (p.modState as number | null) ?? null,
          })
          setModState((p.modState as number | null) ?? null)
        } else {
          setProfile(null)
        }
        setThreads(
          ownedThreads.map((t) => ({
            id: t.id,
            title: (t.properties.title as string) ?? '',
            tags: Array.isArray(t.properties.tags) ? (t.properties.tags as string[]) : [],
            forumSlug: forumById.get((t.properties.forumId as string) ?? '') ?? null,
            sticky: Boolean(t.properties.sticky),
            modState: (t.properties.modState as number | null) ?? null,
            createdAt: t.createdAt,
          })),
        )
        setPostCount(Number(Array.from(postCounts.values()).reduce((a, b) => a + b, 0n)))
        setStatus('ok')
      })
      .catch(() => {
        if (!cancelled) {
          // Keep any snapshot-first-render data honest: mark the read stale
          // but still show the snapshot (threads visible from the static
          // index) instead of a hard error screen.
          setStaleNote(true)
          setStatus('ok')
        }
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identityId])

  const isHidden = isModerated(modState)
  const displayName = profile?.displayName || snapProfileName || (identityId ? shortId(identityId, 20) : 'Unknown')
  const visibleThreads = threads.filter((t) => !isModerated(t.modState))
  const threadsReady = status !== 'loading'

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

  // A profile with no profile doc and no threads is a missing profile.
  const isMissing = status === 'ok' && !profile && threads.length === 0
  if (status === 'missing' || isMissing) {
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
              <Avatar name={isHidden ? 'Hidden' : displayName} id={identityId || null} size="lg" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">{isHidden ? 'Hidden profile' : displayName}</h1>
                  {isHidden && <span className="text-[10px] uppercase tracking-wider text-amber-400 border border-amber-400/40 rounded px-2 py-0.5">hidden</span>}
                  {isSelf && (
                    <Link href="/settings" className="ml-1 inline-flex items-center gap-1.5 rounded-lg border border-[#22304e] px-3 py-1.5 text-xs text-[#93a1bd] hover:text-white hover:border-[#008CE7] transition">
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
                      <span>{visibleThreads.length} thread{visibleThreads.length === 1 ? '' : 's'}{threads.length >= THREAD_WINDOW ? ` (showing latest ${THREAD_WINDOW})` : ''}</span>
                      <span>{postCount} post{postCount === 1 ? '' : 's'}</span>
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

        {isHidden ? (
          <section className="max-w-3xl mx-auto px-4 sm:px-6 py-6">
            <p className="text-sm text-amber-400 rounded-xl border border-amber-400/40 bg-amber-400/10 px-4 py-3">Threads by this user are hidden along with the profile.</p>
          </section>
        ) : (
        <section className="max-w-3xl mx-auto px-4 sm:px-6 py-6">
          <h2 className="text-lg font-bold tracking-tight">Threads by this user</h2>
          <div className="mt-3 space-y-3">
            {status === 'loading' ? (
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
                <Link
                  key={t.id}
                  href={`/t/${encodeURIComponent(t.id)}`}
                  className="flex items-center gap-3 rounded-xl border border-[#22304e] bg-[#111a2e] px-4 py-3 hover:border-[#008CE7] transition fade-up"
                >
                  <MessageSquare className="w-4 h-4 text-[#4db3ff] shrink-0" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      {t.sticky && <span className="text-[10px] uppercase tracking-wider text-[#4db3ff] border border-[#4db3ff]/40 rounded px-1.5 py-0.5">pinned</span>}
                      <p className="font-medium truncate">{t.title}</p>
                    </div>
                    <p className="text-xs text-[#93a1bd] mt-0.5 truncate">
                      {t.forumSlug ?? 'dForum'} · <RelativeTime time={t.createdAt} />
                      {t.tags.length ? ` · ${t.tags.slice(0, 3).map((s) => `#${s}`).join(' ')}` : ''}
                    </p>
                  </div>
                </Link>
              ))
            )}
          </div>
        </section>
        )}
      </main>
      <Footer />
    </>
  )
}
