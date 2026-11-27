import { describe, it, expect, vi, beforeEach } from 'vitest'
import bs58 from 'bs58'

// The cursor must come from the raw page keys (base58), never from reading a
// Uint8Array $id off the doc objects — that bug made every second page fail.
const fakePage = new Map([
  [bs58.encode(Uint8Array.from([1, 2, 3])), { some: 'doc1', toObject: () => ({ $id: Uint8Array.from([1, 2, 3]) }) }],
  [bs58.encode(Uint8Array.from([4, 5, 6])), { some: 'doc2', toObject: () => ({ $id: Uint8Array.from([4, 5, 6]) }) }],
])
const fakeSdk = {
  documents: {
    query: vi.fn(async () => fakePage),
  },
}

vi.mock('@/lib/services/evo-sdk-service', () => ({
  getSdk: vi.fn(async () => fakeSdk),
  getSdkClasses: vi.fn(async () => ({ Document: null, IdentitySigner: null })),
}))

import { queryRaw } from '@/lib/services/document-service'

beforeEach(() => {
  fakeSdk.documents.query.mockClear()
})

describe('queryRaw — startAfter cursor and raw page size', () => {
  it('uses the last raw page key as the cursor and page.size as rawCount', async () => {
    const { docs, rawCount, lastId } = await queryRaw('thread', { limit: 2 })
    expect(rawCount).toBe(2)
    expect(lastId).toBe(bs58.encode(Uint8Array.from([4, 5, 6])))
    expect(lastId).toMatch(/^[1-9A-HJ-NP-Za-km-z]+$/)
  })

  it('does not derive the cursor from a Uint8Array $id (comma-joined garbage)', async () => {
    const { lastId } = await queryRaw('thread', { limit: 2 })
    // The old buggy output looked like "1,2,3" — rejected by the SDK.
    expect(lastId).not.toMatch(/,/)
  })
})
