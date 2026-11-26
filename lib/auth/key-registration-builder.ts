/**
 * Identity update builder — creates unsigned IdentityUpdateTransition bytes
 * for the wallet to sign (via a dash-st: QR) when registering App Connect
 * auth/encryption keys on an identity.
 *
 * Ported from yappr's builder (spec: YAPPR_DET_SIGNER_SPEC §11.5):
 * - auth key: ecdsa_hash160, purpose authentication, high security (unsigned —
 *   the hash160 form must not reveal the full public key)
 * - encryption key: ecdsa_secp256k1, purpose encryption, medium security,
 *   full public key (signed with the encryption key)
 */
import * as secp256k1 from '@noble/secp256k1'
import { sha256 } from '@noble/hashes/sha2.js'
import { hash160 } from '@/lib/auth/protocol'
import { getSdk } from '@/lib/services/evo-sdk-service'
import { decodeKeyDataBytes } from '@/lib/auth/decoder'

const COMPACT_SIG_BASE = 27
const COMPACT_SIG_COMPRESSED_FLAG = 4

function doubleSha256(data: Uint8Array): Uint8Array {
  return sha256(sha256(data))
}

async function signWithKey(privateKey: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const dataHash = doubleSha256(data)
  const signature = await secp256k1.signAsync(dataHash, privateKey, {
    format: 'recovered',
    prehash: false,
  })
  const recoveryId = signature[0]
  const result = new Uint8Array(65)
  result[0] = recoveryId + COMPACT_SIG_BASE + COMPACT_SIG_COMPRESSED_FLAG
  result.set(signature.slice(1), 1)
  return result
}

export interface KeyRegistrationRequest {
  identityId: string
  authPrivateKey: Uint8Array
  authPublicKey: Uint8Array
  encryptionPrivateKey: Uint8Array
  encryptionPublicKey: Uint8Array
}

export interface KeyRegistrationBuildResult {
  transitionBytes: Uint8Array
  authKeyId: number
  encryptionKeyId: number
  identityRevision: bigint
}

export async function buildUnsignedKeyRegistrationTransition(
  request: KeyRegistrationRequest,
): Promise<KeyRegistrationBuildResult> {
  const { identityId, authPrivateKey, authPublicKey, encryptionPrivateKey, encryptionPublicKey } = request

  if (authPrivateKey.length !== 32) throw new Error(`Invalid auth private key length: ${authPrivateKey.length}`)
  if (authPublicKey.length !== 33) throw new Error(`Invalid auth public key length: ${authPublicKey.length}`)
  if (encryptionPrivateKey.length !== 32) throw new Error(`Invalid encryption private key length: ${encryptionPrivateKey.length}`)
  if (encryptionPublicKey.length !== 33) throw new Error(`Invalid encryption public key length: ${encryptionPublicKey.length}`)

  const wasm = await import('@dashevo/wasm-sdk/compressed')
  const sdk = await getSdk()
  const identity = await sdk.identities.fetch(identityId)
  if (!identity) throw new Error(`Identity not found: ${identityId}`)

  const identityJson = identity.toJSON() as { revision?: number }
  const currentRevision = BigInt(identityJson.revision || 0)

  const existingKeys = identity.publicKeys as Array<{ keyId?: number; id?: number }>
  const maxKeyId = existingKeys.reduce(
    (max, key) => Math.max(max, Number(key.keyId ?? key.id ?? 0)),
    0,
  )
  const authKeyId = maxKeyId + 1
  const encryptionKeyId = maxKeyId + 2

  const currentNonce = await sdk.identities.nonce(identityId)
  if (currentNonce === null || currentNonce === undefined) {
    throw new Error('Failed to fetch identity nonce')
  }
  const nextNonce = currentNonce + BigInt(1)
  const newRevision = currentRevision + BigInt(1)

  const authKeyType = 'ecdsa_hash160' as const
  const encryptionKeyType = 'ecdsa_secp256k1' as const
  const authKeyData = hash160(authPublicKey)
  const encryptionKeyData = encryptionPublicKey

  const authSignature: Uint8Array = new Uint8Array(0)
  let encryptionSignature: Uint8Array = new Uint8Array(0)

  const authKey = new wasm.IdentityPublicKeyInCreation({
    keyId: authKeyId,
    purpose: 'authentication',
    securityLevel: 'high',
    keyType: authKeyType,
    isReadOnly: false,
    data: authKeyData,
    signature: new Uint8Array(0),
  })
  const encryptionKey = new wasm.IdentityPublicKeyInCreation({
    keyId: encryptionKeyId,
    purpose: 'encryption',
    securityLevel: 'medium',
    keyType: encryptionKeyType,
    isReadOnly: false,
    data: encryptionKeyData,
    signature: new Uint8Array(0),
  })

  try {
    const transition = new wasm.IdentityUpdateTransition({
      identityId,
      revision: newRevision,
      nonce: nextNonce,
      addPublicKeys: [authKey, encryptionKey],
      disablePublicKeys: [],
    })
    try {
      const stateTransition = transition.toStateTransition()
      const signableBytes = stateTransition.getSignableBytes()
      encryptionSignature = await signWithKey(encryptionPrivateKey, signableBytes)
    } finally {
      transition.free()
    }
  } finally {
    authKey.free()
    encryptionKey.free()
  }

  const authKeyWithSig = new wasm.IdentityPublicKeyInCreation({
    keyId: authKeyId,
    purpose: 'authentication',
    securityLevel: 'high',
    keyType: authKeyType,
    isReadOnly: false,
    data: authKeyData,
    signature: authSignature,
  })
  const encryptionKeyWithSig = new wasm.IdentityPublicKeyInCreation({
    keyId: encryptionKeyId,
    purpose: 'encryption',
    securityLevel: 'medium',
    keyType: encryptionKeyType,
    isReadOnly: false,
    data: encryptionKeyData,
    signature: encryptionSignature,
  })

  let transitionBytes: Uint8Array
  try {
    const finalTransition = new wasm.IdentityUpdateTransition({
      identityId,
      revision: newRevision,
      nonce: nextNonce,
      addPublicKeys: [authKeyWithSig, encryptionKeyWithSig],
      disablePublicKeys: [],
    })
    try {
      transitionBytes = finalTransition.toBytes()
    } finally {
      finalTransition.free()
    }
  } finally {
    authKeyWithSig.free()
    encryptionKeyWithSig.free()
  }

  return {
    transitionBytes,
    authKeyId,
    encryptionKeyId,
    identityRevision: newRevision,
  }
}

/** Check whether an identity already lists the expected auth/encryption keys. */
export async function checkKeysRegistered(
  identityId: string,
  authPublicKey: Uint8Array,
  encryptionPublicKey: Uint8Array,
): Promise<boolean> {
  const sdk = await getSdk()
  const identity = await sdk.identities.fetch(identityId)
  if (!identity) return false

  const authHash = hash160(authPublicKey)

  const keyData = (key: unknown): Uint8Array | null => {
    const raw = (key as { data?: unknown }).data as string | Uint8Array | undefined
    if (!raw) return null
    try {
      return decodeKeyDataBytes(raw)
    } catch {
      return null
    }
  }

  const publicKeys = identity.publicKeys as Array<{
    keyId: number
    purpose: string
    securityLevel: string
    keyType: string
    disabledAt?: bigint | number | null
  }>

  // A key is only proof of registration when it is enabled (disabledAt unset)
  // and at the security level the App Connect flow relies on — the HIGH
  // auth key (document writes) and the MEDIUM encryption key (signed by it).
  const enabled = (key: { disabledAt?: bigint | number | null }): boolean => {
    const disabledAt = key.disabledAt === undefined || key.disabledAt === null ? null : Number(key.disabledAt)
    return disabledAt === null
  }

  const authKeyExists = publicKeys.some((key) => {
    const data = keyData(key)
    if (!data) return false
    const purpose = String(key.purpose).toUpperCase()
    const keyType = String(key.keyType).toUpperCase()
    const level = String(key.securityLevel).toUpperCase()
    const isAuth = purpose === 'AUTHENTICATION'
    const isHash160 = keyType === 'ECDSA_HASH160'
    if (!isAuth || !isHash160) return false
    if (level !== 'HIGH') return false
    if (!enabled(key)) return false
    if (data.length !== authHash.length) return false
    return data.every((b, i) => b === authHash[i])
  })

  const encKeyExists = publicKeys.some((key) => {
    const data = keyData(key)
    if (!data) return false
    const purpose = String(key.purpose).toUpperCase()
    const keyType = String(key.keyType).toUpperCase()
    const level = String(key.securityLevel).toUpperCase()
    const isEnc = purpose === 'ENCRYPTION'
    const isFull = keyType === 'ECDSA_SECP256K1'
    if (!isEnc || !isFull) return false
    if (level !== 'MEDIUM') return false
    if (!enabled(key)) return false
    if (data.length !== encryptionPublicKey.length) return false
    return data.every((b, i) => b === encryptionPublicKey[i])
  })

  return authKeyExists && encKeyExists
}
