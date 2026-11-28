'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { REACTIONS } from '@/lib/forum/types'
import { alertsSeenAt, fetchAlerts, markAlertsSeen, type Alert } from '@/lib/live/alerts'
import { useNames } from '@/lib/live/names'
import { useSession } from '@/lib/session'
import { LOGIN_AVAILABLE } from '@/lib/host'
import { Time } from '@/components/ui/Time'

export function Alerts() {
  const { session, ready } = useSession()
  const [alerts, setAlerts] = useState<Alert[] | null>(null)
  const [error, setError] = useState(false)
  const [seen, setSeen] = useState(0)
  useEffect(() => {
    if (!session) return
    setSeen(alertsSeenAt(session.identityId))
    fetchAlerts(session.identityId).then((a) => { setAlerts(a); markAlertsSeen(session.identityId) }).catch(() => setError(true))
  }, [session])
  const nameOf = useNames({}, (alerts ?? []).map((a) => a.actorId))
  if (!ready) return <p role="status" className="py-10 text-center text-ink-2">Loading…</p>
  if (!session) {
    return (
      <div className="panel mx-auto max-w-md p-8 text-center">
        <h1 className="text-xl font-semibold">Alerts</h1>
        <p className="mt-2 text-ink-2">Log in to see replies and reactions to your posts.</p>
        {LOGIN_AVAILABLE && <Link href="/login/?next=/alerts/" className="btn btn-primary mt-4">Log in with Dash</Link>}
      </div>
    )
  }
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Alerts</h1>
      {error && <p role="alert" className="text-danger">Couldn&apos;t load alerts from Dash Platform. Reload to try again.</p>}
      {!alerts && !error && <p role="status" className="text-ink-2">Loading alerts from Dash Platform…</p>}
      {alerts && alerts.length === 0 && <p className="panel px-4 py-6 text-center text-ink-2">No alerts in the last 60 days. Replies to your threads and reactions to your posts show up here.</p>}
      {alerts && alerts.length > 0 && (
        <ul className="panel divide-y divide-rule">
          {alerts.map((a) => (
            <li key={`${a.kind}-${a.postId}-${a.actorId}`} className={`px-4 py-3 text-sm ${a.at > seen ? 'bg-dash/5' : ''}`}>
              <Link href={`/u/${a.actorId}/`} className="font-semibold hover:text-dash">{nameOf(a.actorId)}</Link>{' '}
              {a.kind === 'reaction'
                ? <>reacted {REACTIONS.find((r) => r.kind === a.reaction)?.emoji ?? ''} to <Link className="link" href={`/t/${a.threadId}/#post-${a.postId}`}>your post{a.threadTitle ? ` in ${a.threadTitle}` : ''}</Link></>
                : <>replied to <Link className="link" href={`/t/${a.threadId}/#post-${a.postId}`}>{a.threadTitle ?? 'your thread'}</Link></>}
              <span className="ml-2 text-ink-2"><Time at={a.at} /></span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
