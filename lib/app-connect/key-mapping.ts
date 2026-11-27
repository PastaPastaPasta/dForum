/**
 * Maps a wasm `IdentityPublicKey` to the App Connect verifier's shape.
 * Faithful: an unreadable bounds kind or data leaves the key out of the set,
 * so an unreadable bound never looks unbound (the verifier must not accept it).
 */
import type { AppConnectIdentityKey, AppConnectKeyBounds } from 'platform-auth'

export interface WasmIdentityKeyLike {
  keyId: number
  keyTypeNumber: number
  purposeNumber: number
  securityLevelNumber: number
  /** Hex string (the wasm getter) or bytes. */
  data: unknown
  disabledAt?: bigint | number | null
  totalBudget?: bigint | null
  expiresAt?: bigint | number | null
  contractBounds?: { toJSON(): { $type: string; id: string; documentTypeName?: string } } | null
}

const HEX_PATTERN = /^[0-9a-fA-F]*$/

function normalizeBytes(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value
  if (Array.isArray(value)) {
    return value.every((n) => typeof n === 'number') ? new Uint8Array(value) : null
  }
  if (typeof value === 'string') {
    const hex = value.startsWith('0x') ? value.slice(2) : value
    if (hex.length > 0 && hex.length % 2 === 0 && HEX_PATTERN.test(hex)) {
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
  return null
}

function toBounds(bounds: WasmIdentityKeyLike['contractBounds']): AppConnectKeyBounds | null | undefined {
  if (!bounds) return undefined
  const json = bounds.toJSON()
  switch (json.$type) {
    case 'singleContract':
      return { kind: 'singleContract', contractId: json.id }
    case 'documentType':
      return json.documentTypeName ? { kind: 'documentType', contractId: json.id, documentTypeName: json.documentTypeName } : null
    case 'contractGroup':
      return { kind: 'contractGroup', groupId: json.id }
    default:
      return null
  }
}

function toNumber(value: bigint | number | null | undefined): number | undefined {
  if (value === null || value === undefined) return undefined
  return typeof value === 'bigint' ? Number(value) : value
}

export function toAppConnectIdentityKey(key: WasmIdentityKeyLike): AppConnectIdentityKey | null {
  const data = normalizeBytes(key.data)
  const bounds = toBounds(key.contractBounds)
  if (!data || bounds === null) return null
  return {
    id: key.keyId,
    type: key.keyTypeNumber,
    purpose: key.purposeNumber,
    securityLevel: key.securityLevelNumber,
    data,
    ...(key.disabledAt !== null && key.disabledAt !== undefined ? { disabledAt: toNumber(key.disabledAt) } : {}),
    ...(bounds ? { bounds } : {}),
    ...(key.totalBudget !== null && key.totalBudget !== undefined ? { totalBudget: key.totalBudget } : {}),
    ...(key.expiresAt !== null && key.expiresAt !== undefined ? { expiresAt: toNumber(key.expiresAt) } : {}),
  }
}

export function toAppConnectIdentityKeys(keys: readonly WasmIdentityKeyLike[]): AppConnectIdentityKey[] {
  return keys.flatMap((key) => {
    const mapped = toAppConnectIdentityKey(key)
    return mapped ? [mapped] : []
  })
}
