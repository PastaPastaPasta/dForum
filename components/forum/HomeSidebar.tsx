'use client'

import Link from 'next/link'
import type { SiteFile } from '@/lib/forum/types'
import { archiveRef, excerpt, postBody, str, archiveAuthor, effectiveAt } from '@/lib/forum/model'
import { deltaChanges, newPosts, toLiveContext, type LiveContextProps } from '@/lib/forum/live-merge'
import { useLive } from '@/lib/live/overlay'
import { useNames } from '@/lib/live/names'
import { useSession } from '@/lib/session'
import { LOGIN_AVAILABLE } from '@/lib/host'
import { Time } from '@/components/ui/Time'
import { Avatar } from '@/components/ui/Avatar'
import { AuthorLink } from './AuthorLink'

type Latest = SiteFile['latestPosts'][number]

export function HomeSidebar({ site, names, ctx }: { site: SiteFile; names: Record<string, string>; ctx: LiveContextProps }) {
  const { session, ready } = useSession()
  const live = useLive(site.snapshotAt)
  const archive = archiveRef(site.settings)
  const fresh: Latest[] = newPosts(live, toLiveContext(ctx)).map(({ post: p, thread }) => ({
    postId: p.id, threadId: thread.id, threadTitle: str(thread, 'title') ?? '', at: effectiveAt(p, archive),
    authorId: p.ownerId, archiveAuthor: archiveAuthor(p, archive), forumId: str(thread, 'forumId') ?? '', excerpt: excerpt(postBody(p), 140),
  }))
  // Static entries drop out as soon as the live delta shows their thread or post hidden.
  const changes = deltaChanges(live)
  const still = site.latestPosts
    .filter((l) => !changes.threadGone(l.threadId) && !changes.postGone(l.postId))
    .map((l) => { const t = changes.thread(l.threadId); return t ? { ...l, threadTitle: str(t, 'title') ?? l.threadTitle } : l })
  const seen = new Set<string>()
  const latest = [...fresh, ...still]
    .sort((a, b) => b.at - a.at)
    .filter((p) => (seen.has(p.threadId) ? false : (seen.add(p.threadId), true)))
    .slice(0, 8)
  const nameOf = useNames(names, latest.map((l) => l.authorId), live.profiles)

  return (
    <aside className="grid content-start gap-5 md:grid-cols-2 xl:grid-cols-1" aria-label="Forum activity">
      {ready && !session && LOGIN_AVAILABLE && (
        <section className="panel p-4">
          <h2 className="font-semibold">Join the discussion</h2>
          <p className="mt-1 text-sm text-ink-2">Log in with your Dash wallet to start threads, reply and react. Your posts are stored on Dash Platform under your identity.</p>
          <Link href="/login/" className="btn btn-primary mt-3 w-full">Log in with Dash</Link>
        </section>
      )}
      <section className="panel">
        <h2 className="flex items-center justify-between border-b border-rule px-4 py-2.5 font-semibold">
          Latest posts
          {live.status === 'live' && (
            <span className="flex items-center gap-1.5 text-xs font-medium text-live"><span className="h-1.5 w-1.5 rounded-full bg-live" />{live.truncated ? 'Catching up' : 'Live'}</span>
          )}
          {live.status === 'offline' && <span className="text-xs font-medium text-ink-2">Offline: showing the last index</span>}
        </h2>
        {latest.length === 0 ? (
          <p className="px-4 py-3 text-sm text-ink-2">Nothing posted yet.</p>
        ) : (
          <ul className="divide-y divide-rule">
            {latest.map((l) => {
              const name = l.archiveAuthor ?? nameOf(l.authorId)
              return (
                <li key={l.postId} className="flex gap-2.5 px-4 py-2.5">
                  <Avatar seed={l.authorId + (l.archiveAuthor ?? '')} name={name} size={28} archive={!!l.archiveAuthor} />
                  <div className="min-w-0 text-sm">
                    <Link href={`/t/${l.threadId}/#post-${l.postId}`} className="tap-y line-clamp-2 font-medium hover:text-dash">{l.threadTitle || 'New reply'}</Link>
                    <p className="text-ink-2"><AuthorLink id={l.authorId} name={name} archiveAuthor={l.archiveAuthor} className="text-ink-2" />, <Time at={l.at} /></p>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
        <Link href="/whats-new/" className="block border-t border-rule px-4 py-2 text-sm text-dash hover:underline">All recent activity</Link>
      </section>
      <section className="panel p-4 text-sm">
        <h2 className="mb-2 font-semibold">Forum statistics</h2>
        <dl className="grid grid-cols-[1fr_auto] gap-y-1">
          <dt className="text-ink-2">Threads</dt><dd className="text-right tabnum">{site.stats.threads.toLocaleString('en-US')}</dd>
          <dt className="text-ink-2">Messages</dt><dd className="text-right tabnum">{site.stats.posts.toLocaleString('en-US')}</dd>
          <dt className="text-ink-2">Members</dt><dd className="text-right tabnum">{site.stats.members.toLocaleString('en-US')}</dd>
          {site.newestMember && (<><dt className="text-ink-2">Newest member</dt><dd className="truncate text-right"><Link className="link" href={`/u/${site.newestMember.id}/`}>{site.newestMember.name}</Link></dd></>)}
        </dl>
        {site.stats.archivePosts > 0 && (
          <p className="mt-3 border-t border-rule pt-3 text-ink-2">{site.stats.archivePosts.toLocaleString('en-US')} messages were imported from {site.settings.archiveSourceName ?? 'the previous forum'}.</p>
        )}
      </section>
      {site.tags.length > 0 && (
        <section className="panel p-4">
          <h2 className="mb-2 font-semibold">Tags</h2>
          <ul className="flex flex-wrap gap-1.5">
            {site.tags.slice(0, 20).map((t) => (
              <li key={t.tag}><Link href={`/tags/${t.tag}/`} className="inline-block rounded bg-sunk px-2 py-0.5 text-sm hover:text-dash">{t.tag}</Link></li>
            ))}
          </ul>
        </section>
      )}
    </aside>
  )
}
