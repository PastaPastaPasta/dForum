/**
 * Build-time reads of the snapshot (data/, written by scripts/snapshot.mjs). Server components
 * only: client components get what they need as props.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { archiveRef } from '@/lib/forum/model'
import type { ArchiveMemberView, ForumFile, ForumView, MemberView, SiteFile, ThreadFile, UserFile } from '@/lib/forum/types'

const DATA = join(process.cwd(), 'data')
const cache = new Map<string, unknown>()

function read<T>(rel: string): T | null {
  if (cache.has(rel)) return cache.get(rel) as T
  const path = join(DATA, rel)
  const value = existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as T) : null
  cache.set(rel, value)
  return value
}

export function site(): SiteFile {
  const s = read<SiteFile>('site.json')
  if (!s) throw new Error('data/site.json missing — run scripts/ensure-snapshot-stub.mjs or scripts/snapshot.mjs')
  return s
}

export const forumFile = (forumId: string) => read<ForumFile>(`forum/${forumId}.json`)
export const threadFile = (threadId: string) => read<ThreadFile>(`thread/${threadId}.json`)
export const userFile = (id: string) => read<UserFile>(`user/${id}.json`)
export const members = () => read<MemberView[]>('members.json') ?? []
export const archiveMembers = () => read<ArchiveMemberView[]>('archive-members.json') ?? []

export function threadIds(): string[] {
  const dir = join(DATA, 'thread')
  return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)) : []
}

export function forumBySlug(slug: string): ForumView | undefined {
  return site().forums.find((f) => f.slug === slug)
}

export function forumById(id: string): ForumView | undefined {
  return site().forums.find((f) => f.id === id)
}

/** Compact id → name map of every member the page might mention. */
export function memberNames(ids: Iterable<string>): Record<string, string> {
  const wanted = new Set(ids)
  const out: Record<string, string> = {}
  for (const m of members()) if (wanted.has(m.id) && m.name) out[m.id] = m.name
  return out
}

export function memberCards(ids: Iterable<string>): Record<string, MemberView> {
  const wanted = new Set(ids)
  const out: Record<string, MemberView> = {}
  for (const m of members()) if (wanted.has(m.id)) out[m.id] = m
  return out
}

/** What the live layer needs to apply the reader rules in the browser. */
export function liveContext(): import('@/lib/forum/live-merge').LiveContextProps {
  const s = site()
  return {
    snapshotAt: s.snapshotAt,
    archive: archiveRef(s.settings),
    archivedForums: s.forums.filter((f) => f.archived).map((f) => f.id),
    staff: [...new Set([s.ownerId, ...s.moderators].filter(Boolean))],
  }
}
