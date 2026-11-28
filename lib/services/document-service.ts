'use client'

/**
 * Forum data layer.
 *
 * Query + write calls against the dForum contract. Reads are public.
 * Writes go through an IdentitySigner built from the session's auth key
 * (or a moderator CRITICAL key for moderation transitions).
 */
import type { IdentitySigner as IdentitySignerCtor } from '@dashevo/evo-sdk'
import bs58 from 'bs58'
import { batchedWrite, STALE_NONCE } from '@/lib/services/batch-write'
import { getSdk, getSdkClasses } from '@/lib/services/evo-sdk-service'
import { CONTRACT_ID, NETWORK } from '@/lib/constants'
import { hash160 } from '@/lib/auth/protocol'
import { stripModeratorFields, buildAuthorUpdate } from '@/lib/services/moderator-fields'
import { decodeWif, decodeKeyDataBytes } from '@/lib/auth/decoder'
import { LOGIN_AVAILABLE, hostIsCanonical } from '@/lib/host'

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

/** Identifier-typed properties per document type (contracts/build.mjs). Writes must carry them as
 * 32 raw bytes; reads normalize them to base58. */
const IDENTIFIER_FIELDS: Record<string, readonly string[]> = {
  forumSettings: ['archiveOwnerId'],
  forum: ['categoryId', 'parentForumId'],
  teamMember: ['memberId'],
  thread: ['forumId', 'movedToForumId'],
  post: ['threadId', 'forumId', 'replyToId'],
  reaction: ['postId', 'postOwnerId', 'threadId'],
  report: ['postId', 'threadId'],
}

function identifierBytes(v: string, label: string): Uint8Array {
  const bytes = bs58.decode(v)
  if (bytes.length !== 32) throw new Error(`${label} is not a 32-byte identifier`)
  return bytes
}

/** Properties in the byte-preserving shape Document.fromObject needs: identifiers as raw bytes. */
export function toWireProperties(type: string, properties: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(properties)) {
    if (v === undefined || v === null) continue
    out[k] = IDENTIFIER_FIELDS[type]?.includes(k) && typeof v === 'string' ? identifierBytes(v, `${type}.${k}`) : v
  }
  return out
}

/**
 * Builds a WASM Document with Document.fromObject (the constructor round-trips properties
 * through JSON and turns byte arrays into integer arrays, which consensus rejects). A create
 * derives its id from entropy + the identity contract nonce, exactly as the transition will.
 */
async function buildDocument(input: {
  type: string
  ownerId: string
  properties: Record<string, unknown>
  revision: bigint
  nonce: bigint
  id?: string
  entropy?: Uint8Array
}) {
  const sdk = await getSdk()
  const { Document, PlatformVersion } = await import('@dashevo/evo-sdk')
  const platformVersion = new PlatformVersion(sdk.version())
  const id = input.id ?? bs58.encode(Document.generateId(input.type, input.ownerId, CONTRACT_ID, input.entropy as Uint8Array, input.nonce, platformVersion))
  return Document.fromObject({
    $formatVersion: '0',
    $id: identifierBytes(id, 'document id'),
    $ownerId: identifierBytes(input.ownerId, 'owner id'),
    $dataContractId: identifierBytes(CONTRACT_ID, 'contract id'),
    $type: input.type,
    $revision: input.revision,
    ...(input.entropy ? { $entropy: input.entropy } : {}),
    ...toWireProperties(input.type, input.properties),
  } as never, platformVersion)
}

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
    const r = raw as { toJSON?: () => Record<string, unknown>; toObject?: () => Record<string, unknown> }
    const obj = typeof r.toJSON === 'function' ? r.toJSON() : typeof r.toObject === 'function' ? r.toObject() : (raw as Record<string, unknown>)
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
      revision: revisionRaw !== undefined && revisionRaw !== null ? BigInt(typeof revisionRaw === 'bigint' ? revisionRaw : Number(revisionRaw)) : 1n,
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
  const { docs } = await queryRaw(type, options)
  return docs
}

/** Like query(), but also reports the RAW page length — callers that page
 * need to know when the index is exhausted even when some docs fail
 * normalization (a short raw page means no more results, regardless of how
 * many were kept). */
export async function queryRaw(
  type: string,
  options: {
    where?: [string, string, unknown][]
    orderBy?: [string, 'asc' | 'desc'][]
    limit?: number
    /** Exclusive $id cursor — page past the document it names. */
    startAfter?: string
  } = {},
): Promise<{ docs: DocRef[]; rawCount: number; lastId: string | null }> {
  const sdk = await getSdk()
  const page = await sdk.documents.query({
    dataContractId: CONTRACT_ID,
    documentTypeName: type,
    where: options.where as never,
    orderBy: options.orderBy as never,
    limit: options.limit ?? 100,
    ...(options.startAfter !== undefined ? { startAfter: options.startAfter } : {}),
  })
  const rawDocs = [...page.values()]
  const out: DocRef[] = []
  for (const doc of rawDocs) {
    const normalized = normalizeDoc(doc)
    if (normalized) out.push(normalized)
  }
  // The startAfter cursor must be the last raw page key — the key is the
  // raw $id the chain ordered by, so paging lands exactly at the edge of what
  // was fetched. (The normalized DocRef id is derived from the same bytes;
  // either form is valid, but the key avoids trusting the doc-object shape.)
  const keys = [...page.keys()]
  const lastId = keys.length > 0 ? String(keys[keys.length - 1]) : null
  return { docs: out, rawCount: page.size, lastId }
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
  /** True when the matched key is contract-bound or limited — Platform only
   * accepts batched transitions from those (20013 otherwise). */
  bound: boolean
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
  // Signing is disabled off the canonical host — the Pages deploy carries no
  // signing path even for a session restored by some other page. Fail closed.
  if (typeof window === 'undefined') return null
  if (!LOGIN_AVAILABLE || !hostIsCanonical(window.location.hostname)) {
    throw new Error('Signing is disabled on this host')
  }
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
    const data = decodeKeyDataBytes(key.data)
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
    if (wasmKey) {
      const limited = Boolean(wasmKey.contractBounds) || wasmKey.totalBudget != null || wasmKey.expiresAt != null
      return { identityId, identityKey: wasmKey, signer, bound: limited }
    }
  }
  try { signer.free() } catch { /* already freed */ }
  return null
  } catch (e) {
    try { signer.free() } catch { /* already freed */ }
    throw e
  }
}

function wifToPrivateKey(wif: string): { privateKey: Uint8Array; compressed: boolean } | null {
  return decodeWif(wif, NETWORK)
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
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

// The last nonce this tab handed out per identity. A node that hasn't seen our previous write yet would
// hand back the same nonce (40204 "nonce already present at tip"); never go backwards.
const usedNonce = new Map<string, bigint>()

async function freshNonce(identityId: string): Promise<bigint> {
  const sdk = await getSdk()
  const raw = (await sdk.wasm.getIdentityContractNonce(identityId, CONTRACT_ID)) ?? 0n
  const chainNext = (raw & SEQUENCE_MASK) + 1n
  const mine = (usedNonce.get(identityId) ?? 0n) + 1n
  const next = chainNext > mine ? chainNext : mine
  // Reserved now, so writes running at the same time in this tab (reacting to two posts quickly)
  // take different nonces. A write that fails leaves a gap, which Platform tolerates; the landed
  // check keeps the stale-nonce retry from duplicating a write that went through.
  usedNonce.set(identityId, next)
  return next
}

/** Records a nonce once its write went through, so the next write in this tab starts above it. */
function nonceUsed(identityId: string, nonce: bigint) {
  if ((usedNonce.get(identityId) ?? 0n) < nonce) usedNonce.set(identityId, nonce)
}


/** Runs a write once more when the chosen nonce turned out stale (the write did not happen). */
async function withNonceRetry<T>(identityId: string, write: () => Promise<T>): Promise<T> {
  try {
    return await write()
  } catch (e) {
    const text = String((e as { message?: unknown })?.message ?? e)
    // Too many failed writes left the reserved nonce too far ahead: start again from the chain's.
    if (/too far in (the )?future/i.test(text)) {
      usedNonce.delete(identityId)
      return write()
    }
    if (!STALE_NONCE.test(text)) throw e
    // The message prints the chain's nonce as "24" or "Some(24)".
    const current = text.match(/current identity nonce is (?:Some\()?(\d+)/)?.[1]
    if (current) nonceUsed(identityId, BigInt(current))
    await new Promise((r) => setTimeout(r, 1500))
    return write()
  }
}

export async function createDocument(
  type: string,
  identityId: string,
  authKeyWif: string,
  properties: Record<string, unknown>,
): Promise<DocRef> {
  return withNonceRetry(identityId, () => createOnce(type, identityId, authKeyWif, properties))
}

async function createOnce(
  type: string,
  identityId: string,
  authKeyWif: string,
  properties: Record<string, unknown>,
): Promise<DocRef> {
  const sdk = await getSdk()
  const sign = await buildSigning(identityId, authKeyWif)
  if (!sign) throw new Error('Signing context unavailable — identity or key not found')

  try {
    const entropy = crypto.getRandomValues(new Uint8Array(32))
    const nonce = await freshNonce(identityId)
    const document = await buildDocument({
      type, ownerId: identityId, properties: stripModeratorFields(type, properties), revision: 1n, nonce, entropy,
    })
    if (sign.bound) {
      // Contract-bound keys sign batches only (20013 otherwise).
      const documentId = await batchedWrite({
        kind: 'create',
        document,
        ownerId: identityId,
        nonce,
        authKeyWif,
        identityKey: sign.identityKey as never,
        landed: async (id) => !!(await get(type, id)),
      })
      nonceUsed(identityId, nonce)
      const after = await get(type, documentId).catch(() => null)
      return after ?? {
        id: documentId,
        ownerId: identityId,
        dataContractId: CONTRACT_ID,
        documentTypeName: type,
        revision: 1n,
        createdAt: 0,
        updatedAt: 0,
        properties: stripModeratorFields(type, properties),
      }
    }
    const created = await sdk.documents.create({ document, identityKey: sign.identityKey as never, signer: sign.signer })
    nonceUsed(identityId, nonce)
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
  return withNonceRetry(identityId, () => replaceOnce(existing, identityId, authKeyWif, properties))
}

async function replaceOnce(
  existing: DocRef,
  identityId: string,
  authKeyWif: string,
  properties: Record<string, unknown>,
): Promise<DocRef> {
  const sdk = await getSdk()
  const sign = await buildSigning(identityId, authKeyWif)
  if (!sign) throw new Error('Signing context unavailable — identity or key not found')

  try {
    // Author-side write: stored moderator-owned values pass through unchanged
    // (a moderator-set field must not be dropped or reset); the author may
    // never set them.
    const updatedProps = buildAuthorUpdate(existing.documentTypeName, existing.properties, properties)
    const nonce = await freshNonce(identityId)
    const document = await buildDocument({
      type: existing.documentTypeName, ownerId: identityId, properties: updatedProps, revision: existing.revision + 1n, nonce, id: existing.id,
    })
    if (sign.bound) {
      // Contract-bound keys sign batches only (20013 otherwise).
      const nextRevision = existing.revision + 1n
      await batchedWrite({
        kind: 'replace',
        document,
        ownerId: identityId,
        nonce,
        authKeyWif,
        identityKey: sign.identityKey as never,
        landed: async (id) => {
          const now = await get(existing.documentTypeName, id)
          return !!now && now.revision >= nextRevision && now.updatedAt > existing.updatedAt
        },
      })
      nonceUsed(identityId, nonce)
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
    }
    await sdk.documents.replace({ document, identityKey: sign.identityKey as never, signer: sign.signer })
    nonceUsed(identityId, nonce)
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

