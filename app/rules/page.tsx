import Link from 'next/link'
import { site, members } from '@/lib/server/site-data'
import { rolesFor } from '@/lib/server/thread-route'
import { Markdown } from '@/components/ui/Markdown'
import { memberLabel } from '@/lib/forum/model'

export const metadata = { title: 'Rules and team', alternates: { canonical: '/rules/' } }

export default function Rules() {
  const s = site()
  const roles = rolesFor()
  const names = Object.fromEntries(members().map((m) => [m.id, m.name]))
  const staff = Object.entries(roles)
  return (
    <div className="mx-auto max-w-read space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Rules and team</h1>
      {s.settings.description && <p className="text-ink-2">{s.settings.description}</p>}
      <section className="panel p-5">
        <h2 className="mb-3 font-semibold">Forum rules</h2>
        {s.settings.rules ? <Markdown source={s.settings.rules} /> : <p className="text-ink-2">The forum owner hasn&apos;t published rules yet.</p>}
      </section>
      <section className="panel p-5">
        <h2 className="mb-2 font-semibold">Who moderates</h2>
        <p className="mb-3 text-sm text-ink-2">The forum owner appoints the moderators. The list below comes from the moderation settings stored in the forum&apos;s data contract on Dash Platform, so it is the same list the network enforces.</p>
        <ul className="divide-y divide-rule">
          {staff.map(([id, role]) => (
            <li key={id} className="flex items-center justify-between py-2"><Link href={`/u/${id}/`} className="font-medium hover:text-dash">{names[id] || memberLabel(id)}</Link><span className="text-sm text-dash">{role}</span></li>
          ))}
        </ul>
      </section>
    </div>
  )
}
