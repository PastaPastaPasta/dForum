/**
 * Build-time snapshot for the static shell.
 *
 * scripts/snapshot.mjs writes data/snapshot.json at build time. The static
 * pages render from it; the session-aware LiveSection re-queries the platform
 * after hydration. Never throws — falls back to empty data when absent.
 */
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

export interface SnapshotPost {
  id: string
  threadId: string | null
  forumId: string | null
  forumSlug: string | null
  body: string
  modState: number | null
  ownerId: string | null
  createdAt: number
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
  counts: { categories: number; forums: number; threads: number; posts: number; reactions: number }
  categories: SnapshotCategory[]
  forums: SnapshotForum[]
  threads: SnapshotThread[]
  posts: SnapshotPost[]
}

const empty: Snapshot = {
  generatedAt: null,
  network: 'testnet',
  contractId: null,
  counts: { categories: 0, forums: 0, threads: 0, posts: 0, reactions: 0 },
  categories: [],
  forums: [],
  threads: [],
  posts: [],
}

try {
  const s = snapshotJson as Partial<Snapshot>
  if (s && typeof s === 'object') {
    Object.assign(empty, s)
  }
} catch {
  // snapshot unavailable at build time — keep the empty defaults
}

export const snapshot: Snapshot = empty

export function loadSnapshot(): Snapshot {
  return snapshot
}
