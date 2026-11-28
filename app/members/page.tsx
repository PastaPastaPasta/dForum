import Link from 'next/link'
import { archiveMembers, members, site } from '@/lib/server/site-data'
import { rolesFor } from '@/lib/server/thread-route'
import { Avatar } from '@/components/ui/Avatar'

export const metadata = { title: 'Members', alternates: { canonical: '/members/' } }

const joined = new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })

export default function Members() {
  const list = members().filter((m) => !m.hidden)
  const roles = rolesFor()
  const staff = list.filter((m) => roles[m.id])
  const archived = archiveMembers().slice(0, 60)
  const s = site()
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Members</h1>
        <p className="mt-1 text-ink-2">{list.length.toLocaleString('en-US')} members have posted or set up a profile. Members are Dash identities; anyone with a Dash wallet can join.</p>
      </div>
      {staff.length > 0 && (
        <section aria-labelledby="staff" className="space-y-2">
          <h2 id="staff" className="text-lg font-semibold">Team</h2>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {staff.map((m) => (
              <li key={m.id} className="panel flex items-center gap-3 p-3">
                <Avatar seed={m.id} name={m.name || m.id} src={m.avatarUrl} size={44} />
                <div className="min-w-0"><Link href={`/u/${m.id}/`} className="block truncate font-semibold hover:text-dash">{m.name || m.id.slice(0, 8)}</Link><p className="text-sm text-dash">{roles[m.id]}</p></div>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section aria-labelledby="all" className="space-y-2">
        <h2 id="all" className="text-lg font-semibold">Most active</h2>
        <div className="panel overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-rule text-left text-ink-2">
              <tr><th className="px-4 py-2 font-medium">Member</th><th className="px-4 py-2 text-right font-medium">Messages</th><th className="px-4 py-2 text-right font-medium">Threads</th><th className="px-4 py-2 text-right font-medium">Reactions</th><th className="hidden px-4 py-2 text-right font-medium sm:table-cell">Joined</th></tr>
            </thead>
            <tbody className="divide-y divide-rule">
              {list.slice(0, 200).map((m) => (
                <tr key={m.id}>
                  <td className="px-4 py-2"><Link href={`/u/${m.id}/`} className="flex items-center gap-2.5 hover:text-dash"><Avatar seed={m.id} name={m.name || m.id} src={m.avatarUrl} size={28} /><span className="truncate font-medium">{m.name || `${m.id.slice(0, 6)}…`}</span></Link></td>
                  <td className="px-4 py-2 text-right tabnum">{m.posts.toLocaleString('en-US')}</td>
                  <td className="px-4 py-2 text-right tabnum">{m.threads.toLocaleString('en-US')}</td>
                  <td className="px-4 py-2 text-right tabnum">{m.reactionsReceived.toLocaleString('en-US')}</td>
                  <td className="hidden px-4 py-2 text-right text-ink-2 sm:table-cell">{m.joinedAt ? joined.format(m.joinedAt) : ''}</td>
                </tr>
              ))}
              {list.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-ink-2">No members yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
      {archived.length > 0 && (
        <section aria-labelledby="arch" className="space-y-2">
          <h2 id="arch" className="text-lg font-semibold">Archive authors</h2>
          <p className="text-sm text-ink-2">Authors of posts imported from {s.settings.archiveSourceName ?? 'the previous forum'}. They are names from the archive, not Dash identities.</p>
          <ul className="flex flex-wrap gap-2">
            {archived.map((a) => <li key={a.key} className="rounded-md bg-archive-wash px-2.5 py-1 text-sm text-archive">{a.name} <span className="tabnum opacity-75">{a.posts}</span></li>)}
          </ul>
        </section>
      )}
    </div>
  )
}
