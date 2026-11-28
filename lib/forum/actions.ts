'use client'

/**
 * Member writes. Every edit re-reads the document first so moderator-owned fields pass through
 * unchanged (an author replace that drops or changes them is refused on chain).
 */
import type { RawDoc } from './types'
import { num, str } from './model'
import { createDocument, get, query, replaceDocument, type DocRef } from '@/lib/services/document-service'
import { injectLocal, refreshLive } from '@/lib/live/overlay'

export interface Signer {
  identityId: string
  authKeyWif: string
}

export const BODY_PART_BYTES = 5120
export const BODY_MAX_BYTES = BODY_PART_BYTES * 2
const enc = new TextEncoder()
export const byteLength = (s: string) => enc.encode(s).length

/** Splits a body into the contract's two 5120-byte parts on a code-point boundary. */
export function splitBody(text: string): { body: string; body2?: string } {
  if (byteLength(text) <= BODY_PART_BYTES) return { body: text }
  let bytes = 0
  let cut = 0
  for (const ch of text) {
    const n = byteLength(ch)
    if (bytes + n > BODY_PART_BYTES) break
    bytes += n
    cut += ch.length
  }
  const body2 = text.slice(cut)
  if (byteLength(body2) > BODY_PART_BYTES) throw new Error('Post is too long (10 KB maximum).')
  return { body: text.slice(0, cut), body2 }
}

function toRaw(d: DocRef): RawDoc {
  return {
    id: d.id,
    ownerId: d.ownerId,
    revision: Number(d.revision),
    createdAt: d.createdAt || Date.now(),
    updatedAt: d.updatedAt || Date.now(),
    p: Object.fromEntries(Object.entries(d.properties).filter(([, v]) => v !== undefined && v !== null)),
  }
}

async function fresh(type: string, id: string): Promise<DocRef> {
  const doc = await get(type, id)
  if (!doc) throw new Error('That document no longer exists.')
  return doc
}

/** Author replace: `changes` values of undefined remove the property. */
async function authorReplace(s: Signer, type: string, id: string, changes: Record<string, unknown>): Promise<RawDoc> {
  const existing = await fresh(type, id)
  if (existing.ownerId !== s.identityId) throw new Error('You can only edit your own posts.')
  const removed = Object.keys(changes).filter((k) => changes[k] === undefined)
  const props = { ...existing.properties }
  for (const k of removed) delete props[k]
  const updated = await replaceDocument({ ...existing, properties: props }, s.identityId, s.authKeyWif,
    Object.fromEntries(Object.entries(changes).filter(([, v]) => v !== undefined)))
  for (const k of removed) delete updated.properties[k]
  return toRaw(updated)
}

/**
 * A thread is two writes. When the opening post fails, the caller keeps the returned threadId
 * (via `onThread`) and retries with `existingThreadId`, so a retry never creates a second thread.
 */
export async function createThread(
  s: Signer,
  input: { forumId: string; title: string; tags: string[]; body: string; existingThreadId?: string },
  onThread?: (threadId: string) => void,
) {
  let threadId = input.existingThreadId
  if (!threadId) {
    const thread = await createDocument('thread', s.identityId, s.authKeyWif, {
      forumId: input.forumId,
      title: input.title.trim(),
      ...(input.tags.length ? { tags: input.tags } : {}),
    })
    threadId = thread.id
    injectLocal('thread', toRaw(thread))
    onThread?.(threadId)
  }
  const post = await createDocument('post', s.identityId, s.authKeyWif, {
    threadId,
    forumId: input.forumId,
    ...splitBody(input.body),
  })
  injectLocal('post', toRaw(post))
  void refreshLive()
  return { threadId, postId: post.id }
}

export async function reply(s: Signer, thread: RawDoc, body: string, replyToId?: string) {
  const post = await createDocument('post', s.identityId, s.authKeyWif, {
    threadId: thread.id,
    forumId: str(thread, 'forumId'),
    ...splitBody(body),
    ...(replyToId ? { replyToId } : {}),
  })
  const raw = toRaw(post)
  injectLocal('post', raw)
  void refreshLive()
  return raw
}

export async function editPost(s: Signer, postId: string, body: string) {
  const parts = splitBody(body)
  const raw = await authorReplace(s, 'post', postId, { body: parts.body, body2: parts.body2 })
  injectLocal('post', raw)
  return raw
}

/** Author delete: posts are not deletable, so the body is replaced and the post marked retracted. */
export async function retractPost(s: Signer, postId: string) {
  const raw = await authorReplace(s, 'post', postId, { body: '(deleted by author)', body2: undefined, retracted: true })
  injectLocal('post', raw)
  return raw
}

export async function editThread(s: Signer, threadId: string, input: { title: string; tags: string[] }) {
  const raw = await authorReplace(s, 'thread', threadId, { title: input.title.trim(), tags: input.tags.length ? input.tags : undefined })
  injectLocal('thread', raw)
  return raw
}

/** One reaction row per (post, member): create it once, then switch kind (0 clears). */
export async function react(s: Signer, post: RawDoc, kind: number): Promise<RawDoc> {
  const [existing] = await query('reaction', { where: [['postId', '==', post.id], ['$ownerId', '==', s.identityId]], limit: 1 })
  let doc: DocRef
  if (existing) {
    if (num(toRaw(existing), 'kind') === kind) return toRaw(existing)
    doc = await replaceDocument(existing, s.identityId, s.authKeyWif, { kind })
  } else {
    if (kind === 0) throw new Error('Nothing to remove.')
    doc = await createDocument('reaction', s.identityId, s.authKeyWif, {
      postId: post.id,
      postOwnerId: post.ownerId,
      threadId: str(post, 'threadId'),
      kind,
    })
  }
  const raw = toRaw(doc)
  injectLocal('reaction', raw)
  return raw
}

export const REPORT_REASONS = [
  { value: 1, label: 'Spam or advertising' },
  { value: 2, label: 'Harassment or abuse' },
  { value: 3, label: 'Scam or phishing' },
  { value: 4, label: 'Off-topic or in the wrong forum' },
  { value: 5, label: 'Illegal content' },
  { value: 8, label: 'Something else' },
] as const

export async function report(s: Signer, post: RawDoc, reason: number, note: string) {
  await createDocument('report', s.identityId, s.authKeyWif, {
    postId: post.id,
    threadId: str(post, 'threadId'),
    reason,
    ...(note.trim() ? { note: note.trim().slice(0, 280) } : {}),
  })
}

export async function saveProfile(s: Signer, fields: Record<string, string>) {
  const clean = Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v.trim()]))
  const [existing] = await query('profile', { where: [['$ownerId', '==', s.identityId]], limit: 1 })
  if (existing) {
    const changes: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(clean)) changes[k] = v === '' && k !== 'displayName' ? undefined : v
    const raw = await authorReplace(s, 'profile', existing.id, changes)
    injectLocal('profile', raw)
    return raw
  }
  const created = await createDocument('profile', s.identityId, s.authKeyWif, Object.fromEntries(Object.entries(clean).filter(([, v]) => v !== '')))
  const raw = toRaw(created)
  injectLocal('profile', raw)
  return raw
}
