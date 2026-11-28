import { liveContext, site } from '@/lib/server/site-data'
import { archiveRef } from '@/lib/forum/model'
import { LiveFallback } from '@/components/site/LiveFallback'

export default function NotFound() {
  const s = site()
  return <LiveFallback ctx={liveContext()} snapshotAt={s.snapshotAt} archive={archiveRef(s.settings)} sourceUrl={s.settings.archiveSourceUrl}
    forums={s.forums.map((f) => ({ ...f, lastPost: undefined }))} categories={s.categories} />
}
