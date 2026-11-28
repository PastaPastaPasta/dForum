/**
 * XenForo 2 post HTML (.bbWrapper) → Markdown for dForum. Output contains no raw HTML (the app
 * renders with skipHtml) and relies on remark-breaks, so a single newline is a line break.
 */
import { parse, HTMLElement, TextNode, type Node } from 'node-html-parser'

export interface MarkdownOptions {
  baseUrl: string
}

const BLOCK_TAGS = new Set(['div', 'p', 'section', 'article', 'center', 'figure', 'aside', 'header', 'footer'])

export function absoluteUrl(href: string, base: string): string | null {
  const raw = href.trim().replace(/^https?:\/\/web\.archive\.org\/web\/\d+[a-z_]*\//i, '').replace(/^\/web\/\d+[a-z_]*\//i, '')
  try {
    const url = new URL(raw, base)
    if (!['http:', 'https:', 'mailto:'].includes(url.protocol)) return null
    return url.href
  } catch {
    return null
  }
}

const mdUrl = (u: string) => u.replace(/[()\s<>]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`)

/** Escapes characters that would start markdown syntax inside plain text. */
export function escapeText(text: string, atLineStart: boolean): string {
  let s = text.replace(/[\\`*_[\]<>|~]/g, (c) => `\\${c}`)
  if (atLineStart) s = s.replace(/^(\s*)([#+-]|\d+[.)])(?=\s|$)/, (_m, sp: string, mark: string) => `${sp}\\${mark}`)
  return s
}

function fence(code: string): string {
  const longest = Math.max(2, ...[...code.matchAll(/`+/g)].map((m) => m[0].length))
  return '`'.repeat(longest + 1)
}

function inlineCode(code: string): string {
  const longest = Math.max(0, ...[...code.matchAll(/`+/g)].map((m) => m[0].length))
  const ticks = '`'.repeat(longest + 1)
  const pad = code.startsWith('`') || code.endsWith('`') ? ' ' : ''
  return `${ticks}${pad}${code}${pad}${ticks}`
}

const cls = (el: HTMLElement) => ` ${el.getAttribute('class') ?? ''} `
const hasClass = (el: HTMLElement, c: string) => cls(el).includes(` ${c} `)

const block = (s: string) => (s.trim() ? `\n\n${s.trim()}\n\n` : '')

function prefixLines(s: string, prefix: string, rest = prefix): string {
  return s.split('\n').map((l, i) => (i === 0 ? prefix : rest) + l).join('\n').replace(/[ \t]+$/gm, '')
}

function wrapInline(inner: string, mark: string): string {
  const m = inner.match(/^(\s*)([\s\S]*?)(\s*)$/) as RegExpMatchArray
  if (!m[2]) return inner
  return `${m[1]}${mark}${m[2]}${mark}${m[3]}`
}

function youtubeLink(el: HTMLElement): string | null {
  const key = el.getAttribute('data-media-key')
  const site = el.getAttribute('data-media-site-id')
  if (key && (!site || site === 'youtube')) return `https://www.youtube.com/watch?v=${encodeURIComponent(key.split(':')[0])}`
  const iframe = el.querySelector('iframe')
  const src = iframe?.getAttribute('src') ?? iframe?.getAttribute('data-src')
  const m = src?.match(/youtube(?:-nocookie)?\.com\/embed\/([\w-]{6,})/)
  if (m) return `https://www.youtube.com/watch?v=${m[1]}`
  return src && /^https?:/.test(src) ? src : null
}

function renderChildren(el: HTMLElement, o: MarkdownOptions, startsLine = true): string {
  let acc = ''
  for (const child of el.childNodes) acc += renderNode(child, o, acc === '' ? startsLine : /\n\s*$/.test(acc))
  return acc
}

function renderList(el: HTMLElement, o: MarkdownOptions, ordered: boolean): string {
  const items = el.childNodes.filter((n): n is HTMLElement => n instanceof HTMLElement && n.tagName === 'LI')
  const start = Number(el.getAttribute('start') ?? 1) || 1
  return block(items.map((li, i) => {
    const marker = ordered ? `${start + i}. ` : '- '
    const content = renderChildren(li, o).replace(/\n{3,}/g, '\n\n').trim() || ' '
    return prefixLines(content, marker, ' '.repeat(marker.length))
  }).join('\n'))
}

function renderTable(el: HTMLElement, o: MarkdownOptions): string {
  const rows = el.querySelectorAll('tr').map((tr) =>
    tr.childNodes.filter((n): n is HTMLElement => n instanceof HTMLElement && (n.tagName === 'TD' || n.tagName === 'TH'))
      .map((td) => renderChildren(td, o).replace(/\s*\n\s*/g, ' ').replace(/\|/g, '\\|').trim()))
  if (!rows.length) return ''
  const width = Math.max(...rows.map((r) => r.length))
  const line = (r: string[]) => `| ${[...r, ...Array(width - r.length).fill('')].join(' | ')} |`
  return block([line(rows[0]), `|${' --- |'.repeat(width)}`, ...rows.slice(1).map(line)].join('\n'))
}

function renderNode(node: Node, o: MarkdownOptions, atLineStart: boolean): string {
  if (node instanceof TextNode) {
    const text = node.text.replace(/[\t\n\r ]+/g, ' ')
    return escapeText(atLineStart ? text.replace(/^ /, '') : text, atLineStart)
  }
  if (!(node instanceof HTMLElement)) return ''
  const el = node
  const tag = el.tagName?.toLowerCase() ?? ''
  if (['script', 'style', 'noscript', 'template', 'button'].includes(tag)) return ''

  if (tag === 'blockquote' || hasClass(el, 'bbCodeBlock--quote')) {
    const name = el.getAttribute('data-quote')
    const body = el.querySelector('.bbCodeBlock-expandContent') ?? el.querySelector('.bbCodeBlock-content') ?? el
    const inner = renderChildren(body, o).replace(/\n{3,}/g, '\n\n').trim()
    const head = name ? `**${escapeText(name, false)} said:**\n` : ''
    return block(prefixLines(head + inner, '> '))
  }
  if (hasClass(el, 'bbCodeBlock--code') || tag === 'pre') {
    const codeEl = el.querySelector('code') ?? el
    const lang = (el.querySelector('.bbCodeCode')?.getAttribute('data-lang') ?? codeEl.getAttribute('class')?.match(/language-([\w+-]+)/)?.[1] ?? '').replace(/[^\w+-]/g, '')
    const code = codeEl.text.replace(/\n+$/, '')
    const f = fence(code)
    return block(`${f}${lang}\n${code}\n${f}`)
  }
  if (hasClass(el, 'bbCodeBlock--unfurl')) {
    const url = absoluteUrl(el.getAttribute('data-url') ?? el.querySelector('a')?.getAttribute('href') ?? '', o.baseUrl)
    return url ? block(`<${mdUrl(url)}>`) : ''
  }
  if (hasClass(el, 'bbCodeSpoiler') || hasClass(el, 'bbCodeInlineSpoiler')) {
    const content = el.querySelector('.bbCodeSpoiler-content') ?? el
    return block(`**Spoiler:** ${renderChildren(content, o).trim()}`)
  }
  if (hasClass(el, 'bbMediaWrapper') || hasClass(el, 'bbMediaJustifier') || tag === 'iframe') {
    const url = youtubeLink(el)
    return url ? block(`<${mdUrl(url)}>`) : ''
  }
  if (hasClass(el, 'bbCodeBlock-title') || hasClass(el, 'bbCodeBlock-expandLink') || hasClass(el, 'js-selectToQuoteEnd')) return ''

  switch (tag) {
    case 'br':
      return '\n'
    case 'hr':
      return block('---')
    case 'b':
    case 'strong':
      return wrapInline(renderChildren(el, o, atLineStart), '**')
    case 'i':
    case 'em':
      return wrapInline(renderChildren(el, o, atLineStart), '_')
    case 's':
    case 'del':
    case 'strike':
      return wrapInline(renderChildren(el, o, atLineStart), '~~')
    case 'code':
      return inlineCode(el.text)
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6':
      return block(`${'#'.repeat(Math.min(4, Math.max(2, Number(tag[1]))))} ${renderChildren(el, o).replace(/\s*\n\s*/g, ' ').trim()}`)
    case 'ul':
      return renderList(el, o, false)
    case 'ol':
      return renderList(el, o, true)
    case 'table':
      return renderTable(el, o)
    case 'img': {
      const alt = (el.getAttribute('alt') ?? '').replace(/[[\]]/g, '')
      if (hasClass(el, 'smilie')) return alt
      const candidates = [el.getAttribute('data-url'), el.getAttribute('data-src'), el.getAttribute('src')]
        .filter((v): v is string => !!v && !v.startsWith('data:'))
      const src = candidates.map((c) => absoluteUrl(c, o.baseUrl)).find((u) => u && u.replace(/\/$/, '') !== o.baseUrl.replace(/\/$/, ''))
      return src ? `![${alt}](${mdUrl(src)})` : alt ? `[image: ${alt}]` : ''
    }
    case 'a': {
      const text = renderChildren(el, o, false).trim()
      if (hasClass(el, 'username') || el.getAttribute('data-user-id')) {
        const name = el.text.trim().replace(/^@/, '')
        return name ? `@${escapeText(name, false)}` : ''
      }
      const href = absoluteUrl(el.getAttribute('href') ?? '', o.baseUrl)
      if (!href) return text
      if (/\/attachments\//.test(href)) return `[attachment: ${text || 'file'}](${mdUrl(href)})`
      const plain = el.text.trim()
      if (!text || plain === href || plain === el.getAttribute('href')) return `<${mdUrl(href)}>`
      return `[${text}](${mdUrl(href)})`
    }
    default: {
      if (BLOCK_TAGS.has(tag)) return block(renderChildren(el, o))
      return renderChildren(el, o, atLineStart)
    }
  }
}

export function xfHtmlToMarkdown(html: string, opts: MarkdownOptions): string {
  const root = parse(html, { comment: false, blockTextElements: { script: false, style: false, noscript: false } })
  return renderChildren(root, opts)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

const enc = new TextEncoder()
const bytes = (s: string) => enc.encode(s).length

/** Cuts on a code-point boundary so the head is ≤ max bytes; prefers whitespace. */
function cutAt(s: string, max: number): number {
  let used = 0
  let cut = 0
  let lastSpace = -1
  for (const ch of s) {
    const n = bytes(ch)
    if (used + n > max) break
    used += n
    cut += ch.length
    if (/\s/.test(ch)) lastSpace = cut
  }
  return lastSpace > cut / 2 ? lastSpace : Math.max(cut, 1)
}

function splitPlain(text: string, max: number): string[] {
  const out: string[] = []
  let rest = text
  while (bytes(rest) > max) {
    const nl = rest.lastIndexOf('\n', cutAt(rest, max))
    const at = nl > 0 && bytes(rest.slice(0, nl)) <= max ? nl : cutAt(rest, max)
    out.push(rest.slice(0, at).trimEnd())
    rest = rest.slice(at).replace(/^\n/, '')
  }
  if (rest.trim()) out.push(rest)
  return out
}

function splitFence(blockText: string, max: number): string[] {
  const lines = blockText.split('\n')
  const open = lines[0]
  const close = lines[lines.length - 1]
  const body = lines.slice(1, -1).join('\n')
  const room = max - bytes(open) - bytes(close) - 2
  return splitPlain(body, Math.max(16, room)).map((part) => `${open}\n${part}\n${close}`)
}

/** Paragraph-preserving split into chunks of ≤ maxBytes UTF-8; fenced code stays balanced. */
export function splitMarkdownByBytes(md: string, maxBytes: number): string[] {
  if (bytes(md) <= maxBytes) return [md]
  const blocks: string[] = []
  let cur: string[] = []
  let inFence: string | null = null
  for (const line of md.split('\n')) {
    const f = line.match(/^(`{3,}|~{3,})/)
    if (inFence) {
      cur.push(line)
      if (f && line.trim() === inFence) { blocks.push(cur.join('\n')); cur = []; inFence = null }
      continue
    }
    if (f) {
      if (cur.length) blocks.push(cur.join('\n'))
      cur = [line]
      inFence = f[1]
      continue
    }
    if (line.trim() === '') {
      if (cur.length) blocks.push(cur.join('\n'))
      cur = []
    } else cur.push(line)
  }
  if (cur.length) blocks.push(cur.join('\n'))

  const pieces = blocks.flatMap((b) => (bytes(b) <= maxBytes ? [b] : /^(`{3,}|~{3,})/.test(b) ? splitFence(b, maxBytes) : splitPlain(b, maxBytes)))
  const chunks: string[] = []
  let acc = ''
  for (const p of pieces) {
    const next = acc ? `${acc}\n\n${p}` : p
    if (bytes(next) <= maxBytes) acc = next
    else { if (acc) chunks.push(acc); acc = p }
  }
  if (acc) chunks.push(acc)
  return chunks
}
