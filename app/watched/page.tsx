import { site } from '@/lib/server/site-data'
import { Watched } from '@/components/site/Watched'

export const metadata = { title: 'Watched threads', robots: { index: false } }

export default function Page() {
  return <Watched snapshotAt={site().snapshotAt} />
}
