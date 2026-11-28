/**
 * XenForo 2 public page parsers (forum home, forum thread lists, thread pages). Works on pages
 * fetched directly or through the Wayback Machine (its URL prefixes are stripped).
 */
import { parse, HTMLElement } from 'node-html-parser'
import { absoluteUrl } from './to-markdown.ts'

export interface XfNode {
  kind: 'forum' | 'category' | 'link'
  origId: number
  title: string
  description: string
  url: string
  threads?: number
  messages?: number
}

export interface XfCategory {
  origId: number
  title: string
  description: string
  nodes: XfNode[]
}

export interface XfThreadItem {
  origId: number
  title: string
  url: string
  author: string
  authorId: number | null
  createdAt: number
  sticky: boolean
  locked: boolean
  replies: number | null
  prefix: string | null
}

export interface XfPost {
  origId: number
  author: string
  authorId: number | null
  createdAt: number
  position: number | null
  html: string
  editedAt: number | null
}

export function normalizeXfUrl(href: string, base: string): string {
  return absoluteUrl(href, base) ?? href
}

const text = (el: HTMLElement | null | undefined) => (el?.text ?? '').replace(/\s+/g, ' ').trim()

export function parseCount(s: string): number | undefined {
  const m = s.replace(/,/g, '').trim().match(/^([\d.]+)\s*([KkMm])?$/)
  if (!m) return undefined
  const n = Number(m[1]) * (m[2] ? (/[Kk]/.test(m[2]) ? 1e3 : 1e6) : 1)
  return Math.round(n)
}

/** ms since epoch from a XenForo <time> element. */
export function timeOf(el: HTMLElement | null | undefined): number | null {
  if (!el) return null
  for (const attr of ['data-timestamp', 'data-time']) {
    const v = el.getAttribute(attr)
    if (v && /^\d{9,11}$/.test(v)) return Number(v) * 1000
  }
  const dt = el.getAttribute('datetime')
  if (dt) {
    const ms = Date.parse(dt.replace(/([+-]\d{2})(\d{2})$/, '$1:$2'))
    if (Number.isFinite(ms)) return ms
  }
  return null
}

function idFromPath(url: string, kind: string): number {
  const m = url.match(new RegExp(`/${kind}/(?:[^/]*\\.)?(\\d+)/?`))
  return m ? Number(m[1]) : 0
}

function userIdOf(el: HTMLElement | null | undefined): number | null {
  if (!el) return null
  const v = el.getAttribute('data-user-id')
  if (v && /^\d+$/.test(v) && v !== '0') return Number(v)
  const href = el.getAttribute('href') ?? ''
  const m = href.match(/\/members\/(?:[^/]*\.)?(\d+)\/?/)
  return m ? Number(m[1]) : null
}

function statPairs(scope: HTMLElement | null): { threads?: number; messages?: number } {
  const out: { threads?: number; messages?: number } = {}
  for (const dl of scope?.querySelectorAll('dl') ?? []) {
    const k = text(dl.querySelector('dt')).toLowerCase()
    const v = parseCount(text(dl.querySelector('dd')))
    if (v === undefined) continue
    if (k.startsWith('thread') || k.startsWith('discussion')) out.threads = v
    else if (k.startsWith('message') || k.startsWith('post')) out.messages = v
  }
  return out
}

function parseNode(el: HTMLElement, base: string): XfNode | null {
  const a = el.querySelector('.node-title a')
  if (!a) return null
  const url = normalizeXfUrl(a.getAttribute('href') ?? '', base)
  const c = ` ${el.getAttribute('class') ?? ''} `
  const kind: XfNode['kind'] = c.includes(' node--forum ') || /\/forums\//.test(url)
    ? 'forum'
    : c.includes(' node--category ') || /\/categories\//.test(url) ? 'category' : 'link'
  const idClass = c.match(/ node--id(\d+) /)
  const origId = idClass ? Number(idClass[1]) : idFromPath(url, kind === 'forum' ? 'forums' : 'categories')
  return {
    kind, origId, title: text(a), description: text(el.querySelector('.node-description')), url,
    ...statPairs(el.querySelector('.node-stats')),
  }
}

function directNodes(container: HTMLElement | null, base: string): XfNode[] {
  if (!container) return []
  const nodes: XfNode[] = []
  for (const el of container.querySelectorAll('.node')) {
    // Skip nodes nested in another node's sub-node list.
    let p = el.parentNode as HTMLElement | null
    let nested = false
    while (p && p !== container) {
      if (` ${p.getAttribute?.('class') ?? ''} `.includes(' node ')) { nested = true; break }
      p = p.parentNode as HTMLElement | null
    }
    if (nested) continue
    const n = parseNode(el, base)
    if (n) nodes.push(n)
  }
  return nodes
}

export function parseNodeIndex(html: string, base: string): { categories: XfCategory[] } {
  const root = parse(html)
  const categories: XfCategory[] = []
  for (const blockEl of root.querySelectorAll('.block--category')) {
    const header = blockEl.querySelector('.block-header')
    const link = header?.querySelector('a')
    const anchor = link?.getAttribute('href') ?? ''
    const idClass = (blockEl.getAttribute('class') ?? '').match(/block--category(\d+)/)
    const origId = idClass ? Number(idClass[1]) : Number(anchor.match(/\.(\d+)$/)?.[1] ?? 0)
    const desc = text(header?.querySelector('.block-desc'))
    const title = text(link) || text(header).replace(desc, '').trim()
    categories.push({ origId, title, description: desc, nodes: directNodes(blockEl.querySelector('.block-body'), base) })
  }
  return { categories }
}

export function parseForumStatistics(html: string): { threads: number; messages: number; members: number } | null {
  const root = parse(html)
  const w = root.querySelector('[data-widget-definition="forum_statistics"]')
  if (!w) return null
  const out = { threads: 0, messages: 0, members: 0 }
  for (const dl of w.querySelectorAll('dl')) {
    const k = text(dl.querySelector('dt')).toLowerCase()
    const v = parseCount(text(dl.querySelector('dd'))) ?? 0
    if (k.startsWith('thread')) out.threads = v
    else if (k.startsWith('message')) out.messages = v
    else if (k.startsWith('member')) out.members = v
  }
  return out
}

function pages(root: HTMLElement): { page: number; lastPage: number } {
  const nums = root.querySelectorAll('.pageNav-main .pageNav-page').map((li) => Number(text(li))).filter(Number.isFinite)
  const current = Number(text(root.querySelector('.pageNav-main .pageNav-page--current'))) || 1
  return { page: current, lastPage: nums.length ? Math.max(...nums) : 1 }
}

export function parseForumPage(html: string, base: string) {
  const root = parse(html)
  const subNodes = directNodes(root.querySelector('.block--nodes .block-body') ?? root.querySelector('.block--nodes'), base)
  const threads: XfThreadItem[] = []
  for (const el of root.querySelectorAll('.structItem--thread')) {
    const titleLink = el.querySelectorAll('.structItem-title a').find((a) => /\/threads\//.test(a.getAttribute('href') ?? ''))
    if (!titleLink) continue
    const url = normalizeXfUrl(titleLink.getAttribute('href') ?? '', base)
    const idClass = (el.getAttribute('class') ?? '').match(/js-threadListItem-(\d+)/)
    const prefix = el.querySelector('.structItem-title .label')
    const repliesDl = el.querySelectorAll('.structItem-cell--meta dl').find((dl) => /repl/i.test(text(dl.querySelector('dt'))))
    threads.push({
      origId: idClass ? Number(idClass[1]) : idFromPath(url, 'threads'),
      title: text(titleLink),
      url,
      author: el.getAttribute('data-author') ?? text(el.querySelector('.structItem-parts .username')),
      authorId: userIdOf(el.querySelector('.structItem-parts .username') ?? el.querySelector('.structItem-iconContainer a')),
      createdAt: timeOf(el.querySelector('.structItem-startDate time')) ?? 0,
      sticky: !!el.querySelector('.structItem-status--sticky'),
      locked: !!el.querySelector('.structItem-status--locked'),
      replies: repliesDl ? parseCount(text(repliesDl.querySelector('dd'))) ?? null : null,
      prefix: prefix ? text(prefix) : null,
    })
  }
  const crumbs = root.querySelectorAll('.p-breadcrumbs a').map((a) => normalizeXfUrl(a.getAttribute('href') ?? '', base))
  return {
    title: text(root.querySelector('.p-title-value')),
    description: text(root.querySelector('.p-description')),
    origId: idFromPath(crumbs.at(-1) ?? base, 'forums') || null,
    ...pages(root),
    subNodes,
    threads,
  }
}

export function parseThreadPage(html: string, base: string) {
  const root = parse(html)
  const titleEl = root.querySelector('.p-title-value')
  const prefixText = titleEl?.querySelectorAll('.label').map((l) => text(l)).join(' ') ?? ''
  const title = text(titleEl).replace(prefixText, '').trim()
  const crumbs = root.querySelectorAll('.p-breadcrumbs a').map((a) => normalizeXfUrl(a.getAttribute('href') ?? '', base))
  const posts: XfPost[] = []
  for (const el of root.querySelectorAll('article.message--post')) {
    const idAttr = el.getAttribute('data-content') ?? el.getAttribute('id') ?? ''
    const origId = Number(idAttr.match(/(\d+)/)?.[1] ?? 0)
    if (!origId) continue
    const body = el.querySelector('.message-body .bbWrapper') ?? el.querySelector('.bbWrapper')
    const positionText = el.querySelectorAll('.message-attribution-opposite a').map((a) => text(a)).find((t) => /^#\d+/.test(t))
    const edited = el.querySelector('.message-lastEdit time')
    posts.push({
      origId,
      author: el.getAttribute('data-author') ?? text(el.querySelector('.message-name')),
      authorId: userIdOf(el.querySelector('.message-name a') ?? el.querySelector('.message-avatar a')),
      createdAt: timeOf(el.querySelector('.message-attribution-main time') ?? el.querySelector('time.u-dt')) ?? 0,
      position: positionText ? Number(positionText.replace(/[^\d]/g, '')) : null,
      html: body?.innerHTML ?? '',
      editedAt: timeOf(edited),
    })
  }
  return {
    origId: idFromPath(base, 'threads'),
    title,
    forumUrl: [...crumbs].reverse().find((u) => /\/forums\//.test(u)) ?? null,
    ...pages(root),
    tags: root.querySelectorAll('.tagList .tagItem').map((t) => text(t)).filter(Boolean),
    posts,
  }
}
