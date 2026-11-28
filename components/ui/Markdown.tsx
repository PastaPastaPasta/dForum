import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import { PostImage } from './PostImage'
import { Quote } from './Quote'
import { remarkLegacySmilies } from '@/lib/import/smilies'

// Relative paths only when not protocol-relative (`//host` or `/\\host` would leave the site).
const SAFE = /^(https?:|mailto:|#|\/(?![/\\]))/i

type HastNode = { type?: string; tagName?: string; value?: string; children?: HastNode[] }
const textOf = (n?: HastNode): string =>
  !n || n.tagName === 'img' ? '' : n.type === 'text' ? n.value ?? '' : (n.children ?? []).map(textOf).join('')

/** XenForo attachment URLs end in "<name>-<ext>.<id>/": recover "name.ext". */
function fileNameOf(href: string): string {
  const slug = href.match(/\/attachments\/([^/?#]+)/)?.[1]?.replace(/\.\d+$/, '') ?? ''
  const m = slug.match(/^(.+)-([a-z0-9]{2,5})$/i)
  return decodeURIComponent(m ? `${m[1]}.${m[2]}` : slug)
}

/** Post bodies. No raw HTML; only http(s)/mailto/relative links; external links are ugc. */
export function Markdown({ source, className = 'post-body', attachmentsFrom }: {
  source: string
  className?: string
  /** Origin of the imported forum: its attachment links render as attachment chips. Only passed for
   * trusted archive posts, so nobody else can dress a link up as a forum attachment. */
  attachmentsFrom?: string
}) {
  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks, remarkLegacySmilies]}
        skipHtml
        urlTransform={(url) => (SAFE.test(url.trim()) ? url : '')}
        components={{
          a: ({ href, children, node }) => {
            if (!href) return <span>{children}</span>
            const external = /^https?:/i.test(href)
            // Imported attachments (often wrapping a thumbnail the old host won't serve here) become
            // one plain link to the original.
            if (attachmentsFrom && href.startsWith(attachmentsFrom) && /\/attachments\//.test(href)) {
              const label = textOf(node).replace(/^Attachment:?\s*/i, '').trim() || fileNameOf(href)
              return <a href={href} rel="nofollow ugc noopener noreferrer" target="_blank" className="attachment"><span aria-hidden>📎</span> {label || 'Attachment'}</a>
            }
            return (
              <a href={href} {...(external ? { rel: 'nofollow ugc noopener noreferrer', target: '_blank' } : {})}>
                {children}
              </a>
            )
          },
          blockquote: ({ children }) => <Quote>{children}</Quote>,
          // Wide code scrolls sideways; keyboard users need to be able to focus it to scroll.
          pre: ({ children }) => <pre tabIndex={0}>{children}</pre>,
          img: ({ src, alt }) =>
            src && /^https:\/\//i.test(String(src)) ? (
              <PostImage src={String(src)} alt={alt ?? ''} />
            ) : (
              <span>{alt}</span>
            ),
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  )
}
