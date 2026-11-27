import { describe, it, expect } from 'vitest'
import { compareIds, beforePost, openingPostFromPosts } from '@/lib/services/orphan-rules'

describe('orphan-rules — shared pure helpers (snapshot + live)', () => {
  it('compareIds orders by decoded bytes', () => {
    // bs58: 0x01 → '8', 0x02 → '9' (higher byte = higher string = later)
    expect(compareIds('8', '9')).toBeLessThan(0)
    expect(compareIds('9', '8')).toBeGreaterThan(0)
    expect(compareIds('8', '8')).toBe(0)
  })

  it('beforePost breaks ties by id, createdAt first', () => {
    const a = { createdAt: 100, id: '9' }
    const b = { createdAt: 100, id: '8' }
    const c = { createdAt: 99, id: '9' }
    expect(beforePost(b, a)).toBe(true) // tie on createdAt: lower id wins
    expect(beforePost(a, b)).toBe(false)
    expect(beforePost(c, a)).toBe(true) // earlier createdAt wins
    expect(beforePost(c, b)).toBe(true)
    expect(beforePost(a, a)).toBe(false)
  })

  it('openingPostFromPosts picks the earliest post owned by the owner', () => {
    const posts = [
      { createdAt: 100, id: '9', ownerId: 'owner' },
      { createdAt: 90, id: '9', ownerId: 'someone-else' },
      { createdAt: 120, id: '8', ownerId: 'owner' },
      { createdAt: 95, id: '8', ownerId: 'owner' },
    ]
    const chosen = openingPostFromPosts(posts, 'owner')
    expect(chosen?.id).toBe('8') // the 95ms post beats the 100ms one
  })

  it('openingPostFromPosts returns null when the owner has no posts', () => {
    expect(openingPostFromPosts([{ createdAt: 1, id: '8', ownerId: 'x' }], 'owner')).toBeNull()
    expect(openingPostFromPosts([], 'owner')).toBeNull()
  })

  it('openingPostFromPosts breaks exact-createdAt ties by id', () => {
    const posts = [
      { createdAt: 100, id: '9', ownerId: 'owner' },
      { createdAt: 100, id: '8', ownerId: 'owner' },
    ]
    const chosen = openingPostFromPosts(posts, 'owner')
    expect(chosen?.id).toBe('8')
  })
})
