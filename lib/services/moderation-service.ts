'use client'

/**
 * Moderation operations on the dForum contract.
 *
 * Every action signs with a CRITICAL authentication key (the moderator's own
 * key — the session key is HIGH and never signs moderation). The operator
 * pastes their key in the moderation console; it lives in that tab's memory
 * only (never persisted, never sent anywhere except the platform request).
 */
import type { IdentitySigner as IdentitySignerCtor } from '@dashevo/evo-sdk'
import { getSdk, getSdkClasses } from '@/lib/services/evo-sdk-service'
import { CONTRACT_ID, NETWORK } from '@/lib/constants'
import { decodeWif, decodeKeyDataBytes } from '@/lib/auth/decoder'
import { redactWif } from '@/lib/redact'
import { LOGIN_AVAILABLE, hostIsCanonical } from '@/lib/host'

export interface ModerationIdentity {
  identityId: string
  signer: InstanceType<typeof IdentitySignerCtor>
  wasmIdentity: unknown
}

export async function prepareModerator(identityId: string, criticalWif: string): Promise<ModerationIdentity> {
  // The moderation console refuses to run off the canonical host — fail closed.
  if (typeof window === 'undefined') throw new Error('Moderation is disabled outside the browser')
  if (!LOGIN_AVAILABLE || !hostIsCanonical(window.location.hostname)) {
    throw new Error('Moderation is disabled on this host')
  }
  const sdk = await getSdk()
  const { IdentitySigner } = await getSdkClasses()
  const identity = await sdk.identities.fetch(identityId)
  if (!identity) throw new Error('Moderator identity not found on the chain')
  const signer = new IdentitySigner()
  try {
    signer.addKeyFromWif(criticalWif)
    return { identityId, signer, wasmIdentity: identity }
  } catch (e) {
    try { signer.free() } catch { /* already freed */ }
    throw e
  }
}

/** Validate a CRITICAL key against the identity: must exist, type ECDSA_SECP256K1, purpose AUTHENTICATION, level CRITICAL. */
export async function validateCriticalKey(identityId: string, criticalWif: string): Promise<{ ok: boolean; reason?: string }> {
  try {
    const sdk = await getSdk()
    const identity = await sdk.identities.fetch(identityId)
    if (!identity) return { ok: false, reason: 'Identity not found' }
    const wif = decodeWif(criticalWif, NETWORK)
    if (!wif) return { ok: false, reason: `Not a ${NETWORK} secp256k1 WIF` }
    const crypto = await import('@noble/secp256k1')
    const publicKey = crypto.getPublicKey(wif.privateKey, wif.compressed)
    for (const key of identity.publicKeys as Array<{ purpose: string; securityLevel: string; keyType: string; data: Uint8Array | string; disabledAt?: bigint | number | null }>) {
      const raw = decodeKeyDataBytes(key.data)
      if (raw.length !== publicKey.length) continue
      if (!bytesEqual(raw, publicKey)) continue
      if (String(key.keyType).toUpperCase() !== 'ECDSA_SECP256K1') return { ok: false, reason: 'Key is not ECDSA_SECP256K1' }
      if (String(key.purpose).toUpperCase() !== 'AUTHENTICATION') return { ok: false, reason: 'Key is not an authentication key' }
      const level = String(key.securityLevel).toUpperCase()
      if (level !== 'CRITICAL') return { ok: false, reason: `Key is ${level} — moderation requires CRITICAL` }
      const disabledAt = key.disabledAt === undefined || key.disabledAt === null ? null : Number(key.disabledAt)
      if (disabledAt !== null && disabledAt > 0) return { ok: false, reason: 'Key is disabled (disabledAt set)' }
      return { ok: true }
    }
    return { ok: false, reason: 'This key is not registered on the identity' }
  } catch (err) {
    // Redact here too — callers render `reason` verbatim and the chain
    // error can carry the WIF in the message.
    return { ok: false, reason: redactWif(err instanceof Error ? err.message : 'Validation failed') }
  }
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

export interface Roster {
  ownerId: string | null
  appointed: string[]
  /** 'team' | 'network' | 'none' — from the contract's moderation config. */
  mode: string | null
}

let rosterCache: { value: Roster; at: number } | null = null
const ROSTER_TTL_MS = 60 * 1000

/** Cached contract roster — each page mount shares one fetch (and the link
 * stops flickering on navigation). `force` bypasses the cache. Throws on a
 * chain failure so callers can fail closed; returns null only when the
 * contract cannot be read at all. */
export async function getRoster(force = false): Promise<Roster | null> {
  if (!force && rosterCache && Date.now() - rosterCache.at < ROSTER_TTL_MS) return rosterCache.value
  const sdk = await getSdk()
  const contract = await sdk.contracts.fetch(CONTRACT_ID)
  if (!contract) return null
  const j = (contract as unknown as { toJSON?: (v: number) => Record<string, unknown> }).toJSON?.(14) ?? {}
  const ownerId = typeof j.ownerId === 'string' ? j.ownerId : null
  const mod = (j.config as Record<string, unknown>)?.moderation as Record<string, unknown> | undefined
  const moderators = mod?.moderators as Record<string, unknown> | undefined
  const identities = moderators?.identities
  const appointed = Array.isArray(identities) ? identities.map((x) => String(x)) : []
  const configType = typeof moderators?.$type === 'string' ? moderators.$type : null
  // Elected mode: the interim appointed set — the deployer's team — is what
  // moderates while the election rotates. The elected team itself is
  // derived from the chain and cannot be listed from the roster read.
  let interimAppointed: string[] = []
  if (configType === 'elected') {
    const interim = (moderators as Record<string, unknown>)?.interim as Record<string, unknown> | undefined
    const identities = interim?.identities
    if (Array.isArray(identities)) interimAppointed = identities.map((x) => String(x))
  }
  const mode = configType === 'appointedModerators' ? 'team' : configType === 'elected' ? 'network' : null
  const value: Roster = { ownerId, appointed: configType === 'elected' ? interimAppointed : appointed, mode }
  rosterCache = { value, at: Date.now() }
  return value
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
