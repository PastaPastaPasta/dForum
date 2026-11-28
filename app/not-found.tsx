import { site } from '@/lib/server/site-data'
import { LiveFallback } from '@/components/site/LiveFallback'

export default function NotFound() {
  const s = site()
  return <LiveFallback snapshotAt={s.snapshotAt} archive={s.settings.archiveOwnerId} sourceUrl={s.settings.archiveSourceUrl}
    forums={s.forums.map((f) => ({ ...f, lastPost: undefined }))} categories={s.categories} />
}
