/**
 * Shared WIF redaction for operator scripts. Anything that prints an error
 * from the chain or WASM layer must scrub key material first — a cause
 * message could carry key bytes.
 *
 * Mirrors lib/redact.ts (the browser-side copy); keep the two in sync.
 * Covers Bitcoin-style prefixes (5/K/L), Dash mainnet keys (X/7), other
 * registries (c/9) — a maximal base58 run starting with a WIF prefix is
 * redacted whole, raw 64–68-char hex private keys with an optional 0x
 * prefix, and JSON byte arrays of at least 32 numbers. Not covered: base64.
 */
const HEX_RE = /(?<![0-9a-fA-F])(?:0x)?[0-9a-fA-F]{64}(?:[0-9a-fA-F]{2}){0,2}(?![0-9a-fA-F])/g
const WIF_RE = /[5KLc9X7][1-9A-HJ-NP-Za-km-z]{50,}/g
const ARRAY_RE = /\[\s*(?:\d{1,3}\s*,\s*){31,}\d{1,3}\s*\]/g
const ALL_RE = new RegExp([HEX_RE.source, WIF_RE.source, ARRAY_RE.source].join('|'), 'g')

export function redactWif(text) {
  return String(text ?? '').replace(ALL_RE, '<redacted-wif>');
}
