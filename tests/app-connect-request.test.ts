import { describe, it, expect } from 'vitest'
import bs58 from 'bs58'
import * as secp256k1 from '@noble/secp256k1'
import { parseAppConnectUri, KeySecurityLevel } from 'platform-auth'
import { CONTRACT_ID, NETWORK } from '@/lib/constants'
import { buildDForumAppConnectRequest, buildDForumAppConnectUris, appConnectCarriers } from '@/lib/app-connect/request'
import { APP_CONNECT_BUDGET, APP_CONNECT_LIFETIME_MS, APP_CONNECT_LABEL } from '@/lib/app-connect/config'

const CREATED_AT = 1_800_000_000_000

function ephemeral(): Uint8Array {
  // A real compressed secp256k1 point (validateAppConnectRequest checks it).
  const privateKey = secp256k1.utils.randomSecretKey()
  return secp256k1.getPublicKey(privateKey, true)
}

function request() {
  return buildDForumAppConnectRequest({
    appEphemeralPubKey: ephemeral(),
    connectionId: new Uint8Array(16).fill(0xaa),
    createdAt: CREATED_AT,
  })
}

describe('buildDForumAppConnectRequest', () => {
  it('targets the configured contract as the app id and the single binding', () => {
    const req = request()
    const contractId = bs58.decode(CONTRACT_ID)
    expect(req.appId).toEqual(contractId)
    expect(req.authBindings).toHaveLength(1)
    const binding = req.authBindings[0]
    expect(binding.kind).toBe('singleContract')
    expect(binding.id).toEqual(contractId)
    expect(binding.securityLevel).toBe(KeySecurityLevel.HIGH)
    expect(binding.totalBudget).toBe(APP_CONNECT_BUDGET)
    expect(binding.expiresAt).toBe(CREATED_AT + APP_CONNECT_LIFETIME_MS)
    expect(req.encBindings).toHaveLength(0)
    expect(req.createdAt).toBe(CREATED_AT)
    expect(req.label).toBe(APP_CONNECT_LABEL)
    expect(req.connectionId).toHaveLength(16)
  })

  it('encodes a v2 request the decoder accepts', () => {
    const [{ uri }] = buildDForumAppConnectUris(request(), 'testnet')
    expect(uri.startsWith('dashpay://connect?')).toBe(true)
    const parsed = parseAppConnectUri(uri)
    expect(parsed.network).toBe('testnet')
    const req = parsed.request
    expect(req.appId).toEqual(bs58.decode(CONTRACT_ID))
    expect(req.label).toBe(APP_CONNECT_LABEL)
    expect(req.authBindings).toHaveLength(1)
    expect(req.authBindings[0].kind).toBe('singleContract')
    expect(req.authBindings[0].securityLevel).toBe(KeySecurityLevel.HIGH)
    expect(req.connectionId).toHaveLength(16)
  })

  it('maps testnet to dashpay primary + dash-key fallback, mainnet to dashpay only', () => {
    const testnet = appConnectCarriers('testnet')
    expect(testnet).toEqual(['dashpay', 'dash-key'])
    const mainnet = appConnectCarriers('mainnet')
    expect(mainnet).toEqual(['dashpay'])
  })

  it('produces a valid dash-key: fallback URI on testnet with the same body', () => {
    const req = request()
    const [dashpay, dashKey] = buildDForumAppConnectUris(req, 'testnet')
    expect(dashpay.carrier).toBe('dashpay')
    expect(dashKey.carrier).toBe('dash-key')
    const [decodedDashpay, decodedDashKey] = [parseAppConnectUri(dashpay.uri), parseAppConnectUri(dashKey.uri)]
    expect(decodedDashKey.request.label).toBe(decodedDashpay.request.label)
    expect(decodedDashKey.request.connectionId).toEqual(decodedDashpay.request.connectionId)
    expect(decodedDashKey.request.authBindings[0].id).toEqual(decodedDashpay.request.authBindings[0].id)
    expect(decodedDashKey.request.createdAt).toBe(CREATED_AT)
  })
})

describe('app id source', () => {
  it('comes from the deployment record / env, not hard-coded', () => {
    expect(CONTRACT_ID.length).toBeGreaterThan(0)
    expect(bs58.decode(CONTRACT_ID)).toHaveLength(32)
    expect(NETWORK).toBe('testnet')
  })
})
