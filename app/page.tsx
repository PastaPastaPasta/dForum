import { site, memberNames } from '@/lib/server/site-data'
import { ForumIndex } from '@/components/forum/ForumIndex'
import { HomeSidebar } from '@/components/forum/HomeSidebar'
import { Markdown } from '@/components/ui/Markdown'

export default function Home() {
  const s = site()
  const ids = [...s.forums.map((f) => f.lastPost?.authorId), ...s.latestPosts.map((p) => p.authorId)].filter((x): x is string => !!x)
  const names = memberNames(ids)
  return (
    <>
      <div className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight">{s.settings.name || 'dForum'}</h1>
        {s.settings.tagline && <p className="mt-1 text-ink-2">{s.settings.tagline}</p>}
      </div>
      {s.settings.announcement && (
        <div role="note" className="mb-5 rounded-lg border border-dash/30 bg-dash/5 px-4 py-3 text-[0.95rem]">
          <Markdown source={s.settings.announcement} className="post-body !font-sans !text-[0.95rem]" />
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <ForumIndex categories={s.categories} forums={s.forums} names={names} snapshotAt={s.snapshotAt} archiveOwnerId={s.settings.archiveOwnerId} />
        <HomeSidebar site={s} names={names} />
      </div>
    </>
  )
}
