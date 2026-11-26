/**
 * WIF redaction for browser-side surfaces: any error message shown to a user
 * must scrub base58 key material first — a cause string could carry key bytes.
 * Mirrors scripts/lib/redact.mjs (the same regex); keep the two in sync.
 */
export function redactWif(text: unknown): string {
  return String(text ?? '').replace(
    /\b[c9][1-9A-HJ-NP-Za-km-z]{50,51}\b|\b[5KL][1-9A-HJ-NP-Za-km-z]{50,51}\b|\b[X7][1-9A-HJ-NP-Za-km-z]{50,51}\b|\b[0-9a-fA-F]{64}\b/g,
    '<redacted-wif>',
  )
}
