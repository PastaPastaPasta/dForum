'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useSession } from '@/lib/session'
import { KeyNotice } from '@/components/site/KeyNotice'
import { LOGIN_AVAILABLE } from '@/lib/host'
import { saveProfile } from '@/lib/forum/actions'
import { str } from '@/lib/forum/model'
import { queryPage } from '@/lib/live/platform'
import { writeFailureMessage } from '@/lib/services/write-errors'
import { Avatar } from '@/components/ui/Avatar'

const FIELDS = [
  { key: 'displayName', label: 'Display name', max: 40, hint: 'Shown on your posts. Names are not unique; your identity id is.' },
  { key: 'location', label: 'Location', max: 60 },
  { key: 'website', label: 'Website', max: 200, hint: 'Starts with https:// or http://' },
  { key: 'avatarUrl', label: 'Avatar image URL', max: 300, hint: 'An https:// image. Leave empty for initials.' },
  { key: 'bio', label: 'About you', max: 1000, area: true, hint: 'Markdown supported.' },
  { key: 'signature', label: 'Signature', max: 300, area: true, hint: 'Shown under each of your posts.' },
] as const

type Draft = Record<(typeof FIELDS)[number]['key'], string>
const EMPTY: Draft = { displayName: '', location: '', website: '', avatarUrl: '', bio: '', signature: '' }

function validate(d: Draft): string | null {
  if (!d.displayName.trim()) return 'Enter a display name.'
  if (d.website && !/^https?:\/\/\S+$/.test(d.website.trim())) return 'The website must start with https:// or http://.'
  if (d.avatarUrl && !/^https:\/\/\S+$/.test(d.avatarUrl.trim())) return 'The avatar URL must start with https://.'
  return null
}

export default function SettingsPage() {
  const { session, ready, signOut, keyState } = useSession()
  const [draft, setDraft] = useState<Draft>(EMPTY)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    if (!session) return
    let alive = true
    queryPage('profile', { where: [['$ownerId', '==', session.identityId]], limit: 1 })
      .then(({ docs }) => {
        if (!alive) return
        const p = docs[0]
        if (p) setDraft((cur) => (cur === EMPTY ? (Object.fromEntries(FIELDS.map((f) => [f.key, str(p, f.key) ?? ''])) as Draft) : cur))
        setState('ready')
      })
      .catch(() => alive && setState('error'))
    return () => { alive = false }
  }, [session])

  if (!ready) return <p role="status" className="py-10 text-center text-ink-2">Loading…</p>
  if (!session) {
    return (
      <div className="panel mx-auto max-w-md p-8 text-center">
        <h1 className="text-xl font-semibold">Settings</h1>
        <p className="mt-2 text-ink-2">Log in to edit your profile.</p>
        {LOGIN_AVAILABLE && <Link href="/login/?next=/settings/" className="btn btn-primary mt-4">Log in with Dash</Link>}
      </div>
    )
  }

  const save = async () => {
    const problem = validate(draft)
    if (problem) { setMessage({ ok: false, text: problem }); return }
    if (!session.authKeyWif) return
    setSaving(true)
    setMessage(null)
    try {
      await saveProfile({ identityId: session.identityId, authKeyWif: session.authKeyWif }, draft)
      setMessage({ ok: true, text: 'Profile saved to Dash Platform.' })
    } catch (e) {
      const f = writeFailureMessage(e)
      setMessage({ ok: false, text: f.message })
      if (f.sessionLogout) void signOut()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      <section className="panel space-y-4 p-5" aria-labelledby="profile-h">
        <div className="flex items-center gap-4">
          <Avatar seed={session.identityId} name={draft.displayName || session.identityId} src={draft.avatarUrl} size={64} />
          <div className="min-w-0">
            <h2 id="profile-h" className="font-semibold">Public profile</h2>
            <p className="truncate font-mono text-xs text-ink-2">{session.identityId}</p>
          </div>
        </div>
        {state === 'loading' && <p role="status" className="text-ink-2"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" />Loading your profile from Dash Platform…</p>}
        {state === 'error' && <p role="alert" className="text-danger">Couldn&apos;t load your profile from Dash Platform, so editing is paused to avoid overwriting it. Reload the page to try again.</p>}
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void save() }}>
          <fieldset disabled={state !== 'ready'} className="space-y-4 disabled:opacity-60">
          {FIELDS.map((f) => (
            <label key={f.key} className="block">
              <span className="text-sm font-medium">{f.label}</span>
              {'area' in f && f.area ? (
                <textarea className="field mt-1 min-h-[6rem]" maxLength={f.max} value={draft[f.key]} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })} />
              ) : (
                <input className="field mt-1" maxLength={f.max} value={draft[f.key]} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })} />
              )}
              {'hint' in f && f.hint && <span className="mt-1 block text-xs text-ink-2">{f.hint}</span>}
            </label>
          ))}
          <KeyNotice />
          <div className="flex flex-wrap items-center gap-3">
            <button className="btn btn-primary" disabled={saving || state === 'loading' || keyState !== 'ready'}>{saving ? 'Saving…' : 'Save profile'}</button>
            <Link href={`/u/${session.identityId}/`} className="link text-sm">View your profile</Link>
          </div>
          {message && <p role={message.ok ? 'status' : 'alert'} className={message.ok ? 'text-live' : 'text-danger'}>{message.text}</p>}
          </fieldset>
        </form>
      </section>
      <section className="panel space-y-2 p-5 text-sm" aria-labelledby="session-h">
        <h2 id="session-h" className="font-semibold">This browser</h2>
        <p className="text-ink-2">This tab holds a forum-only key your wallet created. Logging out removes it from this tab. To revoke the key itself, disconnect the forum in your Dash wallet.</p>
        <button type="button" className="btn btn-quiet" onClick={() => void signOut()}>Log out</button>
      </section>
    </div>
  )
}
