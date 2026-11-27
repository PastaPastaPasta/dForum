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
// Insert right after the charset meta (or right after <head>) so the policy
// governs every external script and all content below — a meta placed late in
// <head> would arrive after the scripts it is meant to allow.
const CHARSET_RE = /<meta\s+charset=[^>]*>/i
const HEAD_OPEN_RE = /<head>/i

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
  // Drop any existing meta (the layout used to emit one) — we re-insert it in
  // the right position so the policy governs every external script below it.
  html = html.replace(META_RE, '')
  if (CHARSET_RE.test(html)) {
    html = html.replace(CHARSET_RE, (m) => `${m}\n${meta}`)
  } else if (HEAD_OPEN_RE.test(html)) {
    html = html.replace(HEAD_OPEN_RE, (m) => `${m}\n${meta}`)
  } else {
    // No insertion point — leaving it unchanged would ship an unprotected page.
    console.warn(`WARN: no <head> in ${file} — leaving it unchanged`)
    continue
  }
  writeFileSync(file, html)
}
console.log(`csp: ${files.length} pages processed, ${inlineScripts} inline script payloads hashed`)
