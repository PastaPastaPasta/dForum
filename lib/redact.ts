/**
 * WIF redaction for browser-side surfaces: any error message shown to a user
 * must scrub base58 key material first — a cause string could carry key bytes.
 * Mirrors scripts/lib/redact.mjs (the same regex); keep the two in sync.
 */
// Base58-aware boundaries instead of \b: \b misses a WIF glued to a word
// character ("_cP…", "cP…_") because _ is a word char. The lookbehind/lookahead
// rejects tokens that are part of a longer base58 string (a real identity ID
// is not redacted), while still matching a WIF delimited by any other text.
const WIF_RE = /(?<![1-9A-HJ-NP-Za-km-z])[c9][1-9A-HJ-NP-Za-km-z]{50,51}(?![1-9A-HJ-NP-Za-km-z])|(?<![1-9A-HJ-NP-Za-km-z])[5KL][1-9A-HJ-NP-Za-km-z]{50,51}(?![1-9A-HJ-NP-Za-km-z])|(?<![1-9A-HJ-NP-Za-km-z])[X7][1-9A-HJ-NP-Za-km-z]{50,51}(?![1-9A-HJ-NP-Za-km-z])|(?<![1-9A-HJ-NP-Za-km-z])[0-9a-fA-F]{64}(?![1-9A-HJ-NP-Za-km-z])/g

export function redactWif(text: unknown): string {
  return String(text ?? '').replace(WIF_RE, '<redacted-wif>')
}
