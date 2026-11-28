import { describe, expect, it } from 'vitest'
import * as React from 'react'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Markdown } from '@/components/ui/Markdown'

// The components compile with the classic JSX runtime under vitest.
(globalThis as { React?: unknown }).React = React

const html = (source: string, attachmentsFrom?: string) => renderToStaticMarkup(createElement(Markdown, { source, attachmentsFrom }))

describe('post rendering', () => {
  it('maps legacy smiley codes in text but never in code', () => {
    const out = html('nice :grin:\n\n`:grin:` and ``x :grin: x``\n\n~~~\n:grin:\n~~~\n\n    :grin: indented')
    expect(out.match(/😁/g)).toHaveLength(1)
    expect(out).toContain('<code>:grin:</code>')
    expect(html('so :grin::grin: and :sad:')).toContain('so 😁😁 and 🙁')
  })
  it('makes attachment chips only for the archive origin', () => {
    expect(html('[Attachment: a.pdf](https://www.dash.org/forum/attachments/a.9/)', 'https://www.dash.org/')).toContain('📎</span> a.pdf')
    expect(html('[Attachment: a.exe](https://evil.example/attachments/1/)', 'https://www.dash.org/')).not.toContain('📎')
    expect(html('[Attachment: a.pdf](https://www.dash.org/forum/attachments/a.9/)')).not.toContain('📎')
    expect(html('[Attachment](https://www.dash.org/forum/attachments/img_0750-jpg.4914/)', 'https://www.dash.org/')).toContain('img_0750.jpg')
    expect(() => html('[](https://www.dash.org/forum/attachments/%E0%A4.1/)', 'https://www.dash.org/')).not.toThrow()
  })
  it('keeps links safe', () => {
    expect(html('[x](javascript:alert(1))')).not.toContain('javascript:')
    expect(html('[x](//evil.example)')).not.toContain('href="//evil')
  })
})
