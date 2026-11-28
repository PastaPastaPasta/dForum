/**
 * XenForo BBCode (REST API `message`) → Markdown, same output rules as to-markdown.ts. Tolerant:
 * unknown or unbalanced tags are kept as text, nothing throws.
 */
import { absoluteUrl, escapeText } from './to-markdown.ts'

interface Tag { name: string; option: string | null; children: Item[] }
type Item = string | Tag

const KNOWN = new Set(['b', 'i', 'u', 's', 'url', 'email', 'img', 'quote', 'code', 'icode', 'php', 'html', 'list', 'color', 'size', 'font',
  'center', 'left', 'right', 'justify', 'indent', 'spoiler', 'ispoiler', 'media', 'attach', 'user', 'plain', 'heading', 'h', 'hr', 'table', 'tr', 'td', 'th', 'sub', 'sup'])
const RAW = new Set(['code', 'icode', 'php', 'html', 'plain'])

function parseBb(src: string): Item[] {
  const root: Tag = { name: '', option: null, children: [] }
  const stack: Array<{ tag: Tag; raw: string }> = [{ tag: root, raw: '' }]
  const re = /\[(\/?)([a-z0-9]+|\*)(?:=("[^"\]]*"|'[^'\]]*'|[^\]]*))?\]/gi
  let last = 0
  let m: RegExpExecArray | null
  const pushText = (t: string) => { if (t) stack[stack.length - 1].tag.children.push(t) }
  while ((m = re.exec(src))) {
    const [whole, closing, rawName, rawOpt] = m
    const name = rawName.toLowerCase()
    const top = stack[stack.length - 1]
    if (RAW.has(top.tag.name) && !(closing && name === top.tag.name)) continue
    if (!KNOWN.has(name) && name !== '*') continue
    pushText(src.slice(last, m.index))
    last = m.index + whole.length
    if (name === '*') { top.tag.children.push({ name: '*', option: null, children: [] }); continue }
    if (name === 'hr') { top.tag.children.push({ name: 'hr', option: null, children: [] }); continue }
    if (!closing) {
      const tag: Tag = { name, option: rawOpt ? rawOpt.replace(/^["']|["']$/g, '') : null, children: [] }
      top.tag.children.push(tag)
      stack.push({ tag, raw: whole })
      continue
    }
    const at = stack.map((s) => s.tag.name).lastIndexOf(name)
    if (at <= 0) { pushText(whole); continue }
    stack.length = at
  }
  pushText(src.slice(last))
  return root.children
}

const flat = (items: Item[]): string => items.map((i) => (typeof i === 'string' ? i : flat(i.children))).join('')
const block = (s: string) => (s.trim() ? `\n\n${s.trim()}\n\n` : '')
const mdUrl = (u: string) => u.replace(/[()\s<>]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`)
const prefix = (s: string, p: string, rest = p) => s.split('\n').map((l, i) => (i ? rest : p) + l).join('\n').replace(/[ \t]+$/gm, '')
const wrap = (s: string, mark: string) => {
  const m = s.match(/^(\s*)([\s\S]*?)(\s*)$/) as RegExpMatchArray
  return m[2] ? `${m[1]}${mark}${m[2]}${mark}${m[3]}` : s
}
function fence(code: string) {
  return '`'.repeat(Math.max(2, ...[...code.matchAll(/`+/g)].map((x) => x[0].length)) + 1)
}

function render(items: Item[], base: string): string {
  let acc = ''
  for (const it of items) {
    if (typeof it === 'string') {
      acc += it.split('\n').map((line, i) => escapeText(line, i > 0 || acc === '' || acc.endsWith('\n'))).join('\n')
      continue
    }
    acc += renderTag(it, base)
  }
  return acc
}

function renderTag(t: Tag, base: string): string {
  const inner = () => render(t.children, base)
  switch (t.name) {
    case 'b': return wrap(inner(), '**')
    case 'i': return wrap(inner(), '_')
    case 's': return wrap(inner(), '~~')
    case 'hr': return block('---')
    case 'url':
    case 'email': {
      const target = t.option ?? flat(t.children).trim()
      const href = t.name === 'email' ? `mailto:${target}` : absoluteUrl(target, base)
      if (!href) return inner()
      const label = inner().trim()
      return !t.option || label === target ? `<${mdUrl(href)}>` : `[${label}](${mdUrl(href)})`
    }
    case 'img': {
      const src = absoluteUrl(flat(t.children).trim(), base)
      return src ? `![](${mdUrl(src)})` : ''
    }
    case 'quote': {
      const name = t.option?.split(',')[0].trim()
      const body = inner().replace(/\n{3,}/g, '\n\n').trim()
      return block(prefix((name ? `**${escapeText(name, false)} said:**\n` : '') + body, '> '))
    }
    case 'code':
    case 'php':
    case 'html': {
      const code = flat(t.children).replace(/^\n+|\n+$/g, '')
      const f = fence(code)
      const lang = t.name === 'code' ? (t.option ?? '').replace(/[^\w+-]/g, '') : t.name
      return block(`${f}${lang}\n${code}\n${f}`)
    }
    case 'icode': {
      const code = flat(t.children)
      const ticks = '`'.repeat(Math.max(0, ...[...code.matchAll(/`+/g)].map((x) => x[0].length)) + 1)
      return `${ticks}${code}${ticks}`
    }
    case 'plain': return escapeText(flat(t.children), false)
    case 'list': {
      const items: Item[][] = []
      for (const c of t.children) {
        if (typeof c !== 'string' && c.name === '*') items.push([])
        else if (items.length) items[items.length - 1].push(c)
        else if (typeof c === 'string' && !c.trim()) continue
        else items.push([c])
      }
      const ordered = t.option !== null && /^[1aAiI]$/.test(t.option)
      return block(items.map((it, i) => {
        const marker = ordered ? `${i + 1}. ` : '- '
        return prefix(render(it, base).trim() || ' ', marker, ' '.repeat(marker.length))
      }).join('\n'))
    }
    case 'spoiler':
    case 'ispoiler': return block(`**Spoiler${t.option ? `: ${escapeText(t.option, false)}` : ''}** ${inner().trim()}`)
    case 'media': {
      const id = flat(t.children).trim()
      if ((t.option ?? '').toLowerCase() === 'youtube' && /^[\w-]{6,}$/.test(id)) return block(`<https://www.youtube.com/watch?v=${id}>`)
      return id ? block(`media: ${escapeText(id, false)}`) : ''
    }
    case 'attach': return `[attachment ${escapeText(flat(t.children).trim(), false)}]`
    case 'user': return `@${escapeText(flat(t.children).trim().replace(/^@/, ''), false)}`
    case 'heading':
    case 'h': return block(`## ${inner().replace(/\s*\n\s*/g, ' ').trim()}`)
    case 'center':
    case 'left':
    case 'right':
    case 'justify':
    case 'indent': return block(inner())
    case 'table': {
      const rows = t.children.filter((c): c is Tag => typeof c !== 'string' && c.name === 'tr')
        .map((tr) => tr.children.filter((c): c is Tag => typeof c !== 'string' && (c.name === 'td' || c.name === 'th'))
          .map((td) => render(td.children, base).replace(/\s*\n\s*/g, ' ').replace(/\|/g, '\\|').trim()))
      if (!rows.length) return ''
      const w = Math.max(...rows.map((r) => r.length))
      const line = (r: string[]) => `| ${[...r, ...Array(w - r.length).fill('')].join(' | ')} |`
      return block([line(rows[0]), `|${' --- |'.repeat(w)}`, ...rows.slice(1).map(line)].join('\n'))
    }
    default: return inner()
  }
}

export function bbcodeToMarkdown(src: string, opts: { baseUrl: string }): string {
  return render(parseBb(src.replace(/\r\n?/g, '\n')), opts.baseUrl)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
