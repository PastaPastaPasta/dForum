import Link from 'next/link'
import { ChevronLeft, ChevronRight } from 'lucide-react'

/** Full trail from `sm` up; on phones only a link back to the parent. */
export function Breadcrumbs({ items }: { items: Array<{ href: string; label: string }> }) {
  const parent = items.at(-1)
  return (
    <nav aria-label="Breadcrumb" className="text-sm text-ink-2">
      {parent && (
        <Link href={parent.href} className="tap -ml-1 inline-flex items-center gap-1 rounded px-1 hover:text-dash sm:hidden">
          <ChevronLeft aria-hidden className="h-4 w-4" />{parent.label}
        </Link>
      )}
      <ol className="hidden flex-wrap items-center gap-1 sm:flex">
        {items.map((it, i) => (
          <li key={it.href} className="flex items-center gap-1">
            {i > 0 && <ChevronRight aria-hidden className="h-3.5 w-3.5 opacity-60" />}
            <Link href={it.href} className="hover:text-dash">{it.label}</Link>
          </li>
        ))}
      </ol>
    </nav>
  )
}
