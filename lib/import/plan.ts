/**
 * Maps crawled XenForo data onto dForum documents. Pure: the importer (scripts/import) and the
 * tests share it.
 */
import { splitMarkdownByBytes } from './to-markdown.ts'

export const BODY_MAX_BYTES = 5120
const CONTINUED = '*(continued)*\n\n'
const enc = new TextEncoder()

export interface CrawledPost {
  origId: number
  author: string
  authorId?: number | null
  createdAt: number
  markdown: string
}

export interface CrawledThread {
  origId: number
  forumOrigId: number
  title: string
  author: string
  createdAt: number
  tags?: string[]
  posts: CrawledPost[]
}

export interface CrawledStructure {
  categories: Array<{ origId: number; title: string; forums: Array<{ origId: number; kind: string; threads: number[] }> }>
}

export interface PostChunk {
  body: string
  body2?: string
}

export function normalizeTags(tags: string[] = []): string[] {
  const out: string[] = []
  for (const t of tags) {
    const slug = t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32)
    if (slug && !out.includes(slug)) out.push(slug)
    if (out.length === 5) break
  }
  return out
}

function clampChars(s: string, min: number, max: number): string {
  const t = [...s.replace(/\s+/g, ' ').trim()]
  const cut = t.length > max ? t.slice(0, max - 1).join('') + '…' : t.join('')
  return cut.length >= min ? cut : cut.padEnd(min, '.')
}

/** Every post becomes one or more documents of up to two 5120-byte parts. */
export function postChunks(post: Pick<CrawledPost, 'markdown'>): PostChunk[] {
  const md = post.markdown.trim() || '*(no content)*'
  const parts = splitMarkdownByBytes(md, BODY_MAX_BYTES - enc.encode(CONTINUED).length)
  const chunks: PostChunk[] = []
  for (let i = 0; i < parts.length; i += 2) {
    const body = (i > 0 ? CONTINUED : '') + parts[i]
    chunks.push(parts[i + 1] !== undefined ? { body, body2: parts[i + 1] } : { body })
  }
  return chunks
}

function provenance(author: string, authorId: number | null | undefined, createdAt: number) {
  return {
    origAuthor: clampChars(author || 'unknown', 1, 50),
    ...(authorId ? { origAuthorId: authorId } : {}),
    origCreatedAt: Math.max(0, Math.round(createdAt)),
  }
}

export function threadDocProps(t: CrawledThread, forumId: string): Record<string, unknown> {
  const first = t.posts[0]
  const tags = normalizeTags(t.tags)
  return {
    forumId,
    title: clampChars(t.title || '(untitled)', 3, 150),
    ...(tags.length ? { tags } : {}),
    origId: t.origId,
    ...provenance(first?.author ?? t.author, first?.authorId, first?.createdAt ?? t.createdAt),
  }
}

export function postDocProps(
  t: CrawledThread,
  p: CrawledPost,
  chunk: PostChunk,
  index: number,
  threadId: string,
  forumId: string,
): Record<string, unknown> {
  return {
    threadId,
    forumId,
    body: chunk.body,
    ...(chunk.body2 ? { body2: chunk.body2 } : {}),
    origId: p.origId * 100 + index,
    ...provenance(p.author, p.authorId, p.createdAt + index),
  }
}

export interface ImportPlan {
  categories: number
  forums: number
  threads: number
  posts: number
  continuations: number
  bytes: number
  estimatedCredits: number
  skipped: Array<{ origId: number; reason: string }>
}

/** Fee model from spike S8: thread ≈ 1.7e8 credits, post ≈ 1.5e8 + ~2e4 per stored byte. */
export function buildImportPlan(structure: CrawledStructure, threads: CrawledThread[]): ImportPlan {
  const plan: ImportPlan = { categories: structure.categories.length, forums: 0, threads: 0, posts: 0, continuations: 0, bytes: 0, estimatedCredits: 0, skipped: [] }
  for (const c of structure.categories) plan.forums += c.forums.filter((f) => f.kind !== 'link').length
  plan.estimatedCredits += plan.categories * 4e7 + plan.forums * 5e7
  for (const t of threads) {
    if (!t.posts.length) {
      plan.skipped.push({ origId: t.origId, reason: `thread ${t.origId} has no posts` })
      continue
    }
    plan.threads += 1
    plan.estimatedCredits += 1.7e8
    for (const p of t.posts) {
      const chunks = postChunks(p)
      plan.posts += 1
      plan.continuations += chunks.length - 1
      for (const ch of chunks) {
        const bytes = enc.encode(ch.body).length + (ch.body2 ? enc.encode(ch.body2).length : 0)
        plan.bytes += bytes
        plan.estimatedCredits += 1.5e8 + bytes * 2e4
      }
    }
  }
  return plan
}
