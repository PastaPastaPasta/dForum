import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import { PostImage } from './PostImage'
import { Quote } from './Quote'

// Relative paths only when not protocol-relative (`//host` or `/\\host` would leave the site).
const SAFE = /^(https?:|mailto:|#|\/(?![/\\]))/i

/** Post bodies. No raw HTML; only http(s)/mailto/relative links; external links are ugc. */
export function Markdown({ source, className = 'post-body' }: { source: string; className?: string }) {
  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        skipHtml
        urlTransform={(url) => (SAFE.test(url.trim()) ? url : '')}
        components={{
          a: ({ href, children }) => {
            if (!href) return <span>{children}</span>
            const external = /^https?:/i.test(href)
            return (
              <a href={href} {...(external ? { rel: 'nofollow ugc noopener noreferrer', target: '_blank' } : {})}>
                {children}
              </a>
            )
          },
          blockquote: ({ children }) => <Quote>{children}</Quote>,
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
