import { describe, it, expect } from 'vitest'
import bs58check from 'bs58check'
import { redactWif } from '@/lib/redact'

function wif(privateKey: Uint8Array, version: number, compressed: boolean): string {
  const payload = new Uint8Array([version, ...privateKey, ...(compressed ? [0x01] : [])])
  return bs58check.encode(payload)
}

describe('redactWif — any key-looking string is scrubbed', () => {
  it('redacts Bitcoin testnet and mainnet WIF-like strings', () => {
    const key = new Uint8Array(32).fill(0xab)
    const text = `failed with key ${wif(key, 0xef, true)} and ${wif(key, 0xcc, true)}`
    const out = redactWif(text)
    expect(out).not.toContain('1')
    expect(out).toContain('<redacted-wif>')
  })

  it('redacts Dash mainnet keys (X/7 prefix)', () => {
    // A Dash mainnet-style string: base58 of version 0xcc (the same payload
    // the decoders use — the redactor must catch the prefix, not the version).
    const text = `oops ${wif(new Uint8Array(32).fill(1), 0xcc, true)}`
    expect(redactWif(text)).toContain('<redacted-wif>')
  })

  it('redacts raw 64-char hex private keys', () => {
    const hex = 'cd'.repeat(32)
    expect(redactWif(`leaked ${hex}`)).toContain('<redacted-wif>')
  })

  it('leaves ordinary text untouched', () => {
    const text = 'Error: timeout after 30s while fetching identity 02abc123'
    expect(redactWif(text)).toBe(text)
  })

  it('handles non-string input without throwing', () => {
    expect(redactWif(null)).toBe('')
    expect(redactWif(undefined)).toBe('')
    expect(redactWif(42)).toBe('42')
  })

  it('redacts a WIF glued to a word character (missing underscore boundary)', () => {
    // The old \b regex missed these — _ is a word character in JS regexes.
    const key = new Uint8Array(32).fill(0xab)
    const w = wif(key, 0xef, true)
    expect(redactWif(`_${w}`)).toContain('<redacted-wif>')
    expect(redactWif(`start-${w}`)).toContain('<redacted-wif>')
    expect(redactWif(`${w}-end`)).toContain('<redacted-wif>')
  })

  it('redacts a hex key with a 0x prefix', () => {
    const hex = 'ab'.repeat(32)
    expect(redactWif(`leaked 0x${hex}`)).toContain('<redacted-wif>')
  })

  it('redacts a 68-char hex WIF-payload hex', () => {
    const hex = 'ef' + 'ab'.repeat(32) + '01'
    expect(hex.length).toBe(68)
    expect(redactWif(`leaked ${hex}`)).toContain('<redacted-wif>')
  })

  it('redacts a WIF glued to a letter', () => {
    const key = new Uint8Array(32).fill(0xab)
    const w = wif(key, 0xef, true)
    const out = redactWif(`wifc${w.slice(1)}`)
    expect(out).toContain('<redacted-wif>')
  })

  it('redacts a JSON byte array of at least 32 numbers', () => {
    const arr = `[${Array.from({ length: 32 }, (_, i) => (i * 7) % 256).join(',')}]`
    expect(redactWif(`key ${arr}`)).toContain('<redacted-wif>')
  })

  it('does NOT redact a short JSON array', () => {
    expect(redactWif('status [1,2,3,4]')).toBe('status [1,2,3,4]')
  })

  it('does NOT redact a longer base58 string that merely starts with a WIF prefix', () => {
    // A 60-char base58 token starting with 'c' is not a WIF — the lookahead
    // must reject it rather than scrub the whole token.
    const long = `c${'A'.repeat(59)}`
    expect(redactWif(`note ${long}`)).toContain(long)
  })
})
