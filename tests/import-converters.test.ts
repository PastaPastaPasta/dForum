import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseForumPage, parseNodeIndex, parseThreadPage, parseCount, timeOf } from '@/lib/import/xf-html'
import { splitMarkdownByBytes, xfHtmlToMarkdown } from '@/lib/import/to-markdown'
import { bbcodeToMarkdown } from '@/lib/import/bbcode'
import { buildImportPlan, postChunks, postDocProps, threadDocProps, normalizeTags } from '@/lib/import/plan'
import { parse } from 'node-html-parser'

const F = (name: string) => readFileSync(`tests/fixtures/xenforo/${name}`, 'utf8')
const BASE = 'https://www.dash.org/forum/'
const md = (html: string) => xfHtmlToMarkdown(html, { baseUrl: BASE })
const bytes = (s: string) => new TextEncoder().encode(s).length

describe('XenForo page parsers', () => {
  it('reads the node index through Wayback, with ids, kinds and counts', () => {
    const { categories } = parseNodeIndex(F('node-index-wayback.html'), BASE)
    const currency = categories.find((c) => c.title === 'Dash Currency')
    expect(currency?.origId).toBe(1)
    const general = currency?.nodes.find((n) => n.title === 'General Discussion')
    expect(general).toMatchObject({ kind: 'forum', origId: 2, url: 'https://www.dash.org/forum/forums/general-discussion.2/', threads: 3800, messages: 43400 })
    expect(currency?.nodes.find((n) => n.title === 'Dash Guides')?.kind).toBe('category')
  })

  it('reads a forum thread list', () => {
    const page = parseForumPage(F('forum-list-152.html'), `${BASE}forums/dash-platform-dapps.152/`)
    expect(page.lastPage).toBe(1)
    expect(page.threads).toHaveLength(4)
    expect(page.threads[0]).toMatchObject({ origId: 53920, author: 'xkcd', authorId: 10365, sticky: true, replies: 4, createdAt: 1690051543000 })
    expect(page.threads.filter((t) => t.sticky)).toHaveLength(1)
  })

  it('reads a thread page: posts, authors, dates, pagination', () => {
    const page = parseThreadPage(F('t6.html'), `${BASE}threads/bison-wallet-integration-bugs-and-ux.55284/`)
    expect(page.title).toBe('Bison Wallet integration - bugs and UX')
    expect(page.lastPage).toBe(2)
    expect(page.posts).toHaveLength(20)
    expect(page.posts[0]).toMatchObject({ origId: 239476, author: 'GrandMasterDash', authorId: 3780, position: 1 })
    expect(page.posts.every((p) => p.createdAt > 1.4e12 && p.html.length > 0)).toBe(true)
  })

  it('parses counts and times', () => {
    expect(parseCount('18,226')).toBe(18226)
    expect(parseCount('1.2K')).toBe(1200)
    expect(parseCount('3M')).toBe(3_000_000)
    expect(timeOf(parse('<time data-time="1638785032"></time>').querySelector('time'))).toBe(1638785032000)
    expect(timeOf(parse('<time datetime="2021-12-06T10:03:52+0000"></time>').querySelector('time'))).toBe(Date.UTC(2021, 11, 6, 10, 3, 52))
  })
})

describe('HTML to Markdown', () => {
  it('keeps line breaks, emphasis and links', () => {
    expect(md('a<br />\nb <b>bold</b> <i>it</i> <s>gone</s>')).toBe('a\nb **bold** _it_ ~~gone~~')
    expect(md('<a href="https://x.org/a(1)" class="link link--external">x</a>')).toBe('[x](https://x.org/a%281%29)')
    expect(md('<a href="https://x.org/">https://x.org/</a>')).toBe('<https://x.org/>')
    expect(md('<a href="javascript:alert(1)">bad</a>')).toBe('bad')
  })
  it('converts quotes with attribution and drops the expander', () => {
    const out = md('<blockquote data-quote="Bob" class="bbCodeBlock bbCodeBlock--quote"><div class="bbCodeBlock-title">Bob said:</div><div class="bbCodeBlock-content"><div class="bbCodeBlock-expandContent">hi<br />there</div><div class="bbCodeBlock-expandLink"><a>Click to expand...</a></div></div></blockquote>after')
    expect(out).toBe('> **Bob said:**\n> hi\n> there\n\nafter')
  })
  it('fences code with a longer fence than its content', () => {
    const out = md('<div class="bbCodeBlock bbCodeBlock--code"><div class="bbCodeBlock-content"><pre class="bbCodeCode" data-lang="js"><code>a = ```x```</code></pre></div></div>')
    expect(out).toBe('````js\na = ```x```\n````')
  })
  it('converts lists, mentions, smilies, media and images', () => {
    expect(md('<ul><li>one</li><li>two<ul><li>deep</li></ul></li></ul>')).toBe('- one\n- two\n\n  - deep')
    expect(md('<a href="/forum/members/x.4/" class="username" data-user-id="4">@Bob</a> hi')).toBe('@Bob hi')
    expect(md('<img class="smilie" alt=":)" src="x.png" />')).toBe(':)')
    expect(md('<span class="bbMediaWrapper" data-media-site-id="youtube" data-media-key="abcdefg"></span>')).toBe('<https://www.youtube.com/watch?v=abcdefg>')
    expect(md('<img class="bbImage" src="/forum/attachments/x-png.12/" alt="x" />')).toBe('![x](https://www.dash.org/forum/attachments/x-png.12/)')
  })
  it('escapes markdown-significant text and never emits raw HTML', () => {
    expect(md('# not a heading')).toBe('\\# not a heading')
    expect(md('a &lt;script&gt; *b*')).toBe('a \\<script\\> \\*b\\*')
  })
  it('converts every fixture post without raw tags', () => {
    for (let i = 1; i <= 13; i++) {
      for (const p of parseThreadPage(F(`t${i}.html`), `${BASE}threads/x.1/`).posts) {
        const out = md(p.html)
        expect(out).not.toMatch(/(^|[^\\])<(?!https?:|mailto:)[a-z/][^>]*>/im)
      }
    }
  })
})

describe('BBCode to Markdown', () => {
  const bb = (s: string) => bbcodeToMarkdown(s, { baseUrl: BASE })
  it('handles the common tags', () => {
    expect(bb('[B]b[/B] [i]i[/i] [S]s[/S] [U]u[/U]')).toBe('**b** _i_ ~~s~~ u')
    expect(bb('[QUOTE="Alice, post: 1, member: 2"]hi [b]there[/b][/QUOTE]')).toBe('> **Alice said:**\n> hi **there**')
    expect(bb('[LIST=1][*]a[*]b[/LIST]')).toBe('1. a\n2. b')
    expect(bb('[URL=https://x.org/]x[/URL] [URL]https://y.org/[/URL]')).toBe('[x](https://x.org/) <https://y.org/>')
    expect(bb('[CODE=php]<?php [b]no[/b] ?>[/CODE]')).toBe('```php\n<?php [b]no[/b] ?>\n```')
    expect(bb('[MEDIA=youtube]dQw4w9WgXcQ[/MEDIA]')).toBe('<https://www.youtube.com/watch?v=dQw4w9WgXcQ>')
    expect(bb('[USER=4]@Bob[/USER]')).toBe('@Bob')
  })
  it('tolerates broken markup', () => {
    expect(bb('[b]open [i]nest[/b] tail [/i] [unknown]x')).toBe('**open _nest_** tail \\[/i\\] \\[unknown\\]x')
    expect(() => bb('[quote][quote][list][*]')).not.toThrow()
  })
})

describe('splitting and planning', () => {
  it('splits on paragraphs, keeps fences balanced and respects the byte limit', () => {
    const text = ['é'.repeat(40), '```\n' + 'line\n'.repeat(60) + '```', 'end '.repeat(50)].join('\n\n')
    const chunks = splitMarkdownByBytes(text, 120)
    expect(chunks.length).toBeGreaterThan(3)
    for (const c of chunks) {
      expect(bytes(c)).toBeLessThanOrEqual(120)
      expect((c.match(/^```/gm) ?? []).length % 2).toBe(0)
      expect(c).not.toContain('\uFFFD')
    }
    expect(chunks.join(' ').replace(/```\n/g, '').replace(/\s+/g, '')).toContain('é'.repeat(40))
  })
  it('maps crawled threads to contract-valid documents', () => {
    const thread = { origId: 7, forumOrigId: 2, title: 'Hi', author: 'a', createdAt: 1000, tags: ['Dash Platform', 'x!y', 'a', 'b', 'c', 'd'], posts: [{ origId: 70, author: 'a', authorId: 3, createdAt: 1000, markdown: 'x'.repeat(12000) }] }
    const t = threadDocProps(thread, 'F')
    expect(t).toMatchObject({ forumId: 'F', title: 'Hi.', origId: 7, origAuthor: 'a', origAuthorId: 3, origCreatedAt: 1000 })
    expect(t.tags).toEqual(['dash-platform', 'x-y', 'a', 'b', 'c'])
    const chunks = postChunks(thread.posts[0])
    expect(chunks).toHaveLength(2)
    for (const c of chunks) {
      expect(bytes(c.body)).toBeLessThanOrEqual(5120)
      if (c.body2) expect(bytes(c.body2)).toBeLessThanOrEqual(5120)
    }
    expect(postDocProps(thread, thread.posts[0], chunks[1], 1, 'T', 'F')).toMatchObject({ origId: 7001, origCreatedAt: 1001, threadId: 'T' })
    const plan = buildImportPlan({ categories: [{ origId: 1, title: 'c', forums: [{ origId: 2, kind: 'forum', threads: [7] }] }] }, [thread])
    expect(plan).toMatchObject({ threads: 1, posts: 1, continuations: 1 })
    expect(normalizeTags(['A B', 'a-b'])).toEqual(['a-b'])
  })
})
