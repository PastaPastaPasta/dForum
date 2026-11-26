/**
 * Trusted-host derivation for the key-signing surfaces (login + moderation).
 *
 * The login flow and the moderation console hold key material in this tab.
 * They must be reachable only on hosts we control: the canonical host from
 * SITE_URL (build-time) plus localhost for development. Everything else —
 * including the shared GitHub Pages origin that hosts other sites — requires
 * an explicit user acknowledgement, and /moderation refuses outright.
 */
const SITE_URL_HOST = (() => {
  try {
    return new URL(process.env.SITE_URL || 'https://forum.dashhq.org').hostname
  } catch {
    return 'forum.dashhq.org'
  }
})()

export function hostIsLocal(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1' || /^127\.0\.0\./.test(host)
}

/** The host the site is canonical for at build time (SITE_URL hostname), plus
 * localhost. Hosts not in this set require an acknowledgement. */
export function hostIsCanonical(host: string): boolean {
  if (!host) return false
  return host === SITE_URL_HOST || hostIsLocal(host)
}

export function canonicalHost(): string {
  return SITE_URL_HOST
}
