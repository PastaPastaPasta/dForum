import { describe, it, expect } from 'vitest'
import bs58 from 'bs58'
import { compareIds, beforePost, openingPostFromPosts } from '@/lib/services/orphan'

function idOf(bytes: number[]): string {
  return bs58.encode(Uint8Array.from(bytes))
}

describe('compareIds — byte-order tie-break', () => {
  it('orders by decoded bytes, not base58 strings', () => {
    // base58 sorts lexicographically by the encoded string; byte order is the chain's order.
    const a = idOf([0x01, 0x99])
    const b = idOf([0x02, 0x00])
    expect(compareIds(a, b)).toBeLessThan(0)
    expect(compareIds(b, a)).toBeGreaterThan(0)
    expect(compareIds(a, a)).toBe(0)
  })

  it('falls back to string order for unparseable ids', () => {
    expect(compareIds('zz', 'aa')).toBeGreaterThan(0)
    expect(compareIds('aa', 'aa')).toBe(0)
  })
})

describe('beforePost — (createdAt, id) ordering', () => {
  it('orders by createdAt first', () => {
    const older = { id: 'z', createdAt: 1 }
    const newer = { id: 'a', createdAt: 2 }
    expect(beforePost(older, newer)).toBe(true)
    expect(beforePost(newer, older)).toBe(false)
  })

  it('breaks createdAt ties by byte-order id', () => {
    const a = { id: idOf([0x01]), createdAt: 5 }
    const b = { id: idOf([0x02]), createdAt: 5 }
    expect(beforePost(a, b)).toBe(true)
    expect(beforePost(b, a)).toBe(false)
  })
})

describe('openingPostFromPosts — earliest owner post wins', () => {
  const mk = (id: string, ownerId: string, createdAt: number) => ({
    id,
    ownerId,
    createdAt,
    properties: {},
  })

  it('picks the earliest post owned by the thread owner', () => {
    const posts = [
      mk('3', 'owner', 30),
      mk('1', 'someone-else', 10),
      mk('2', 'owner', 20),
    ]
    const opening = openingPostFromPosts(posts, 'owner')
    expect(opening?.id).toBe('2')
  })

  it('ignores posts by non-owners entirely', () => {
    const posts = [mk('1', 'someone-else', 10)]
    expect(openingPostFromPosts(posts, 'owner')).toBeNull()
  })

  it('breaks exact-createdAt ties by id', () => {
    const posts = [
      { id: idOf([0x02]), ownerId: 'owner', createdAt: 10, properties: {} },
      { id: idOf([0x01]), ownerId: 'owner', createdAt: 10, properties: {} },
    ]
    const opening = openingPostFromPosts(posts, 'owner')
    expect(opening?.id).toBe(idOf([0x01]))
  })
})
