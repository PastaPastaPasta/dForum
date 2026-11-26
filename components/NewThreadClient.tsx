'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Send, Loader2, AlertCircle } from 'lucide-react'
import { Navbar } from '@/components/Navbar'
import { Footer } from '@/components/Footer'
import { useSession } from '@/lib/session'
import { query, createDocument } from '@/lib/services/document-service'
import type { Snapshot } from '@/lib/services/snapshot-server'
import { LIMITS } from '@/lib/constants'

interface ForumOption {
  id: string
  slug: string
  title: string
  archived: boolean
}

/** Split/clean tags the same way the contract accepts: ^[a-z0-9-]{1,32}$,
 * ≤5, unique. Invalid ones are reported so the form can reject them instead of
 * letting the chain reject the whole thread. */
function parseTags(raw: string): { valid: string[]; rejected: string[] } {
  const seen = new Set<string>()
  const valid: string[] = []
  const rejected: string[] = []
  for (const part of raw.split(/[,\s#]+/)) {
    const tag = part.trim().toLowerCase()
    if (!tag) continue
    if (!/^[a-z0-9-]{1,32}$/.test(tag)) { rejected.push(tag); continue }
    if (seen.has(tag)) continue
    seen.add(tag)
    valid.push(tag)
  }
  return { valid, rejected }
}

export default function NewThreadClient({ snapshot }: { snapshot: Snapshot }) {
  const router = useRouter()
  const { session, ready } = useSession()
  const snap = snapshot
  // Read in an effect — during prerender there is no window.
  const [forumParam, setForumParam] = useState<string | null>(null)
  useEffect(() => {
    setForumParam(new URLSearchParams(window.location.search).get('forum'))
  }, [])

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
  const [fieldError, setFieldError] = useState<{ forum?: string; title?: string; tags?: string; body?: string } | null>(null)
  // Set once the thread is created — never re-editable. The retry uses the
  // stored id and the stored forum so the opening post matches the thread.
  const [createdThreadId, setCreatedThreadId] = useState('')
  const [createdForumId, setCreatedForumId] = useState('')
  const threadCreated = Boolean(createdThreadId)

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

  // Preselect the forum passed via ?forum= (from a forum page's "new thread").
  useEffect(() => {
    if (!forumParam) return
    const byId = forums.find((f) => f.id === forumParam)
    if (byId) { setForumId(byId.id); return }
    const bySlug = forums.find((f) => f.slug === forumParam)
    if (bySlug) setForumId(bySlug.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forums, forumParam])

  if (!ready) {
    return (
      <>
        <Navbar />
        <main id="main" tabIndex={-1} className="flex-1 flex items-center justify-center px-6">
          <>
            <span className="sr-only" role="status">Loading…</span>
            <Loader2 className="w-6 h-6 animate-spin text-[#4db3ff]" aria-hidden="true" />
          </>
        </main>
        <Footer />
      </>
    )
  }

  if (!session) {
    return (
      <>
        <Navbar />
        <main id="main" tabIndex={-1} className="flex-1 flex items-center justify-center px-6">
          <div className="text-center fade-up">
            <p className="text-sm uppercase tracking-widest text-[#93a1bd]">Login required</p>
            <h1 className="text-2xl font-bold mt-2">Sign in to start a thread</h1>
            <Link href={`/login?next=${encodeURIComponent(`/new${forumParam ? `?forum=${encodeURIComponent(forumParam)}` : ''}`)}`} className="mt-6 btn-primary">Login with Dash</Link>
          </div>
        </main>
        <Footer />
      </>
    )
  }

  const focusField = (name: string) => {
    document.getElementById(name)?.focus()
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    // Already created a thread — the core button routes to the opening-post
    // retry instead of creating a second thread.
    if (threadCreated) {
      await handleFinishOpeningPost()
      return
    }
    const errs: { forum?: string; title?: string; tags?: string; body?: string } = {}
    if (!selected) errs.forum = 'Choose a forum'
    // Tags must match the contract: ^[a-z0-9-]{1,32}$, ≤5, unique — invalid
    // ones are reported, never silently cut.
    const tagList = parseTags(tags)
    const overLimit = tagList.valid.length > LIMITS.maxTags
    if (tagList.rejected.length) errs.tags = `Invalid tag “${tagList.rejected[0]}” — use lowercase letters, numbers and hyphens (1–32 chars).`
    else if (overLimit) errs.tags = `Too many tags — the forum contract allows at most ${LIMITS.maxTags}.`
    else if (tagList.valid.length === 0 && tags.trim()) errs.tags = 'No usable tags — fix the tags or leave the field empty.'
    const titleTrim = title.trim()
    if (titleTrim.length < 3) errs.title = 'A title is required (at least 3 characters)'
    const bodyTrim = body.trim()
    if (!bodyTrim) errs.body = 'An opening post is required — a thread with no posts is never listed.'
    else if (new TextEncoder().encode(bodyTrim).length > LIMITS.bodyMaxBytes) errs.body = `Body is too large — the platform limit is ${LIMITS.bodyMaxBytes} bytes (4000 chars max).`
    if (Object.keys(errs).length) {
      setFieldError(errs)
      const first = ['forum', 'title', 'tags', 'body'].find((k) => errs[k as keyof typeof errs])
      if (first) focusField(first)
      return
    }
    setFieldError(null)
    if (!session || !selected || !titleTrim) return
    if (!session.authKeyWif) {
      setError('Your session has no signable key. Try logging in again.')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const tagList = parseTags(tags).valid

      const thread = await createDocument('thread', session.identityId, session.authKeyWif, {
        forumId: selected.id,
        title: titleTrim.slice(0, LIMITS.title),
        tags: tagList,
      })
      setCreatedThreadId(thread.id)
      setCreatedForumId(selected.id)

      // The opening post is required — a thread with no posts is never listed.
      try {
        await createDocument('post', session.identityId, session.authKeyWif, {
          threadId: thread.id,
          forumId: selected.id,
          body: bodyTrim,
        })
        setCreatedThreadId('')
        setCreatedForumId('')
        router.push(`/t/${encodeURIComponent(thread.id)}`)
        return
      } catch (postError) {
        // The thread exists. Do not create a second one — let the author
        // retry just the opening post (the orphan rule keeps the thread
        // unlisted until the post lands).
        setSubmitting(false)
        setError(
          `Thread created, but the opening post failed: ${postError instanceof Error ? postError.message : 'error'}. Click "Finish opening post" to retry — your thread is already saved.`,
        )
        return
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create thread — try again in a moment')
      setSubmitting(false)
    }
  }

  async function handleFinishOpeningPost() {
    if (!session || !session.authKeyWif || !createdThreadId || !createdForumId) return
    const bodyTrim = body.trim()
    if (!bodyTrim) {
      setError('Write the opening post first, then tap "Finish opening post".')
      return
    }
    if (new TextEncoder().encode(bodyTrim).length > LIMITS.bodyMaxBytes) {
      setError(`Body is too large — the platform limit is ${LIMITS.bodyMaxBytes} bytes.`)
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await createDocument('post', session.identityId, session.authKeyWif, {
        threadId: createdThreadId,
        forumId: createdForumId,
        body: bodyTrim,
      })
      const threadId = createdThreadId
      setCreatedThreadId('')
      setCreatedForumId('')
      setBody('')
      router.push(`/t/${encodeURIComponent(threadId)}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Opening post failed — try again in a moment')
      setSubmitting(false)
    }
  }

  return (
    <>
      <Navbar />
      <main id="main" tabIndex={-1} className="flex-1">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
          <Link href="/" className="text-sm text-[#93a1bd] hover:text-white transition">← Back to dForum</Link>
          <h1 className="mt-2 text-2xl sm:text-3xl font-bold tracking-tight">Start a thread</h1>
          <p className="mt-1 text-sm text-[#93a1bd]">Posts are stored on-chain — think it through before you send.</p>

          <form noValidate onSubmit={handleSubmit} className="mt-6 space-y-5">
            <div>
              <label htmlFor="forum" className="text-sm font-medium text-[#93a1bd]">Forum</label>
              <select
                id="forum"
                value={forumId}
                onChange={(e) => setForumId(e.target.value)}
                disabled={threadCreated}
                aria-invalid={Boolean(fieldError?.forum)}
                aria-describedby={fieldError?.forum ? 'forum-error' : undefined}
                className="mt-1.5 w-full rounded-lg border border-input bg-[#111a2e] px-3 py-2.5 text-sm focus:border-[#008CE7] disabled:opacity-60"
              >
                <option value="">Choose a forum…</option>
                {forumOptions.map((f) => (
                  <option key={f.id} value={f.id}>{f.title}</option>
                ))}
              </select>
              {fieldError?.forum ? (
                <p id="forum-error" className="mt-1.5 text-xs text-red-400">{fieldError.forum}</p>
              ) : forumOptions.length === 0 ? (
                <p className="mt-1.5 text-xs text-amber-400">No forums available yet.</p>
              ) : null}
            </div>

            <div>
              <label htmlFor="title" className="text-sm font-medium text-[#93a1bd]">Title</label>
              <input
                id="title"
                maxLength={LIMITS.title}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={threadCreated}
                placeholder="Give your thread a clear, specific title"
                aria-invalid={Boolean(fieldError?.title)}
                aria-describedby={fieldError?.title ? 'title-error' : undefined}
                className="mt-1.5 w-full rounded-lg border border-input bg-[#111a2e] px-3 py-2.5 text-sm focus:border-[#008CE7] disabled:opacity-60"
              />
              {fieldError?.title ? (
                <p id="title-error" className="mt-1 text-xs text-red-400">{fieldError.title}</p>
              ) : (
                <p className="mt-1 text-xs text-[#93a1bd] text-right">{title.length}/{LIMITS.title}</p>
              )}
            </div>

            <div>
              <label htmlFor="tags" className="text-sm font-medium text-[#93a1bd]">Tags</label>
              <input
                id="tags"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                disabled={threadCreated}
                placeholder="announcement, discussion, feature"
                aria-invalid={Boolean(fieldError?.tags)}
                aria-describedby={fieldError?.tags ? 'tags-error' : undefined}
                className="mt-1.5 w-full rounded-lg border border-input bg-[#111a2e] px-3 py-2.5 text-sm placeholder:text-[#93a1bd] focus:border-[#008CE7] disabled:opacity-60"
              />
              {fieldError?.tags ? (
                <p id="tags-error" className="mt-1 text-xs text-red-400">{fieldError.tags}</p>
              ) : (
                <p className="mt-1 text-xs text-[#93a1bd]">Comma, space or # separated — up to {LIMITS.maxTags}. Lowercase, digits and hyphens (max 32 chars).</p>
              )}
            </div>

            <div>
              <label htmlFor="body" className="text-sm font-medium text-[#93a1bd]">Opening post</label>
              <textarea
                id="body"
                rows={6}
                maxLength={LIMITS.body}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="What would you like to discuss?"
                aria-invalid={Boolean(fieldError?.body)}
                aria-describedby={fieldError?.body ? 'body-error' : undefined}
                className="mt-1.5 w-full rounded-lg border border-input bg-[#111a2e] p-3 text-sm placeholder:text-[#93a1bd] focus:border-[#008CE7] resize-y"
              />
              {fieldError?.body ? (
                <p id="body-error" className="mt-1 text-xs text-red-400">{fieldError.body}</p>
              ) : (
                <p className="mt-1 text-xs text-[#93a1bd] text-right">{new TextEncoder().encode(body.trim()).length}/{LIMITS.bodyMaxBytes} bytes</p>
              )}
            </div>

            {error && (
              <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
                <span className="flex-1">{error}</span>
              </div>
            )}

            <button
              type="submit"
              aria-disabled={submitting}
              className="w-full btn-primary justify-center px-5 py-3 font-semibold aria-disabled:opacity-50 aria-disabled:cursor-not-allowed"
            >
              {submitting ? <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" /> : <Send className="w-5 h-5" aria-hidden="true" />}
              {threadCreated ? 'Finish opening post' : submitting ? 'Creating…' : 'Start thread'}
            </button>
          </form>
        </div>
      </main>
      <Footer />
    </>
  )
}
