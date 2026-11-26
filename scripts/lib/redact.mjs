/**
 * Shared WIF redaction for operator scripts. Anything that prints an error
 * from the chain or WASM layer must scrub base58 WIF-looking strings first —
 * a cause message could carry key material.
 *
 * Mirrors lib/redact.ts (the browser-side copy); keep the two in sync.
 * Covers testnet/mainnet Bitcoin-style prefixes (5/K/L), Dash mainnet keys
 * (X/7), and raw 64-char hex private keys.
 */
export function redactWif(text) {
  return String(text ?? '').replace(
    /\b[c9][1-9A-HJ-NP-Za-km-z]{50,51}\b|\b[5KL][1-9A-HJ-NP-Za-km-z]{50,51}\b|\b[X7][1-9A-HJ-NP-Za-km-z]{50,51}\b|\b[0-9a-fA-F]{64}\b/g,
    '<redacted-wif>',
  );
}
