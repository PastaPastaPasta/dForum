/**
 * Platform-auth dependency adapters for dForum.
 *
 * All persisted state lives in sessionStorage under the `dforum:auth:`
 * namespace — tab-scoped, cleared on tab close, never sent anywhere except
 * through the platform-auth controller's own handlers (all in-browser).
 */
import bs58 from 'bs58'
import bs58check from 'bs58check'
import { hkdf } from '@noble/hashes/hkdf.js'
import { sha256 } from '@noble/hashes/sha2.js'
import {
  decodeYapprIdentityId,
  deriveYapprAuthKeyFromLogin,
  deriveYapprEncryptionKeyFromLogin,
  getYapprPublicKey,
  hash160,
  type AuthPublicKey,
  type AuthSessionSnapshot,
  type AuthUser,
  type IdentityRecord,
  type NetworkName,
  type PlatformAuthDependencies,
  type SecretStore,
  type SessionStore,
  type YapprKeyExchangePort,
} from 'platform-auth'
import { CONTRACT_ID, NETWORK, STORAGE_KEY_PREFIX } from '@/lib/constants'
import { getSdk } from '@/lib/services/evo-sdk-service'
import { buildUnsignedKeyRegistrationTransition, checkKeysRegistered } from '@/lib/auth/key-registration-builder'
import { KEY_EXCHANGE_CONTRACT_ID } from '@/lib/constants'

const NS = `${STORAGE_KEY_PREFIX}:auth:`
const SESSION_KEY = `${NS}session`
const SK_PREFIX = `${NS}sk:`
const ENC_PREFIX = `${NS}enc:`
const ENC_TYPE_PREFIX = `${NS}enc-type:`
const DEK_PREFIX = `${NS}dek:`

// A restored session is only trusted for this long — a key forgotten in a
// sessionStorage backlog (tab reopen, crash recovery) must not sign for the
// life of the tab. Expiry handling: the snapshot is dropped here, so the
// controller sees an empty store and signs out cleanly.
const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000

function hostAllowed(): boolean {
  if (typeof window === 'undefined') return false
  if (!LOGIN_AVAILABLE) return false
  return hostIsCanonical(window.location.hostname)
}

function read(key: string): string | null {
  if (typeof window === 'undefined') return null
  try {
    return window.sessionStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string | null): void {
  if (typeof window === 'undefined') return
  try {
    if (value === null) window.sessionStorage.removeItem(key)
    else window.sessionStorage.setItem(key, value)
  } catch {
    // storage unavailable — session lives in memory only
  }
}

import { decodeKeyDataBytes as decodeKeyDataBytesShared, decodeWif as decodeWifShared } from '@/lib/auth/decoder'
import { hostIsCanonical, LOGIN_AVAILABLE } from '@/lib/host'

/** Mirror document-service's encode side: hex if it decodes as hex, else assume base64 already. */
function toBase64FromString(str: string): string {
  // Mirror document-service: hex if it decodes as hex, else assume base64 already.
  if (/^(?:[0-9a-fA-F]{2})+$/.test(str) && str.length % 2 === 0) {
    const bytes = new Uint8Array(str.length / 2)
    for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(str.slice(i * 2, i * 2 + 2), 16)
    return toBase64(bytes)
  }
  return str
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

function fromBase64(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

// ---- storage ports ----------------------------------------------------------

export const sessionStore: SessionStore = {
  async getSession(): Promise<AuthSessionSnapshot | null> {
    if (!hostAllowed()) return null
    const raw = read(SESSION_KEY)
    if (!raw) return null
    try {
      const parsed = JSON.parse(raw) as AuthSessionSnapshot
      if (!parsed?.user?.identityId) return null
      const ts = Number(parsed.timestamp ?? 0)
      if (!Number.isFinite(ts) || ts <= 0) return null
      if (Date.now() - ts > SESSION_MAX_AGE_MS) {
        // Stale snapshot — drop it so the controller signs out cleanly.
        write(SESSION_KEY, null)
        return null
      }
      return parsed
    } catch {
      return null
    }
  },
  async setSession(snapshot: AuthSessionSnapshot): Promise<void> {
    write(SESSION_KEY, JSON.stringify(snapshot))
  },
  async clearSession(): Promise<void> {
    write(SESSION_KEY, null)
  },
}

export const secretStore: SecretStore = {
  async storePrivateKey(identityId: string, privateKey: string): Promise<void> {
    write(`${SK_PREFIX}${identityId}`, privateKey)
  },
  async getPrivateKey(identityId: string): Promise<string | null> {
    if (!hostAllowed()) return null
    return read(`${SK_PREFIX}${identityId}`)
  },
  async hasPrivateKey(identityId: string): Promise<boolean> {
    if (!hostAllowed()) return false
    return read(`${SK_PREFIX}${identityId}`) !== null
  },
  async clearPrivateKey(identityId: string): Promise<void> {
    write(`${SK_PREFIX}${identityId}`, null)
  },
  async storeEncryptionKey(identityId: string, encryptionKey: string): Promise<void> {
    write(`${ENC_PREFIX}${identityId}`, encryptionKey)
  },
  async getEncryptionKey(identityId: string): Promise<string | null> {
    return read(`${ENC_PREFIX}${identityId}`)
  },
  async hasEncryptionKey(identityId: string): Promise<boolean> {
    return read(`${ENC_PREFIX}${identityId}`) !== null
  },
  async clearEncryptionKey(identityId: string): Promise<void> {
    write(`${ENC_PREFIX}${identityId}`, null)
  },
  async storeEncryptionKeyType(identityId: string, type: 'derived' | 'external'): Promise<void> {
    write(`${ENC_TYPE_PREFIX}${identityId}`, type)
  },
  async clearEncryptionKeyType(identityId: string): Promise<void> {
    write(`${ENC_TYPE_PREFIX}${identityId}`, null)
  },
  async storeTransferKey(identityId: string, transferKey: string): Promise<void> {
    write(`${NS}transfer:${identityId}`, transferKey)
  },
  async getTransferKey(identityId: string): Promise<string | null> {
    return read(`${NS}transfer:${identityId}`)
  },
  async clearTransferKey(identityId: string): Promise<void> {
    write(`${NS}transfer:${identityId}`, null)
  },
  // The login key is never written to storage. The App Connect session
  // only needs the derived HIGH auth key (kept as `sk:`) and the
  // encryption key (`enc:`); `authVault` is disabled, so nothing reads the
  // login key back. Keeping it out of sessionStorage removes a second
  // sensitive value from the origin's storage space.
  async storeLoginKey(identityId: string, loginKey: Uint8Array): Promise<void> {
    void identityId
    void loginKey
  },
  async getLoginKey(identityId: string): Promise<Uint8Array | null> {
    void identityId
    return null
  },
  async clearLoginKey(identityId: string): Promise<void> {
    void identityId
  },
  async storeAuthVaultDek(identityId: string, dek: Uint8Array): Promise<void> {
    write(`${DEK_PREFIX}${identityId}`, toBase64(dek))
  },
  async getAuthVaultDek(identityId: string): Promise<Uint8Array | null> {
    const raw = read(`${DEK_PREFIX}${identityId}`)
    if (!raw) return null
    try {
      return fromBase64(raw)
    } catch {
      return null
    }
  },
  async clearAuthVaultDek(identityId: string): Promise<void> {
    write(`${DEK_PREFIX}${identityId}`, null)
  },
}

// ---- identity port ----------------------------------------------------------

export const identityPort = {
  async getIdentity(identityId: string): Promise<IdentityRecord | null> {
    const sdk = await getSdk()
    const identity = await sdk.identities.fetch(identityId)
    if (!identity) return null
    const keys: AuthPublicKey[] = []
    for (const key of identity.publicKeys as Array<{
      keyId: number
      purpose: string
      keyType: string
      securityLevel: string
      isReadOnly: boolean
      data: Uint8Array | string
    }>) {
      keys.push({
        id: Number(key.keyId),
        type: keyTypeToNumber(key.keyType),
        purpose: purposeToNumber(key.purpose),
        securityLevel: securityLevelToNumber(key.securityLevel),
        data: key.data instanceof Uint8Array ? toBase64(key.data) : toBase64FromString(String(key.data)),
      })
    }
    const balance = await sdk.identities.balance(identityId)
    return {
      id: identityId,
      balance: Number(balance),
      publicKeys: keys,
    }
  },
  async getBalance(identityId: string): Promise<number> {
    const sdk = await getSdk()
    const balance = await sdk.identities.balance(identityId)
    return Number(balance)
  },
}

function purposeToNumber(purpose: string): number {
  switch (purpose.toLowerCase()) {
    case 'authentication': return 0
    case 'encryption': return 1
    case 'decryption': return 2
    case 'transfer': return 3
    case 'owner': return 4
    case 'voting': return 5
    default: return -1
  }
}

function keyTypeToNumber(keyType: string): number {
  switch (keyType.toUpperCase()) {
    case 'ECDSA_SECP256K1': return 0
    case 'BLS12_381': return 1
    case 'ECDSA_HASH160': return 2
    case 'BIP13_SCRIPT_HASH': return 3
    case 'EDDSA_25519_HASH160': return 4
    default: return -1
  }
}

function securityLevelToNumber(level: string): number {
  switch (level.toLowerCase()) {
    case 'master': return 0
    case 'critical': return 1
    case 'high': return 2
    case 'medium': return 3
    default: return -1
  }
}

// ---- crypto port ------------------------------------------------------------

function decodeWif(wif: string): { privateKey: Uint8Array; compressed: boolean } {
  const decoded = decodeWifShared(wif, NETWORK)
  if (!decoded) throw new Error(`Invalid ${NETWORK} WIF`)
  return decoded
}

function encodeWif(privateKey: Uint8Array, network: NetworkName, compressed: boolean): string {
  const prefix = network === 'mainnet' ? 0xcc : 0xef
  const payload = compressed ? new Uint8Array([prefix, ...privateKey, 0x01]) : new Uint8Array([prefix, ...privateKey])
  return bs58check.encode(payload)
}

export const cryptoPort = {
  parsePrivateKey(privateKeyWif: string): { privateKey: Uint8Array } {
    return { privateKey: decodeWif(privateKeyWif).privateKey }
  },
  privateKeyToWif(privateKey: Uint8Array, network: NetworkName, compressed: boolean): string {
    return encodeWif(privateKey, network, compressed)
  },
  deriveEncryptionKey(authPrivateKey: Uint8Array, identityId: string): Uint8Array {
    const identityIdBytes = decodeYapprIdentityId(identityId)
    return hkdf(sha256, authPrivateKey, identityIdBytes, new TextEncoder().encode('encryption'), 32)
  },
  async validateDerivedKeyMatchesIdentity(derivedKey: Uint8Array, identityId: string): Promise<boolean> {
    try {
      const publicKey = getYapprPublicKey(derivedKey)
      const hash = hash160(publicKey)
      const sdk = await getSdk()
      const identity = await sdk.identities.fetch(identityId)
      if (!identity) return false
      return (identity.publicKeys as Array<{ data: Uint8Array | string; keyType: string; purpose?: string; securityLevel?: string; disabledAt?: bigint | number | null }>).some((key) => {
        // Only an enabled AUTHENTICATION key whose level is HIGH or CRITICAL
        // may be trusted — a MEDIUM/low or disabled key must never pass.
        if (String(key.purpose ?? '').toUpperCase() !== 'AUTHENTICATION') return false
        const level = String(key.securityLevel ?? '').toUpperCase()
        if (level !== 'HIGH' && level !== 'CRITICAL') return false
        const disabledAt = key.disabledAt === undefined || key.disabledAt === null ? null : Number(key.disabledAt)
        if (disabledAt !== null && disabledAt > 0) return false
        const data = decodeKeyDataBytesShared(key.data)
        if (data.length === hash.length) return data.every((b, i) => b === hash[i])
        if (data.length === publicKey.length) return data.every((b, i) => b === publicKey[i])
        return false
      })
    } catch {
      return false
    }
  },
  identityHasEncryptionKey(publicKeys: AuthPublicKey[]): boolean {
    return publicKeys.some((key) => key.purpose === 1 || String(key.purpose).toLowerCase() === 'encryption')
  },
  decodeIdentityId(identityId: string): Uint8Array {
    return decodeYapprIdentityId(identityId)
  },
  deriveAuthKeyFromLogin: deriveYapprAuthKeyFromLogin,
  deriveEncryptionKeyFromLogin: deriveYapprEncryptionKeyFromLogin,
}

// ---- key-exchange port ------------------------------------------------------

/** Response doc ids already handed out — a poll must never replay the same one. */
const seenResponseIds = new Set<string>()

function toBase64OfBytes(data: unknown): Uint8Array | null {
  if (data instanceof Uint8Array) return data
  if (Array.isArray(data) && data.every((v) => typeof v === 'number')) return new Uint8Array(data)
  if (typeof data === 'string') {
    try {
      return fromBase64(data)
    } catch {
      if (/^[0-9a-fA-F]+$/.test(data) && data.length % 2 === 0) {
        const bytes = new Uint8Array(data.length / 2)
        for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(data.slice(i * 2, i * 2 + 2), 16)
        return bytes
      }
      return null
    }
  }
  if (data && typeof data === 'object' && 'type' in data && 'data' in data) {
    const like = data as { type: string; data: number[] }
    if (like.type === 'Buffer' && Array.isArray(like.data)) return new Uint8Array(like.data)
  }
  if (data && typeof data === 'object') {
    const keys = Object.keys(data as Record<string, unknown>)
    if (keys.length > 0 && keys.every((k) => /^\d+$/.test(k))) {
      const asObj = data as Record<string, unknown>
      const max = Math.max(...keys.map((k) => Number(k)))
      if (max === keys.length - 1) {
        const bytes = new Uint8Array(keys.length)
        for (const k of keys) bytes[Number(k)] = Number(asObj[k]) & 0xff
        return bytes
      }
    }
  }
  return null
}

export const keyExchangePort: YapprKeyExchangePort = {
  async getResponse(contractIdBytes: Uint8Array, appEphemeralPubKeyHash: Uint8Array) {
    const sdk = await getSdk()
    const contractIdBase58 = bs58.encode(contractIdBytes)
    const hashBase64 = toBase64(appEphemeralPubKeyHash)

    // Oldest-first and several candidates, not one: a malformed or
    // attacker-posted document must never wedge the poll — skip
    // structurally invalid docs and only return ones that can decrypt.
    // Docs already returned are remembered and skipped so the poll cannot
    // hand the same response back twice.
    const page = await sdk.documents.query({
      dataContractId: KEY_EXCHANGE_CONTRACT_ID,
      documentTypeName: 'loginKeyResponse',
      where: [
        ['contractId', '==', contractIdBase58],
        ['appEphemeralPubKeyHash', '==', hashBase64],
      ],
      orderBy: [['$createdAt', 'asc']],
      limit: 10,
    })

    for (const doc of page.values()) {
      if (!doc) continue
      const obj = (doc.toObject?.() ?? doc) as Record<string, unknown>
      const idRaw = obj.$id ?? obj.id
      const idString = typeof idRaw === 'string' ? idRaw : String(idRaw ?? '')
      if (!idString || seenResponseIds.has(idString)) continue
      const walletEphemeralPubKey = toBase64OfBytes(obj.walletEphemeralPubKey)
      const encryptedPayload = toBase64OfBytes(obj.encryptedPayload)
      const keyIndex = Number(obj.keyIndex ?? 0)
      if (!walletEphemeralPubKey || walletEphemeralPubKey.length !== 33) continue
      if (!encryptedPayload || encryptedPayload.length < 60) continue
      const ownerRaw = obj.$ownerId ?? obj.ownerId
      const ownerId = typeof ownerRaw === 'string' ? ownerRaw : String(ownerRaw ?? '')
      if (!ownerId) continue
      seenResponseIds.add(idString)
      return {
        $id: idString,
        $ownerId: ownerId,
        $revision: Number(obj.$revision ?? obj.revision ?? 1),
        contractId: contractIdBytes,
        appEphemeralPubKeyHash,
        walletEphemeralPubKey,
        encryptedPayload,
        keyIndex,
      }
    }
    return null
  },

  async buildUnsignedKeyRegistrationTransition(request) {
    const { transitionBytes, authKeyId, encryptionKeyId, identityRevision } =
      await buildUnsignedKeyRegistrationTransition(request)
    return {
      transitionBytes,
      authKeyId,
      encryptionKeyId,
      identityRevision,
    }
  },

  async checkKeysRegistered(identityId, authPublicKey, encryptionPublicKey) {
    return checkKeysRegistered(identityId, authPublicKey, encryptionPublicKey)
  },
}

// ---- assemble ---------------------------------------------------------------

export function createPlatformAuthDependencies(): PlatformAuthDependencies {
  return {
    network: (NETWORK === 'mainnet' ? 'mainnet' : 'testnet') as NetworkName,
    sessionStore,
    secretStore,
    identity: identityPort,
    crypto: cryptoPort,
    yapprKeyExchange: keyExchangePort,
    yapprKeyExchangeConfig: {
      appContractId: CONTRACT_ID,
      keyExchangeContractId: KEY_EXCHANGE_CONTRACT_ID,
      network: (NETWORK === 'mainnet' ? 'mainnet' : 'testnet') as NetworkName,
      label: 'Login to dForum',
      pollIntervalMs: 3000,
      timeoutMs: 180000,
    },
    features: {
      usernameGate: false,
      profileGate: false,
      passwordLogin: false,
      passkeyLogin: false,
      keyExchangeLogin: true,
      authVault: false,
      legacyPasswordLogin: false,
      autoDeriveEncryptionKey: false,
      postLoginTasks: false,
      balanceRefresh: false,
    },
  }
}
