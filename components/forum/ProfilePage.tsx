'use client'

import Link from 'next/link'
import { useMemo } from 'react'
import { Globe, MapPin } from 'lucide-react'
import type { MemberView, UserFile } from '@/lib/forum/types'
import { isHidden, str } from '@/lib/forum/model'
import { useLive } from '@/lib/live/overlay'
import { deltaChanges } from '@/lib/forum/live-merge'
import { useNames } from '@/lib/live/names'
import { memberLabel } from '@/lib/forum/model'
import { useSession } from '@/lib/session'
import { Avatar } from '@/components/ui/Avatar'
import { Markdown } from '@/components/ui/Markdown'
import { Time } from '@/components/ui/Time'
import { ThreadList } from './ThreadList'

const joined = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })

export function ProfilePage({ id, file, role, snapshotAt, forumTitles }: {
  id: string
  file: UserFile | null
  role?: string
  snapshotAt: number
  forumTitles: Record<string, string>
}) {
  const live = useLive(snapshotAt)
  const { session } = useSession()
  const liveProfile = live.profiles.find((p) => p.ownerId === id)
  const changes = deltaChanges(live)
  const member: MemberView = useMemo(() => {
    const base: MemberView = file?.member ?? { id, name: '', joinedAt: 0, posts: 0, threads: 0, reactionsReceived: 0 }
    if (!liveProfile) return base
    if (isHidden(liveProfile)) return { ...base, hidden: true }
    return {
      ...base, hidden: undefined, name: str(liveProfile, 'displayName') ?? base.name, bio: str(liveProfile, 'bio'), signature: str(liveProfile, 'signature'),
      website: str(liveProfile, 'website'), location: str(liveProfile, 'location'), avatarUrl: str(liveProfile, 'avatarUrl'),
      title: str(liveProfile, 'customTitle') ?? base.title,
    }
  }, [file, liveProfile, id])
  const name = member.hidden ? 'Hidden profile' : member.name || memberLabel(id)
  const others = useNames({}, (file?.threads ?? []).map((t) => t.lastPostAuthorId), live.profiles)
  const nameOf = (who: string) => (who === id ? name : others(who))
  const website = member.website && /^https?:\/\//.test(member.website) ? member.website : undefined

  return (
    <div className="space-y-6">
      <section className="panel flex flex-col gap-5 p-5 sm:flex-row sm:items-start">
        <Avatar seed={id} name={name} src={member.hidden ? undefined : member.avatarUrl} size={96} />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-baseline gap-x-3">
            <h1 className="text-2xl font-semibold tracking-tight">{name}</h1>
            {(role || member.title) && <span className="text-sm font-semibold text-dash">{role ?? member.title}</span>}
          </div>
          <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-2">
            {member.joinedAt > 0 && <span>Joined {joined.format(member.joinedAt)}</span>}
            {member.location && !member.hidden && <span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{member.location}</span>}
            {website && !member.hidden && <a className="flex items-center gap-1 link" href={website} rel="nofollow ugc noopener" target="_blank"><Globe className="h-3.5 w-3.5" />{website.replace(/^https?:\/\//, '').slice(0, 40)}</a>}
          </p>
          {member.bio && !member.hidden && <Markdown source={member.bio} className="post-body max-w-read !text-base" />}
          <p className="text-xs text-ink-2">Dash identity <span className="font-mono break-all">{id}</span></p>
          {session?.identityId === id && <Link href="/settings/" className="btn btn-quiet">Edit profile</Link>}
        </div>
        <dl className="grid grid-cols-3 gap-4 text-center sm:w-64">
          {[['Messages', member.posts], ['Threads', member.threads], ['Reactions', member.reactionsReceived]].map(([l, v]) => (
            <div key={l as string}><dd className="text-xl font-semibold tabnum">{(v as number).toLocaleString('en-US')}</dd><dt className="text-xs text-ink-2">{l}</dt></div>
          ))}
        </dl>
      </section>
      <section aria-labelledby="threads-h" className="space-y-2">
        <h2 id="threads-h" className="text-lg font-semibold">Threads started</h2>
        <ThreadList threads={(file?.threads ?? []).filter((t) => !changes.threadGone(t.id))} nameOf={nameOf} showForum forumTitle={(f) => forumTitles[f]} emptyText="No threads yet." />
      </section>
      <section aria-labelledby="posts-h" className="space-y-2">
        <h2 id="posts-h" className="text-lg font-semibold">Recent posts</h2>
        {file?.posts.length ? (
          <ul className="panel divide-y divide-rule">
            {file.posts.filter((p) => !changes.threadGone(p.threadId) && !changes.postGone(p.postId)).map((p) => (
              <li key={p.postId} className="px-4 py-3">
                <Link href={`/t/${p.threadId}/#post-${p.postId}`} className="font-medium hover:text-dash">{p.threadTitle}</Link>
                <p className="mt-0.5 text-sm text-ink-2 line-clamp-2">{p.excerpt}</p>
                <p className="mt-1 text-xs text-ink-2"><Time at={p.at} />{forumTitles[p.forumId] && <> in {forumTitles[p.forumId]}</>}</p>
              </li>
            ))}
          </ul>
        ) : <p className="panel px-4 py-6 text-center text-ink-2">No posts in the index yet. Newer posts appear after the next index update.</p>}
      </section>
    </div>
  )
}
