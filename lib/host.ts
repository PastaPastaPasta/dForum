/**
 * Trusted-host derivation for the key-signing surfaces (login + moderation).
 *
 * The login flow and the moderation console hold key material in this tab.
 * They must be reachable only on hosts we control. The canonical host is an
 * explicit constant — never derived from an env var (client bundles do not
 * inline SITE_URL; reading one here would silently produce the wrong host),
 * and never a shared GitHub Pages origin: every PastaPastaPasta Pages site
 * shares it, and the key-exchange session would be readable from any of them.
 *
 * Localhost is canonical for local development only.
 */
export const CANONICAL_HOST = 'forum.dashhq.org'

export function hostIsLocal(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1' || /^127\.0\.0\./.test(host)
}

/** The host the site is canonical for, plus localhost. Hosts not in this set
 * require an explicit user acknowledgement (login) or a hard refusal
 * (moderation). */
export function hostIsCanonical(host: string): boolean {
  if (!host) return false
  return host === CANONICAL_HOST || hostIsLocal(host)
}

export function canonicalHost(): string {
  return CANONICAL_HOST
}
