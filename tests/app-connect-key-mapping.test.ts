import { describe, it, expect } from 'vitest'
import { toAppConnectIdentityKey, toAppConnectIdentityKeys } from '@/lib/app-connect/key-mapping'

function hexKey(hex: string, extra: Record<string, unknown> = {}) {
  return {
    keyId: 7,
    keyTypeNumber: 0,
    purposeNumber: 0,
    securityLevelNumber: 2,
    data: hex,
    ...extra,
  }
}

describe('toAppConnectIdentityKey', () => {
  it('maps a hex ECDSA_SECP256K1 key with singleContract bounds', () => {
    const data = '02'.repeat(1) + 'ab'.repeat(32)
    const bounds = {
      toJSON: () => ({ $type: 'singleContract', id: 'abc123' }),
    }
    const mapped = toAppConnectIdentityKey(hexKey(data, { contractBounds: bounds, totalBudget: 500n, expiresAt: 1234 }))
    expect(mapped).not.toBeNull()
    expect(mapped!.id).toBe(7)
    expect(mapped!.type).toBe(0)
    expect(mapped!.purpose).toBe(0)
    expect(mapped!.securityLevel).toBe(2)
    expect(mapped!.data).toBeInstanceOf(Uint8Array)
    expect(mapped!.data.length).toBe(33)
    expect(mapped!.bounds).toEqual({ kind: 'singleContract', contractId: 'abc123' })
    expect(mapped!.totalBudget).toBe(500n)
    expect(mapped!.expiresAt).toBe(1234)
  })

  it('maps documentType bounds; an unlabelled documentType is rejected', () => {
    const bounds = { toJSON: () => ({ $type: 'documentType', id: 'abc', documentTypeName: 'thread' }) }
    expect(toAppConnectIdentityKey(hexKey('02ff', { contractBounds: bounds }))!.bounds)
      .toEqual({ kind: 'documentType', contractId: 'abc', documentTypeName: 'thread' })
    const broken = { toJSON: () => ({ $type: 'documentType', id: 'abc' }) }
    expect(toAppConnectIdentityKey(hexKey('02ff', { contractBounds: broken }))).toBeNull()
  })

  it('maps contractGroup bounds', () => {
    const bounds = { toJSON: () => ({ $type: 'contractGroup', id: 'grp' }) }
    expect(toAppConnectIdentityKey(hexKey('02ff', { contractBounds: bounds }))!.bounds)
      .toEqual({ kind: 'contractGroup', groupId: 'grp' })
  })

  it('returns null for unreadable data or an unknown bounds kind', () => {
    expect(toAppConnectIdentityKey(hexKey('!!!!'))).toBeNull()
    const weird = { toJSON: () => ({ $type: 'somethingElse', id: 'x' }) }
    expect(toAppConnectIdentityKey(hexKey('02ff', { contractBounds: weird }))).toBeNull()
  })

  it('keeps disabledAt and rejects nothing when omitted', () => {
    const mapped = toAppConnectIdentityKey(hexKey('02ff'))
    expect(mapped!.disabledAt).toBeUndefined()
    const dis = toAppConnectIdentityKey(hexKey('02ff', { disabledAt: 99n }))
    expect(dis!.disabledAt).toBe(99)
  })

  it('toAppConnectIdentityKeys drops unreadable entries instead of throwing', () => {
    const good = hexKey('02ff')
    const bad = hexKey('!!!!')
    const mapped = toAppConnectIdentityKeys([good, bad])
    expect(mapped).toHaveLength(1)
    expect(mapped[0].id).toBe(7)
  })
})
