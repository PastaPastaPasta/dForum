#!/usr/bin/env node
/**
 * Post-build CSP hashing (static export).
 *
 * Next's static export emits inline <script> blocks (the App Router RSC
 * payload — per-page content), which force 'unsafe-inline' if the CSP has to
 * come from a meta tag. Instead we hash every inline script body in each page
 * and rewrite that page's CSP meta to allow exactly those hashes. External
 * scripts (src=...) are allowed via 'self'.
 *
 * Inline styles (one avatar gradient) still require style-src 'unsafe-inline'
 * — hashes don't apply to style attributes, and CSS injection here would
 * require an attacker-controlled attribute, which does not exist in this
 * app.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

const OUT = 'out'
const CSP_FALLBACK =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' https: wss:; worker-src 'self' blob:; child-src 'self' blob:; frame-src 'none'; base-uri 'self'; form-action 'self'"

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else if (entry.endsWith('.html')) out.push(p)
  }
  return out
}

const JS_RE = /<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/gi
const META_RE = /<meta\s+http-equiv="Content-Security-Policy"[^>]*\/?>/i
const HEAD_CLOSE_RE = /<\/head>/i

const files = walk(OUT)
let inlineScripts = 0
for (const file of files) {
  let html = readFileSync(file, 'utf8')
  const scripts = new Set()
  for (const m of html.matchAll(JS_RE)) {
    if (m[2].trim()) scripts.add(m[2])
  }
  inlineScripts += scripts.size
  const hashes = [...scripts].map(
    (body) => `'sha256-${createHash('sha256').update(body).digest('base64')}'`,
  )
  const csp =
    "default-src 'self'; script-src 'self'" +
    (hashes.length ? ' ' + hashes.join(' ') : '') +
    " 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' https: wss:; worker-src 'self' blob:; child-src 'self' blob:; frame-src 'none'; base-uri 'self'; form-action 'self'"
  const meta = `<meta http-equiv="Content-Security-Policy" content="${csp}">`
  if (META_RE.test(html)) {
    html = html.replace(META_RE, () => meta)
  } else {
    // No CSP meta anywhere — inject one before </head>. A static export hosts
    // no headers, so the only enforcement point is the meta.
    if (!HEAD_CLOSE_RE.test(html)) {
      console.warn(`WARN: no </head> in ${file} — leaving it unchanged`)
      continue
    }
    html = html.replace(HEAD_CLOSE_RE, (m) => `${meta}${m}`)
  }
  writeFileSync(file, html)
}
console.log(`csp: ${files.length} pages processed, ${inlineScripts} inline script payloads hashed`)
