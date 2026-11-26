/** Domain types for the forum. Raw documents arrive as `Uint8Array`/`string` mixes;
 *  these are the app's plain shapes. */

export interface Category {
  id: string
  slug: string
  title: string
  description: string
  sort: number
  createdAt: number
}

export interface Forum {
  id: string
  categoryId: string
  slug: string
  title: string
  description: string
  sort: number
  archived: boolean
  createdAt: number
}

export interface Thread {
  id: string
  forumId: string
  title: string
  tags: string[]
  sticky: boolean
  lockedAt: number | null
  modState: number | null
  modNote: string | null
  createdAt: number
  updatedAt: number
  ownerId: string
}

export interface Post {
  id: string
  threadId: string
  forumId: string
  body: string
  replyToId: string | null
  modState: number | null
  modNote: string | null
  createdAt: number
  updatedAt: number
  ownerId: string
}

export interface Reaction {
  id: string
  postId: string
  postOwnerId: string
  threadId: string
  kind: number
  createdAt: number
  ownerId: string
}

export interface Report {
  id: string
  postId: string
  threadId: string
  reason: number
  note: string
  status: number | null
  resolution: string | null
  createdAt: number
  ownerId: string
}

export interface Profile {
  id: string
  displayName: string
  bio: string
  signature: string
  avatarUrl: string
  website: string
  customTitle: string | null
  modState: number | null
  createdAt: number
  updatedAt: number
  ownerId: string
}

export interface ForumSettings {
  id: string
  key: string
  name: string
  tagline: string
  description: string
  rules: string
  announcement: string
  hideBannedContent: boolean
}

export interface SessionData {
  identityId: string
  authKeyWif: string | null
  /** Display id for the header avatar — defaults to identityId. */
  username?: string
}
