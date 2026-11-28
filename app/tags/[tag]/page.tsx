import { archiveRef } from '@/lib/forum/model'
import { forumFile, memberNames, site } from '@/lib/server/site-data'
import { sortThreadSummaries } from '@/lib/forum/model'
import { TagThreads } from '@/components/forum/TagThreads'

export const dynamicParams = false
export function generateStaticParams() {
  const tags = site().tags
  return tags.length ? tags.map((t) => ({ tag: t.tag })) : [{ tag: '__none__' }]
}
export const generateMetadata = ({ params }: { params: { tag: string } }) => ({ title: `Tagged ${params.tag}`, alternates: { canonical: `/tags/${params.tag}/` } })

export default function Page({ params }: { params: { tag: string } }) {
  const s = site()
  const threads = sortThreadSummaries(s.forums.flatMap((f) => forumFile(f.id)?.threads ?? []).filter((t) => t.tags.includes(params.tag)).map((t) => ({ ...t, sticky: false }))).slice(0, 200)
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Threads tagged <span className="rounded bg-sunk px-2">{params.tag}</span></h1>
      <TagThreads threads={threads} names={memberNames(threads.flatMap((t) => [t.ownerId, t.lastPostAuthorId]))} forumTitles={Object.fromEntries(s.forums.map((f) => [f.id, f.title]))} snapshotAt={s.snapshotAt} archive={archiveRef(s.settings)} />
    </div>
  )
}
