/**
 * App Connect's chain reads over the evo-sdk: the loginKeyResponse candidates
 * and the identity/key verification reads. Every read goes to the network
 * (the SDK's default facade methods); identity reads bypass any identity
 * cache so a key added moments ago is exactly what the verifier checks.
 */
import bs58 from 'bs58'
import type { EvoSDK } from '@dashevo/evo-sdk'
import type {
  AppConnectCandidate,
  AppConnectIdentityPort,
  AppConnectResponsePort,
} from 'platform-auth'
import { getSdk } from '@/lib/services/evo-sdk-service'
import { toAppConnectIdentityKeys, type WasmIdentityKeyLike } from './key-mapping'
import { APP_CONNECT_RESPONSE_CONTRACT_ID, APP_CONNECT_RESPONSE_DOCUMENT_TYPE } from './config'

function toBase64OfBytes(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

export function toBytes(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value
  if (Array.isArray(value) && value.every((n) => typeof n === 'number')) return new Uint8Array(value)
  if (typeof value === 'string') {
    const hex = value.startsWith('0x') ? value.slice(2) : value
    if (hex.length > 0 && hex.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(hex)) {
      const bytes = new Uint8Array(hex.length / 2)
      for (let i = 0; i < hex.length / 2; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
      return bytes
    }
    try {
      const binary = atob(value)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
      return bytes
    } catch {
      return null
    }
  }
  // The wasm document shape may surface a Buffer-like {type:'Buffer', data:number[]}
  if (value && typeof value === 'object' && 'type' in value && 'data' in value) {
    const like = value as { type: string; data: unknown }
    if (like.type === 'Buffer') return toBytes(like.data)
  }
  return null
}

/** Identifier-like fields arrive as base58 strings or bytes; normalize to a base58 id. */
export function idToBase58(value: unknown): string | null {
  if (!value) return null
  if (typeof value === 'string') {
    if (/^[0-9a-fA-F]{64}$/.test(value)) {
      const bytes = new Uint8Array(32)
      for (let i = 0; i < 32; i++) bytes[i] = parseInt(value.slice(i * 2, i * 2 + 2), 16)
      return bs58.encode(bytes)
    }
    try {
      return bs58.encode(bs58.decode(value))
    } catch {
      return value
    }
  }
  if (value instanceof Uint8Array) return bs58.encode(value)
  if (Array.isArray(value) && value.length === 32) return bs58.encode(Uint8Array.from(value))
  return null
}

function documentView(doc: unknown): Record<string, unknown> | null {
  const obj = doc as { toObject?: () => unknown; toJSON?: () => unknown }
  const raw = (typeof obj?.toObject === 'function' ? obj.toObject() : obj?.toJSON ? obj.toJSON() : doc) as Record<string, unknown>
  return raw && typeof raw === 'object' ? raw : null
}

export function createAppConnectIdentityPort(): AppConnectIdentityPort {
  return {
    async getIdentityFresh(identityId: string) {
      const sdk = await getSdk()
      const identity = await sdk.identities.fetch(identityId)
      if (!identity) return null
      return {
        id: identity.id.toBase58?.() ?? identityId,
        publicKeys: toAppConnectIdentityKeys(identity.publicKeys as unknown as WasmIdentityKeyLike[]),
      }
    },

    async remainingBudgets(identityId: string, keyIds: number[]) {
      const sdk = await getSdk()
      const budgets = await sdk.identities.keysRemainingBudgets(identityId, keyIds)
      const result = new Map<number, bigint | undefined>()
      for (const [keyId, remaining] of budgets) result.set(Number(keyId), remaining ?? undefined)
      return result
    },

    // dForum asks for no encryption binding, so the verifier never resolves
    // one; the method exists because the port contract requires it.
    async contractKeys() {
      return []
    },
    // dForum asks for no contract-group binding (the verifier only consults
    // it for that kind), so a group question has no honest answer here.
    async groupInfo() {
      return null
    },
  }
}

export function createAppConnectResponsePort(): AppConnectResponsePort {
  return {
    async listCandidates(requestHash: Uint8Array, hint: string | undefined, startAfter: string | undefined, limit: number) {
      const sdk: EvoSDK = await getSdk()
      const hashBase64 = toBase64OfBytes(requestHash)
      const where: [string, string, string][] = [['appEphemeralPubKeyHash', '==', hashBase64]]
      if (hint) where.push(['$ownerId', '==', hint])
      else if (startAfter) where.push(['$ownerId', '>', startAfter])
      const response = await sdk.documents.query({
        dataContractId: APP_CONNECT_RESPONSE_CONTRACT_ID,
        documentTypeName: APP_CONNECT_RESPONSE_DOCUMENT_TYPE,
        where: where as never,
        orderBy: [['$ownerId', 'asc']] as never,
        limit,
      })
      const candidates: AppConnectCandidate[] = []
      for (const doc of response.values()) {
        if (!doc) continue
        const plain = documentView(doc)
        if (!plain) continue
        const ownerId = idToBase58(plain.$ownerId ?? plain.ownerId)
        if (!ownerId) continue
        const walletEphemeralPubKey = toBytes(plain.walletEphemeralPubKey)
        const encryptedPayload = toBytes(plain.encryptedPayload)
        if (!walletEphemeralPubKey || walletEphemeralPubKey.length !== 33) continue
        if (!encryptedPayload || encryptedPayload.length < 28) continue
        candidates.push({ ownerId, walletEphemeralPubKey, encryptedPayload })
      }
      return candidates.sort((a, b) => compareIds(a.ownerId, b.ownerId))
    },
  }
}

function compareIds(a: string, b: string): number {
  const left = bs58.decode(a)
  const right = bs58.decode(b)
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    if (left[i] !== right[i]) return left[i] - right[i]
  }
  return left.length - right.length
}

/** Block time and protocol version from the latest proved response. */
export async function appConnectChainStatus(): Promise<{ protocolVersion: number; blockTimeMs: number }> {
  const sdk = await getSdk()
  const { metadata } = await sdk.protocol.versionUpgradeStateWithProof()
  return { protocolVersion: metadata.protocolVersion, blockTimeMs: Number(metadata.timeMs) }
}
