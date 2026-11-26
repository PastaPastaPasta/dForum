/**
 * Shared key-data decoder — hex (even-length, hex-charset) or base64, the
 * two encodings the platform/SDK hands keys back in. One decoder everywhere
 * so validation paths never disagree.
 */
import bs58 from 'bs58'
import bs58check from 'bs58check'

export function decodeKeyDataBytes(data: Uint8Array | string): Uint8Array {
  if (data instanceof Uint8Array) return data
  const str = String(data)
  if (/^(?:[0-9a-fA-F]{2})+$/.test(str) && str.length % 2 === 0) {
    const bytes = new Uint8Array(str.length / 2)
    for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(str.slice(i * 2, i * 2 + 2), 16)
    return bytes
  }
  const binary = atob(str)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex
  const bytes = new Uint8Array(clean.length / 2)
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  return bytes
}

export function toBase64OfBytes(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

export function fromBase64(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/** Decode a WIF — only the network's version byte is accepted. Returns null
 * for anything else (never guesses). */
export function decodeWif(wif: string, network: 'testnet' | 'mainnet'): { privateKey: Uint8Array; compressed: boolean } | null {
  let decoded: Uint8Array
  try {
    decoded = bs58check.decode(wif)
  } catch {
    return null
  }
  const expected = network === 'mainnet' ? 0xcc : 0xef
  if (decoded[0] !== expected) return null
  if (decoded.length === 34 && decoded[33] === 0x01) {
    return { privateKey: decoded.slice(1, 33), compressed: true }
  }
  if (decoded.length === 33) {
    return { privateKey: decoded.slice(1, 33), compressed: false }
  }
  return null
}

export function toBase58Id(value: unknown): string | null {
  if (!value) return null
  if (typeof value === 'string') {
    if (/^[0-9a-fA-F]{64}$/.test(value)) return bs58.encode(Buffer.from(value, 'hex'))
    try { return bs58.encode(bs58.decode(value)) } catch { return value }
  }
  if (value instanceof Uint8Array) return bs58.encode(value)
  if (Array.isArray(value) && value.length === 32) return bs58.encode(Uint8Array.from(value))
  return null
}
