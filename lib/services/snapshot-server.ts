/**
 * Server-side snapshot accessors. Imported ONLY by server route components
 * (generateStaticParams, generateMetadata, the page components) — client
 * components receive the snapshot as props, so the file is never bundled
 * into client JS and each page's payload carries only its own content.
 *
 * data/snapshot.json is written by scripts/snapshot.mjs (gitignored — rebuilt
 * hourly by CI; a stub is written by scripts/ensure-snapshot-stub.mjs so a
 * fresh clone still builds).
 */
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import snapshotJson from '@/data/snapshot.json'

export interface SnapshotThread {
  id: string
  forumId: string | null
  forumSlug: string | null
  title: string
  tags: string[]
  sticky: boolean
  lockedAt: number | null
  modState: number | null
  ownerId: string | null
  createdAt: number
  updatedAt: number
}

export interface SnapshotCategory {
  id: string
  slug: string | null
  title: string
  description: string
  sort: number
}

export interface SnapshotForum {
  id: string
  categoryId: string | null
  categorySlug: string | null
  slug: string | null
  title: string
  description: string
  sort: number
  archived: boolean
}

export interface Snapshot {
  generatedAt: string | null
  network: string
  contractId: string | null
  counts: { categories: number; forums: number; threads: number; posts: number }
  categories: SnapshotCategory[]
  forums: SnapshotForum[]
  threads: SnapshotThread[]
  /** Resolved display names for listed-thread owners (hidden → "Hidden profile"). */
  profiles: Record<string, string>
  /** True when the live thread scan filled the window before the index ran dry. */
  threadsWindowFilled?: boolean
}

export interface StaticPost {
  id: string
  body: string
  authorId: string | null
  createdAt: number
  updatedAt: number
  modState: number | null
  replyToId: string | null
}

const empty: Snapshot = {
  generatedAt: null,
  network: 'testnet',
  contractId: null,
  counts: { categories: 0, forums: 0, threads: 0, posts: 0 },
  categories: [],
  forums: [],
  threads: [],
  profiles: {},
}

export function loadSnapshot(): Snapshot {
  try {
    const s = snapshotJson as Partial<Snapshot>
    if (s && typeof s === 'object') {
      return {
        ...empty,
        ...s,
        counts: { ...empty.counts, ...(s.counts ?? {}) },
        categories: Array.isArray(s.categories) ? s.categories : [],
        forums: Array.isArray(s.forums) ? s.forums : [],
        threads: Array.isArray(s.threads) ? s.threads : [],
        profiles: (s.profiles && typeof s.profiles === 'object' ? s.profiles : {}) as Record<string, string>,
      }
    }
  } catch {
    // snapshot unavailable at build time — keep the empty defaults
  }
  return empty
}

/** Per-thread static posts shipped by the snapshot (data/posts/<id>.json).
 * Returns [] when the thread has no static posts (or the file is absent). */
export function getStaticPosts(threadId: string): StaticPost[] {
  try {
    const file = join(process.cwd(), 'data', 'posts', `${threadId}.json`)
    if (!existsSync(file)) return []
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}
