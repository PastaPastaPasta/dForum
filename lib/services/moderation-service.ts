'use client'

/**
 * Moderation operations on the dForum contract.
 *
 * Every action signs with a CRITICAL authentication key (the moderator's own
 * key — the session key is HIGH and never signs moderation). The operator
 * pastes their key in the moderation console; it lives in sessionStorage
 * only and is never sent anywhere except the platform.
 */
import type { IdentitySigner as IdentitySignerCtor } from '@dashevo/evo-sdk'
import { getSdk, getSdkClasses } from '@/lib/services/evo-sdk-service'
import { CONTRACT_ID } from '@/lib/constants'

export interface ModerationIdentity {
  identityId: string
  signer: InstanceType<typeof IdentitySignerCtor>
  wasmIdentity: unknown
}

export async function prepareModerator(identityId: string, criticalWif: string): Promise<ModerationIdentity> {
  const sdk = await getSdk()
  const { IdentitySigner } = await getSdkClasses()
  const identity = await sdk.identities.fetch(identityId)
  if (!identity) throw new Error('Moderator identity not found on the chain')
  const signer = new IdentitySigner()
  signer.addKeyFromWif(criticalWif)
  return { identityId, signer, wasmIdentity: identity }
}

/** Validate a CRITICAL key against the identity: must exist, type ECDSA_SECP256K1, purpose AUTHENTICATION, level CRITICAL. */
export async function validateCriticalKey(identityId: string, criticalWif: string): Promise<{ ok: boolean; reason?: string }> {
  try {
    const sdk = await getSdk()
    const identity = await sdk.identities.fetch(identityId)
    if (!identity) return { ok: false, reason: 'Identity not found' }
    const crypto = await import('@noble/secp256k1')
    const bs58check = (await import('bs58check')).default
    let decoded: Uint8Array
    try {
      decoded = bs58check.decode(criticalWif)
    } catch {
      return { ok: false, reason: 'Not a valid WIF' }
    }
    if (decoded.length !== 34 && decoded.length !== 33) return { ok: false, reason: 'Not a valid secp256k1 WIF' }
    const compressed = decoded.length === 34
    const privateKey = decoded.slice(1, 33)
    const publicKey = crypto.getPublicKey(privateKey, compressed)
    for (const key of identity.publicKeys as Array<{ purpose: string; securityLevel: string; keyType: string; data: Uint8Array | string }>) {
      const raw = key.data instanceof Uint8Array ? key.data : hexToBytes(String(key.data))
      if (raw.length !== publicKey.length) continue
      if (!bytesEqual(raw, publicKey)) continue
      if (String(key.keyType).toUpperCase() !== 'ECDSA_SECP256K1') return { ok: false, reason: 'Key is not ECDSA_SECP256K1' }
      if (String(key.purpose).toUpperCase() !== 'AUTHENTICATION') return { ok: false, reason: 'Key is not an authentication key' }
      const level = String(key.securityLevel).toUpperCase()
      if (level !== 'CRITICAL') return { ok: false, reason: `Key is ${level} — moderation requires CRITICAL` }
      return { ok: true }
    }
    return { ok: false, reason: 'This key is not registered on the identity' }
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : 'Validation failed' }
  }
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex
  const bytes = new Uint8Array(clean.length / 2)
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  return bytes
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

export async function getRoster(): Promise<{ ownerId: string | null; appointed: string[] } | null> {
  const sdk = await getSdk()
  const contract = await sdk.contracts.fetch(CONTRACT_ID)
  if (!contract) return null
  const j = (contract as unknown as { toJSON?: (v: number) => Record<string, unknown> }).toJSON?.(14) ?? {}
  const ownerId = typeof j.ownerId === 'string' ? j.ownerId : null
  const mod = (j.config as Record<string, unknown>)?.moderation as Record<string, unknown> | undefined
  const moderators = mod?.moderators as Record<string, unknown> | undefined
  const identities = moderators?.identities
  const appointed = Array.isArray(identities) ? identities.map((x) => String(x)) : []
  return { ownerId, appointed }
}

/** A thread lock/unlock, sticky toggle, or modState/modNote change via changeFields. */
export async function changeDocumentFields(
  moderator: ModerationIdentity,
  documentTypeName: 'thread' | 'post' | 'report' | 'profile',
  documentId: string,
  fields: Record<string, unknown>,
  reasonText = '',
): Promise<void> {
  const sdk = await getSdk()
  await sdk.contracts.moderatorChangeDocumentFields({
    identity: moderator.wasmIdentity as never,
    contractId: CONTRACT_ID,
    documentTypeName,
    documentId,
    fields,
    signer: moderator.signer,
    reason: reasonText ? { text: reasonText } : undefined,
  })
}

/** Moderator-delete a document on the contract (thread, post, report, profile). */
export async function deleteDocument(
  moderator: ModerationIdentity,
  documentTypeName: 'thread' | 'post' | 'report' | 'profile',
  documentId: string,
  reasonText = '',
): Promise<void> {
  const sdk = await getSdk()
  await sdk.contracts.moderatorDeleteDocument({
    identity: moderator.wasmIdentity as never,
    contractId: CONTRACT_ID,
    documentTypeName,
    documentId,
    signer: moderator.signer,
    reason: reasonText ? { text: reasonText } : undefined,
  })
}

/** Restore a moderator-deleted document. */
export async function restoreDocument(
  moderator: ModerationIdentity,
  documentTypeName: 'thread' | 'post' | 'report' | 'profile',
  document: unknown,
): Promise<void> {
  const sdk = await getSdk()
  await sdk.contracts.moderatorRestoreDocument({
    identity: moderator.wasmIdentity as never,
    contractId: CONTRACT_ID,
    documentTypeName,
    signer: moderator.signer,
    document: document as never,
  })
}

/** Ban an identity on the contract. */
export async function banUser(moderator: ModerationIdentity, targetIdentityId: string, reasonText: string): Promise<void> {
  const sdk = await getSdk()
  await sdk.contracts.banUser({
    identity: moderator.wasmIdentity as never,
    contractId: CONTRACT_ID,
    identityId: targetIdentityId,
    signer: moderator.signer,
    reason: { text: reasonText },
  })
}

/** Remove an identity from the banlist. */
export async function unbanUser(moderator: ModerationIdentity, targetIdentityId: string): Promise<void> {
  const sdk = await getSdk()
  await sdk.contracts.unbanUser({
    identity: moderator.wasmIdentity as never,
    contractId: CONTRACT_ID,
    identityId: targetIdentityId,
    signer: moderator.signer,
  })
}

/** Suspend an identity until a block time (ms). */
export async function suspendUser(
  moderator: ModerationIdentity,
  targetIdentityId: string,
  untilMs: bigint,
  reasonText: string,
): Promise<void> {
  const sdk = await getSdk()
  await sdk.contracts.suspendUser({
    identity: moderator.wasmIdentity as never,
    contractId: CONTRACT_ID,
    identityId: targetIdentityId,
    signer: moderator.signer,
    until: untilMs,
    reason: { text: reasonText },
  })
}

/** Remove an identity from the suspension list. */
export async function unsuspendUser(moderator: ModerationIdentity, targetIdentityId: string): Promise<void> {
  const sdk = await getSdk()
  await sdk.contracts.unsuspendUser({
    identity: moderator.wasmIdentity as never,
    contractId: CONTRACT_ID,
    identityId: targetIdentityId,
    signer: moderator.signer,
  })
}

/** Warn an identity (adds a warning; bars nothing). */
export async function warnUser(moderator: ModerationIdentity, targetIdentityId: string, reasonText: string): Promise<void> {
  const sdk = await getSdk()
  await sdk.contracts.warnUser({
    identity: moderator.wasmIdentity as never,
    contractId: CONTRACT_ID,
    identityId: targetIdentityId,
    signer: moderator.signer,
    reason: { text: reasonText },
  })
}

/** Clear all warnings an identity carries. */
export async function clearWarnings(moderator: ModerationIdentity, targetIdentityId: string): Promise<void> {
  const sdk = await getSdk()
  await sdk.contracts.clearUserWarnings({
    identity: moderator.wasmIdentity as never,
    contractId: CONTRACT_ID,
    identityId: targetIdentityId,
    signer: moderator.signer,
  })
}

/** Fetch a status page for an identity on the contract. */
export async function moderationStatus(targetIdentityId: string) {
  const sdk = await getSdk()
  return sdk.contracts.moderationStatus({
    contractId: CONTRACT_ID,
    identityId: targetIdentityId,
  })
}
