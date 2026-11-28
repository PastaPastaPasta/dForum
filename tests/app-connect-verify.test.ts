/**
 * Table tests for the App Connect v2 verifier (same code path as
 * verifyAppConnectCandidate — verifyAppConnectKeys takes private keys instead
 * of a decrypted payload). A valid grant passes; every rejection below is
 * asserted by reason AND by retryable/final semantics, which is what the
 * login hook keys on.
 */
import { describe, it, expect } from 'vitest'
import * as secp256k1 from '@noble/secp256k1'
import bs58 from 'bs58'
import {
  verifyAppConnectKeys,
  KeyPurpose,
  KeySecurityLevel,
  KeyType,
  type AppConnectIdentityKey,
  type AppConnectIdentityPort,
  type AppConnectRequest,
} from 'platform-auth'

const CONTRACT_ID_BYTES = new Uint8Array(32).fill(0x42)
const CONTRACT_ID_B58 = bs58.encode(CONTRACT_ID_BYTES)
const NOW = 1_800_000_000_000
const VALID_EXPIRY = NOW + 90 * 24 * 60 * 60 * 1000

function makeRequest(over: Partial<AppConnectRequest> = {}): AppConnectRequest {
  return {
    appEphemeralPubKey: new Uint8Array(33).fill(7),
    appId: new Uint8Array(32).fill(3),
    label: 'dForum',
    authBindings: [
      {
        kind: 'singleContract',
        id: CONTRACT_ID_BYTES,
        securityLevel: KeySecurityLevel.HIGH,
        totalBudget: 50_000_000_000n,
        expiresAt: VALID_EXPIRY,
      },
    ],
    encBindings: [],
    createdAt: NOW,
    connectionId: new Uint8Array(16).fill(9),
    ...over,
  }
}

function makeKey(privateKey: Uint8Array, over: Partial<AppConnectIdentityKey> = {}): AppConnectIdentityKey {
  return {
    id: 11,
    type: KeyType.ECDSA_SECP256K1,
    purpose: KeyPurpose.AUTHENTICATION,
    securityLevel: KeySecurityLevel.HIGH,
    data: new Uint8Array(33).fill(1),
    bounds: { kind: 'singleContract', contractId: CONTRACT_ID_B58 },
    totalBudget: 50_000_000_000n,
    expiresAt: VALID_EXPIRY,
    ...over,
  }
}

function fakeIdentity(keys: AppConnectIdentityKey[], remaining: bigint | null = 10n): AppConnectIdentityPort {
  return {
    async getIdentityFresh() { return { id: 'ownerIdentityId', publicKeys: keys } },
    async remainingBudgets(_id, keyIds) {
      const map = new Map<number, bigint | undefined>()
      if (remaining !== null) for (const id of keyIds) map.set(id, remaining)
      return map
    },
    async contractKeys() { return [] },
    async groupInfo() { return null },
  }
}

function keypair(): { privateKey: Uint8Array; publicKey: Uint8Array } {
  const privateKey = secp256k1.utils.randomSecretKey()
  const publicKey = secp256k1.getPublicKey(privateKey, true)
  return { privateKey, publicKey }
}

function portWith(keys: AppConnectIdentityKey[], remaining: bigint | null = 10n) {
  return fakeIdentity(keys, remaining)
}

describe('verifyAppConnectKeys — valid grant', () => {
  it('accepts a correct singleContract HIGH key', async () => {
    const { privateKey, publicKey } = keypair()
    const key = makeKey(privateKey, { data: publicKey })
    const result = await verifyAppConnectKeys({
      request: makeRequest(),
      ownerId: 'ownerIdentityId',
      identity: portWith([key]),
      now: NOW,
      privateKeys: [privateKey],
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.grant.authKeys).toHaveLength(1)
      expect(result.grant.authKeys[0].role).toBe('singleContract')
      expect(result.grant.authKeys[0].bindingIndex).toBe(0)
    }
  })
})

describe('verifyAppConnectKeys — rejections', () => {
  it('rejects a key bound to a different contract (final)', async () => {
    const { privateKey, publicKey } = keypair()
    const key = makeKey(privateKey, { data: publicKey, bounds: { kind: 'singleContract', contractId: bs58.encode(new Uint8Array(32).fill(0x99)) } })
    const result = await verifyAppConnectKeys({
      request: makeRequest(), ownerId: 'ownerIdentityId', identity: portWith([key]), now: NOW, privateKeys: [privateKey],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) { expect(result.reason).toBe('key-unmatched'); expect(result.retryable).toBe(false) }
  })

  it('rejects MEDIUM (final) and CRITICAL (final) on a HIGH binding', async () => {
    for (const level of [KeySecurityLevel.MEDIUM, KeySecurityLevel.CRITICAL]) {
      const { privateKey, publicKey } = keypair()
      const key = makeKey(privateKey, { data: publicKey, securityLevel: level })
      const result = await verifyAppConnectKeys({
        request: makeRequest(), ownerId: 'ownerIdentityId', identity: portWith([key]), now: NOW, privateKeys: [privateKey],
      })
      expect(result.ok).toBe(false)
      if (!result.ok) { expect(result.reason).toBe('key-level'); expect(result.retryable).toBe(false) }
    }
  })

  it('rejects a disabled key (final)', async () => {
    const { privateKey, publicKey } = keypair()
    const key = makeKey(privateKey, { data: publicKey, disabledAt: NOW - 1000 })
    const result = await verifyAppConnectKeys({
      request: makeRequest(), ownerId: 'ownerIdentityId', identity: portWith([key]), now: NOW, privateKeys: [privateKey],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) { expect(result.reason).toBe('key-disabled'); expect(result.retryable).toBe(false) }
  })

  it('rejects a key inside the expiry margin (final)', async () => {
    const { privateKey, publicKey } = keypair()
    const key = makeKey(privateKey, { data: publicKey, expiresAt: NOW + 30 * 60 * 1000 }) // 30 min, margin 60 min
    const result = await verifyAppConnectKeys({
      request: makeRequest(), ownerId: 'ownerIdentityId', identity: portWith([key]), now: NOW, privateKeys: [privateKey],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) { expect(result.reason).toBe('key-expired'); expect(result.retryable).toBe(false) }
  })

  it('rejects a missing budget on a budget-required binding (final)', async () => {
    const { privateKey, publicKey } = keypair()
    const key = makeKey(privateKey, { data: publicKey, totalBudget: undefined })
    const result = await verifyAppConnectKeys({
      request: makeRequest(), ownerId: 'ownerIdentityId', identity: portWith([key]), now: NOW, privateKeys: [privateKey],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) { expect(result.reason).toBe('key-limits'); expect(result.retryable).toBe(false) }
  })

  it('rejects a missing expiry on an expiry-carrying binding (final)', async () => {
    const { privateKey, publicKey } = keypair()
    const key = makeKey(privateKey, { data: publicKey, expiresAt: undefined })
    const result = await verifyAppConnectKeys({
      request: makeRequest(), ownerId: 'ownerIdentityId', identity: portWith([key]), now: NOW, privateKeys: [privateKey],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) { expect(result.reason).toBe('key-limits'); expect(result.retryable).toBe(false) }
  })

  it('rejects an unknown key (retryable)', async () => {
    const { privateKey } = keypair()
    const result = await verifyAppConnectKeys({
      request: makeRequest(), ownerId: 'ownerIdentityId', identity: portWith([]), now: NOW, privateKeys: [privateKey],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) { expect(result.reason).toBe('key-not-found'); expect(result.retryable).toBe(true) }
  })

  it('rejects more slots than bindings as framing (final)', async () => {
    const { privateKey, publicKey } = keypair()
    const key = makeKey(privateKey, { data: publicKey })
    const result = await verifyAppConnectKeys({
      request: makeRequest(), ownerId: 'ownerIdentityId', identity: portWith([key]), now: NOW,
      privateKeys: [privateKey, privateKey],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) { expect(result.reason).toBe('framing'); expect(result.retryable).toBe(false) }
  })

  it('rejects a request whose primary binding is missing (final)', async () => {
    const { privateKey, publicKey } = keypair()
    const key = makeKey(privateKey, { data: publicKey })
    // Two-binding request: the key matches only the SECOND binding (a different
    // contract), so no primary-binding match exists.
    const otherId = new Uint8Array(32).fill(0x77)
    const request = makeRequest({
      authBindings: [
        { kind: 'singleContract', id: CONTRACT_ID_BYTES, securityLevel: KeySecurityLevel.HIGH, totalBudget: 50_000_000_000n, expiresAt: VALID_EXPIRY },
        { kind: 'singleContract', id: otherId, securityLevel: KeySecurityLevel.HIGH, totalBudget: 50_000_000_000n, expiresAt: VALID_EXPIRY },
      ],
    })
    const otherKey = makeKey(privateKey, { data: publicKey, bounds: { kind: 'singleContract', contractId: bs58.encode(otherId) } })
    const result = await verifyAppConnectKeys({
      request,
      ownerId: 'ownerIdentityId',
      identity: portWith([otherKey]),
      now: NOW,
      privateKeys: [privateKey],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) { expect(result.reason).toBe('primary-missing'); expect(result.retryable).toBe(false) }
  })

  it('rejects an exhausted key (final)', async () => {
    const { privateKey, publicKey } = keypair()
    const key = makeKey(privateKey, { data: publicKey })
    const result = await verifyAppConnectKeys({
      request: makeRequest(), ownerId: 'ownerIdentityId', identity: portWith([key], 0n), now: NOW, privateKeys: [privateKey],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) { expect(result.reason).toBe('budget-exhausted'); expect(result.retryable).toBe(false) }
  })

  it('rejects an unknown budget (retryable)', async () => {
    const { privateKey, publicKey } = keypair()
    const key = makeKey(privateKey, { data: publicKey })
    const result = await verifyAppConnectKeys({
      request: makeRequest(), ownerId: 'ownerIdentityId', identity: portWith([key], null), now: NOW, privateKeys: [privateKey],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) { expect(result.reason).toBe('budget-unknown'); expect(result.retryable).toBe(true) }
  })
})
