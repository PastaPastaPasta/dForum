/**
 * Shapes shared by the snapshot builder (Node) and the app (browser). Documents are kept in a
 * normalized raw form so the client can merge live deltas into snapshot data and recompute every
 * view with the same rules (lib/forum/model.ts).
 */

export interface RawDoc {
  id: string
  ownerId: string
  revision: number
  createdAt: number
  updatedAt: number
  /** $moderatedAt — set only by moderator changeFields. */
  moderatedAt?: number
  /** $moderatedBy — the moderator of the latest change. */
  moderatedBy?: string
  /** Non-system properties: identifiers as base58, everything else JSON-plain. */
  p: Record<string, unknown>
}

export interface ForumSettings {
  name: string
  tagline?: string
  description?: string
  rules?: string
  announcement?: string
  archiveOwnerId?: string
  archiveTrustUntil?: number
  archiveSourceName?: string
  archiveSourceUrl?: string
}

export interface CategoryView {
  id: string
  slug: string
  title: string
  description?: string
  sort: number
}

export interface LastPost {
  postId: string
  threadId: string
  threadTitle: string
  at: number
  authorId: string
  /** Set when the post is a trusted archive post. */
  archiveAuthor?: string
}

export interface ForumView {
  id: string
  categoryId: string
  parentForumId?: string
  slug: string
  title: string
  description?: string
  sort: number
  archived: boolean
  threadCount: number
  postCount: number
  lastPost?: LastPost
}

export interface ThreadSummary {
  id: string
  forumId: string
  title: string
  tags: string[]
  ownerId: string
  archiveAuthor?: string
  origId?: number
  createdAt: number
  sticky: boolean
  locked: boolean
  replies: number
  /** Posts on the thread pages, hidden placeholders included (sets the page count). */
  posts?: number
  reactions: number
  lastPostAt: number
  lastPostAuthorId: string
  lastPostArchiveAuthor?: string
  lastPostId?: string
}

/** Reaction counts per kind, keyed by kind number. */
export type ReactionCounts = Record<number, number>

export interface ThreadFile {
  thread: RawDoc
  forumId: string
  /** Opening post first, then replies in effective-date order. Hidden posts are kept as
   * placeholders (body stripped) so permalinks and numbering stay stable. */
  posts: RawDoc[]
  reactions: Record<string, ReactionCounts>
}

export interface MemberView {
  id: string
  name: string
  dpns?: string
  title?: string
  avatarUrl?: string
  bio?: string
  signature?: string
  website?: string
  location?: string
  joinedAt: number
  posts: number
  threads: number
  reactionsReceived: number
  hidden?: boolean
}

export interface ArchiveMemberView {
  key: string
  name: string
  origAuthorId?: number
  posts: number
  threads: number
  firstAt: number
  lastAt: number
}

export interface SiteFile {
  version: 2
  network: string
  contractId: string
  generatedAt: number
  /** Platform block time the snapshot is consistent with; live deltas query from here. */
  snapshotAt: number
  settings: ForumSettings
  ownerId: string
  moderators: string[]
  team: Array<{ memberId: string; role: string; sort: number }>
  categories: CategoryView[]
  forums: ForumView[]
  stats: { threads: number; posts: number; members: number; archivePosts: number }
  latestThreads: ThreadSummary[]
  latestPosts: Array<LastPost & { forumId: string; excerpt: string }>
  newestMember?: { id: string; name: string }
  tags: Array<{ tag: string; count: number }>
}

export interface ForumFile {
  forumId: string
  threads: ThreadSummary[]
}

export interface UserFile {
  member: MemberView
  threads: ThreadSummary[]
  posts: Array<LastPost & { forumId: string; excerpt: string }>
}

export const REACTIONS = [
  { kind: 1, key: 'like', label: 'Like', emoji: '👍' },
  { kind: 2, key: 'love', label: 'Love', emoji: '❤️' },
  { kind: 3, key: 'haha', label: 'Haha', emoji: '😂' },
  { kind: 4, key: 'wow', label: 'Wow', emoji: '😮' },
  { kind: 5, key: 'sad', label: 'Sad', emoji: '😢' },
  { kind: 6, key: 'thanks', label: 'Thanks', emoji: '🙏' },
] as const

export const POSTS_PER_PAGE = 20
export const THREADS_PER_PAGE = 30
