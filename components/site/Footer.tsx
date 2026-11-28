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
          <p className="mt-1 max-w-xs">Threads, posts and profiles are stored on Dash Platform. Log in with your Dash wallet to take part.</p>
        </div>
        <ul className="space-y-1.5">
          <li><Link href="/whats-new/" className="tap underline decoration-rule underline-offset-4 hover:text-dash hover:decoration-dash">What&apos;s new</Link></li>
          <li><Link href="/members/" className="tap underline decoration-rule underline-offset-4 hover:text-dash hover:decoration-dash">Members</Link></li>
          <li><Link href="/rules/" className="tap underline decoration-rule underline-offset-4 hover:text-dash hover:decoration-dash">Rules and team</Link></li>
          <li><a href="/feed.xml" className="tap underline decoration-rule underline-offset-4 hover:text-dash hover:decoration-dash">RSS feed</a></li>
        </ul>
        <div className="space-y-1.5">
          <p>Running on {NETWORK === 'mainnet' ? 'Dash' : `Dash ${NETWORK}`}<span className="sr-only">, data contract {CONTRACT_ID}</span>.</p>
          <p>Pages last refreshed {built}. Newer posts load automatically.</p>
          {archiveSourceName && (
            <p>Includes history imported from {archiveSourceUrl ? <a className="link" href={archiveSourceUrl} rel="nofollow noopener">{archiveSourceName}</a> : archiveSourceName}.</p>
          )}
        </div>
      </div>
    </footer>
  )
}
