'use client'

/**
 * Forum data layer.
 *
 * Query + write calls against the dForum contract. Reads are public.
 * Writes go through an IdentitySigner built from the session's auth key
 * (or a moderator CRITICAL key for moderation transitions).
 */
import type { Document as DocumentCtor, IdentitySigner as IdentitySignerCtor } from '@dashevo/evo-sdk'
import bs58 from 'bs58'
import bs58check from 'bs58check'
import { getSdk, getSdkClasses } from '@/lib/services/evo-sdk-service'
import { CONTRACT_ID, NETWORK } from '@/lib/constants'
import { hash160 } from '@/lib/auth/protocol'
import { stripModeratorFields, buildAuthorUpdate } from '@/lib/services/moderator-fields'

export interface DocRef {
  id: string
  ownerId: string
  dataContractId: string
  documentTypeName: string
  revision: bigint
  createdAt: number
  updatedAt: number
  properties: Record<string, unknown>
}

const SEQUENCE_MASK = (1n << 40n) - 1n

// ---- normalization helpers --------------------------------------------------

/** Convert identifier-like values (Uint8Array, numeric-keyed objects, base58) to base58. */
function identifierify(value: unknown): string | null {
  if (!value) return null
  if (typeof value === 'string') {
    // already base58? try decode/re-encode to normalize; if it fails, leave it
    try {
      return bs58.encode(bs58.decode(value))
    } catch {
      return value
    }
  }
  if (value instanceof Uint8Array) return bs58.encode(value)
  if (Array.isArray(value) && value.length === 32) return bs58.encode(Uint8Array.from(value))
  if (typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>)
    if (keys.length === 32 && keys.every((k) => /^\d+$/.test(k))) {
      const bytes = new Uint8Array(32)
      for (const k of keys) bytes[Number(k)] = Number((value as Record<string, unknown>)[k]) & 0xff
      return bs58.encode(bytes)
    }
  }
  return null
}

function normalizeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    if (value.length === 0) return []
    if (value.every((v) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')) {
      return value.map((v) => normalizeValue(v))
    }
    const idents = value.map((v) => identifierify(v))
    return idents.every(Boolean) ? idents : value.map((v) => normalizeValue(v))
  }
  if (value instanceof Uint8Array) {
    // binary identifier-like; keep base58 for display/query
    const ident = identifierify(value)
    if (ident) return ident
    return value
  }
  if (typeof value === 'object' && value !== null) {
    const ident = identifierify(value)
    if (ident) return ident
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = normalizeValue(v)
    return out
  }
  return value
}

function normalizeDoc(raw: unknown): DocRef | null {
  if (!raw) return null
  try {
    const obj = typeof (raw as { toObject?: () => unknown }).toObject === 'function'
      ? (raw as { toObject: () => Record<string, unknown> }).toObject()
      : (raw as Record<string, unknown>)
    if (!obj || typeof obj !== 'object') return null

    const id = identifierify(obj.$id ?? obj.id)
    if (!id) return null

    const ownerId = identifierify(obj.$ownerId ?? obj.ownerId) ?? ''
    const dataContractId = identifierify(obj.$dataContractId ?? obj.dataContractId) ?? ''
    const documentTypeName = (obj.$type ?? obj.documentTypeName ?? '') as string

    const props: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(obj)) {
      if (key.startsWith('$')) continue
      if (key === 'dataContractId' || key === 'documentTypeName' || key === 'revision' || key === 'createdAt' || key === 'updatedAt' || key === 'id' || key === 'ownerId') continue
      const normalized = normalizeValue(value)
      if (normalized !== undefined) props[key] = normalized
    }

    const createdAtRaw = obj.$createdAt ?? obj.createdAt
    const updatedAtRaw = obj.$updatedAt ?? obj.updatedAt
    const revisionRaw = obj.$revision ?? obj.revision

    return {
      id,
      ownerId,
      dataContractId,
      documentTypeName: String(documentTypeName),
      revision: revisionRaw !== undefined ? BigInt(typeof revisionRaw === 'bigint' ? revisionRaw : Number(revisionRaw)) : 1n,
      createdAt: createdAtRaw ? Number(createdAtRaw) : 0,
      updatedAt: updatedAtRaw ? Number(updatedAtRaw) : 0,
      properties: props,
    }
  } catch {
    return null
  }
}

// ---- reads ------------------------------------------------------------------

export async function query(
  type: string,
  options: {
    where?: [string, string, unknown][]
    orderBy?: [string, 'asc' | 'desc'][]
    limit?: number
    /** Exclusive $id cursor — page past the document it names. */
    startAfter?: string
  } = {},
): Promise<DocRef[]> {
  const sdk = await getSdk()
  const page = await sdk.documents.query({
    dataContractId: CONTRACT_ID,
    documentTypeName: type,
    where: options.where as never,
    orderBy: options.orderBy as never,
    limit: options.limit ?? 100,
    ...(options.startAfter !== undefined ? { startAfter: options.startAfter } : {}),
  })
  const out: DocRef[] = []
  for (const doc of page.values()) {
    const normalized = normalizeDoc(doc)
    if (normalized) out.push(normalized)
  }
  return out
}

export async function count(
  type: string,
  options: {
    where?: [string, string, unknown][]
    groupBy?: string[]
  } = {},
): Promise<Map<string, bigint>> {
  const sdk = await getSdk()
  const map = await sdk.documents.count({
    dataContractId: CONTRACT_ID,
    documentTypeName: type,
    where: options.where as never,
    groupBy: options.groupBy ?? [],
  })
  const out = new Map<string, bigint>()
  for (const [key, value] of map.entries()) out.set(String(key), value)
  return out
}

export async function get(type: string, documentId: string): Promise<DocRef | null> {
  const sdk = await getSdk()
  const raw = await sdk.documents.get(CONTRACT_ID, type, documentId)
  return normalizeDoc(raw)
}

// ---- writes ------------------------------------------------------------------

export interface SigningContext {
  identityId: string
  identityKey: unknown
  signer: InstanceType<typeof IdentitySignerCtor>
}

/**
 * Build the signer + matched identity key for a private key WIF.
 * The matched key must be HIGH or CRITICAL (document writes).
 */
export async function buildSigning(
  identityId: string,
  authKeyWif: string,
  requiredAtLeast: 'high' | 'critical' = 'high',
): Promise<SigningContext | null> {
  const sdk = await getSdk()
  const { IdentitySigner } = await getSdkClasses()
  const identity = await sdk.identities.fetch(identityId)
  if (!identity) return null

  const signer = new IdentitySigner()
  try {
    signer.addKeyFromWif(authKeyWif)
  } catch (e) {
    try { signer.free() } catch { /* already freed */ }
    throw e
  }

  // Match the WIF against the identity's public keys, exactly as yappr does.
  const wifBytes = wifToPrivateKey(authKeyWif)
  if (!wifBytes) { try { signer.free() } catch { /* already freed */ } return null }
  const { privateKey, compressed } = wifBytes
  let publicKey: Uint8Array
  try {
    const { getPublicKey } = await import('@noble/secp256k1')
    publicKey = getPublicKey(privateKey, compressed)
  } catch (e) {
    try { signer.free() } catch { /* already freed */ }
    throw e
  }
  const identityKeys = identity.publicKeys as Array<{
    keyId: number
    purpose: string
    keyType: string
    securityLevel: string
    data: Uint8Array | string
    isReadOnly: boolean
    disabledAt?: bigint | number | null
  }>

  const hash160Pub = hash160(publicKey)
  try {
  for (const key of identityKeys) {
    // skipped below — purpose/level are checked before any match is trusted.
    const disabledAt = key.disabledAt === undefined || key.disabledAt === null ? null : Number(key.disabledAt)
    if (disabledAt !== null && disabledAt > 0) continue
    const data = decodeKeyData(key.data)
    const keyType = key.keyType.toUpperCase()
    let match = false
    if (keyType === 'ECDSA_SECP256K1' && data.length === publicKey.length && bytesEqual(data, publicKey)) {
      match = true
    } else if (keyType === 'ECDSA_HASH160' && data.length === hash160Pub.length && bytesEqual(data, hash160Pub)) {
      match = true
    }
    if (!match) continue
    if (String(key.purpose).toUpperCase() !== 'AUTHENTICATION') continue
    const levelNum = securityLevelNumber(key.securityLevel)
    // document writes allow CRITICAL or HIGH (1 or 2); moderation needs CRITICAL (1)
    if (levelNum === 0) continue
    if (requiredAtLeast === 'critical' && levelNum > 1) continue
    if (requiredAtLeast === 'high' && levelNum > 2) continue
    // find the wasm key object by id
    const wasmKey = identity.getPublicKeyById(key.keyId)
    if (wasmKey) return { identityId, identityKey: wasmKey, signer }
  }
  try { signer.free() } catch { /* already freed */ }
  return null
  } catch (e) {
    try { signer.free() } catch { /* already freed */ }
    throw e
  }
}

function wifToPrivateKey(wif: string): { privateKey: Uint8Array; compressed: boolean } | null {
  try {
    const decoded = bs58check.decode(wif)
    if (decoded.length === 34 && decoded[33] === 0x01) {
      return { privateKey: decoded.slice(1, 33), compressed: true }
    }
    if (decoded.length === 33) {
      return { privateKey: decoded.slice(1, 33), compressed: false }
    }
    return null
  } catch {
    return null
  }
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

/** Decode a key-data field. The SDK hands bytes as Uint8Array; when a string
 * ever appears, hex is the app's canonical encoding — hex if it matches,
 * otherwise base64. Both decodes are shapes, never guessed silently. */
function decodeKeyData(data: Uint8Array | string): Uint8Array {
  if (data instanceof Uint8Array) return data
  const str = String(data)
  if (/^(?:[0-9a-fA-F]{2})+$/.test(str) && str.length % 2 === 0) {
    return hexToBytes(str)
  }
  const binary = atob(str)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex
  const bytes = new Uint8Array(clean.length / 2)
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  return bytes
}

function securityLevelNumber(level: string): number {
  switch (level.toUpperCase()) {
    case 'MASTER': return 0
    case 'CRITICAL': return 1
    case 'HIGH': return 2
    case 'MEDIUM': return 3
    default: return 99
  }
}

async function freshNonce(identityId: string): Promise<bigint> {
  const sdk = await getSdk()
  const raw = (await sdk.wasm.getIdentityContractNonce(identityId, CONTRACT_ID)) ?? 0n
  return (raw & SEQUENCE_MASK) + 1n
}

export async function createDocument(
  type: string,
  identityId: string,
  authKeyWif: string,
  properties: Record<string, unknown>,
): Promise<DocRef> {
  const sdk = await getSdk()
  const { Document } = await getSdkClasses()
  const sign = await buildSigning(identityId, authKeyWif)
  if (!sign) throw new Error('Signing context unavailable — identity or key not found')

  try {
    const entropy = crypto.getRandomValues(new Uint8Array(32))
    const nonce = await freshNonce(identityId)
    const document = new Document({
      properties: stripModeratorFields(type, properties),
      documentTypeName: type,
      dataContractId: CONTRACT_ID,
      ownerId: identityId,
      revision: 1n,
      entropy,
      identityContractNonce: nonce,
    })
    const created = await sdk.documents.create({ document, identityKey: sign.identityKey as never, signer: sign.signer })
    const normalized = normalizeDoc(created)
    if (!normalized) throw new Error('Document create returned an unreadable document')
    return normalized
  } finally {
    try { sign.signer?.free?.() } catch { /* already freed */ }
  }
}

export async function replaceDocument(
  existing: DocRef,
  identityId: string,
  authKeyWif: string,
  properties: Record<string, unknown>,
): Promise<DocRef> {
  const sdk = await getSdk()
  const { Document } = await getSdkClasses()
  const sign = await buildSigning(identityId, authKeyWif)
  if (!sign) throw new Error('Signing context unavailable — identity or key not found')

  try {
    // Author-side write: stored moderator-owned values pass through unchanged
    // (a moderator-set field must not be dropped or reset); the author may
    // never set them.
    const updatedProps = buildAuthorUpdate(existing.documentTypeName, existing.properties, properties)
    const nonce = await freshNonce(identityId)
    const document = new Document({
      properties: updatedProps,
      documentTypeName: existing.documentTypeName,
      dataContractId: CONTRACT_ID,
      ownerId: identityId,
      revision: existing.revision + 1n,
      id: existing.id,
      identityContractNonce: nonce,
    })
    await sdk.documents.replace({ document, identityKey: sign.identityKey as never, signer: sign.signer })
    // The chain wrote the document — a re-read failure is not a write
    // failure. Report honestly: return what the write produced.
    const after = await get(existing.documentTypeName, existing.id).catch(() => null)
    if (after) return after
    return {
      id: existing.id,
      ownerId: identityId,
      dataContractId: CONTRACT_ID,
      documentTypeName: existing.documentTypeName,
      revision: existing.revision + 1n,
      createdAt: existing.createdAt,
      updatedAt: existing.updatedAt,
      properties: updatedProps,
    }
  } finally {
    try { sign.signer?.free?.() } catch { /* already freed */ }
  }
}

