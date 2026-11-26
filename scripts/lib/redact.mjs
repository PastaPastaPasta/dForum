/**
 * Shared WIF redaction for operator scripts. Anything that prints an error
 * from the chain or WASM layer must scrub base58 WIF-looking strings first —
 * a cause message could carry key material.
 */
export function redactWif(text) {
  return String(text ?? '').replace(/\b[c9][1-9A-HJ-NP-Za-km-z]{50,51}\b|\b[5KL][1-9A-HJ-NP-Za-km-z]{50,51}\b/g, '<redacted-wif>');
}
