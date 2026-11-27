/**
 * WIF redaction for browser-side surfaces: any error message shown to a user
 * must scrub key material first — a cause string could carry key bytes.
 * Mirrors scripts/lib/redact.mjs (the same regex); keep the two in sync.
 *
 * Covers:
 *  - base58 WIFs (32-byte payload + version + checksum → 51–52 chars) with
 *    prefixes 5, K, L (testnet/mainnet), X, 7 (Dash mainnet), and c, 9
 *    (other registries) — a maximal run of base58 characters starting with a
 *    WIF prefix is redacted whole, even when ordinary letters are glued to
 *    the right side (a WIF-shaped token with no boundary is still a key).
 *  - raw hex private keys, 64–68 chars with an optional 0x prefix — the hex
 *    branch carries its own boundaries (hex is not a base58 alphabet).
 *  - JSON byte arrays of at least 32 numbers.
 *
 * Not covered: base64 (a 44-char base64 string is indistinguishable from any
 * other short base64 in an error message — scrubbed only when a real key
 * format shows up). For anything else, tools must print `<redacted-wif>`
 * by hand.
 */
const HEX_RE = /(?<![0-9a-fA-F])(?:0x)?[0-9a-fA-F]{64}(?:[0-9a-fA-F]{2}){0,2}(?![0-9a-fA-F])/g
const WIF_RE = /[5KLc9X7][1-9A-HJ-NP-Za-km-z]{50,}/g
const ARRAY_RE = /\[\s*(?:\d{1,3}\s*,\s*){31,}\d{1,3}\s*\]/g
const ALL_RE = new RegExp([HEX_RE.source, WIF_RE.source, ARRAY_RE.source].join('|'), 'g')

export function redactWif(text: unknown): string {
  return String(text ?? '').replace(ALL_RE, '<redacted-wif>')
}
