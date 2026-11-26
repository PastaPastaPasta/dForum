/**
 * Shared WIF redaction for operator scripts. Anything that prints an error
 * from the chain or WASM layer must scrub base58 WIF-looking strings first —
 * a cause message could carry key material.
 *
 * Mirrors lib/redact.ts (the browser-side copy); keep the two in sync.
 * Covers testnet/mainnet Bitcoin-style prefixes (5/K/L), Dash mainnet keys
 * (X/7), and raw 64-char hex private keys.
 */
// Base58-aware boundaries (same reasoning as lib/redact.ts): \b misses a WIF
// glued to a word character.
const WIF_RE = /(?<![1-9A-HJ-NP-Za-km-z])[c9][1-9A-HJ-NP-Za-km-z]{50,51}(?![1-9A-HJ-NP-Za-km-z])|(?<![1-9A-HJ-NP-Za-km-z])[5KL][1-9A-HJ-NP-Za-km-z]{50,51}(?![1-9A-HJ-NP-Za-km-z])|(?<![1-9A-HJ-NP-Za-km-z])[X7][1-9A-HJ-NP-Za-km-z]{50,51}(?![1-9A-HJ-NP-Za-km-z])|(?<![1-9A-HJ-NP-Za-km-z])[0-9a-fA-F]{64}(?![1-9A-HJ-NP-Za-km-z])/g;

export function redactWif(text) {
  return String(text ?? '').replace(WIF_RE, '<redacted-wif>');
}
