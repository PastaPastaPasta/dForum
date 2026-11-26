/**
 * Post-login redirect target validation (login flow + session-safe surfaces).
 *
 * The value comes from an untrusted query param (`?next=`), is normalised via
 * URL parsing — which collapses dot segments — and is assigned to
 * window.location. So the result is checked twice: once on the raw input and
 * once after normalisation, and it is always confined to this app's base path.
 *
 * Rules (all enforced):
 *  - the raw value must start with exactly one `/` — never `//` (protocol-
 *    relative), never a backslash (browsers treat `\` as `/`), never whitespace
 *    (browsers strip tabs inside URLs, which is what turned `/./\t/evil.com`
 *    into `//evil.com`).
 *  - the parsed URL must be same-origin.
 *  - the normalised result must not start with `//`.
 *  - on the Pages deploy (BASE_PATH='/dForum') the result must stay under
 *    `/dForum/` — a same-origin path outside it would navigate to a sibling
 *    repo on the shared GitHub Pages origin, where the session keys stored in
 *    sessionStorage are readable from that page.
 */
export function safeNextPath(raw: string | null, origin: string): string | null {
  if (!raw) return null
  const trimmed = raw.trim()
  if (!trimmed.startsWith('/')) return null
  if (trimmed.startsWith('//')) return null
  if (/[\\\s]/.test(trimmed)) return null

  const base = process.env.NEXT_PUBLIC_BASE_PATH || ''
  try {
    const url = new URL(trimmed, origin)
    if (url.origin !== origin) return null

    // Normalisation must not produce a protocol-relative path.
    if (url.pathname.startsWith('//')) return null

    let path = url.pathname
    // The raw path may or may not already carry the base path — on the Pages
    // deploy, app-relative paths (`/t/<id>`) must be re-rooted under it.
    // A bare base (`/dForum`) is the home page — the slash boundary is
    // normalized so `/dForum` and `/dForum/` can never collide differently.
    if (base && path !== base && path !== base + '/' && !path.startsWith(base + '/')) {
      path = base + path
    }

    const result = path + url.search + url.hash
    if (result.startsWith('//')) return null
    if (base && !result.startsWith(base + '/') && result !== base) return null
    return result
  } catch {
    return null
  }
}
