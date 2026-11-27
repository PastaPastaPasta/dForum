/**
 * App Connect v2 (dashpay://connect) — dForum's request, carriers and limits.
 * Protocol: dashpay/dips#181 (App Connect), dashpay/dips#191 (derivation paths),
 * Yappr's profile (docs/APP_CONNECT_PROFILE.md in PastaPastaPasta/yappr).
 *
 * dForum is a single contract: one singleContract HIGH binding, no group, no
 * encryption key, no callback. The wallet registers the keys as part of the
 * approval, so the app never builds or signs a registration itself.
 */

/** Platform's App Connect system contract, where wallets publish loginKeyResponse documents. */
export const APP_CONNECT_RESPONSE_CONTRACT_ID = 'H8F9mP1BM55TE1ShsxPZHzhyinaMdY9bMmP85mkDhcJJ'
export const APP_CONNECT_RESPONSE_DOCUMENT_TYPE = 'loginKeyResponse'
/** Bound V1 keys exist from protocol version 14. */
export const APP_CONNECT_MIN_PROTOCOL_VERSION = 14

/** 1 DASH in credits (the wallet's unit, matching Yappr's test responder). */
export const CREDITS_PER_DASH = 100_000_000_000n
/** Proposed lifetime budget: half a DASH — a forum's writes, not a fleet's. */
export const APP_CONNECT_BUDGET = CREDITS_PER_DASH / 2n
/** Proposed lifetime: 90 days. */
export const APP_CONNECT_LIFETIME_MS = 90 * 24 * 60 * 60 * 1000

export const APP_CONNECT_LABEL = 'dForum'
