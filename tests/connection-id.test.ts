import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ensureConnectionId, getConnectionId } from '@/lib/app-connect/connection-id'

const store = new Map<string, string>()

beforeEach(() => {
  store.clear()
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, value) },
      removeItem: (key: string) => { store.delete(key) },
    },
  })
})

describe('connection id', () => {
  it('generates a 16-byte hex id and keeps it across calls', () => {
    const first = ensureConnectionId()
    expect(first).toMatch(/^[0-9a-f]{32}$/)
    expect(getConnectionId()).toBe(first)
    expect(ensureConnectionId()).toBe(first)
  })

  it('refuses a malformed stored value', () => {
    store.set('dforum:app-connect:connection-id', 'not-hex')
    const fresh = ensureConnectionId()
    expect(fresh).toMatch(/^[0-9a-f]{32}$/)
    expect(fresh).not.toBe('not-hex')
  })
})
