import Link from 'next/link'

/** Page links: first, last, and a window around the current page. */
export function Pagination({ page, pages, href, label = 'Pages' }: { page: number; pages: number; href: (n: number) => string; label?: string }) {
  if (pages <= 1) return null
  const nums = new Set([1, pages, page - 2, page - 1, page, page + 1, page + 2].filter((n) => n >= 1 && n <= pages))
  const list = [...nums].sort((a, b) => a - b)
  const items: Array<number | 'gap'> = []
  list.forEach((n, i) => {
    if (i > 0 && n - list[i - 1] > 1) items.push('gap')
    items.push(n)
  })
  const cell = 'min-w-[2.5rem] h-10 px-2 inline-flex items-center justify-center rounded-md text-sm tabnum'
  return (
    <nav aria-label={label} className="flex flex-wrap items-center gap-1">
      {page > 1 && <Link href={href(page - 1)} className={`${cell} btn-quiet border`} rel="prev">Previous</Link>}
      {items.map((it, i) =>
        it === 'gap' ? (
          <span key={`g${i}`} aria-hidden className={`${cell} text-ink-2`}>…</span>
        ) : it === page ? (
          <span key={it} aria-current="page" aria-label={`Page ${it}, current`} className={`${cell} bg-dash text-dash-ink font-semibold`}>{it}</span>
        ) : (
          <Link key={it} href={href(it)} aria-label={`Page ${it}`} className={`${cell} text-ink hover:bg-sunk`}>{it}</Link>
        ),
      )}
      {page < pages && <Link href={href(page + 1)} className={`${cell} btn-quiet border`} rel="next">Next</Link>}
    </nav>
  )
}
