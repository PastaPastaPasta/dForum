import { describe, it, expect } from 'vitest'
import bs58check from 'bs58check'
import bs58 from 'bs58'
import { decodeWif, toBase58Id, hexToBytes } from '@/lib/auth/decoder'

function wif(privateKey: Uint8Array, version: number, compressed: boolean): string {
  const payload = new Uint8Array([version, ...privateKey, ...(compressed ? [0x01] : [])])
  return bs58check.encode(payload)
}

describe('decodeWif — only the network version byte is accepted', () => {
  it('decodes a testnet compressed WIF', () => {
    const key = new Uint8Array(32).fill(0x42)
    const decoded = decodeWif(wif(key, 0xef, true), 'testnet')
    expect(decoded).not.toBeNull()
    expect(Array.from(decoded!.privateKey)).toEqual(Array.from(key))
    expect(decoded!.compressed).toBe(true)
  })

  it('decodes a mainnet uncompressed WIF', () => {
    const key = new Uint8Array(32).fill(0x11)
    const decoded = decodeWif(wif(key, 0xcc, false), 'mainnet')
    expect(decoded).not.toBeNull()
    expect(decoded!.compressed).toBe(false)
  })

  it('rejects a WIF from the wrong network', () => {
    const key = new Uint8Array(32).fill(0x42)
    expect(decodeWif(wif(key, 0xcc, true), 'testnet')).toBeNull()
    expect(decodeWif(wif(key, 0xef, true), 'mainnet')).toBeNull()
  })

  it('rejects garbage without throwing', () => {
    expect(decodeWif('not-a-wif', 'testnet')).toBeNull()
    expect(decodeWif('', 'testnet')).toBeNull()
  })
})

describe('hexToBytes', () => {
  it('decodes even-length hex and tolerates a 0x prefix', () => {
    expect(Array.from(hexToBytes('0xdeadbeef'))).toEqual([0xde, 0xad, 0xbe, 0xef])
    expect(Array.from(hexToBytes('00ff'))).toEqual([0x00, 0xff])
  })
})

describe('toBase58Id — normalizes the two hex/base58 forms', () => {
  it('normalizes a 64-char hex string to base58', () => {
    const hex = 'ab'.repeat(32)
    expect(toBase58Id(hex)).toBe(bs58.encode(Buffer.from(hex, 'hex')))
  })

  it('normalizes a base58 id to itself', () => {
    const raw = bs58.encode(new Uint8Array(32).fill(7))
    expect(toBase58Id(raw)).toBe(raw)
  })

  it('returns null for empty input', () => {
    expect(toBase58Id(null)).toBeNull()
    expect(toBase58Id('')).toBeNull()
  })
})
