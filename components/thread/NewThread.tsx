'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import type { CategoryView, ForumView } from '@/lib/forum/types'
import { createThread } from '@/lib/forum/actions'
import { normalizeTagInput } from '@/lib/forum/tags'
import { useSession } from '@/lib/session'
import { LOGIN_AVAILABLE } from '@/lib/host'
import { writeFailureMessage } from '@/lib/services/write-errors'
import { Composer } from './Composer'

const DRAFT_KEY = 'dforum:draft:new-thread'

export function NewThread({ categories, forums }: { categories: CategoryView[]; forums: ForumView[] }) {
  const router = useRouter()
  const { session, ready, signOut } = useSession()
  const open = forums.filter((f) => !f.archived)
  const [forumId, setForumId] = useState('')
  const [title, setTitle] = useState('')
  const [tags, setTags] = useState('')
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<{ threadId: string; forumId: string } | null>(null)

  useEffect(() => {
    const slug = new URLSearchParams(location.search).get('forum')
    const f = open.find((x) => x.slug === slug)
    if (f) setForumId(f.id)
    try {
      const d = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? 'null')
      if (d) { setTitle(d.title ?? ''); setTags(d.tags ?? ''); setBody(d.body ?? '') }
    } catch { /* no draft */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ title, tags, body })) } catch { /* storage blocked */ }
  }, [title, tags, body])

  if (!ready) return <p role="status" className="py-10 text-center text-ink-2">Loading…</p>
  if (!session) {
    return (
      <div className="panel mx-auto max-w-md p-8 text-center">
        <h1 className="text-xl font-semibold">Start a thread</h1>
        <p className="mt-2 text-ink-2">Log in with your Dash wallet to post.</p>
        {LOGIN_AVAILABLE && <Link href="/login/?next=/new/" className="btn btn-primary mt-4">Log in with Dash</Link>}
      </div>
    )
  }

  const tagList = normalizeTagInput(tags)
  const titleOk = title.trim().length >= 3 && title.trim().length <= 150
  const submit = async () => {
    if (!forumId) { setError('Choose a forum.'); return }
    if (!titleOk) { setError('The title needs 3 to 150 characters.'); return }
    if (!session.authKeyWif) return
    setBusy(true)
    setError(null)
    try {
      const existingThreadId = pending?.forumId === forumId ? pending.threadId : undefined
      const { threadId } = await createThread({ identityId: session.identityId, authKeyWif: session.authKeyWif },
        { forumId, title, tags: tagList, body, existingThreadId }, (id) => setPending({ threadId: id, forumId }))
      try { localStorage.removeItem(DRAFT_KEY) } catch { /* storage blocked */ }
      router.push(`/t/${threadId}/`)
    } catch (e) {
      const f = writeFailureMessage(e)
      setError(f.message)
      if (f.sessionLogout) void signOut()
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Start a thread</h1>
      <div className="grid gap-4 sm:grid-cols-[16rem_1fr]">
        <label className="block">
          <span className="text-sm font-medium">Forum</span>
          <select className="field mt-1" value={forumId} disabled={!!pending} onChange={(e) => setForumId(e.target.value)}>
            <option value="">Choose a forum…</option>
            {categories.map((c) => {
              const list = open.filter((f) => f.categoryId === c.id)
              return list.length ? (
                <optgroup key={c.id} label={c.title}>
                  {list.map((f) => <option key={f.id} value={f.id}>{f.parentForumId ? `— ${f.title}` : f.title}</option>)}
                </optgroup>
              ) : null
            })}
          </select>
        </label>
        <label className="block">
          <span className="text-sm font-medium">Title</span>
          <input className="field mt-1" value={title} maxLength={150} onChange={(e) => setTitle(e.target.value)} placeholder="What do you want to discuss?" />
        </label>
      </div>
      <label className="block">
        <span className="text-sm font-medium">Tags</span>
        <input className="field mt-1" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="governance, wallet (up to 5)" />
        {tagList.length > 0 && <span className="mt-1 flex flex-wrap gap-1.5">{tagList.map((t) => <span key={t} className="rounded bg-sunk px-1.5 text-xs leading-5">{t}</span>)}</span>}
      </label>
      {pending && !busy && <p className="text-sm text-ink-2">The thread was created; its opening post still needs to be saved. Posting again finishes it.</p>}
      <Composer value={body} onChange={setBody} busy={busy} submitLabel={pending ? 'Save opening post' : 'Post thread'} label="Opening post" placeholder="Write the opening post…" onSubmit={() => void submit()} error={error} />
      <p className="text-sm text-ink-2">Your thread is saved to Dash Platform and shows up for everyone within a few seconds.</p>
    </div>
  )
}
