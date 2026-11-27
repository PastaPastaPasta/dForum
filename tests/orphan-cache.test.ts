import { describe, it, expect, vi, beforeEach } from 'vitest'
import bs58 from 'bs58'

// Mock the document service BEFORE importing orphan.ts — the orphan rule
// reads through queryRaw, so a mocked query freezes live chain state.
vi.mock('@/lib/services/document-service', () => ({
  queryRaw: vi.fn(),
}))

import { queryRaw } from '@/lib/services/document-service'
import { filterListableWithFailures, filterListable, earliestOwnerPost } from '@/lib/services/orphan'

const idOf = (bytes: number[]) => bs58.encode(Uint8Array.from(bytes))

function doc(id: string, ownerId: string, createdAt: number, threadId: string, modState: number | null = null) {
  return {
    id,
    ownerId,
    createdAt,
    updatedAt: createdAt,
    properties: { threadId, modState },
    revision: 1n,
    dataContractId: 'c',
    documentTypeName: 'post',
  }
}

const mocked = queryRaw as ReturnType<typeof vi.fn>

beforeEach(() => {
  mocked.mockReset()
})

describe('filterListableWithFailures — failed checks are reported, not cached as listable', () => {
  it('marks threads whose orphan check throws as failed, and reports them separately', async () => {
    // Thread A: the query succeeds and the opening post exists → listed.
    // Thread B: queryRaw rejects → failed (unknown verdict).
    mocked.mockImplementation(async (type: string, opts: { where?: [string, string, unknown][] }) => {
      const ownerId = opts.where?.[0]?.[2]
      if (ownerId === 'ownerA') {
        const mine = [doc(idOf([0x01]), 'ownerA', 100, 'tA')]
        return { docs: mine, rawCount: 1, lastId: mine[0].id }
      }
      throw new Error('chain unreachable')
    })

    const threads = [
      { id: 'tA', ownerId: 'ownerA', lockedAt: null, createdAt: 100 },
      { id: 'tB', ownerId: 'ownerB', lockedAt: null, createdAt: 100 },
    ]
    const { listed, failed } = await filterListableWithFailures(threads, 4)
    // Fail-open: the failed check keeps the thread in the list — but the
    // caller (the search cache) must NOT cache tB's verdict.
    expect(listed.map((t) => t.id).sort()).toEqual(['tA', 'tB'])
    expect(failed.has('tB')).toBe(true)
    expect(failed.has('tA')).toBe(false)
  })

  it('filterListable keeps the thread on failure (fail-open) and reports nothing', async () => {
    mocked.mockImplementation(async (type: string, opts: { where?: [string, string, unknown][] }) => {
      const ownerId = opts.where?.[0]?.[2]
      if (ownerId === 'ownerA') {
        const mine = [doc(idOf([0x01]), 'ownerA', 100, 'tA')]
        return { docs: mine, rawCount: 1, lastId: mine[0].id }
      }
      throw new Error('chain unreachable')
    })
    const threads = [
      { id: 'tA', ownerId: 'ownerA', lockedAt: null, createdAt: 100 },
      { id: 'tB', ownerId: 'ownerB', lockedAt: null, createdAt: 100 },
    ]
    const listed = await filterListable(threads, 4)
    expect(listed.map((t) => t.id).sort()).toEqual(['tA', 'tB']) // fail-open
  })
})

describe('earliestOwnerPost — raw-count paging (malformed docs must not end the scan)', () => {
  it('continues paging when the raw page is full but normalized docs are fewer', async () => {
    // 25 raw docs on page 1 (25 normalized, e.g. 3 of which were dropped by
    // the normalizer → 22 kept). Page 1 has no opening post in this thread;
    // page 2 has it.
    const page1 = Array.from({ length: 25 }, (_, i) =>
      doc(idOf([i]), 'owner', 100 + i, 'other-thread'))
    // 12 normalized docs for page 1 (25 raw − 13 dropped), rawCount must say 25.
    mocked.mockImplementation(async (type: string, opts: { startAfter?: string }) => {
      if (!opts.startAfter) {
        return { docs: page1.slice(0, 12), rawCount: 25, lastId: idOf([24]) }
      }
      return { docs: [doc(idOf([0xff]), 'owner', 200, 't')], rawCount: 1, lastId: idOf([0xff]) }
    })

    const opening = await earliestOwnerPost('t', 'owner', 0)
    expect(opening?.id).toBe(idOf([0xff]))
    // 2 calls: the full raw page is NOT treated as exhausted.
    expect(mocked).toHaveBeenCalledTimes(2)
  })

  it('returns null when the author has no posts in the thread', async () => {
    mocked.mockImplementation(async () => ({
      docs: [doc(idOf([0x01]), 'owner', 100, 'other-thread')],
      rawCount: 1,
      lastId: idOf([0x01]),
    }))
    const opening = await earliestOwnerPost('t', 'owner', 0)
    expect(opening).toBeNull()
  })

  it('throws (not null) when the page budget is exhausted', async () => {
    const page = Array.from({ length: 25 }, (_, i) =>
      doc(idOf([i]), 'owner', 100 + i, 'other-thread'))
    mocked.mockImplementation(async () => ({
      docs: page.slice(0, 25),
      rawCount: 25,
      lastId: idOf([24]),
    }))
    const { earliestOwnerPost, OrphanScanExhaustedError } = await import('@/lib/services/orphan')
    await expect(earliestOwnerPost('t', 'owner', 0)).rejects.toThrow(OrphanScanExhaustedError)
    // 12 pages attempted (the budget), then the error — never a silent null.
    expect(mocked).toHaveBeenCalledTimes(12)
  })

  it('returns the opening post regardless of its hidden state (visibility is the caller’s job)', async () => {
    mocked.mockImplementation(async () => ({
      docs: [doc(idOf([0x01]), 'owner', 100, 't', 1)],
      rawCount: 1,
      lastId: idOf([0x01]),
    }))
    const opening = await earliestOwnerPost('t', 'owner', 0)
    expect(opening?.id).toBe(idOf([0x01]))
    expect(opening?.modState).toBe(1)
  })
})

describe('hasOpeningPost — visibility rules via earliestOwnerPost', () => {
  it('keeps the thread when opening post is visible', async () => {
    const { hasOpeningPost } = await import('@/lib/services/orphan')
    mocked.mockImplementation(async () => ({
      docs: [doc(idOf([0x01]), 'owner', 100, 't')],
      rawCount: 1,
      lastId: idOf([0x01]),
    }))
    expect(await hasOpeningPost({ id: 't', ownerId: 'owner', lockedAt: null, createdAt: 50 })).toBe(true)
  })

  it('drops the thread when the opening post is hidden', async () => {
    const { hasOpeningPost } = await import('@/lib/services/orphan')
    mocked.mockImplementation(async () => ({
      docs: [doc(idOf([0x01]), 'owner', 100, 't', 1)],
      rawCount: 1,
      lastId: idOf([0x01]),
    }))
    expect(await hasOpeningPost({ id: 't', ownerId: 'owner', lockedAt: null, createdAt: 50 })).toBe(false)
  })

  it('drops the thread when the lock is applied before the opening post', async () => {
    const { hasOpeningPost } = await import('@/lib/services/orphan')
    mocked.mockImplementation(async () => ({
      docs: [doc(idOf([0x01]), 'owner', 100, 't')],
      rawCount: 1,
      lastId: idOf([0x01]),
    }))
    // lockedAt 90 < opening.createdAt 100 → not visible
    expect(await hasOpeningPost({ id: 't', ownerId: 'owner', lockedAt: 90, createdAt: 50 })).toBe(false)
    // lockedAt 100 >= opening.createdAt 100 → visible
    expect(await hasOpeningPost({ id: 't', ownerId: 'owner', lockedAt: 100, createdAt: 50 })).toBe(true)
  })
})
