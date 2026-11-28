import Link from 'next/link'
import { NETWORK, CONTRACT_ID } from '@/lib/constants'

export function Footer({ siteName, snapshotAt, archiveSourceName, archiveSourceUrl }: {
  siteName: string
  snapshotAt: number
  archiveSourceName?: string
  archiveSourceUrl?: string
}) {
  const built = snapshotAt ? new Date(snapshotAt).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : 'not built yet'
  return (
    <footer className="mt-16 border-t border-rule bg-sheet">
      <div className="mx-auto grid max-w-page gap-6 px-4 py-8 text-sm text-ink-2 sm:grid-cols-3">
        <div>
          <p className="font-semibold text-ink">{siteName}</p>
          <p className="mt-1 max-w-xs">Every thread, post and profile is stored on Dash Platform. Sign in with your Dash wallet.</p>
        </div>
        <ul className="space-y-1.5">
          <li><Link href="/whats-new/" className="hover:text-dash">What&apos;s new</Link></li>
          <li><Link href="/members/" className="hover:text-dash">Members</Link></li>
          <li><Link href="/rules/" className="hover:text-dash">Rules and team</Link></li>
          <li><a href="/feed.xml" className="hover:text-dash">RSS feed</a></li>
        </ul>
        <div className="space-y-1.5">
          <p>{NETWORK === 'mainnet' ? 'Dash mainnet' : `Dash ${NETWORK}`} · contract <span className="font-mono text-xs">{CONTRACT_ID.slice(0, 8)}…</span></p>
          <p>Static index updated {built}; newer activity loads live.</p>
          {archiveSourceName && (
            <p>Includes history imported from {archiveSourceUrl ? <a className="link" href={archiveSourceUrl} rel="nofollow noopener">{archiveSourceName}</a> : archiveSourceName}.</p>
          )}
        </div>
      </div>
    </footer>
  )
}
