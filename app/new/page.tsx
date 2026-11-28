import { site } from '@/lib/server/site-data'
import { NewThread } from '@/components/thread/NewThread'

export default function NewThreadPage() {
  const s = site()
  return <NewThread categories={s.categories} forums={s.forums.map(({ lastPost: _l, ...f }) => f as typeof s.forums[number])} />
}
