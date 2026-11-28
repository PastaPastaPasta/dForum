import { forumFile, liveContext, memberNames, site } from '@/lib/server/site-data'
import { sortThreadSummaries } from '@/lib/forum/model'
import { WhatsNew } from '@/components/forum/WhatsNew'

export const metadata = { title: "What's new", alternates: { canonical: '/whats-new/' } }

export default function Page() {
  const s = site()
  const all = s.forums.flatMap((f) => forumFile(f.id)?.threads ?? [])
  const threads = sortThreadSummaries(all.map((t) => ({ ...t, sticky: false }))).slice(0, 50)
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">What&apos;s new</h1>
        <p className="mt-1 text-ink-2">Threads with the latest replies across every forum.</p>
      </div>
      <WhatsNew threads={threads} ctx={liveContext()}
        names={memberNames(threads.flatMap((t) => [t.ownerId, t.lastPostAuthorId]))} forumTitles={Object.fromEntries(s.forums.map((f) => [f.id, f.title]))} />
    </div>
  )
}
