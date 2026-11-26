'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Send, Loader2, AlertCircle } from 'lucide-react'
import { Navbar } from '@/components/Navbar'
import { Footer } from '@/components/Footer'
import { useSession } from '@/lib/session'
import { query, createDocument } from '@/lib/services/document-service'
import { loadSnapshot } from '@/lib/services/snapshot-service'
import { LIMITS } from '@/lib/constants'

interface ForumOption {
  id: string
  slug: string
  title: string
  archived: boolean
}

export default function NewThreadPage() {
  const router = useRouter()
  const { session, ready } = useSession()
  const snap = loadSnapshot()

  const [forums, setForums] = useState<ForumOption[]>(() =>
    snap.forums
      .filter((f) => !f.archived)
      .map((f) => ({ id: f.id, slug: f.slug ?? '', title: f.title, archived: f.archived })),
  )
  const [forumId, setForumId] = useState('')
  const [title, setTitle] = useState('')
  const [tags, setTags] = useState('')
  const [body, setBody] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Live forum list
  useEffect(() => {
    let cancelled = false
    query('forum', { limit: 50 })
      .then((docs) => {
        if (cancelled) return
        const list = docs
          .filter((f) => !f.properties.archived)
          .map((f) => ({
            id: f.id,
            slug: (f.properties.slug as string) ?? '',
            title: (f.properties.title as string) ?? '',
            archived: Boolean(f.properties.archived),
          }))
        if (list.length) setForums(list)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  const forumOptions = useMemo(() => forums, [forums])
  const selected = forumOptions.find((f) => f.id === forumId)

  if (ready && !session) {
    return (
      <>
        <Navbar />
        <main className="flex-1 flex items-center justify-center px-6">
          <div className="text-center fade-up">
            <p className="text-sm uppercase tracking-widest text-[#93a1bd]">Login required</p>
            <h1 className="text-2xl font-bold mt-2">Sign in to start a thread</h1>
            <Link href="/login" className="mt-6 inline-block rounded-lg bg-[#008CE7] px-4 py-2 font-medium text-white hover:bg-[#006bb3] transition">Login with Dash</Link>
          </div>
        </main>
        <Footer />
      </>
    )
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!session || !selected || !title.trim()) return
    if (!session.authKeyWif) {
      setError('Your session has no signable key. Try logging in again.')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const tagList = tags
        .split(/[,\s#]+/)
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean)
        .slice(0, LIMITS.maxTags)

      const thread = await createDocument('thread', session.identityId, session.authKeyWif, {
        forumId: selected.id,
        title: title.trim().slice(0, LIMITS.title),
        tags: tagList,
      })

      if (body.trim()) {
        await createDocument('post', session.identityId, session.authKeyWif, {
          threadId: thread.id,
          forumId: selected.id,
          body: body.trim().slice(0, LIMITS.body),
        })
      }

      router.push(`/t?id=${thread.id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create thread — try again in a moment')
      setSubmitting(false)
    }
  }

  return (
    <>
      <Navbar />
      <main className="flex-1">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
          <Link href="/" className="text-sm text-[#93a1bd] hover:text-white transition">← Back to dForum</Link>
          <h1 className="mt-2 text-2xl sm:text-3xl font-bold tracking-tight">Start a thread</h1>
          <p className="mt-1 text-sm text-[#93a1bd]">Posts are stored on-chain — think it through before you send.</p>

          <form onSubmit={handleSubmit} className="mt-6 space-y-5">
            <div>
              <label htmlFor="forum" className="text-sm font-medium text-[#93a1bd]">Forum</label>
              <select
                id="forum"
                required
                value={forumId}
                onChange={(e) => setForumId(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-[#22304e] bg-[#111a2e] px-3 py-2.5 text-sm focus:border-[#008CE7] focus:outline-none"
              >
                <option value="">Choose a forum…</option>
                {forumOptions.map((f) => (
                  <option key={f.id} value={f.id}>{f.title}</option>
                ))}
              </select>
              {forumOptions.length === 0 && (
                <p className="mt-1.5 text-xs text-amber-400">No forums available yet.</p>
              )}
            </div>

            <div>
              <label htmlFor="title" className="text-sm font-medium text-[#93a1bd]">Title</label>
              <input
                id="title"
                required
                maxLength={LIMITS.title}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Give your thread a clear, specific title"
                className="mt-1.5 w-full rounded-lg border border-[#22304e] bg-[#111a2e] px-3 py-2.5 text-sm focus:border-[#008CE7] focus:outline-none"
              />
              <p className="mt-1 text-xs text-[#93a1bd] text-right">{title.length}/{LIMITS.title}</p>
            </div>

            <div>
              <label htmlFor="tags" className="text-sm font-medium text-[#93a1bd]">Tags</label>
              <input
                id="tags"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="announcement, discussion, feature"
                className="mt-1.5 w-full rounded-lg border border-[#22304e] bg-[#111a2e] px-3 py-2.5 text-sm placeholder:text-[#93a1bd]/50 focus:border-[#008CE7] focus:outline-none"
              />
              <p className="mt-1 text-xs text-[#93a1bd]">Comma, space or # separated — up to {LIMITS.maxTags}.</p>
            </div>

            <div>
              <label htmlFor="body" className="text-sm font-medium text-[#93a1bd]">Opening post <span className="text-[#93a1bd]/70 font-normal">(optional)</span></label>
              <textarea
                id="body"
                rows={6}
                maxLength={LIMITS.body}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="What would you like to discuss?"
                className="mt-1.5 w-full rounded-lg border border-[#22304e] bg-[#111a2e] p-3 text-sm placeholder:text-[#93a1bd]/50 focus:border-[#008CE7] focus:outline-none resize-y"
              />
              <p className="mt-1 text-xs text-[#93a1bd] text-right">{body.length}/{LIMITS.body}</p>
            </div>

            {error && (
              <div className="flex items-start gap-2 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={submitting || !forumId || !title.trim()}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[#008CE7] hover:bg-[#006bb3] transition px-5 py-3 font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
              {submitting ? 'Creating…' : 'Start thread'}
            </button>
          </form>
        </div>
      </main>
      <Footer />
    </>
  )
}
